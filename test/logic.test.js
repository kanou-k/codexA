const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');

test('日付の加算と差分（月・年またぎ）', () => {
  assert.equal(L.addDays('2026-12-25', 10), '2027-01-04');
  assert.equal(L.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(L.daysBetween('2026-11-20', '2026-12-01'), 11);
  assert.equal(L.daysBetween('2026-12-01', '2026-11-20'), -11);
});

test('収穫目安日の提案', () => {
  assert.equal(L.suggestHarvestDate('コマツナ', '2026-04-01'), '2026-05-06');
  assert.equal(L.suggestHarvestDate(' コマツナ ', '2026-04-01'), '2026-05-06');
  assert.equal(L.suggestHarvestDate('知らない野菜', '2026-04-01'), '');
  assert.equal(L.suggestHarvestDate('コマツナ', ''), '');
});

test('月ごとの植えどき', () => {
  assert.ok(L.plantableIn(11).includes('タマネギ'));
  assert.ok(!L.plantableIn(11).includes('トマト'));
});

test('収穫量の集計は年と作業種別で絞る', () => {
  const crops = [{ id: 'a', name: 'トマト' }, { id: 'b', name: 'ナス' }];
  const logs = [
    { cropId: 'a', type: '収穫', date: '2026-07-01', amount: '300' },
    { cropId: 'a', type: '収穫', date: '2026-07-05', amount: '900' },
    { cropId: 'b', type: '収穫', date: '2026-07-05', amount: '' },
    { cropId: 'a', type: '収穫', date: '2025-07-05', amount: '5000' },
    { cropId: 'a', type: '水やり', date: '2026-07-05', amount: '' },
    { cropId: 'x', type: '収穫', date: '2026-08-01', amount: '50' },
  ];
  assert.deepEqual(L.harvestTotals(logs, crops, 2026), [
    { name: 'トマト', grams: 1200, count: 2 },
    { name: '（作物なし）', grams: 50, count: 1 },
    { name: 'ナス', grams: 0, count: 1 },
  ]);
  assert.equal(L.formatGrams(1200), '1.2 kg');
  assert.equal(L.formatGrams(2000), '2 kg');
  assert.equal(L.formatGrams(850), '850 g');
});

test('最後の作業日', () => {
  const logs = [
    { cropId: 'a', type: '水やり', date: '2026-07-01' },
    { cropId: 'a', type: '水やり', date: '2026-07-09' },
    { cropId: 'a', type: '追肥', date: '2026-07-20' },
  ];
  assert.equal(L.lastLogDate(logs, 'a', '水やり'), '2026-07-09');
  assert.equal(L.lastLogDate(logs, 'b', '水やり'), '');
});

test('今日やること', () => {
  const state = {
    tasks: [
      { id: 't1', title: '支柱', due: '2026-11-18', done: false },
      { id: 't2', title: '済み', due: '2026-11-18', done: true },
      { id: 't3', title: '来週', due: '2026-11-27', done: false },
    ],
    crops: [
      { id: 'c1', name: 'カブ', harvestOn: '2026-11-25' },
      { id: 'c2', name: 'ネギ', harvestOn: '2026-11-10' },
      { id: 'c3', name: '終了', harvestOn: '2026-11-10', ended: true },
      { id: 'c4', name: '先', harvestOn: '2027-01-10' },
    ],
    logs: [],
  };
  const items = L.todoItems(state, '2026-11-20');
  assert.deepEqual(items.map((i) => i.id), ['c2', 't1', 'c1']);
  assert.equal(items[1].overdue, true);
  assert.match(items[2].text, /あと5日/);
});

test('読み込みデータの検証', () => {
  assert.equal(L.isValidState({ crops: [], logs: [], tasks: [] }), true);
  assert.equal(L.isValidState({ crops: [] }), false);
  assert.equal(L.isValidState(null), false);
});

test('畑の図：場所と作物の対応', () => {
  const planters = [{ id: 'p1', name: 'プランター1', side: 'right' }];
  const crops = [
    { id: 'a', name: 'トマト', spots: ['f:0:0', 'f:0:1', 'p:p1'] },
    { id: 'b', name: 'ナス', spots: ['f:1:0'], ended: true },
    { id: 'c', name: 'カブ', bed: '東側', spots: ['f:3:5', 'f:0:2', 'f:1:1', 'f:1:2', 'f:1:3'] },
  ];
  const occ = L.occupancy(crops);
  assert.equal(occ.get('f:0:1').name, 'トマト');
  assert.equal(occ.get('p:p1').name, 'トマト');
  assert.equal(occ.has('f:1:0'), false); // 終了した作物は空き扱い
  assert.equal(L.cropLocation(crops[0], planters), '畑1-1・畑1-2・プランター1');
  assert.equal(L.cropLocation(crops[2], planters), '東側 / 畑4-6・畑1-3・畑2-2 ほか2か所');
  L.clipSpots(crops, 2, 3);
  assert.deepEqual(crops[2].spots, ['f:0:2', 'f:1:1', 'f:1:2']);
  assert.deepEqual(crops[0].spots, ['f:0:0', 'f:0:1', 'p:p1']);
});

test('古いデータに畑の項目を補う', () => {
  const s = L.normalizeState({ crops: [{ id: 'a', name: 'x' }], logs: [], tasks: [] });
  assert.deepEqual(s.garden, { rows: 4, cols: 6 });
  assert.deepEqual(s.planters, []);
  assert.deepEqual(s.crops[0].spots, []);
  assert.deepEqual(L.normalizeState({ crops: [], logs: [], tasks: [], garden: { rows: 99, cols: 3 } }).garden, { rows: 4, cols: 3 });
});
