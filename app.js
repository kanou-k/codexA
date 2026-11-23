(() => {
  const L = GardenLogic;
  const KEY = 'saien-v1';
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const fmtDate = (s) => (s ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : '');

  let state = load();
  let tab = 'home';
  let showEnded = false;
  let logFilter = '';

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (L.isValidState(s)) return L.normalizeState(s);
    } catch (e) { /* 壊れたデータは無視して空で始める */ }
    return L.normalizeState({ crops: [], logs: [], tasks: [] });
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      alert('保存できませんでした。ブラウザの保存領域を確認してください。');
    }
  }
  const clone = (s) => JSON.parse(JSON.stringify(s));
  let baseline = clone(state); // 前回保存時点。変更箇所の検出に使う
  function commit() {
    L.stampChanges(baseline, state, Date.now());
    baseline = clone(state);
    save();
    render();
    scheduleSync(1000);
  }

  // ---------- 端末間の同期（Firebase Realtime Database） ----------
  const SYNC_KEY = 'saien-sync';
  let sync = null; // { url, code }
  try {
    const s = JSON.parse(localStorage.getItem(SYNC_KEY));
    if (s && L.validDbUrl(s.url) && L.validShareCode(s.code)) sync = s;
  } catch (e) { /* 設定なしとして扱う */ }
  let syncing = false;
  let syncAgain = false;
  let syncTimer = 0;
  let syncNote = '';
  function setSyncNote(text, isError) {
    syncNote = text;
    const el = $('#sync-status');
    el.textContent = text;
    el.classList.toggle('error', !!isError);
    const inView = $('#sync-note');
    if (inView) inView.textContent = text;
  }
  function scheduleSync(ms) {
    if (!sync) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, ms);
  }
  async function syncNow() {
    if (!sync) return;
    if (syncing) { syncAgain = true; return; }
    if (dlg.open) return scheduleSync(5000); // 入力中は画面を書き換えない
    syncing = true;
    setSyncNote('同期中…');
    const endpoint = `${sync.url}/gardens/${sync.code}.json`;
    try {
      const res = await fetch(endpoint, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      let remote = null;
      if (body && typeof body.data === 'string') {
        const parsed = JSON.parse(body.data);
        if (L.isValidState(parsed)) remote = L.normalizeState(parsed);
      }
      if (dlg.open) { scheduleSync(5000); return; }
      // ここから送信開始までは同期処理なので、途中で state が変わることはない
      const merged = remote ? L.mergeStates(state, remote) : state;
      if (JSON.stringify(merged) !== JSON.stringify(state)) {
        state = merged;
        baseline = clone(state);
        save();
        render();
      }
      if (!remote || JSON.stringify(merged) !== JSON.stringify(remote)) {
        const put = await fetch(endpoint, { method: 'PUT', body: JSON.stringify({ data: JSON.stringify(merged), u: Date.now() }) });
        if (!put.ok) throw new Error(`HTTP ${put.status}`);
      }
      const t = new Date();
      setSyncNote(`同期済み ${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`);
    } catch (e) {
      const denied = /HTTP 40[13]/.test(e.message);
      setSyncNote(denied ? '同期できません（Firebaseのルール設定を確認）' : navigator.onLine === false ? 'オフライン（つながったら同期します）' : `同期できません（${e.message}）`, true);
    } finally {
      syncing = false;
      if (syncAgain) { syncAgain = false; scheduleSync(500); }
    }
  }
  function setSync(next) {
    sync = next;
    try {
      if (sync) localStorage.setItem(SYNC_KEY, JSON.stringify(sync));
      else localStorage.removeItem(SYNC_KEY);
    } catch (e) { /* 保存できなくてもこの回は動く */ }
    setSyncNote('');
    render();
    if (sync) syncNow();
  }
  const newShareCode = () => {
    const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    return [...crypto.getRandomValues(new Uint8Array(24))].map((b) => chars[b % chars.length]).join('');
  };
  const shareLink = () => `${location.href.split('#')[0]}#${new URLSearchParams({ db: sync.url, code: sync.code })}`;
  function syncForm() {
    openForm('端末間の共有を設定', `
      <label>FirebaseのデータベースURL<input name="url" required inputmode="url" placeholder="https://〇〇-default-rtdb.firebaseio.com"></label>
      <label>合言葉<input name="code" required minlength="16" maxlength="64" pattern="[A-Za-z0-9_\\-]+" value="${newShareCode()}" autocomplete="off"></label>
      <p class="hint">合言葉を知っている端末だけがデータを読み書きできます。1台目は自動で作られたものをそのまま使い、2台目以降は1台目の「共有リンク」を開くと入力なしで参加できます。</p>`,
    (d) => {
      const url = L.validDbUrl(d.url);
      if (!url || !L.validShareCode(d.code)) {
        setTimeout(() => alert(url ? '合言葉は半角英数字16文字以上にしてください。' : 'FirebaseのデータベースURLを確認してください。'));
        return;
      }
      setTimeout(() => setSync({ url, code: d.code }));
    });
  }
  // 共有リンク（#db=…&code=…）から開いたときは、確認のうえ共有に参加する
  function joinFromLink() {
    if (!location.hash.includes('code=')) return;
    const p = new URLSearchParams(location.hash.slice(1));
    const url = L.validDbUrl(p.get('db'));
    const code = p.get('code');
    history.replaceState(null, '', location.href.split('#')[0]);
    if (!url || !L.validShareCode(code)) return alert('共有リンクが正しくありません。');
    if (sync && sync.url === url && sync.code === code) return;
    if (confirm(`この端末を菜園データの共有に参加させますか？\n同期先：${url}\nこの端末にあるデータは、共有先のデータと合わせて残ります。`)) setSync({ url, code });
  }

  const cropName = (id) => state.crops.find((c) => c.id === id)?.name || '';
  const empty = (msg) => `<p class="empty">${msg}</p>`;

  // ---------- 各画面 ----------
  function viewHome() {
    const today = L.todayStr();
    const year = today.slice(0, 4);
    const growing = state.crops.filter((c) => !c.ended).length;
    const grams = L.harvestTotals(state.logs, state.crops, year).reduce((a, r) => a + r.grams, 0);
    const openTasks = state.tasks.filter((t) => !t.done).length;
    const todos = L.todoItems(state, today);
    const month = Number(today.slice(5, 7));
    const plantable = L.plantableIn(month);
    return `
      <div class="stats">
        <div class="stat"><b>${growing}</b><span>栽培中</span></div>
        <div class="stat"><b>${esc(L.formatGrams(grams))}</b><span>${year}年の収穫</span></div>
        <div class="stat"><b>${openTasks}</b><span>残りの予定</span></div>
      </div>
      <section>
        <h2>今日やること</h2>
        ${todos.length ? `<ul class="list">${todos.map((t) => `
          <li class="row">
            <span class="badge ${t.kind === 'harvest' ? 'ok' : t.overdue ? 'warn' : ''}">${t.kind === 'harvest' ? '収穫' : t.overdue ? '期限切れ' : '予定'}</span>
            <span class="grow">${esc(t.text)}</span>
            ${t.kind === 'task'
              ? `<button class="btn small" data-act="task-toggle" data-id="${t.id}">完了</button>`
              : `<button class="btn small" data-act="log-new" data-crop="${t.id}" data-type="収穫">記録</button>`}
          </li>`).join('')}</ul>` : empty('今日の予定はありません。')}
      </section>
      <section>
        <h2>${month}月の植えどき <small>目安</small></h2>
        ${plantable.length
          ? `<div class="chips">${plantable.map((n) => `<button class="chip" data-act="crop-new" data-name="${esc(n)}">${esc(n)}</button>`).join('')}</div>`
          : empty('今月が植えどきの野菜は登録されていません。')}
        <p class="hint">中間地の一般的な目安です。地域や品種で前後します。</p>
      </section>`;
  }

  function viewCrops() {
    const today = L.todayStr();
    const list = state.crops
      .filter((c) => showEnded || !c.ended)
      .sort((a, b) => (a.ended ? 1 : 0) - (b.ended ? 1 : 0) || (b.plantedOn || '').localeCompare(a.plantedOn || ''));
    return `
      <div class="toolbar">
        <label class="check"><input type="checkbox" data-act="toggle-ended" ${showEnded ? 'checked' : ''}> 終了した作物も表示</label>
        <button class="btn primary" data-act="crop-new">＋ 作物を追加</button>
      </div>
      ${list.length ? `<ul class="list">${list.map((c) => {
        const days = c.plantedOn ? L.daysBetween(c.plantedOn, today) : null;
        const left = c.harvestOn ? L.daysBetween(today, c.harvestOn) : null;
        const water = L.lastLogDate(state.logs, c.id, '水やり');
        const loc = L.cropLocation(c, state.planters);
        const meta = [
          loc && `場所：${esc(loc)}`,
          c.plantedOn && `${esc(c.kind || '植え付け')} ${fmtDate(c.plantedOn)}（${days}日目）`,
          left !== null && !c.ended && (left > 0 ? `収穫目安まで${left}日` : '収穫期'),
          water && `水やり ${fmtDate(water)}`,
        ].filter(Boolean).join(' ・ ');
        return `
          <li class="card ${c.ended ? 'ended' : ''}">
            <div class="card-head">
              <h3>${esc(c.name)} ${c.variety ? `<small>${esc(c.variety)}</small>` : ''}</h3>
              ${c.ended ? '<span class="badge">終了</span>' : left !== null && left <= 0 ? '<span class="badge ok">収穫期</span>' : ''}
            </div>
            <p class="meta">${meta}</p>
            ${c.note ? `<p class="note">${esc(c.note)}</p>` : ''}
            <div class="actions">
              ${c.ended ? '' : `
                <button class="btn small" data-act="quick-water" data-id="${c.id}">水やり</button>
                <button class="btn small" data-act="log-new" data-crop="${c.id}">記録する</button>`}
              <button class="btn small ghost" data-act="crop-edit" data-id="${c.id}">編集</button>
            </div>
          </li>`;
      }).join('')}</ul>` : empty('まだ作物がありません。「作物を追加」から登録しましょう。')}`;
  }

  const SIDES = { top: '上', left: '左', right: '右', bottom: '下' };
  function viewPlot() {
    const occ = L.occupancy(state.crops);
    const { rows, cols } = state.garden;
    // 登録順に色相を黄金角ずつずらし、隣り合う作物の色が似ないようにする
    const hueOf = (c) => Math.round((state.crops.indexOf(c) * 137.5 + 100) % 360);
    const tile = (key, label, cls) => {
      const c = occ.get(key);
      return `<button class="${cls}${c ? ' filled' : ''}" data-act="spot" data-key="${key}" ${c ? `style="--h:${hueOf(c)}"` : ''}
        aria-label="${esc(label)}${c ? `：${esc(c.name)}` : '（空き）'}">${cls === 'planter' ? `<small>${esc(label)}</small>` : ''}<span>${c ? esc(c.name) : cls === 'planter' ? '空き' : ''}</span></button>`;
    };
    let cells = '';
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells += tile(L.fieldKey(r, c), `畑${r + 1}-${c + 1}`, 'cell');
    const zone = (side) => `<div class="zone ${side}">${state.planters.filter((p) => (SIDES[p.side] ? p.side : 'bottom') === side)
      .map((p) => tile(L.planterKey(p.id), p.name, 'planter')).join('')}</div>`;
    return `
      <p class="hint">マスやプランターをタップして、植えた作物を記録します。</p>
      <div class="plot">
        ${zone('top')}${zone('left')}
        <div class="field" style="grid-template-columns:repeat(${cols},1fr)">${cells}</div>
        ${zone('right')}${zone('bottom')}
      </div>
      <div class="actions">
        <button class="btn" data-act="planter-new">＋ プランターを置く</button>
        <button class="btn ghost" data-act="garden-size">畑の大きさ（${rows}×${cols}）</button>
      </div>
      ${state.planters.length ? `<section><h2>プランター <small>タップで名前・位置を変更</small></h2>
        <div class="chips">${state.planters.map((p) => `<button class="chip" data-act="planter-edit" data-id="${p.id}">${esc(p.name)}（畑の${SIDES[p.side] || '下'}）</button>`).join('')}</div></section>` : ''}`;
  }

  function viewLogs() {
    const logs = state.logs
      .filter((l) => !logFilter || l.cropId === logFilter)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    return `
      <div class="toolbar">
        <select data-act="log-filter" aria-label="作物で絞り込み">
          <option value="">すべての作物</option>
          ${state.crops.map((c) => `<option value="${c.id}" ${logFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
        <button class="btn primary" data-act="log-new">＋ 記録する</button>
      </div>
      ${logs.length ? `<ul class="list">${logs.map((l) => `
        <li class="row">
          <span class="date">${fmtDate(l.date)}</span>
          <span class="badge ${l.type === '収穫' ? 'ok' : ''}">${esc(l.type)}</span>
          <span class="grow">${esc(cropName(l.cropId) || '—')}${l.type === '収穫' && l.amount ? ` <b>${esc(L.formatGrams(Number(l.amount)))}</b>` : ''}
            ${l.note ? `<small class="block">${esc(l.note)}</small>` : ''}</span>
          <button class="btn small ghost" data-act="log-edit" data-id="${l.id}">編集</button>
        </li>`).join('')}</ul>` : empty('記録はまだありません。')}`;
  }

  function viewTasks() {
    const tasks = [...state.tasks].sort(
      (a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || (a.due || '9999').localeCompare(b.due || '9999'));
    const today = L.todayStr();
    return `
      <div class="toolbar"><span></span><button class="btn primary" data-act="task-new">＋ 予定を追加</button></div>
      ${tasks.length ? `<ul class="list">${tasks.map((t) => `
        <li class="row ${t.done ? 'done' : ''}">
          <input type="checkbox" data-act="task-toggle" data-id="${t.id}" ${t.done ? 'checked' : ''} aria-label="完了">
          <span class="grow">${esc(t.title)}${t.cropId && cropName(t.cropId) ? ` <small>（${esc(cropName(t.cropId))}）</small>` : ''}</span>
          ${t.due ? `<span class="date ${!t.done && t.due < today ? 'late' : ''}">${fmtDate(t.due)}</span>` : ''}
          <button class="btn small ghost" data-act="task-edit" data-id="${t.id}">編集</button>
        </li>`).join('')}</ul>` : empty('予定はありません。')}`;
  }

  function viewSummary() {
    const year = L.todayStr().slice(0, 4);
    const rows = L.harvestTotals(state.logs, state.crops, year);
    const max = Math.max(1, ...rows.map((r) => r.grams));
    return `
      <section>
        <h2>${year}年の収穫量</h2>
        ${rows.length ? `<ul class="bars">${rows.map((r) => `
          <li><span class="bar-name">${esc(r.name)}</span>
            <span class="bar"><i style="width:${Math.max(2, (r.grams / max) * 100)}%"></i></span>
            <span class="bar-val">${esc(L.formatGrams(r.grams))}<small> / ${r.count}回</small></span></li>`).join('')}</ul>`
          : empty('今年の収穫記録はまだありません。')}
      </section>
      <section>
        <h2>端末間の共有</h2>
        ${sync ? `
          <p class="hint">共有中：<span id="sync-note">${esc(syncNote)}</span></p>
          <div class="actions">
            <button class="btn primary" data-act="sync-link">共有リンクをコピー</button>
            <button class="btn" data-act="sync-now">今すぐ同期</button>
            <button class="btn danger" data-act="sync-off">共有をやめる</button>
          </div>
          <p class="hint">共有リンクを他の端末で開くと、同じデータを使えます。リンクは合言葉を含むので、共有したい相手だけに渡してください。</p>`
        : `
          <p class="hint">スマホとパソコン、家族の端末などで同じデータを使えます。Firebase（無料枠）の準備が必要です。手順は README の「端末間の共有」を見てください。</p>
          <div class="actions"><button class="btn" data-act="sync-setup">共有を設定する</button></div>`}
      </section>
      <section>
        <h2>データ</h2>
        <p class="hint">データはこの端末のブラウザ内に保存されます。機種変更やバックアップには書き出しを使ってください。</p>
        <div class="actions">
          <button class="btn" data-act="export">書き出す（JSON）</button>
          <button class="btn" data-act="import">読み込む</button>
        </div>
      </section>`;
  }

  const VIEWS = { home: viewHome, plot: viewPlot, crops: viewCrops, logs: viewLogs, tasks: viewTasks, summary: viewSummary };
  function render() {
    $('#view').innerHTML = VIEWS[tab]();
    document.querySelectorAll('nav button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  }

  // ---------- 入力ダイアログ ----------
  const dlg = $('#dialog');
  let onSubmit = null;
  let onDelete = null;
  function openForm(title, html, submit, del) {
    $('#dialog-title').textContent = title;
    $('#dialog-fields').innerHTML = html;
    $('#dialog-delete').hidden = !del;
    $('#dialog-submit').hidden = !submit;
    $('#dialog-cancel').textContent = submit ? 'キャンセル' : '閉じる';
    onSubmit = submit;
    onDelete = del || null;
    dlg.showModal();
  }
  $('#dialog-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!onSubmit) return dlg.close();
    const data = Object.fromEntries(new FormData(e.target));
    for (const k of Object.keys(data)) if (typeof data[k] === 'string') data[k] = data[k].trim();
    onSubmit(data);
    dlg.close();
    commit();
  });
  $('#dialog-cancel').addEventListener('click', () => dlg.close());
  $('#dialog-delete').addEventListener('click', () => {
    if (!confirm('削除しますか？')) return;
    onDelete();
    dlg.close();
    commit();
  });

  const cropOptions = (selected, includeEnded) =>
    `<option value="">（作物なし）</option>` + state.crops
      .filter((c) => includeEnded || !c.ended || c.id === selected)
      .map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}${c.bed ? `（${esc(c.bed)}）` : ''}</option>`).join('');

  function cropForm(crop, presetName, spot) {
    const c = crop || { name: presetName || '', plantedOn: L.todayStr(), kind: '苗の植え付け' };
    if (!crop) c.harvestOn = L.suggestHarvestDate(c.name, c.plantedOn);
    openForm(crop ? '作物を編集' : '作物を追加', `
      <label>作物名<input name="name" required list="presets" value="${esc(c.name)}" autocomplete="off"></label>
      <datalist id="presets">${L.PRESETS.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>
      <label>品種<input name="variety" value="${esc(c.variety)}"></label>
      <label>場所・区画<input name="bed" value="${esc(c.bed)}" placeholder="畑の図でも指定できます"></label>
      <div class="cols">
        <label>方法<select name="kind">${['苗の植え付け', '種まき'].map((k) => `<option ${c.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
        <label>日付<input type="date" name="plantedOn" value="${esc(c.plantedOn)}"></label>
      </div>
      <label>収穫の目安日<input type="date" name="harvestOn" value="${esc(c.harvestOn)}"></label>
      <p class="hint">一覧にある作物名なら、目安日を自動で入れます（変更できます）。</p>
      <label>メモ<textarea name="note" rows="2">${esc(c.note)}</textarea></label>
      ${crop ? `<label class="check"><input type="checkbox" name="ended" ${c.ended ? 'checked' : ''}> 栽培を終了した</label>` : ''}`,
    (d) => {
      const next = { ...d, ended: d.ended === 'on' };
      if (crop) {
        // 終了したら図のマスを空ける。どこにあったかは場所欄に残す
        if (next.ended && crop.spots.length) {
          if (!next.bed) next.bed = L.cropLocation({ spots: crop.spots }, state.planters);
          crop.spots = [];
        }
        Object.assign(crop, next);
      } else state.crops.push({ id: uid(), spots: spot ? [spot] : [], ...next });
    },
    crop && (() => {
      state.crops = state.crops.filter((x) => x.id !== crop.id);
      state.logs = state.logs.filter((l) => l.cropId !== crop.id);
      state.tasks.forEach((t) => { if (t.cropId === crop.id) t.cropId = ''; });
    }));
    // 目安日がまだ手入力されていない間だけ、作物名・日付から自動提案する
    const f = $('#dialog-form');
    let auto = !crop;
    f.harvestOn.addEventListener('input', () => { auto = false; });
    const suggest = () => { if (auto) f.harvestOn.value = L.suggestHarvestDate(f.name.value, f.plantedOn.value); };
    f.elements.name.addEventListener('input', suggest);
    f.plantedOn.addEventListener('input', suggest);
  }

  function logForm(log, defaults = {}) {
    const l = log || { date: L.todayStr(), cropId: defaults.cropId || '', type: defaults.type || '水やり' };
    openForm(log ? '記録を編集' : '作業を記録', `
      <div class="cols">
        <label>日付<input type="date" name="date" required value="${esc(l.date)}"></label>
        <label>作業<select name="type">${L.LOG_TYPES.map((t) => `<option ${l.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      </div>
      <label>作物<select name="cropId">${cropOptions(l.cropId, !!log)}</select></label>
      <label id="amount-field">収穫量（g）<input type="number" name="amount" min="0" step="1" inputmode="numeric" value="${esc(l.amount)}"></label>
      <label>メモ<textarea name="note" rows="2">${esc(l.note)}</textarea></label>`,
    (d) => {
      if (d.type !== '収穫') d.amount = '';
      if (log) Object.assign(log, d);
      else state.logs.push({ id: uid(), createdAt: Date.now(), ...d });
    },
    log && (() => { state.logs = state.logs.filter((x) => x.id !== log.id); }));
    const f = $('#dialog-form');
    const sync = () => { $('#amount-field').hidden = f.type.value !== '収穫'; };
    f.type.addEventListener('change', sync);
    sync();
  }

  function taskForm(task) {
    const t = task || { title: '', due: L.todayStr(), cropId: '' };
    openForm(task ? '予定を編集' : '予定を追加', `
      <label>内容<input name="title" required value="${esc(t.title)}" placeholder="例：支柱を立てる"></label>
      <label>期日<input type="date" name="due" value="${esc(t.due)}"></label>
      <label>作物<select name="cropId">${cropOptions(t.cropId, false)}</select></label>`,
    (d) => {
      if (task) Object.assign(task, d);
      else state.tasks.push({ id: uid(), done: false, ...d });
    },
    task && (() => { state.tasks = state.tasks.filter((x) => x.id !== task.id); }));
  }

  // ---------- 畑の図 ----------
  function plantAt(key) {
    const growing = state.crops.filter((c) => !c.ended);
    if (!growing.length) return cropForm(null, '', key);
    openForm(`${L.spotLabel(key, state.planters)} に植える`, `
      <label>植えた作物<select name="cropId">
        <option value="">新しい作物を登録する</option>
        ${growing.map((c) => `<option value="${c.id}">${esc(c.name)}${c.variety ? `（${esc(c.variety)}）` : ''} を広げる</option>`).join('')}
      </select></label>
      <p class="hint">すでに登録した作物が複数のマスにまたがるときは「広げる」を選びます。</p>`,
    (d) => {
      const crop = state.crops.find((c) => c.id === d.cropId);
      if (crop) crop.spots.push(key);
      else setTimeout(() => cropForm(null, '', key)); // このダイアログが閉じてから開く
    });
  }
  function spotDetail(c, key) {
    const today = L.todayStr();
    const left = c.harvestOn ? L.daysBetween(today, c.harvestOn) : null;
    const water = L.lastLogDate(state.logs, c.id, '水やり');
    const meta = [
      c.plantedOn && `${esc(c.kind || '植え付け')} ${fmtDate(c.plantedOn)}（${L.daysBetween(c.plantedOn, today)}日目）`,
      left !== null && (left > 0 ? `収穫目安まで${left}日` : '収穫期'),
      water && `水やり ${fmtDate(water)}`,
    ].filter(Boolean).join(' ・ ');
    openForm(`${c.name}${c.variety ? `（${c.variety}）` : ''}`, `
      <p class="meta">${esc(L.spotLabel(key, state.planters))}${meta ? ` ・ ${meta}` : ''}</p>
      ${c.note ? `<p class="note">${esc(c.note)}</p>` : ''}
      <div class="actions">
        <button type="button" class="btn small" data-act="quick-water" data-id="${c.id}">水やり</button>
        <button type="button" class="btn small" data-act="log-new" data-crop="${c.id}">記録する</button>
        <button type="button" class="btn small" data-act="crop-edit" data-id="${c.id}">編集</button>
        <button type="button" class="btn small danger" data-act="unspot" data-id="${c.id}" data-key="${key}">ここから外す</button>
      </div>`, null);
  }
  function gardenForm() {
    const g = state.garden;
    openForm('畑の大きさ', `
      <div class="cols">
        <label>たて（マス）<input type="number" name="rows" min="1" max="10" required value="${g.rows}"></label>
        <label>よこ（マス）<input type="number" name="cols" min="1" max="10" required value="${g.cols}"></label>
      </div>
      <p class="hint">小さくすると、はみ出たマスの記録は外れます（作物そのものは残ります）。</p>`,
    (d) => {
      state.garden = { rows: Number(d.rows), cols: Number(d.cols) };
      L.clipSpots(state.crops, state.garden.rows, state.garden.cols);
    });
  }
  function planterForm(planter) {
    const p = planter || { name: `プランター${state.planters.length + 1}`, side: 'bottom' };
    openForm(planter ? 'プランターを編集' : 'プランターを置く', `
      <label>名前<input name="name" required value="${esc(p.name)}"></label>
      <label>置く位置<select name="side">${Object.entries(SIDES).map(([v, t]) => `<option value="${v}" ${p.side === v ? 'selected' : ''}>畑の${t}</option>`).join('')}</select></label>`,
    (d) => {
      if (planter) Object.assign(planter, d);
      else state.planters.push({ id: uid(), ...d });
    },
    planter && (() => {
      const key = L.planterKey(planter.id);
      state.planters = state.planters.filter((x) => x.id !== planter.id);
      state.crops.forEach((c) => { c.spots = c.spots.filter((k) => k !== key); });
    }));
  }

  // ---------- データの書き出し・読み込み ----------
  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `saien-${L.todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch (err) { data = null; }
    if (!L.isValidState(data)) return alert('このファイルは読み込めません（形式が違います）。');
    if (!confirm('今のデータを、読み込んだ内容で置き換えます。よろしいですか？')) return;
    state = L.normalizeState(data);
    commit();
  });

  // ---------- 操作 ----------
  const ACTIONS = {
    'crop-new': (el) => cropForm(null, el.dataset.name),
    'crop-edit': (el) => cropForm(state.crops.find((c) => c.id === el.dataset.id)),
    'quick-water': (el) => {
      state.logs.push({ id: uid(), createdAt: Date.now(), date: L.todayStr(), cropId: el.dataset.id, type: '水やり', amount: '', note: '' });
      commit();
    },
    'log-new': (el) => logForm(null, { cropId: el.dataset.crop, type: el.dataset.type }),
    'log-edit': (el) => logForm(state.logs.find((l) => l.id === el.dataset.id)),
    'task-new': () => taskForm(),
    'task-edit': (el) => taskForm(state.tasks.find((t) => t.id === el.dataset.id)),
    'task-toggle': (el) => {
      const t = state.tasks.find((x) => x.id === el.dataset.id);
      t.done = !t.done;
      commit();
    },
    spot: (el) => {
      const c = L.occupancy(state.crops).get(el.dataset.key);
      if (c) spotDetail(c, el.dataset.key);
      else plantAt(el.dataset.key);
    },
    unspot: (el) => {
      const c = state.crops.find((x) => x.id === el.dataset.id);
      c.spots = c.spots.filter((k) => k !== el.dataset.key);
      commit();
    },
    'garden-size': gardenForm,
    'planter-new': () => planterForm(),
    'planter-edit': (el) => planterForm(state.planters.find((p) => p.id === el.dataset.id)),
    'sync-setup': syncForm,
    'sync-now': syncNow,
    'sync-off': () => {
      if (confirm('この端末での共有をやめますか？\nこの端末のデータも、共有先のデータもそのまま残ります。')) setSync(null);
    },
    'sync-link': async () => {
      try {
        await navigator.clipboard.writeText(shareLink());
        alert('共有リンクをコピーしました。他の端末で開いてください。');
      } catch (e) {
        prompt('このリンクをコピーして、他の端末で開いてください。', shareLink());
      }
    },
    export: exportData,
    import: () => $('#import-file').click(),
  };
  // ダイアログ内のボタンも同じ操作を使うので、ページ全体で受ける
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !ACTIONS[el.dataset.act]) return;
    if (el.closest('dialog')) dlg.close();
    ACTIONS[el.dataset.act](el);
  });
  $('#view').addEventListener('change', (e) => {
    const act = e.target.dataset.act;
    if (act === 'toggle-ended') { showEnded = e.target.checked; render(); }
    if (act === 'log-filter') { logFilter = e.target.value; render(); }
  });
  $('nav').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    render();
    window.scrollTo(0, 0);
  });

  // ホーム画面に追加して、オフラインでも開けるようにする（ファイルを直接開いた場合は使えない）
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  render();
  joinFromLink();
  syncNow();
  // 開いている間は定期的に、戻ってきたときはすぐに他の端末の変更を取り込む
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  window.addEventListener('online', syncNow);
})();
