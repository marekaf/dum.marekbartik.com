// All coordinates are S-JTSK (EPSG:5514) metres: x grows east, y grows north, both are negative.

// Tile grid of the CENIA WMTS matrix set "jtsk:epsg:5514": 512 px tiles, level 0 is one tile.
export const GRID = { originX: -925000, originY: -920000, tileSize: 512, res0: 1024.128, maxLevel: 12 };

// Metres per screen pixel the map can show, as multiples of the deepest tile level (about 0.25 m),
// so a tile is never resampled by an odd factor. The first step stretches that level to double size.
export const RESOLUTIONS = [0.5, 1, 2, 4, 8, 16, 32, 64].map((k) => (k * GRID.res0) / 2 ** GRID.maxLevel);

export function levelResolution(level) {
  return GRID.res0 / 2 ** level;
}

export function viewBounds(view) {
  const halfW = (view.width / 2) * view.res;
  const halfH = (view.height / 2) * view.res;
  return { minX: view.cx - halfW, maxX: view.cx + halfW, minY: view.cy - halfH, maxY: view.cy + halfH };
}

export function tileLevel(res, pixelRatio = 1) {
  const wanted = Math.ceil(Math.log2(GRID.res0 / (res / pixelRatio)) - 1e-9);
  return Math.max(0, Math.min(GRID.maxLevel, wanted));
}

export function tilesForView(view, pixelRatio = 1) {
  const level = tileLevel(view.res, pixelRatio);
  const tileRes = levelResolution(level);
  const span = GRID.tileSize * tileRes;
  const b = viewBounds(view);
  const last = 2 ** level - 1;
  const clamp = (n) => Math.max(0, Math.min(last, n));
  const col0 = clamp(Math.floor((b.minX - GRID.originX) / span));
  const col1 = clamp(Math.floor((b.maxX - GRID.originX) / span));
  const row0 = clamp(Math.floor((GRID.originY - b.maxY) / span));
  const row1 = clamp(Math.floor((GRID.originY - b.minY) / span));
  const size = span / view.res;
  const tiles = [];
  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) {
      tiles.push({
        level,
        row,
        col,
        left: (GRID.originX + col * span - b.minX) / view.res,
        top: (b.maxY - (GRID.originY - row * span)) / view.res,
        size,
      });
    }
  }
  return tiles;
}

export function toPixel(view, x, y) {
  const b = viewBounds(view);
  return [(x - b.minX) / view.res, (b.maxY - y) / view.res];
}

export function ringsBounds(rings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

export function fitResolution(bounds, width, height, room = 2.5) {
  const need = Math.max(((bounds.maxX - bounds.minX) * room) / width, ((bounds.maxY - bounds.minY) * room) / height);
  const usable = RESOLUTIONS.slice(1);
  return usable.find((r) => r >= need) ?? usable[usable.length - 1];
}

export function ringsToPath(view, rings) {
  return rings
    .map((ring) => ring.map(([x, y], i) => {
      const [px, py] = toPixel(view, x, y);
      return `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`;
    }).join('') + 'Z')
    .join('');
}

// Accepts "123", "123/4", "st. 123", "st.123/4", "p.č. 123/4". Returns null for anything else.
export function parseParcelNumber(text) {
  const m = /^\s*(?:(st)\.?\s*|p\.?\s*č\.?\s*|parc\.?\s*č\.?\s*)?(\d{1,5})(?:\s*\/\s*(\d{1,4}))?\s*$/i.exec(text ?? '');
  if (!m) return null;
  return { building: Boolean(m[1]), base: Number(m[2]), sub: m[3] === undefined ? null : Number(m[3]) };
}

// Accepts "223", "č.p. 223", "čp 223", "č.ev. 12", "223/2" (the part after the slash is the street number).
export function parseHouseNumber(text) {
  const m = /^\s*(?:(č\.?\s*p\.?|č\.?\s*ev\.?|c\.?\s*p\.?|c\.?\s*ev\.?)\s*)?(\d{1,5})(?:\s*\/\s*\d{1,4}\s*[a-z]?)?\s*$/i.exec(text ?? '');
  if (!m) return null;
  return { number: Number(m[2]), registration: /ev/i.test(m[1] ?? '') };
}

export function parcelWhere(areaCode, parcel) {
  const parts = [
    Array.isArray(areaCode) ? `katastralniuzemi IN (${areaCode.map(Number).join(',')})` : `katastralniuzemi=${Number(areaCode)}`,
    `kmenovecislo=${Number(parcel.base)}`,
    parcel.sub === null ? 'poddelenicisla IS NULL' : `poddelenicisla=${Number(parcel.sub)}`,
  ];
  if (parcel.building) parts.push('druhcislovanikod=1');
  return parts.join(' AND ');
}

export function parcelLabel(attrs) {
  const number = attrs.poddelenicisla == null ? `${attrs.kmenovecislo}` : `${attrs.kmenovecislo}/${attrs.poddelenicisla}`;
  return attrs.druhcislovanikod === 1 ? `st. ${number}` : number;
}

export function foldText(text) {
  return (text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Returns a suggestion only when the typed text points at exactly one. Many names repeat across
// districts ("Nová Ves (Liberec)", "Nová Ves (Brno-venkov)"), and a guess would show another village.
export function bestSuggestion(typed, suggestions) {
  if (suggestions.length === 1) return suggestions[0];
  const want = foldText(typed);
  const names = suggestions.map((s) => foldText(s.text));
  let hits = suggestions.filter((_, i) => names[i] === want);
  if (!hits.length) hits = suggestions.filter((s, i) => (s.name ? foldText(s.name) : names[i].replace(/\s*\(.*\)$/, '')) === want);
  return hits.length === 1 ? hits[0] : null;
}

// The geocoder writes a suggestion as "Name (District)", and as "Name" alone inside Prague.
export function splitSuggestion(text) {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(text ?? '');
  return m ? { name: m[1].trim(), district: m[2].trim() } : { name: (text ?? '').trim(), district: '' };
}

// magicKey is the row id of the cadastral area. It goes into the lookup, because several areas
// share one name and differ only by district.
export function cadastralAreaItems(suggestions) {
  return suggestions.map((s) => {
    const { name, district } = splitSuggestion(s.text);
    return { magicKey: s.magicKey, name, district, text: district ? `${name} (okres ${district})` : name };
  });
}

// Builds the one list a visitor picks a place from in the house search. A part of a municipality
// and a cadastral area usually repeat the name of the place above them, so a row is dropped when
// a row above it already covers the same houses under the same name.
// towns: [{ code, name, district }], parts and areas: [{ code, name, district, townCode }].
export function houseAreaItems({ towns = [], parts = [], areas = [] }, townNames = new Map()) {
  const district = (d) => (d ? ` (okres ${d})` : '');
  const key = (townCode, name) => `${townCode}|${foldText(name)}`;
  const covered = new Set(towns.map((t) => key(t.code, t.name)));
  const items = towns.map((t) => ({ kind: 'obec', code: t.code, name: t.name, text: `${t.name}${district(t.district)}` }));
  for (const p of parts) {
    if (covered.has(key(p.townCode, p.name))) continue;
    covered.add(key(p.townCode, p.name));
    items.push({ kind: 'cast', code: p.code, name: p.name, text: `${p.name}, část obce ${townNames.get(p.townCode) ?? '?'}${district(p.district)}` });
  }
  for (const a of areas) {
    if (covered.has(key(a.townCode, a.name))) continue;
    covered.add(key(a.townCode, a.name));
    items.push({ kind: 'ku', code: a.code, townCode: a.townCode, name: a.name, text: `${a.name}, katastrální území v obci ${townNames.get(a.townCode) ?? '?'}${district(a.district)}` });
  }
  return items;
}

// RÚIAN ties a building to a cadastral area only through the parcel it stands on.
export function buildingsOnParcels(buildings, parcelIds) {
  const wanted = new Set(parcelIds.map((id) => Math.round(id)));
  return buildings.filter((b) => wanted.has(Math.round(b.attributes.identifikacniparcela)));
}

export function slugify(text) {
  return foldText(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
}

// The number is the RÚIAN id and alone decides what opens. The words after it only make the link readable.
export function placeHash(kind, id, title) {
  const slug = slugify(title);
  return slug ? `${kind}/${id}/${slug}` : `${kind}/${id}`;
}

export function parseHash(hash) {
  const m = /^#?(parcela|stavba)[=/](\d{1,15})(?:\/[^/]*)?$/.exec(hash ?? '');
  return m ? { kind: m[1], id: m[2] } : null;
}
