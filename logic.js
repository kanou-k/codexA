// 画面に依存しない計算ロジック（ブラウザと Node の両方で読み込める）
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GardenLogic = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // 植えどき（月）と収穫までの日数の目安。中間地の一般的な値で、地域・品種により前後する。
  const PRESETS = [
    { name: 'トマト', days: 60, months: [4, 5] },
    { name: 'ミニトマト', days: 55, months: [4, 5] },
    { name: 'キュウリ', days: 45, months: [4, 5, 6] },
    { name: 'ナス', days: 60, months: [4, 5] },
    { name: 'ピーマン', days: 60, months: [4, 5] },
    { name: 'オクラ', days: 60, months: [5, 6] },
    { name: 'エダマメ', days: 85, months: [4, 5, 6] },
    { name: 'トウモロコシ', days: 85, months: [4, 5] },
    { name: 'ジャガイモ', days: 100, months: [2, 3, 8, 9] },
    { name: 'サツマイモ', days: 130, months: [5, 6] },
    { name: 'ダイコン', days: 65, months: [3, 4, 8, 9] },
    { name: 'ニンジン', days: 110, months: [3, 4, 7, 8] },
    { name: 'カブ', days: 50, months: [3, 4, 9, 10] },
    { name: 'ラディッシュ', days: 30, months: [3, 4, 5, 9, 10] },
    { name: 'ホウレンソウ', days: 45, months: [3, 4, 9, 10] },
    { name: 'コマツナ', days: 35, months: [3, 4, 5, 6, 7, 8, 9, 10] },
    { name: 'レタス', days: 60, months: [3, 4, 9, 10] },
    { name: 'キャベツ', days: 100, months: [3, 4, 8, 9] },
    { name: 'ブロッコリー', days: 95, months: [8, 9] },
    { name: 'ハクサイ', days: 80, months: [8, 9] },
    { name: 'ネギ', days: 120, months: [3, 4, 9] },
    { name: 'タマネギ', days: 200, months: [11] },
    { name: 'ニンニク', days: 240, months: [9, 10] },
    { name: 'ソラマメ', days: 200, months: [10, 11] },
    { name: 'エンドウ', days: 190, months: [10, 11] },
    { name: 'イチゴ', days: 210, months: [10, 11] },
  ];

  const LOG_TYPES = ['水やり', '追肥', '手入れ', '防除', '収穫', 'その他'];

  const pad = (n) => String(n).padStart(2, '0');
  const toStr = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const parse = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };

  function todayStr(now = new Date()) {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
  function addDays(s, n) {
    const d = parse(s);
    d.setUTCDate(d.getUTCDate() + n);
    return toStr(d);
  }
  // b - a（日数）
  function daysBetween(a, b) {
    return Math.round((parse(b) - parse(a)) / 86400000);
  }
  function findPreset(name) {
    const n = (name || '').trim();
    return PRESETS.find((p) => p.name === n) || null;
  }
  function suggestHarvestDate(name, plantedOn) {
    const p = findPreset(name);
    return p && plantedOn ? addDays(plantedOn, p.days) : '';
  }
  function plantableIn(month) {
    return PRESETS.filter((p) => p.months.includes(month)).map((p) => p.name);
  }
  function lastLogDate(logs, cropId, type) {
    let last = '';
    for (const l of logs) {
      if (l.cropId === cropId && l.type === type && l.date > last) last = l.date;
    }
    return last;
  }
  // 指定年の収穫量を作物ごとに集計（多い順）
  function harvestTotals(logs, crops, year) {
    const names = new Map(crops.map((c) => [c.id, c.name]));
    const sums = new Map();
    for (const l of logs) {
      if (l.type !== '収穫' || !l.date.startsWith(String(year))) continue;
      const name = names.get(l.cropId) || '（作物なし）';
      const cur = sums.get(name) || { name, grams: 0, count: 0 };
      cur.grams += Number(l.amount) || 0;
      cur.count += 1;
      sums.set(name, cur);
    }
    return [...sums.values()].sort((a, b) => b.grams - a.grams || b.count - a.count);
  }
  function formatGrams(g) {
    return g >= 1000 ? `${(g / 1000).toFixed(g % 1000 === 0 ? 0 : 1)} kg` : `${g} g`;
  }
  // 今日やること：期日が来たタスクと、収穫予定が近い（7日以内・超過含む）栽培中の作物
  function todoItems(state, today) {
    const items = [];
    for (const t of state.tasks) {
      if (!t.done && t.due && t.due <= today) {
        items.push({ kind: 'task', id: t.id, text: t.title, overdue: t.due < today, date: t.due });
      }
    }
    for (const c of state.crops) {
      if (c.ended || !c.harvestOn) continue;
      const left = daysBetween(today, c.harvestOn);
      if (left <= 7) {
        items.push({
          kind: 'harvest', id: c.id, date: c.harvestOn, overdue: false,
          text: left > 0 ? `${c.name}：あと${left}日で収穫の目安` : `${c.name}：収穫の目安を過ぎています`,
        });
      }
    }
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }
  function isValidState(s) {
    return !!s && ['crops', 'logs', 'tasks'].every((k) => Array.isArray(s[k]));
  }

  return {
    PRESETS, LOG_TYPES, todayStr, addDays, daysBetween, findPreset, suggestHarvestDate,
    plantableIn, lastLogDate, harvestTotals, formatGrams, todoItems, isValidState,
  };
});
