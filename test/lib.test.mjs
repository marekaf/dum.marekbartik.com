import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bestSuggestion, cadastralAreaItems, fitResolution, foldText, houseAreaItems, parcelLabel, parcelWhere, parseHash, parseHouseNumber,
  parseParcelNumber, RESOLUTIONS, ringsBounds, ringsToPath, splitSuggestion, tileLevel, tilesForView, toPixel,
} from '../lib.js';

test('tile level follows the view resolution and the pixel ratio', () => {
  assert.equal(tileLevel(1024.128), 0);
  assert.equal(tileLevel(0.25003125), 12);
  assert.equal(tileLevel(RESOLUTIONS[1]), 12);
  assert.equal(tileLevel(RESOLUTIONS[2]), 11);
  assert.equal(tileLevel(RESOLUTIONS[2], 2), 12);
  assert.equal(tileLevel(RESOLUTIONS[0]), 12);
  assert.equal(tileLevel(RESOLUTIONS[7]), 6);
  assert.equal(tileLevel(5000), 0);
});

test('the view around the National Theatre uses the tile the service returned for it', () => {
  const view = { cx: -743456, cy: -1043620, res: 0.25003125, width: 100, height: 100 };
  const tiles = tilesForView(view);
  assert.ok(tiles.some((t) => t.level === 12 && t.col === 1418 && t.row === 965));
  const tile = tiles.find((t) => t.col === 1418 && t.row === 965);
  assert.ok(Math.abs(tile.size - 512) < 1e-6);
  const [px, py] = toPixel(view, -743473.312, -1043535.44);
  assert.ok(Math.abs(px - tile.left) < 1e-3);
  assert.ok(Math.abs(py - tile.top) < 1e-3);
});

test('tiles stay inside the grid at the edge of the coverage', () => {
  const tiles = tilesForView({ cx: -925000, cy: -920000, res: 8, width: 400, height: 400 });
  assert.ok(tiles.length > 0);
  assert.ok(tiles.every((t) => t.col >= 0 && t.row >= 0));
});

test('fit picks the finest step that keeps the shape in view', () => {
  const small = { minX: 0, minY: 0, maxX: 20, maxY: 20 };
  assert.equal(fitResolution(small, 360, 360), RESOLUTIONS[1]);
  const field = { minX: 0, minY: 0, maxX: 400, maxY: 100 };
  assert.equal(fitResolution(field, 360, 360), RESOLUTIONS[5]);
  const huge = { minX: 0, minY: 0, maxX: 90000, maxY: 90000 };
  assert.equal(fitResolution(huge, 360, 360), RESOLUTIONS[7]);
});

test('rings give bounds and an svg path', () => {
  const rings = [[[0, 0], [10, 0], [10, 10], [0, 0]]];
  assert.deepEqual(ringsBounds(rings), { minX: 0, minY: 0, maxX: 10, maxY: 10 });
  assert.equal(ringsBounds([]), null);
  const path = ringsToPath({ cx: 5, cy: 5, res: 1, width: 10, height: 10 }, rings);
  assert.equal(path, 'M0.0 10.0L10.0 10.0L10.0 0.0L0.0 10.0Z');
});

test('parcel numbers', () => {
  assert.deepEqual(parseParcelNumber('123'), { building: false, base: 123, sub: null });
  assert.deepEqual(parseParcelNumber(' 123/4 '), { building: false, base: 123, sub: 4 });
  assert.deepEqual(parseParcelNumber('st. 77'), { building: true, base: 77, sub: null });
  assert.deepEqual(parseParcelNumber('St.77/2'), { building: true, base: 77, sub: 2 });
  assert.deepEqual(parseParcelNumber('p.č. 15/3'), { building: false, base: 15, sub: 3 });
  assert.equal(parseParcelNumber('abc'), null);
  assert.equal(parseParcelNumber("1 OR 1=1"), null);
  assert.equal(parseParcelNumber(''), null);
});

test('house numbers', () => {
  assert.deepEqual(parseHouseNumber('223'), { number: 223, registration: false });
  assert.deepEqual(parseHouseNumber('č.p. 223'), { number: 223, registration: false });
  assert.deepEqual(parseHouseNumber('čp 223/2'), { number: 223, registration: false });
  assert.deepEqual(parseHouseNumber('č.ev. 12'), { number: 12, registration: true });
  assert.equal(parseHouseNumber("223' OR '1'='1"), null);
  assert.equal(parseHouseNumber('Národní'), null);
});

test('parcel query text holds numbers only', () => {
  assert.equal(parcelWhere(727181, { building: false, base: 160, sub: 1 }), 'katastralniuzemi=727181 AND kmenovecislo=160 AND poddelenicisla=1');
  assert.equal(parcelWhere([1, '2'], { building: false, base: 7, sub: 3 }), 'katastralniuzemi IN (1,2) AND kmenovecislo=7 AND poddelenicisla=3');
  assert.equal(parcelWhere('727181', { building: true, base: 5, sub: null }), 'katastralniuzemi=727181 AND kmenovecislo=5 AND poddelenicisla IS NULL AND druhcislovanikod=1');
});

test('parcel label', () => {
  assert.equal(parcelLabel({ kmenovecislo: 160, poddelenicisla: 1, druhcislovanikod: 2 }), '160/1');
  assert.equal(parcelLabel({ kmenovecislo: 5, poddelenicisla: null, druhcislovanikod: 1 }), 'st. 5');
});

test('suggestion match ignores accents, case and the district in brackets', () => {
  const list = [{ text: 'Nové Město u Mikulova (Teplice)' }, { text: 'Nové Město' }, { text: 'Telč (Jihlava)' }];
  assert.equal(foldText('  NOVÉ   Město '), 'nove mesto');
  assert.equal(bestSuggestion('nove mesto', list).text, 'Nové Město');
  assert.equal(bestSuggestion('telc', list).text, 'Telč (Jihlava)');
  assert.equal(bestSuggestion('nove', list), null);
  assert.equal(bestSuggestion('x', [{ text: 'Xaverov' }]).text, 'Xaverov');
  const twins = [{ text: 'Nová Ves (Liberec)' }, { text: 'Nová Ves (Brno-venkov)' }];
  assert.equal(bestSuggestion('Nová Ves', twins), null);
  assert.equal(bestSuggestion('Nová Ves', [...twins].reverse()), null);
  assert.equal(bestSuggestion('nova ves (liberec)', twins).text, 'Nová Ves (Liberec)');
});

test('hash', () => {
  assert.deepEqual(parseHash('#stavba=21652228'), { kind: 'stavba', id: '21652228' });
  assert.deepEqual(parseHash('#parcela=2070575101'), { kind: 'parcela', id: '2070575101' });
  assert.equal(parseHash('#stavba=1 OR 1=1'), null);
  assert.equal(parseHash(''), null);
});

test('suggestion text splits into name and district', () => {
  assert.deepEqual(splitSuggestion('Telč-Štěpnice (Jihlava)'), { name: 'Telč-Štěpnice', district: 'Jihlava' });
  assert.deepEqual(splitSuggestion('Nové Město'), { name: 'Nové Město', district: '' });
});

test('a name that is only a part of a municipality is offered and picked', () => {
  const townNames = new Map([[588024, 'Telč']]);
  const items = houseAreaItems({
    towns: [],
    parts: [{ code: 413425, name: 'Telč-Štěpnice', district: 'Jihlava', townCode: 588024 }],
    areas: [],
  }, townNames);
  assert.deepEqual(items, [{ kind: 'cast', code: 413425, name: 'Telč-Štěpnice', text: 'Telč-Štěpnice, část obce Telč (okres Jihlava)' }]);
  assert.equal(bestSuggestion('stepnice', items).code, 413425);
});

test('a part and a cadastral area with the name of the place above them are not repeated', () => {
  const townNames = new Map([[1, 'Lhota'], [2, 'Velká Ves']]);
  const items = houseAreaItems({
    towns: [{ code: 1, name: 'Lhota', district: 'Kladno' }],
    parts: [
      { code: 11, name: 'Lhota', district: 'Kladno', townCode: 1 },
      { code: 21, name: 'Lhota', district: 'Kladno', townCode: 2 },
    ],
    areas: [
      { code: 101, name: 'Lhota', district: 'Kladno', townCode: 1 },
      { code: 201, name: 'Lhota', district: 'Kladno', townCode: 2 },
      { code: 202, name: 'Lhota u Vsi', district: 'Kladno', townCode: 2 },
    ],
  }, townNames);
  assert.deepEqual(items.map((i) => i.text), [
    'Lhota (okres Kladno)',
    'Lhota, část obce Velká Ves (okres Kladno)',
    'Lhota u Vsi, katastrální území v obci Velká Ves (okres Kladno)',
  ]);
  assert.equal(bestSuggestion('lhota', items), null);
  assert.equal(bestSuggestion('LHOTA U VSI', items).kind, 'ku');
});

test('two cadastral areas with one name stay apart and keep their own id', () => {
  const items = cadastralAreaItems([
    { text: 'Lhota (Kladno)', magicKey: '11' },
    { text: 'Lhota (Zlín)', magicKey: '22' },
    { text: 'Lhota u Vsi (Kladno)', magicKey: '33' },
    { text: 'Josefov', magicKey: '44' },
  ]);
  assert.deepEqual(items.map((i) => i.text), ['Lhota (okres Kladno)', 'Lhota (okres Zlín)', 'Lhota u Vsi (okres Kladno)', 'Josefov']);
  assert.equal(bestSuggestion('lhota', items), null);
  assert.equal(bestSuggestion('Lhota (okres Zlín)', items).magicKey, '22');
  assert.equal(bestSuggestion('lhota u vsi', items).magicKey, '33');
  assert.equal(bestSuggestion('josefov', items).magicKey, '44');
});
