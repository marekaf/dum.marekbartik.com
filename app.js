import {
  RESOLUTIONS, bestSuggestion, cadastralAreaItems, fitResolution, houseAreaItems, parcelLabel, parcelWhere, parseHash, parseHouseNumber,
  parseParcelNumber, ringsBounds, ringsToPath, splitSuggestion, tilesForView, toPixel, viewBounds,
} from './lib.js';

const RUIAN = 'https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/Vyhledavaci_sluzba_nad_daty_RUIAN/MapServer';
const TODAY_WMS = 'https://ags.cuzk.gov.cz/arcgis1/services/ORTOFOTO/MapServer/WMSServer';
const OLD_TILES = 'https://gis.cenia.cz/mapcache/ortofotomapa_historicka/wmts/1.0.0/orto/default/jtsk:epsg:5514';
const OLD_YEARS = 'https://gis.cenia.cz/geoserver/ortofotomapa_historicka_roky/wms';

// Layer and geocoder table numbers of the RÚIAN service.
const L = { parcelPoint: 0, address: 1, building: 3, parcel: 5, cadastralArea: 7, municipalityPart: 11, municipality: 12 };

const EXAMPLE = { kind: 'stavba', id: '21652228' };

const LAND_USE = {
  2: 'orná půda', 3: 'chmelnice', 4: 'vinice', 5: 'zahrada', 6: 'ovocný sad', 7: 'trvalý travní porost',
  8: 'trvalý travní porost', 10: 'lesní pozemek', 11: 'vodní plocha', 13: 'zastavěná plocha a nádvoří', 14: 'ostatní plocha',
};

const $ = (id) => document.getElementById(id);

async function getJson(url, params) {
  const full = `${url}?${new URLSearchParams(params)}`;
  const response = await fetch(full, { signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'service error');
  return data;
}

async function query(layer, where, outFields, geometry = false) {
  const data = await getJson(`${RUIAN}/${layer}/query`, { where, outFields, returnGeometry: geometry, outSR: 5514, f: 'json' });
  return data.features ?? [];
}

async function suggest(table, text) {
  const data = await getJson(`${RUIAN}/exts/GeocodeSOE/tables/${table}/suggest`, { text, f: 'json' });
  return data.suggestions ?? [];
}

function setStatus(text, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function setChoices(items) {
  const list = $('choices');
  list.replaceChildren();
  list.hidden = items.length === 0;
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = item.label;
    button.addEventListener('click', () => run(item.open));
    const li = document.createElement('li');
    li.append(button);
    list.append(li);
  }
}

let busy = 0;
async function run(task) {
  busy++;
  for (const b of document.querySelectorAll('.btn')) b.disabled = true;
  try {
    await task();
  } catch (error) {
    console.error(error);
    const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
    setStatus(timeout ? 'Služba ČÚZK neodpověděla včas. Zkuste to prosím za chvíli znovu.' : 'Hledání se nepodařilo. Služba ČÚZK teď možná neběží. Zkuste to prosím za chvíli znovu.', true);
  } finally {
    if (--busy === 0) for (const b of document.querySelectorAll('.btn')) b.disabled = false;
  }
}

class AreaPicker {
  constructor(input, list, load) {
    Object.assign(this, { input, list, load, picked: null, items: [], active: -1, timer: 0, serial: 0 });
    input.addEventListener('input', () => this.onInput());
    input.addEventListener('keydown', (e) => this.onKey(e));
    input.addEventListener('blur', () => setTimeout(() => this.close(), 150));
  }

  onInput() {
    this.picked = null;
    clearTimeout(this.timer);
    const text = this.input.value.trim();
    if (text.length < 2) return this.close();
    this.timer = setTimeout(async () => {
      const serial = ++this.serial;
      try {
        const items = await this.load(text);
        if (serial === this.serial && document.activeElement === this.input) this.open(items);
      } catch (error) {
        console.error(error);
      }
    }, 350);
  }

  open(items) {
    this.items = items;
    this.active = -1;
    this.list.replaceChildren(...items.map((item, i) => {
      const li = document.createElement('li');
      li.id = `${this.list.id}-${i}`;
      li.setAttribute('role', 'option');
      li.textContent = item.text;
      li.addEventListener('pointerdown', (e) => { e.preventDefault(); this.pick(item); });
      return li;
    }));
    this.list.hidden = items.length === 0;
    this.input.setAttribute('aria-expanded', String(items.length > 0));
  }

  close() {
    this.list.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
  }

  pick(item) {
    this.picked = item;
    this.input.value = item.text;
    this.close();
  }

  onKey(e) {
    if (this.list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = this.items.length;
      this.active = (this.active + (e.key === 'ArrowDown' ? 1 : n - 1) + (this.active < 0 && e.key === 'ArrowUp' ? 1 : 0)) % n;
      [...this.list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === this.active)));
      this.input.setAttribute('aria-activedescendant', this.list.children[this.active].id);
      this.list.children[this.active].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && this.active >= 0) {
      e.preventDefault();
      this.pick(this.items[this.active]);
    } else if (e.key === 'Escape') {
      this.close();
    }
  }

  // Returns the picked item, or null after it showed the visitor what to do.
  async resolve(kindName) {
    clearTimeout(this.timer);
    this.serial++;
    let item = this.picked;
    if (!item) {
      const text = this.input.value.trim();
      const items = text.length >= 2 ? await this.load(text) : [];
      item = bestSuggestion(text, items);
      if (!item) {
        if (items.length) {
          this.open(items);
          this.input.focus();
          setStatus(`Vyberte ${kindName} ze seznamu pod polem.`);
        } else {
          setStatus(`${kindName[0].toUpperCase()}${kindName.slice(1)} „${text}“ jsme nenašli. Zkontrolujte prosím název.`, true);
        }
        return null;
      }
      this.pick(item);
    }
    return item;
  }
}

const SUGGEST_LIMIT = 8;

async function suggestedRows(layer, text) {
  const list = (await suggest(layer, text)).slice(0, SUGGEST_LIMIT);
  if (!list.length) return [];
  const found = await query(layer, `objectid IN (${list.map((s) => Number(s.magicKey)).join(',')})`, layer === L.municipality ? 'objectid,kod,nazev' : 'objectid,kod,nazev,obec');
  const byId = new Map(found.map((f) => [f.attributes.objectid, f.attributes]));
  return list.flatMap((s) => {
    const row = byId.get(Number(s.magicKey));
    return row ? [{ code: row.kod, name: row.nazev, townCode: row.obec, district: splitSuggestion(s.text).district }] : [];
  });
}

async function loadHouseAreas(text) {
  const [towns, parts, areas] = await Promise.all([L.municipality, L.municipalityPart, L.cadastralArea].map((layer) => suggestedRows(layer, text)));
  const townNames = new Map(towns.map((t) => [t.code, t.name]));
  const missing = [...new Set([...parts, ...areas].map((r) => r.townCode))].filter((code) => !townNames.has(code));
  if (missing.length) {
    for (const f of await query(L.municipality, `kod IN (${missing.map(Number).join(',')})`, 'kod,nazev')) townNames.set(f.attributes.kod, f.attributes.nazev);
  }
  return houseAreaItems({ towns, parts, areas }, townNames);
}

async function loadCadastralAreas(text) {
  return cadastralAreaItems(await suggest(L.cadastralArea, text));
}

const stage = $('stage');
const view = { cx: 0, cy: 0, res: RESOLUTIONS[1], width: 0, height: 0 };
let shapes = { parcel: null, building: null };
let split = 0.5;
let todayImage = null;
let todayTimer = 0;
let todaySerial = 0;
let frame = 0;
const tileImages = new Map();

function draw() {
  frame = 0;
  view.width = stage.clientWidth;
  view.height = stage.clientHeight;
  if (!view.width || !view.height) return;

  const wanted = new Set();
  for (const t of tilesForView(view, window.devicePixelRatio || 1)) {
    const src = `${OLD_TILES}/${t.level}/${t.row}/${t.col}.jpgpng`;
    wanted.add(src);
    let img = tileImages.get(src);
    if (!img) {
      img = new Image();
      img.alt = '';
      img.decoding = 'async';
      img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
      img.src = src;
      tileImages.set(src, img);
      $('layer-old').append(img);
    }
    Object.assign(img.style, { left: `${t.left}px`, top: `${t.top}px`, width: `${t.size + 0.5}px`, height: `${t.size + 0.5}px` });
  }
  for (const [src, img] of tileImages) {
    if (!wanted.has(src)) { img.remove(); tileImages.delete(src); }
  }

  if (todayImage) placeToday(todayImage);
  $('outline').setAttribute('viewBox', `0 0 ${view.width} ${view.height}`);
  $('outline-parcel').setAttribute('d', shapes.parcel ? ringsToPath(view, shapes.parcel) : '');
  $('outline-building').setAttribute('d', shapes.building ? ringsToPath(view, shapes.building) : '');
  $('zoom-in').disabled = view.res <= RESOLUTIONS[0];
  $('zoom-out').disabled = view.res >= RESOLUTIONS[RESOLUTIONS.length - 1];

  clearTimeout(todayTimer);
  todayTimer = setTimeout(loadSettled, 350);
}

function redraw() {
  if (!frame) frame = requestAnimationFrame(draw);
}

// The today image covers the bounds it was requested for. Position it for the current view.
function placeToday(img) {
  const b = img.bounds;
  const [left, top] = toPixel(view, b.minX, b.maxY);
  Object.assign(img.style, { left: `${left}px`, top: `${top}px`, width: `${(b.maxX - b.minX) / view.res}px`, height: `${(b.maxY - b.minY) / view.res}px` });
}

function loadSettled() {
  const serial = ++todaySerial;
  const b = viewBounds(view);
  const scale = Math.min(window.devicePixelRatio || 1, 2, 2048 / Math.max(view.width, view.height));
  const params = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap', LAYERS: '0', STYLES: '', SRS: 'EPSG:5514', FORMAT: 'image/jpeg',
    BBOX: [b.minX, b.minY, b.maxX, b.maxY].map((n) => n.toFixed(2)).join(','),
    WIDTH: Math.round(view.width * scale), HEIGHT: Math.round(view.height * scale),
  });
  const img = new Image();
  img.alt = '';
  img.bounds = b;
  img.addEventListener('load', () => {
    if (serial !== todaySerial) return;
    todayImage?.remove();
    todayImage = img;
    placeToday(img);
    $('layer-today').append(img);
  });
  img.src = `${TODAY_WMS}?${params}`;

  const half = view.res * 50;
  getJson(OLD_YEARS, {
    SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetFeatureInfo', LAYERS: 'ortofotomapa_historicka_roky', QUERY_LAYERS: 'ortofotomapa_historicka_roky',
    STYLES: '', SRS: 'EPSG:5514', BBOX: [view.cx - half, view.cy - half, view.cx + half, view.cy + half].map((n) => n.toFixed(2)).join(','),
    WIDTH: 101, HEIGHT: 101, X: 50, Y: 50, INFO_FORMAT: 'application/json', FEATURE_COUNT: 1, propertyName: 'rok',
  }).then((data) => {
    if (serial !== todaySerial) return;
    const year = data.features?.[0]?.properties?.rok;
    $('label-old').textContent = /^\d{4}$/.test(year ?? '') ? `rok ${year}` : '50. léta';
  }).catch(() => {
    if (serial === todaySerial) $('label-old').textContent = '50. léta';
  });
}

function setSplit(value) {
  split = Math.max(0, Math.min(1, value));
  const percent = split * 100;
  $('layer-old').style.clipPath = `inset(0 ${100 - percent}% 0 0)`;
  $('handle').style.left = `${percent}%`;
  $('handle').setAttribute('aria-valuenow', String(Math.round(percent)));
}

function zoom(step) {
  const i = RESOLUTIONS.indexOf(view.res) + step;
  if (i < 0 || i >= RESOLUTIONS.length) return;
  view.res = RESOLUTIONS[i];
  redraw();
}

function setupStage() {
  const pointers = new Map();
  let pinch = 0;

  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.zoom, .handle')) return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    pinch = 0;
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 1) {
      view.cx -= (e.clientX - last[0]) * view.res;
      view.cy += (e.clientY - last[1]) * view.res;
      redraw();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (!pinch) pinch = distance;
      else if (distance > pinch * 1.5) { zoom(-1); pinch = distance; }
      else if (distance < pinch / 1.5) { zoom(1); pinch = distance; }
    }
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    pinch = 0;
    if (!pointers.size) stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('dblclick', (e) => { if (!e.target.closest('.zoom, .handle')) zoom(-1); });

  const handle = $('handle');
  let sliding = false;
  handle.addEventListener('pointerdown', (e) => { sliding = true; handle.setPointerCapture(e.pointerId); e.preventDefault(); });
  handle.addEventListener('pointermove', (e) => {
    if (!sliding) return;
    const box = stage.getBoundingClientRect();
    setSplit((e.clientX - box.left) / box.width);
  });
  const stop = () => { sliding = false; };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -0.05, ArrowRight: 0.05, Home: -1, End: 1 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    setSplit(split + step);
  });

  $('zoom-in').addEventListener('click', () => zoom(-1));
  $('zoom-out').addEventListener('click', () => zoom(1));
  new ResizeObserver(redraw).observe(stage);
  setSplit(0.5);
}

function showPlace({ title, facts, parcelRings, buildingRings, point, hash }) {
  $('result').hidden = false;
  $('result-title').textContent = title;
  $('facts').replaceChildren(...facts.filter(Boolean).map((text) => Object.assign(document.createElement('li'), { textContent: text })));
  shapes = { parcel: parcelRings ?? null, building: buildingRings ?? null };
  $('legend').textContent = [
    parcelRings ? 'Žlutá čára je hranice parcely.' : '',
    buildingRings ? 'Bílá čárkovaná čára je obrys budovy.' : '',
    !parcelRings && !buildingRings ? 'Pro toto místo nemá RÚIAN obrys, mapa je jen vystředěná na místo.' : '',
  ].filter(Boolean).join(' ');

  view.width = stage.clientWidth;
  view.height = stage.clientHeight;
  const bounds = ringsBounds([...(parcelRings ?? []), ...(buildingRings ?? [])]);
  if (bounds) {
    view.cx = (bounds.minX + bounds.maxX) / 2;
    view.cy = (bounds.minY + bounds.maxY) / 2;
    view.res = Math.max(fitResolution(bounds, view.width, view.height), RESOLUTIONS[2]);
  } else {
    view.cx = point.x;
    view.cy = point.y;
    view.res = RESOLUTIONS[2];
  }
  todayImage?.remove();
  todayImage = null;
  $('label-old').textContent = '50. léta';
  redraw();
  setStatus('');
  setChoices([]);
  if (hash && location.hash !== `#${hash}`) history.replaceState(null, '', `#${hash}`);
  if (hash) $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function areaName(code) {
  const rows = await query(L.cadastralArea, `kod=${Number(code)}`, 'nazev');
  return rows[0]?.attributes.nazev ?? '';
}

function parcelFacts(attrs, area) {
  return [
    `Parcela ${parcelLabel(attrs)}, katastrální území ${area}`,
    attrs.vymeraparcely ? `Výměra: ${Number(attrs.vymeraparcely).toLocaleString('cs-CZ')} m²` : '',
    LAND_USE[attrs.druhpozemkukod] ? `Druh pozemku dnes: ${LAND_USE[attrs.druhpozemkukod]}` : '',
  ];
}

const PARCEL_FIELDS = 'id,kmenovecislo,poddelenicisla,druhcislovanikod,druhpozemkukod,vymeraparcely,katastralniuzemi';

async function findParcels(where) {
  const polygons = await query(L.parcel, where, PARCEL_FIELDS, true);
  if (polygons.length) return polygons;
  return query(L.parcelPoint, where, PARCEL_FIELDS, true);
}

async function openParcel(feature, area, updateHash = true) {
  const a = feature.attributes;
  const name = area ?? await areaName(a.katastralniuzemi);
  showPlace({
    title: `Parcela ${parcelLabel(a)}, ${name}`,
    facts: parcelFacts(a, name),
    parcelRings: feature.geometry?.rings,
    point: feature.geometry,
    hash: updateHash ? `parcela=${Math.round(a.id)}` : '',
  });
}

async function openBuilding(code, updateHash = true) {
  const rows = await query(L.building, `kod=${Number(code)}`, 'kod,cisladomovni,identifikacniparcela,typstavebnihoobjektukod,castobce', true);
  if (!rows.length) return setStatus('Tuto budovu už RÚIAN neeviduje.', true);
  const b = rows[0];
  const a = b.attributes;
  const [addresses, parts, parcels] = await Promise.all([
    query(L.address, `stavebniobjekt=${a.kod}`, 'adresa', true),
    query(L.municipalityPart, `kod=${Number(a.castobce)}`, 'nazev'),
    a.identifikacniparcela ? findParcels(`id=${Math.round(a.identifikacniparcela)}`) : [],
  ]);
  const parcel = parcels[0];
  const part = parts[0]?.attributes.nazev ?? '';
  const number = `${a.typstavebnihoobjektukod === 2 ? 'č.ev.' : 'č.p.'} ${a.cisladomovni}`;
  const area = parcel ? await areaName(parcel.attributes.katastralniuzemi) : '';
  const point = b.geometry?.rings ? null : (addresses[0]?.geometry ?? parcel?.geometry);
  if (!b.geometry?.rings && !parcel?.geometry?.rings && !point) return setStatus('Pro tuto budovu nemá RÚIAN polohu.', true);
  showPlace({
    title: addresses[0]?.attributes.adresa ?? `${number}, ${part}`,
    facts: [`Budova ${number}, část obce ${part}`, ...(parcel ? parcelFacts(parcel.attributes, area) : [])],
    parcelRings: parcel?.geometry?.rings,
    buildingRings: b.geometry?.rings,
    point,
    hash: updateHash ? `stavba=${a.kod}` : '',
  });
}

async function searchParcel(picker) {
  setChoices([]);
  const parcel = parseParcelNumber($('parcel-number').value);
  if (!parcel) return setStatus('Číslo parcely zadejte jako 123, 123/4 nebo st. 56.', true);
  setStatus('Hledám parcelu…');
  const picked = await picker.resolve('katastrální území');
  if (!picked) return;
  const rows = await query(L.cadastralArea, `objectid=${Number(picked.magicKey)}`, 'kod,nazev');
  if (!rows.length) throw new Error('cadastral area not found by objectid');
  const area = { code: rows[0].attributes.kod, name: rows[0].attributes.nazev };
  const typed = $('parcel-number').value.trim();
  const found = await findParcels(parcelWhere(area.code, parcel));
  if (!found.length) {
    const missing = `Parcela ${typed} v katastrálním území ${picked.text} podle RÚIAN neexistuje.`;
    const others = (await loadCadastralAreas(area.name)).filter((o) => o.magicKey !== picked.magicKey);
    const otherRows = others.length ? await query(L.cadastralArea, `objectid IN (${others.map((o) => Number(o.magicKey)).join(',')})`, 'objectid,kod') : [];
    const labelOf = new Map(otherRows.map((r) => [r.attributes.kod, others.find((o) => Number(o.magicKey) === r.attributes.objectid)?.text]));
    const elsewhere = labelOf.size ? await findParcels(parcelWhere([...labelOf.keys()], parcel)) : [];
    if (!elsewhere.length) {
      return setStatus(`${missing} Zkontrolujte číslo a katastrální území. Stavební parcelu zadejte jako „st. 56“.`, true);
    }
    setStatus(`${missing} Parcela s tímto číslem je v katastrálním území s podobným názvem:`, true);
    return setChoices(elsewhere.map((f) => ({
      label: `Parcela ${parcelLabel(f.attributes)}, katastrální území ${labelOf.get(f.attributes.katastralniuzemi)}`,
      open: () => openParcel(f),
    })));
  }
  if (found.length === 1) return openParcel(found[0], area.name);
  setStatus('Tomu číslu odpovídá víc parcel. Vyberte jednu:');
  setChoices(found.map((f) => ({
    label: `${f.attributes.druhcislovanikod === 1 ? 'Stavební parcela' : 'Pozemková parcela'} ${parcelLabel(f.attributes)}, ${LAND_USE[f.attributes.druhpozemkukod] ?? ''}`,
    open: () => openParcel(f, area.name),
  })));
}

async function searchHouse(picker) {
  setChoices([]);
  const house = parseHouseNumber($('house-number').value);
  if (!house) return setStatus('Číslo popisné zadejte jako číslo, například 223.', true);
  setStatus('Hledám dům…');
  const town = await picker.resolve('obec nebo část obce');
  if (!town) return;
  const partsWhere = town.kind === 'cast' ? `kod=${Number(town.code)}` : `obec=${Number(town.kind === 'ku' ? town.townCode : town.code)}`;
  const parts = await query(L.municipalityPart, partsWhere, 'kod,nazev');
  if (!parts.length) return setStatus(`Místo ${town.name} nemá v RÚIAN žádnou část obce.`, true);
  const partNames = new Map(parts.map((p) => [p.attributes.kod, p.attributes.nazev]));
  const where = `castobce IN (${[...partNames.keys()].map(Number).join(',')}) AND cisladomovni='${house.number}'${house.registration ? ' AND typstavebnihoobjektukod=2' : ''}`;
  const buildings = (await query(L.building, where, 'kod,cisladomovni,typstavebnihoobjektukod,castobce'))
    .sort((x, y) => x.attributes.typstavebnihoobjektukod - y.attributes.typstavebnihoobjektukod);
  if (!buildings.length) return setStatus(`Dům s číslem ${house.number} v místě ${town.name} jsme nenašli.`, true);
  if (buildings.length === 1) return openBuilding(buildings[0].attributes.kod);

  const shown = buildings.slice(0, 60);
  const addresses = await query(L.address, `stavebniobjekt IN (${shown.map((b) => b.attributes.kod).join(',')})`, 'stavebniobjekt,adresa');
  const addressOf = new Map(addresses.map((r) => [r.attributes.stavebniobjekt, r.attributes.adresa]));
  setStatus(`V místě ${town.name} je víc domů s číslem ${house.number}. Vyberte jeden:`);
  setChoices(shown.map((b) => {
    const a = b.attributes;
    const fallback = `${a.typstavebnihoobjektukod === 2 ? 'č.ev.' : 'č.p.'} ${a.cisladomovni}, ${partNames.get(a.castobce) ?? ''}`;
    return { label: addressOf.get(a.kod) ?? fallback, open: () => openBuilding(a.kod) };
  }).sort((x, y) => x.label.localeCompare(y.label, 'cs')));
}

async function openFromHash(target, updateHash) {
  if (target.kind === 'stavba') return openBuilding(target.id, updateHash);
  const found = await findParcels(`id=${target.id}`);
  if (!found.length) return setStatus('Tuto parcelu už RÚIAN neeviduje.', true);
  return openParcel(found[0], undefined, updateHash);
}

function setupTabs() {
  const tabs = [$('tab-house'), $('tab-parcel')];
  const select = (tab) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    }
    setStatus('');
    setChoices([]);
  };
  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const other = tabs[1 - tabs.indexOf(tab)];
      select(other);
      other.focus();
    });
  }
}

setupTabs();
setupStage();
const housePicker = new AreaPicker($('house-area'), $('house-area-list'), loadHouseAreas);
const parcelPicker = new AreaPicker($('parcel-area'), $('parcel-area-list'), loadCadastralAreas);
$('form-house').addEventListener('submit', (e) => { e.preventDefault(); run(() => searchHouse(housePicker)); });
$('form-parcel').addEventListener('submit', (e) => { e.preventDefault(); run(() => searchParcel(parcelPicker)); });
window.addEventListener('hashchange', () => {
  const target = parseHash(location.hash);
  if (target) run(() => openFromHash(target, true));
});

const start = parseHash(location.hash);
run(async () => {
  await openFromHash(start ?? EXAMPLE, Boolean(start));
  if (!start) setStatus('Ukázka: Národní divadlo v Praze. Vedle něj dnes stojí Nová scéna, v 50. letech tam byly domy.');
});
