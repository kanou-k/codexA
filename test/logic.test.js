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
  assert.deepEqual(s.garden, { rows: 4, cols: 6, u: 0 });
  assert.deepEqual(s.deleted, {});
  assert.deepEqual(s.planters, []);
  assert.deepEqual(s.crops[0].spots, []);
  assert.deepEqual(L.normalizeState({ crops: [], logs: [], tasks: [], garden: { rows: 99, cols: 3 } }).garden, { rows: 4, cols: 3, u: 0 });
});

const blank = () => L.normalizeState({ crops: [], logs: [], tasks: [] });
const clone = (s) => JSON.parse(JSON.stringify(s));

test('同期：変更と削除に時刻が付く', () => {
  const base = blank();
  const s1 = clone(base);
  s1.crops.push({ id: 'a', name: 'トマト', spots: [] }, { id: 'b', name: 'ナス', spots: [] });
  L.stampChanges(base, s1, 100);
  assert.deepEqual(s1.crops.map((c) => [c.u, c.createdAt]), [[100, 100], [100, 100]]);

  const s2 = clone(s1);
  s2.crops[0].name = 'ミニトマト';
  s2.crops.splice(1, 1);
  s2.garden.rows = 5;
  L.stampChanges(s1, s2, 200);
  assert.equal(s2.crops[0].u, 200);
  assert.equal(s2.crops[0].createdAt, 100);
  assert.deepEqual(s2.deleted, { b: 200 });
  assert.equal(s2.garden.u, 200);

  const s3 = clone(s2);
  L.stampChanges(s2, s3, 300); // 変更なし
  assert.equal(s3.crops[0].u, 200);
  assert.equal(s3.garden.u, 200);
});

test('同期：別々の端末の編集がどちらも残る', () => {
  const base = blank();
  base.crops.push({ id: 'a', name: 'トマト', spots: [] }, { id: 'b', name: 'ナス', spots: [] });
  L.stampChanges(blank(), base, 100);

  const phone = clone(base); // スマホ：トマトを改名し、記録を追加
  phone.crops[0].name = 'ミニトマト';
  phone.logs.push({ id: 'l1', cropId: 'a', type: '水やり', date: '2026-11-20' });
  L.stampChanges(base, phone, 200);

  const pc = clone(base); // PC：ナスを削除し、畑を広げ、予定を追加
  pc.crops.splice(1, 1);
  pc.garden.cols = 8;
  pc.tasks.push({ id: 't1', title: '支柱', done: false });
  L.stampChanges(base, pc, 300);

  const m1 = L.mergeStates(phone, pc);
  const m2 = L.mergeStates(pc, phone);
  assert.deepEqual(m1, m2); // どちらの端末で突き合わせても同じ結果
  assert.deepEqual(m1.crops.map((c) => c.name), ['ミニトマト']);
  assert.equal(m1.logs.length, 1);
  assert.equal(m1.tasks.length, 1);
  assert.equal(m1.garden.cols, 8);
  assert.deepEqual(L.mergeStates(m1, phone), m1); // 古い端末と再度突き合わせても削除は復活しない
});

test('同期：削除より後の編集は残り、同時刻の編集も結果が一致する', () => {
  const a = blank(), b = blank();
  a.crops.push({ id: 'x', name: '後で編集', spots: [], u: 500, createdAt: 1 });
  b.deleted.x = 400;
  assert.equal(L.mergeStates(a, b).crops.length, 1);
  b.deleted.x = 500;
  assert.equal(L.mergeStates(a, b).crops.length, 0);

  const c = blank(), d = blank();
  c.tasks.push({ id: 't', title: 'A', u: 9 });
  d.tasks.push({ id: 't', title: 'B', u: 9 });
  assert.deepEqual(L.mergeStates(c, d), L.mergeStates(d, c));
});

test('同期先URLと合言葉の検証', () => {
  assert.equal(L.validDbUrl(' https://my-garden-default-rtdb.firebaseio.com/ '), 'https://my-garden-default-rtdb.firebaseio.com');
  assert.equal(L.validDbUrl('https://my-garden-default-rtdb.asia-southeast1.firebasedatabase.app'), 'https://my-garden-default-rtdb.asia-southeast1.firebasedatabase.app');
  for (const bad of ['http://x.firebaseio.com', 'https://evil.example.com', 'https://firebaseio.com.evil.example', 'https://x.firebaseio.com.evil.example', 'なし', '']) {
    assert.equal(L.validDbUrl(bad), '', bad);
  }
  assert.equal(L.validShareCode('abcdefghijklmnop'), true);
  assert.equal(L.validShareCode('short'), false);
  assert.equal(L.validShareCode('abcdefghijklmnop/../x'), false);
});
