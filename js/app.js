/* KEhaz app.js　目的：画面の表示と操作（4つのタブの切り替え、今日・決まったやること・記録、更新ボタン、起動）。
   カスタマイズタブは customize.js。基づく仕様書：KEhaz_仕様書_v3.1.2 */

const S = {
  tab: 'today', today: '', date: '', day: null, items: [], templates: [], values: {}, warnings: [], parts: {},
  tplItems: [], dirty: { day: false, tpl: false }, pendingNav: null
};
const $ = (id) => document.getElementById(id);

// 要素を作る小さな道具（文字は textContent で入れるので安全）
function el(tag, attrs, children) {
  const e = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === false) return;
    if (k === 'text') e.textContent = v;
    else if (k === 'class') e.className = v;
    else if (k.startsWith('data-') || k.startsWith('aria-')) e.setAttribute(k, v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  });
  (children || []).forEach((c) => c && e.appendChild(c));
  return e;
}

// "YYYY-MM-DD" に日数を足す
function addDaysStr(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// 端末の時計で「今日」（午前4時で切り替え）
function localToday() {
  const d = new Date(Date.now() - DAY_START_HOUR * 3600000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// 曜日（0=日）
function weekdayOfStr(dateStr) { return new Date(dateStr + 'T00:00:00Z').getUTCDay(); }
// "HH:mm" を分にする
function hmToMin(hm) { const p = String(hm || '').split(':'); return p.length === 2 ? Number(p[0]) * 60 + Number(p[1]) : NaN; }
// 分を「2時間30分」にする
function minText(m) { const h = Math.floor(m / 60), r = m % 60; return (h ? h + '時間' : '') + (r || !h ? r + '分' : ''); }
// ISO時刻を "HH:mm" にする
function isoHm(iso) { const d = new Date(iso); return isNaN(d) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
// "YYYY-MM-DD" を「11/3(火)」にする
function dateLabel(date) { const p = date.split('-'); return `${Number(p[1])}/${Number(p[2])}(${WEEKDAYS_JA[weekdayOfStr(date)]})`; }

// 通信の結果・失敗の理由を画面上部に出す
function showStatus(msg, isError, retryFn) {
  const box = $('status-msg');
  $('status-text').textContent = msg;
  box.classList.toggle('error', !!isError);
  const retry = $('status-retry');
  retry.hidden = !retryFn;
  retry.onclick = retryFn ? () => { box.hidden = true; retryFn(); } : null;
  box.hidden = false;
  clearTimeout(showStatus.timer);
  if (!isError) showStatus.timer = setTimeout(() => { box.hidden = true; }, 3000);
}
// 失敗を表示する（理由をそのまま出す）
function showError(e, retryFn) {
  const code = e && e.code ? `[${e.code}] ` : '';
  console.error(e);
  showStatus(code + ((e && e.message) || String(e)), true, retryFn);
}

// 分数の選択肢を作る（今の値が選択肢に無ければ足す）
function fillMinutes(sel, current) {
  const list = MINUTES_CHOICES.slice();
  if (current && list.indexOf(Number(current)) < 0) list.push(Number(current));
  list.sort((a, b) => a - b);
  sel.innerHTML = '';
  list.forEach((m) => sel.appendChild(el('option', { value: String(m), text: m + '分' })));
  sel.value = String(current || 60);
}

// 背景色の上で読みやすい文字の色（白か黒）
function textOn(hex) { return contrastRatio(hex, '#FFFFFF') >= contrastRatio(hex, '#111111') ? '#FFFFFF' : '#111111'; }

// 見た目と、カスタマイズで決めた色を当てはめる（色が空欄なら、見た目の色のまま）
function applyColors(values) {
  const theme = THEMES[values.theme] ? values.theme : DEFAULT_THEME;
  const html = document.documentElement;
  html.dataset.theme = theme;
  lsSet(LS_KEYS.THEME, theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEMES[theme].bar);
  const set = (v, name, on) => {
    if (v) { html.style.setProperty(name, v); if (on) html.style.setProperty(on, textOn(v)); }
    else { html.style.removeProperty(name); if (on) html.style.removeProperty(on); }
  };
  set(values.color_accent, '--accent', '--on-accent');
  set(values.color_start, '--start', '--on-start');
  set(values.color_skip, '--skip', null);
}

// 2回押しで実行するボタン（1回目は文字を変えるだけ）
function confirmTwice(btn, fn) {
  if (btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.textContent = btn.dataset.label; clearTimeout(btn._t); fn(); return; }
  btn.dataset.label = btn.textContent;
  btn.dataset.armed = '1';
  btn.textContent = TXT.CONFIRM_AGAIN;
  btn._t = setTimeout(() => { btn.dataset.armed = ''; btn.textContent = btn.dataset.label; }, CONFIRM_MS);
}

/* ---------- タブ ---------- */

// タブを切り替える（保存していない変更があれば先に聞く）
function switchTab(tabId, force) {
  if (!force && tabId !== S.tab && hasDirty()) { askLeave(() => switchTab(tabId, true)); return; }
  S.tab = tabId;
  lsSet(LS_KEYS.LAST_TAB, tabId);
  document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== 'panel-' + tabId; });
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tabId));
  $('cz-bar').hidden = true;
  window.scrollTo(0, 0);
  if (tabId === 'today') loadDay(S.date || localToday());
  else if (tabId === 'template') loadTemplates();
  else if (tabId === 'record') loadStats();
  else if (tabId === 'customize') loadCustomize();
}
function hasDirty() {
  return (S.tab === 'today' && S.dirty.day) || (S.tab === 'template' && S.dirty.tpl) || (S.tab === 'customize' && czDirtyCount() > 0);
}

// 「保存していない変更があります」を出し、選ばれたら移る
function askLeave(navFn) { S.pendingNav = navFn; $('leave-bar').hidden = false; }
async function leaveSave() {
  $('leave-bar').hidden = true;
  let ok;
  if (S.tab === 'template') ok = await saveTemplates();
  else if (S.tab === 'customize') ok = await czSave();
  else ok = await saveDay();
  if (ok && S.pendingNav) { const f = S.pendingNav; S.pendingNav = null; f(); }
}
function leaveDiscard() {
  $('leave-bar').hidden = true;
  S.dirty.day = false; S.dirty.tpl = false; czDiscard(true);
  if (S.pendingNav) { const f = S.pendingNav; S.pendingNav = null; f(); }
}

/* ---------- 今日 ---------- */

// その日の内容を読み込む
async function loadDay(date) {
  S.date = date;
  $('item-list').innerHTML = '';
  $('day-label').textContent = TXT.LOADING;
  try {
    const d = await callApi('getState', { date });
    S.today = d.today; S.day = d.day; S.items = d.items.map((it) => Object.assign({}, it));
    S.templates = d.templates; S.values = d.settings.values; S.warnings = d.settings.warnings; S.parts = d.parts;
    S.state = d; S.dirty.day = false;
    applyColors(S.values);
    renderDay();
  } catch (e) { $('day-label').textContent = date; showError(e, () => loadDay(date)); }
}

// 別の日に移る（今日〜30日先）
function pickDay(date) {
  const today = S.today || localToday();
  if (!date || date < today || date > addDaysStr(today, MAX_DAYS_AHEAD)) { renderDay(); return; }
  if (S.dirty.day) { askLeave(() => { S.dirty.day = false; loadDay(date); }); $('day-picker').value = S.date; return; }
  loadDay(date);
}

// 「今日」タブを描く
function renderDay() {
  const today = S.today || localToday();
  const date = S.date;
  const tag = date === today ? ' ' + TXT.TODAY : (date === addDaysStr(today, 1) ? ' ' + TXT.TOMORROW : '');
  const kind = S.day && S.day.kind === 'off' ? '　休みの日' : '';
  $('day-label').textContent = dateLabel(date) + tag + kind;
  $('day-prev').disabled = date <= today;
  $('day-next').disabled = date >= addDaysStr(today, MAX_DAYS_AHEAD);
  const picker = $('day-picker');
  picker.min = today; picker.max = addDaysStr(today, MAX_DAYS_AHEAD); picker.value = date;
  $('day-start-time').value = (S.day && S.day.startTime) || '';
  $('day-off').checked = !S.day || S.day.status === 'off';

  // 達成度・連続日数（部品がONのときだけ）
  const st = S.state || {};
  const info = [];
  if (date === today && S.parts.progress) {
    const done = S.items.filter((it) => it.status === 'done' && it.note !== 'carried').length;
    const total = S.items.filter((it) => it.note !== 'carried').length;
    if (total) info.push(`今日 ${done}/${total}`);
  }
  if (S.parts.streak && st.streak) info.push(`連続${st.streak}日`);
  $('day-info').textContent = info.join('　');
  $('day-info').hidden = !info.length;

  // 休む・LINE停止・設定の注意
  const notes = [];
  if (st.resting) notes.push(TXT.REST_NOTE.replace('{d}', st.restUntil));
  if (st.lineStopped) notes.push(TXT.LINE_STOPPED);
  (S.warnings || []).forEach((w) => notes.push(w.message));
  const nb = $('day-notice');
  nb.innerHTML = '';
  notes.forEach((n) => nb.appendChild(el('p', { text: n })));
  nb.hidden = !notes.length;

  const list = $('item-list');
  list.innerHTML = '';
  S.items.forEach((it, i) => list.appendChild(renderItemCard(it, i)));

  const active = S.items.filter((it) => it.status !== 'skipped');
  const total = active.reduce((s, it) => s + Number(it.minutes || 0), 0);
  const start = hmToMin($('day-start-time').value);
  let avail = hmToMin(S.values.bedtime) - start;
  if (avail <= 0) avail += 1440;
  const summary = `合計 ${minText(total)}` + (isNaN(avail) ? '' : `（就寝までの時間 ${minText(avail)}）`);
  $('day-summary').textContent = $('day-off').checked ? summary + '　' + TXT.DAY_OFF_NOTE : summary;
  const warns = [];
  if (S.items.length > WARN_ITEM_COUNT) warns.push(TXT.WARN_COUNT.replace('{n}', S.items.length));
  if (!isNaN(avail) && total > avail) warns.push(TXT.WARN_TIME);
  $('day-warning').textContent = warns.join('　');
  $('day-warning').hidden = !warns.length;

  const chips = $('template-chips');
  chips.innerHTML = '';
  S.templates.forEach((t) => chips.appendChild(el('button', { type: 'button', text: t.title, 'data-tid': t.id })));
}

// やること1件のカード
function renderItemCard(it, idx) {
  const finished = it.status === 'done' || it.status === 'skipped';
  const mark = it.templateId ? ITEM_MARK.TEMPLATE : ITEM_MARK.ONEOFF;
  let st = TXT.STATUS[it.status] || '';
  if (it.note === 'carried') st = '今日に移した';
  if (it.status === 'doing' && it.fiveStage) st += '（5分だけ）';
  else if (it.status === 'doing' && it.startedAt) {
    st += `（〜${isoHm(new Date(new Date(it.startedAt).getTime() + it.minutes * 60000).toISOString())}）`;
  }
  const meta = [`${it.minutes}分`, it.fixedTime ? `⏰${it.fixedTime}` : '', it.bedOk === '1' ? '🌙' : '', st].filter(Boolean).join('　');
  const canAct = !!it.id && !S.dirty.day;
  const btns = [];
  const act = (op, label, cls) => el('button', { type: 'button', class: 'mini ' + (cls || ''), text: label,
    'data-op': op, 'data-id': it.id, disabled: !canAct, title: canAct ? '' : TXT.SAVE_FIRST });
  if (it.status === 'pending' || it.status === 'asked') { btns.push(act('start', TXT.BTN_START, 'b-start')); btns.push(act('skip', TXT.BTN_SKIP, 'b-skip')); }
  if (it.status === 'doing') { btns.push(act('done', TXT.BTN_DONE, 'b-start')); btns.push(act('skip', TXT.BTN_SKIP, 'b-skip')); }
  if (it.status === 'skipped' && it.note !== 'carried') btns.push(act('restore', TXT.BTN_RESTORE));
  btns.push(el('span', { class: 'grow' }));
  if (it.status !== 'done') {
    btns.push(el('button', { type: 'button', class: 'mini', text: '▲', 'aria-label': '上へ', 'data-move': '-1', 'data-idx': String(idx), disabled: idx === 0 }));
    btns.push(el('button', { type: 'button', class: 'mini', text: '▼', 'aria-label': '下へ', 'data-move': '1', 'data-idx': String(idx), disabled: idx === S.items.length - 1 }));
    btns.push(el('button', { type: 'button', class: 'mini b-del', text: '✕', 'aria-label': '削除', 'data-remove': String(idx) }));
  }
  return el('li', { class: 'item-card' + (finished ? ' finished' : ''), 'data-id': it.id || '' }, [
    el('div', { class: 'ic-top' }, [el('span', { text: `${idx + 1}` }), el('span', { text: mark }), el('span', { class: 'ic-title', text: it.title })]),
    el('div', { class: 'ic-meta', text: meta }),
    el('div', { class: 'ic-btns' }, btns)
  ]);
}

// 並び順を1つ動かす
function moveItem(idx, dir) {
  const j = idx + dir;
  if (j < 0 || j >= S.items.length) return;
  [S.items[idx], S.items[j]] = [S.items[j], S.items[idx]];
  markDayDirty();
}
// 1件消す
function removeItem(idx) { S.items.splice(idx, 1); markDayDirty(); }
// その日だけのやることを足す
function addItem() {
  const title = $('add-title').value.trim();
  if (!title) { showStatus(TXT.NEED_TITLE, true); return; }
  S.items.push({ id: '', title, minutes: Number($('add-minutes').value), fixedTime: $('add-fixed').value || '', status: 'pending', templateId: '', bedOk: '0' });
  $('add-title').value = ''; $('add-fixed').value = '';
  markDayDirty();
}
// 決まったやることを、その日だけのやることとして足す
function addFromTemplate(tid) {
  const t = S.templates.find((x) => x.id === tid);
  if (!t) return;
  S.items.push({ id: '', title: t.title, minutes: Number(t.minutes), fixedTime: t.fixedTime || '', status: 'pending', templateId: '', bedOk: t.bedOk });
  markDayDirty();
}
function markDayDirty() { S.dirty.day = true; renderDay(); }
// その日の開始時刻・送るかどうかを、画面の値で書き換える
function setDayField(key, value) {
  S.day = Object.assign({ date: S.date, status: 'on', startTime: '' }, S.day || {});
  S.day[key] = value;
  markDayDirty();
}

// その日を保存する
async function saveDay() {
  const btn = $('save-day');
  btn.disabled = true;
  try {
    const d = await callApi('saveDay', {
      date: S.date, startTime: $('day-start-time').value || '', status: $('day-off').checked ? 'off' : 'on',
      items: S.items.map((it) => ({ id: it.id || '', title: it.title, minutes: it.minutes, fixedTime: it.fixedTime || '', bedOk: it.bedOk || '0' }))
    });
    S.day = d.day; S.items = d.items; S.dirty.day = false;
    renderDay();
    showStatus(TXT.SAVED);
    return true;
  } catch (e) { showError(e, saveDay); return false; }
  finally { btn.disabled = false; }
}

// 画面のボタン（始める・終わった・やめる・戻す）
async function doItemAction(id, op) {
  if (S.dirty.day) { showStatus(TXT.SAVE_FIRST, true); return; }
  try {
    const d = await callApi('itemAction', { itemId: id, op });
    S.items = d.items;
    renderDay();
  } catch (e) { showError(e, () => doItemAction(id, op)); }
}

/* ---------- 決まったやること ---------- */

// 決まったやることを読み込む
async function loadTemplates() {
  $('tpl-list').innerHTML = '';
  try {
    const d = await callApi('getState', { date: S.today || localToday() });
    S.today = d.today; S.templates = d.templates; S.values = d.settings.values;
    applyColors(S.values);
    S.tplItems = d.templates.map((t) => Object.assign({}, t));
    S.dirty.tpl = false;
    renderTemplates();
  } catch (e) { showError(e, loadTemplates); }
}

// 「決まったやること」タブを描く
function renderTemplates() {
  const list = $('tpl-list');
  list.innerHTML = '';
  S.tplItems.forEach((t, i) => list.appendChild(renderTemplateCard(t, i)));
}

// 決まったやること1件のカード
function renderTemplateCard(t, idx) {
  const sel = el('select', { class: 'tpl-min', 'data-idx': String(idx), 'aria-label': '目安の分数' });
  fillMinutes(sel, t.minutes);
  const days = el('div', { class: 'tpl-days' }, WEEKDAYS_JA.map((w, d) => el('button', {
    type: 'button', class: 'tpl-day' + (t.days.charAt(d) === '1' ? ' on' : ''), text: w,
    'data-day': String(d), 'data-idx': String(idx), 'aria-pressed': t.days.charAt(d) === '1' ? 'true' : 'false'
  })));
  const bed = el('label', { class: 'check small' }, [
    el('input', { type: 'checkbox', class: 'tpl-bed', 'data-idx': String(idx), checked: t.bedOk === '1' }),
    el('span', { text: '🌙 就寝前でも案内する' })
  ]);
  return el('li', { class: 'tpl-card', 'data-id': t.id || '' }, [
    el('div', { class: 'tpl-fields' }, [
      el('input', { type: 'text', class: 'tpl-title', maxLength: 50, value: t.title, 'data-idx': String(idx), 'aria-label': '名前' }),
      sel,
      el('input', { type: 'time', class: 'tpl-fixed', value: t.fixedTime || '', 'data-idx': String(idx), 'aria-label': '時刻指定' })
    ]),
    days,
    t.days.indexOf('1') < 0 ? el('p', { class: 'warn small', text: TXT.NO_DAYS_ON }) : null,
    el('div', { class: 'ic-btns' }, [
      bed,
      el('span', { class: 'grow' }),
      el('button', { type: 'button', class: 'mini', text: '▲', 'aria-label': '上へ', 'data-tmove': '-1', 'data-idx': String(idx), disabled: idx === 0 }),
      el('button', { type: 'button', class: 'mini', text: '▼', 'aria-label': '下へ', 'data-tmove': '1', 'data-idx': String(idx), disabled: idx === S.tplItems.length - 1 }),
      el('button', { type: 'button', class: 'mini b-del', text: '✕', 'aria-label': '削除', 'data-tremove': String(idx) })
    ])
  ]);
}

// 入力欄の今の値を読み取る（iPhoneで change が起きないまま保存を押した場合のため）
function syncTemplateInputs() {
  document.querySelectorAll('#tpl-list .tpl-card').forEach((card, i) => {
    const t = S.tplItems[i];
    if (!t) return;
    t.title = card.querySelector('.tpl-title').value.trim();
    t.minutes = Number(card.querySelector('.tpl-min').value);
    t.fixedTime = card.querySelector('.tpl-fixed').value || '';
    t.bedOk = card.querySelector('.tpl-bed').checked ? '1' : '0';
  });
}

// 曜日のON／OFFを切り替える
function toggleTemplateDay(idx, day) {
  syncTemplateInputs();
  const t = S.tplItems[idx];
  t.days = t.days.slice(0, day) + (t.days.charAt(day) === '1' ? '0' : '1') + t.days.slice(day + 1);
  S.dirty.tpl = true;
  renderTemplates();
}
// 決まったやることを足す（曜日はすべてON）
function addTemplate() {
  const title = $('tpl-add-title').value.trim();
  if (!title) { showStatus(TXT.NEED_TITLE, true); return; }
  syncTemplateInputs();
  S.tplItems.push({ id: '', title, minutes: Number($('tpl-add-minutes').value), fixedTime: $('tpl-add-fixed').value || '', days: '1111111', bedOk: '0' });
  $('tpl-add-title').value = ''; $('tpl-add-fixed').value = '';
  S.dirty.tpl = true;
  renderTemplates();
}

// 決まったやることを保存する
async function saveTemplates() {
  syncTemplateInputs();
  const btn = $('tpl-save');
  btn.disabled = true;
  try {
    const d = await callApi('saveTemplates', {
      items: S.tplItems.map((t) => ({ id: t.id || '', title: t.title, minutes: t.minutes, fixedTime: t.fixedTime || '', days: t.days, bedOk: t.bedOk }))
    });
    S.templates = d.templates;
    S.tplItems = d.templates.map((t) => Object.assign({}, t));
    S.dirty.tpl = false;
    renderTemplates();
    showStatus(TXT.SAVED_TPL);
    return true;
  } catch (e) { showError(e, saveTemplates); return false; }
  finally { btn.disabled = false; }
}

/* ---------- 記録 ---------- */

// 記録を読み込んで表にする
async function loadStats() {
  try { renderStats(await callApi('getStats', { weeks: 4 })); }
  catch (e) { showError(e, loadStats); }
}

// 記録タブを描く
function renderStats(d) {
  if (d.look) applyColors(d.look);
  $('rec-streak-box').hidden = d.streak === null || d.streak === undefined;
  $('rec-streak').textContent = `${d.streak || 0}日続いています`;
  const items = $('rec-items');
  items.innerHTML = '';
  items.appendChild(el('tr', {}, ['やること', 'できた', 'やめた', '予定'].map((h) => el('th', { text: h }))));
  d.perTitle.forEach((p) => items.appendChild(el('tr', {}, [
    el('td', { text: p.title }), el('td', { class: 'num', text: String(p.done) }),
    el('td', { class: 'num', text: String(p.skipped) }), el('td', { class: 'num', text: String(p.planned) })])));
  const days = $('rec-days');
  days.innerHTML = '';
  days.appendChild(el('tr', {}, ['日付', 'できた', 'やめた', '予定'].map((h) => el('th', { text: h }))));
  d.days.forEach((x) => days.appendChild(el('tr', {}, [
    el('td', { text: dateLabel(x.date) }), el('td', { class: 'num', text: String(x.done) }),
    el('td', { class: 'num', text: String(x.skipped) }), el('td', { class: 'num', text: String(x.planned) })])));
  const rec = $('rec-recent');
  rec.innerHTML = '';
  d.recent.forEach((it) => {
    const st = it.status === 'done' || it.status === 'skipped' ? it.status : 'pending';
    const sel = el('select', { 'data-fix': it.id, 'aria-label': it.title + 'の状態' },
      ['done', 'skipped', 'pending'].map((v) => el('option', { value: v, text: TXT.FIX_STATUS[v], selected: v === st })));
    rec.appendChild(el('li', {}, [el('span', { class: 'fix-date', text: dateLabel(it.date) }), el('span', { class: 'fix-title', text: it.title }), sel]));
  });
  $('rec-error').textContent = d.lastError ? `${d.lastError.at}　${d.lastError.message}` : TXT.NO_ERROR;
}

// 押し間違いを直す
async function fixItem(id, status) {
  try { renderStats(await callApi('fixItem', { itemId: id, status, weeks: 4 })); showStatus(TXT.SAVED); }
  catch (e) { showError(e); loadStats(); }
}

/* ---------- 更新ボタン（ルールブック3-12のとおり） ---------- */

let swRegistration = null;
let lastUpdateCheck = 0;
let updateRequested = false; // ボタンが押されたときだけ true（初回の起動で読み込み直さないため）

async function initUpdateNotice() {
  if (!('serviceWorker' in navigator)) return;
  try { swRegistration = await navigator.serviceWorker.register('./sw.js'); } catch (e) { console.warn(e); return; }
  if (!swRegistration) return;
  lastUpdateCheck = Date.now();
  if (swRegistration.waiting && navigator.serviceWorker.controller) showUpdateButton();
  swRegistration.addEventListener('updatefound', () => {
    const worker = swRegistration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateButton();
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateRequested) return;
    updateRequested = false;
    location.reload();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
}

function checkForUpdate() {
  if (!swRegistration) return;
  if (Date.now() - lastUpdateCheck < UPDATE_CHECK_INTERVAL_MS) return;
  lastUpdateCheck = Date.now();
  swRegistration.update().catch(() => {}); // 電波が無いときは何もしない
}

function showUpdateButton() {
  $('update-btn').hidden = false;
}

function applyUpdate() {
  $('update-btn').hidden = true;
  const waiting = swRegistration && swRegistration.waiting;
  if (waiting) {
    updateRequested = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  } else {
    location.reload();
  }
}

/* ---------- 起動 ---------- */

// 画面の準備をして、最後に開いていたタブから始める
function init() {
  fillMinutes($('add-minutes'), 60);
  fillMinutes($('tpl-add-minutes'), 60);
  $('set-version').textContent = APP_VERSION;

  document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('update-btn').addEventListener('click', applyUpdate);
  $('leave-save').addEventListener('click', leaveSave);
  $('leave-discard').addEventListener('click', leaveDiscard);
  $('leave-cancel').addEventListener('click', () => { $('leave-bar').hidden = true; S.pendingNav = null; });

  $('day-prev').addEventListener('click', () => pickDay(addDaysStr(S.date, -1)));
  $('day-next').addEventListener('click', () => pickDay(addDaysStr(S.date, 1)));
  $('day-picker').addEventListener('change', (e) => pickDay(e.target.value));
  $('day-start-time').addEventListener('change', (e) => { setDayField('startTime', e.target.value || ''); });
  $('day-off').addEventListener('change', (e) => { setDayField('status', e.target.checked ? 'off' : 'on'); });
  $('add-btn').addEventListener('click', addItem);
  $('save-day').addEventListener('click', saveDay);
  $('template-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-tid]'); if (b) addFromTemplate(b.dataset.tid); });
  $('item-list').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.op) doItemAction(b.dataset.id, b.dataset.op);
    else if (b.dataset.move) moveItem(Number(b.dataset.idx), Number(b.dataset.move));
    else if (b.dataset.remove !== undefined) removeItem(Number(b.dataset.remove));
  });

  $('tpl-list').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const idx = Number(b.dataset.idx);
    if (b.dataset.day !== undefined) toggleTemplateDay(idx, Number(b.dataset.day));
    else if (b.dataset.tmove) {
      const j = idx + Number(b.dataset.tmove);
      if (j < 0 || j >= S.tplItems.length) return;
      syncTemplateInputs();
      [S.tplItems[idx], S.tplItems[j]] = [S.tplItems[j], S.tplItems[idx]];
      S.dirty.tpl = true; renderTemplates();
    } else if (b.dataset.tremove !== undefined) {
      syncTemplateInputs();
      S.tplItems.splice(Number(b.dataset.tremove), 1); S.dirty.tpl = true; renderTemplates();
    }
  });
  $('tpl-list').addEventListener('change', (e) => {
    const t = S.tplItems[Number(e.target.dataset.idx)];
    if (!t) return;
    if (e.target.classList.contains('tpl-title')) t.title = e.target.value.trim();
    else if (e.target.classList.contains('tpl-min')) t.minutes = Number(e.target.value);
    else if (e.target.classList.contains('tpl-fixed')) t.fixedTime = e.target.value || '';
    else if (e.target.classList.contains('tpl-bed')) t.bedOk = e.target.checked ? '1' : '0';
    S.dirty.tpl = true;
  });
  $('tpl-add-btn').addEventListener('click', addTemplate);
  $('tpl-save').addEventListener('click', saveTemplates);

  $('rec-recent').addEventListener('change', (e) => { if (e.target.dataset.fix) fixItem(e.target.dataset.fix, e.target.value); });

  initCustomize();

  S.date = localToday();
  const last = lsGet(LS_KEYS.LAST_TAB);
  const first = TABS.indexOf(last) >= 0 ? last : 'today';
  switchTab(lsGet(LS_KEYS.GAS_URL) ? first : 'customize', true);
  initUpdateNotice();
}

document.addEventListener('DOMContentLoaded', init);
