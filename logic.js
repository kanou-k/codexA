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

  // ---- 畑の図 ----
  // 場所キー：畑のマスは "f:行:列"、プランターは "p:プランターID"
  const fieldKey = (r, c) => `f:${r}:${c}`;
  const planterKey = (id) => `p:${id}`;
  // 場所キー → そこに植わっている栽培中の作物
  function occupancy(crops) {
    const map = new Map();
    for (const c of crops) {
      if (c.ended) continue;
      for (const k of c.spots || []) map.set(k, c);
    }
    return map;
  }
  function spotLabel(key, planters) {
    if (key.startsWith('p:')) {
      const p = planters.find((x) => planterKey(x.id) === key);
      return p ? p.name : '';
    }
    const [, r, c] = key.split(':');
    return `畑${Number(r) + 1}-${Number(c) + 1}`;
  }
  function cropLocation(crop, planters) {
    const labels = (crop.spots || []).map((k) => spotLabel(k, planters)).filter(Boolean);
    const parts = [];
    if (crop.bed) parts.push(crop.bed);
    if (labels.length > 3) parts.push(`${labels.slice(0, 3).join('・')} ほか${labels.length - 3}か所`);
    else if (labels.length) parts.push(labels.join('・'));
    return parts.join(' / ');
  }
  // 畑を小さくしたとき、はみ出たマスの記録を外す
  function clipSpots(crops, rows, cols) {
    for (const c of crops) {
      c.spots = (c.spots || []).filter((k) => {
        if (!k.startsWith('f:')) return true;
        const [, r, col] = k.split(':').map(Number);
        return r < rows && col < cols;
      });
    }
  }
  // 古い形式のデータにも畑・プランターの項目を補う
  function normalizeState(s) {
    const g = s.garden || {};
    const size = (v, d) => (Number.isInteger(v) && v >= 1 && v <= 10 ? v : d);
    return {
      crops: s.crops.map((c) => ({ ...c, spots: Array.isArray(c.spots) ? c.spots : [] })),
      logs: s.logs,
      tasks: s.tasks,
      garden: { rows: size(g.rows, 4), cols: size(g.cols, 6), u: g.u || 0 },
      planters: Array.isArray(s.planters) ? s.planters : [],
      deleted: s.deleted && typeof s.deleted === 'object' ? s.deleted : {},
    };
  }

  // ---- 端末間の同期 ----
  // 各レコードに更新時刻 u を付け、削除は deleted[id] = 時刻 として残す。
  // 端末どうしはレコード単位で新しい方を採るので、別々の端末での編集が互いを消さない。
  const COLLECTIONS = ['crops', 'logs', 'tasks', 'planters'];
  const sansU = (rec) => JSON.stringify({ ...rec, u: 0 });

  // prev（前回保存時点）と比べて、変わったレコードに時刻を付け、消えたレコードを deleted に記録する
  function stampChanges(prev, next, now) {
    next.deleted = { ...prev.deleted, ...next.deleted };
    for (const col of COLLECTIONS) {
      const before = new Map(prev[col].map((r) => [r.id, r]));
      for (const rec of next[col]) {
        const old = before.get(rec.id);
        if (!old) rec.createdAt = rec.createdAt || now;
        if (!old || sansU(old) !== sansU(rec)) rec.u = now;
        before.delete(rec.id);
      }
      for (const id of before.keys()) next.deleted[id] = now;
    }
    if (prev.garden.rows !== next.garden.rows || prev.garden.cols !== next.garden.cols) next.garden.u = now;
    return next;
  }
  // 同じ更新時刻のときも両端末で同じ結果になるよう、内容の文字列比較で決める
  const newer = (a, b) => {
    const ua = a.u || 0, ub = b.u || 0;
    return ua !== ub ? ua > ub : JSON.stringify(a) > JSON.stringify(b);
  };
  function mergeStates(a, b) {
    const deleted = { ...a.deleted };
    for (const [id, t] of Object.entries(b.deleted)) deleted[id] = Math.max(deleted[id] || 0, t);
    const out = { deleted };
    for (const col of COLLECTIONS) {
      const byId = new Map();
      for (const rec of [...a[col], ...b[col]]) {
        const cur = byId.get(rec.id);
        if (!cur || newer(rec, cur)) byId.set(rec.id, rec);
      }
      out[col] = [...byId.values()]
        .filter((r) => !(r.id in deleted) || deleted[r.id] < (r.u || 0))
        .sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0) || (x.id < y.id ? -1 : 1));
    }
    out.garden = newer(b.garden, a.garden) ? b.garden : a.garden;
    return normalizeState(out);
  }
  // 同期先は Firebase Realtime Database だけを許可する（リンク経由で他所へ送らせない）
  function validDbUrl(input) {
    try {
      const u = new URL(String(input).trim());
      const ok = /^[a-z0-9-]+\.firebaseio\.com$|^[a-z0-9-]+\.[a-z0-9-]+\.firebasedatabase\.app$/.test(u.hostname);
      return u.protocol === 'https:' && ok ? u.origin : '';
    } catch (e) {
      return '';
    }
  }
  const validShareCode = (code) => /^[A-Za-z0-9_-]{16,64}$/.test(code || '');

  return {
    fieldKey, planterKey, occupancy, spotLabel, cropLocation, clipSpots, normalizeState, stampChanges, mergeStates, validDbUrl, validShareCode,
    PRESETS, LOG_TYPES, todayStr, addDays, daysBetween, findPreset, suggestHarvestDate,
    plantableIn, lastLogDate, harvestTotals, formatGrams, todoItems, isValidState,
  };
});
