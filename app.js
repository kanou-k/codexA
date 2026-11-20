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
      if (L.isValidState(s)) return s;
    } catch (e) { /* 壊れたデータは無視して空で始める */ }
    return { crops: [], logs: [], tasks: [] };
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      alert('保存できませんでした。ブラウザの保存領域を確認してください。');
    }
  }
  function commit() { save(); render(); }

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
        const meta = [
          c.bed && `場所：${esc(c.bed)}`,
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
        <h2>データ</h2>
        <p class="hint">データはこの端末のブラウザ内に保存されます。機種変更やバックアップには書き出しを使ってください。</p>
        <div class="actions">
          <button class="btn" data-act="export">書き出す（JSON）</button>
          <button class="btn" data-act="import">読み込む</button>
        </div>
      </section>`;
  }

  const VIEWS = { home: viewHome, crops: viewCrops, logs: viewLogs, tasks: viewTasks, summary: viewSummary };
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
    onSubmit = submit;
    onDelete = del || null;
    dlg.showModal();
  }
  $('#dialog-form').addEventListener('submit', (e) => {
    e.preventDefault();
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

  function cropForm(crop, presetName) {
    const c = crop || { name: presetName || '', plantedOn: L.todayStr(), kind: '苗の植え付け' };
    if (!crop) c.harvestOn = L.suggestHarvestDate(c.name, c.plantedOn);
    openForm(crop ? '作物を編集' : '作物を追加', `
      <label>作物名<input name="name" required list="presets" value="${esc(c.name)}" autocomplete="off"></label>
      <datalist id="presets">${L.PRESETS.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>
      <label>品種<input name="variety" value="${esc(c.variety)}"></label>
      <label>場所・区画<input name="bed" value="${esc(c.bed)}" placeholder="例：畝A、プランター1"></label>
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
      if (crop) Object.assign(crop, next);
      else state.crops.push({ id: uid(), ...next });
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
    state = { crops: data.crops, logs: data.logs, tasks: data.tasks };
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
    export: exportData,
    import: () => $('#import-file').click(),
  };
  $('#view').addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (el && ACTIONS[el.dataset.act]) ACTIONS[el.dataset.act](el);
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

  render();
})();
