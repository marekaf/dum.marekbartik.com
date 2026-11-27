import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bestSuggestion, fitResolution, foldText, parcelLabel, parcelWhere, parseHash, parseHouseNumber,
  parseParcelNumber, RESOLUTIONS, ringsBounds, ringsToPath, tileLevel, tilesForView, toPixel,
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
});

test('hash', () => {
  assert.deepEqual(parseHash('#stavba=21652228'), { kind: 'stavba', id: '21652228' });
  assert.deepEqual(parseHash('#parcela=2070575101'), { kind: 'parcela', id: '2070575101' });
  assert.equal(parseHash('#stavba=1 OR 1=1'), null);
  assert.equal(parseHash(''), null);
});
