/* KEhaz app.js　目的：画面の表示と操作（4つのタブの切り替え、今日・決まったやること・記録、更新ボタン、起動）。
   カスタマイズタブは customize.js。基づく仕様書：KEhaz_仕様書_v3.5.1 */

const S = {
  tab: 'today', today: '', date: '', day: null, items: [], templates: [], values: {}, warnings: [], parts: {},
  tplItems: [], dayQuiet: [], quietItems: [], dirty: { day: false, tpl: false }, pendingNav: null
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

/* ---------- 読み込みを減らす仕組み（前回の内容をすぐ出し、裏で読み直す） ---------- */

// 読んだ内容の写し（端末に保存。版が変わったら使わない）
const CACHE = { state: {}, stateAt: {}, stats: null, statsAt: 0, cz: null, czAt: 0 };
// 端末に保存した写しを読む
function cacheLoad() {
  try {
    const c = JSON.parse(lsGet(LS_KEYS.CACHE) || 'null');
    if (c && c.v === APP_VERSION && c.url === lsGet(LS_KEYS.GAS_URL)) Object.assign(CACHE, c.data);
  } catch (e) { /* 壊れていたら使わない */ }
}
// 写しを端末に保存する（日ごとの内容は、新しい3日分だけ残す）
function cacheSave() {
  const dates = Object.keys(CACHE.state).sort((a, b) => (CACHE.stateAt[b] || 0) - (CACHE.stateAt[a] || 0));
  dates.slice(3).forEach((d) => { delete CACHE.state[d]; delete CACHE.stateAt[d]; });
  lsSet(LS_KEYS.CACHE, JSON.stringify({ v: APP_VERSION, url: lsGet(LS_KEYS.GAS_URL), data: CACHE }));
}
// 写しを全部捨てる（つなぎ先を変えたとき）
function cacheClear() {
  CACHE.state = {}; CACHE.stateAt = {}; CACHE.stats = null; CACHE.statsAt = 0; CACHE.cz = null; CACHE.czAt = 0;
  lsSet(LS_KEYS.CACHE, '');
}
// 読んでから FRESH_MS 以内か
function isFresh(at) { return !!at && Date.now() - at < FRESH_MS; }
// その日の写しを、保存・操作の返事で書き換える
function cachePatchDay(date, patch) {
  if (!CACHE.state[date]) return;
  Object.assign(CACHE.state[date], patch);
  CACHE.stateAt[date] = Date.now();
  CACHE.statsAt = 0;          // 記録タブは次に開いたとき読み直す
  cacheSave();
}
// 裏で読み込んでいる数と「更新中…」の表示
let syncCount = 0;
function syncStart() { syncCount++; $('sync-ind').hidden = false; }
function syncEnd() { syncCount = Math.max(0, syncCount - 1); $('sync-ind').hidden = syncCount > 0 ? false : true; }
// 「◯時◯分に読み込み」の表示
function renderFresh(id, at) {
  const e = $(id);
  if (e) e.textContent = at ? TXT.FRESH.replace('{t}', isoHm(new Date(at).toISOString())) : '';
}
// 今のタブを読み直す（↻ と、引っぱったとき）
function refreshCurrent() {
  if (hasDirty()) { showStatus(TXT.SAVE_FIRST, true); return; }
  if (S.tab === 'today') loadDay(S.date || localToday(), true);
  else if (S.tab === 'template') loadTemplates(true);
  else if (S.tab === 'record') loadStats(true);
  else loadCustomize(true);
}
// 画面のいちばん上で下に引っぱったら読み直す
function initPullToRefresh() {
  let y0 = null;
  document.addEventListener('touchstart', (e) => { y0 = window.scrollY <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (y0 === null) return;
    const dy = e.changedTouches[0].clientY - y0;
    y0 = null;
    if (dy > PULL_PX) refreshCurrent();
  }, { passive: true });
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

// 読んだ内容（getState の返事）を画面に当てはめる
function takeState(d) {
  S.today = d.today; S.day = d.day; S.items = d.items.map((it) => Object.assign({}, it));
  S.templates = d.templates; S.values = d.settings.values; S.warnings = d.settings.warnings; S.parts = d.parts;
  S.state = d; S.dirty.day = false;
  S.dayQuiet = (d.dayQuiet || []).map((q) => Object.assign({}, q));
  applyColors(S.values);
  renderDay();
  renderFresh('day-fresh', CACHE.stateAt[d.date]);
}

// その日の内容を読み込む。写しがあればすぐ出し、古ければ（または force なら）裏で読み直す
async function loadDay(date, force) {
  S.date = date;
  const c = CACHE.state[date];
  if (c) takeState(c);
  else { $('item-list').innerHTML = ''; $('day-label').textContent = TXT.LOADING; }
  if (c && !force && isFresh(CACHE.stateAt[date])) return;
  syncStart();
  try {
    const d = await callApi('getState', { date });
    CACHE.state[date] = d; CACHE.stateAt[date] = Date.now(); cacheSave();
    // 読んでいる間に、別の日・別のタブへ移ったり、書き換えを始めたりしていたら、画面は変えない
    if (S.tab === 'today' && S.date === date && !S.dirty.day) takeState(d);
  } catch (e) {
    if (!c) $('day-label').textContent = date;
    showError(e, () => loadDay(date, true));
  } finally { syncEnd(); }
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
    const inPlan = (it) => it.note !== 'carried' && it.note !== 'moved';
    const done = S.items.filter((it) => it.status === 'done' && inPlan(it)).length;
    const total = S.items.filter(inPlan).length;
    if (total) info.push(`今日 ${done}/${total}`);
  }
  if (S.parts.streak && st.streak) info.push(`連続${st.streak}日`);
  $('day-info').textContent = info.join('　');
  $('day-info').hidden = !info.length;

  // 休む・LINE停止・設定の注意
  const notes = [];
  if (st.tickHealth && !st.tickHealth.ok) notes.push(st.tickHealth.message);
  if (date === today && st.date === date && st.quietNow && st.quietNow.active) notes.push(TXT.QUIET_NOW.replace('{t}', st.quietNow.until));
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
  renderQuietDay();
}

/* ---------- 送らない時間帯 ---------- */

// 時間帯の行（withWd=true なら曜日の選択つき）。kind：'d'（この日だけ）／'w'（毎週）
function quietRow(q, idx, withWd, kind) {
  const kids = [];
  if (withWd) {
    kids.push(el('select', { class: 'q-wd', 'data-q': kind, 'data-idx': String(idx), 'aria-label': '曜日' },
      WEEKDAYS_JA.map((w, i) => el('option', { value: String(i), text: w + '曜', selected: Number(q.wd) === i }))));
  }
  kids.push(el('input', { type: 'time', class: 'q-from', value: q.from || '', 'data-q': kind, 'data-idx': String(idx), 'aria-label': '開始' }));
  kids.push(el('span', { text: '〜' }));
  kids.push(el('input', { type: 'time', class: 'q-to', value: q.to || '', 'data-q': kind, 'data-idx': String(idx), 'aria-label': '終わり' }));
  kids.push(el('button', { type: 'button', class: 'mini b-del', text: '✕', 'aria-label': '消す', 'data-qdel': kind, 'data-idx': String(idx) }));
  return el('li', { class: 'quiet-row' + (withWd ? '' : ' no-wd') }, kids);
}
// 時間帯の一覧を確かめる。誤りの文（無ければ ''）
function quietError(list, max) {
  if (list.length > max) return TXT.QUIET_MAX.replace('{n}', max);
  for (let i = 0; i < list.length; i++) {
    const q = list[i];
    if (!/^\d{2}:\d{2}$/.test(q.from || '') || !/^\d{2}:\d{2}$/.test(q.to || '')) return `${i + 1}個目：${TXT.QUIET_FORMAT}`;
    if (q.from === q.to) return `${i + 1}個目：${TXT.QUIET_SAME}`;
  }
  return '';
}
// 入力欄の今の値を読み取る（iPhoneで change が起きないまま保存を押した場合のため）
function syncQuietInputs(kind) {
  const list = kind === 'w' ? S.quietItems : S.dayQuiet;
  document.querySelectorAll(`#${kind === 'w' ? 'quiet-list' : 'day-quiet-list'} .quiet-row`).forEach((row, i) => {
    const q = list[i];
    if (!q) return;
    q.from = row.querySelector('.q-from').value || '';
    q.to = row.querySelector('.q-to').value || '';
    const wd = row.querySelector('.q-wd');
    if (wd) q.wd = Number(wd.value);
  });
}
// 「この日だけ送らない時間帯」を描く
function renderQuietDay() {
  const ul = $('day-quiet-list');
  ul.innerHTML = '';
  S.dayQuiet.forEach((q, i) => ul.appendChild(quietRow(q, i, false, 'd')));
  const err = quietError(S.dayQuiet, DAY_QUIET_MAX);
  $('day-quiet-err').textContent = err; $('day-quiet-err').hidden = !err;
  $('day-quiet-add').disabled = S.dayQuiet.length >= DAY_QUIET_MAX;
}
// この日だけの時間帯を変えたら、正しければすぐ保存する
function changeDayQuiet() {
  syncQuietInputs('d');
  const err = quietError(S.dayQuiet, DAY_QUIET_MAX);
  $('day-quiet-err').textContent = err; $('day-quiet-err').hidden = !err;
  if (err) return;
  S.dirty.day = true;
  queueSaveDay();
}
// 「送らない時間帯（毎週）」を描く
function renderQuietWeekly() {
  const ul = $('quiet-list');
  ul.innerHTML = '';
  S.quietItems.forEach((q, i) => ul.appendChild(quietRow(q, i, true, 'w')));
  const err = quietError(S.quietItems, QUIET_MAX);
  $('quiet-err').textContent = err; $('quiet-err').hidden = !err;
  $('quiet-add').disabled = S.quietItems.length >= QUIET_MAX;
}

// やること1件のカード
function renderItemCard(it, idx) {
  const finished = it.status === 'done' || it.status === 'skipped';
  const mark = it.templateId ? ITEM_MARK.TEMPLATE : ITEM_MARK.ONEOFF;
  let st = TXT.STATUS[it.status] || '';
  if (it.note === 'carried') st = '今日に移した';
  if (it.note === 'noreply') st = '見送り（返事なし）';
  if (it.note === 'moved') st = TXT.MOVED;
  if (it.status === 'doing' && it.fiveStage) st += '（5分だけ）';
  else if (it.status === 'doing' && it.startedAt) {
    st += `（〜${isoHm(new Date(new Date(it.startedAt).getTime() + it.minutes * 60000).toISOString())}）`;
  }
  const moved = Number(it.moveCount) > 0 ? TXT.MOVED_COUNT.replace('{n}', it.moveCount) : '';
  const meta = [`${it.minutes}分`, it.fixedTime ? `⏰${it.fixedTime}` : '', it.bedOk === '1' ? '🌙' : '', moved, st].filter(Boolean).join('　');
  const canAct = !!it.id && !S.dirty.day;
  const btns = [];
  const act = (op, label, cls) => el('button', { type: 'button', class: 'mini ' + (cls || ''), text: label,
    'data-op': op, 'data-id': it.id, disabled: !canAct, title: canAct ? '' : TXT.SAVE_FIRST });
  if (it.status === 'pending' || it.status === 'asked') {
    btns.push(act('start', TXT.BTN_START, 'b-start'));
    if (!it.templateId && S.parts.tomorrow) btns.push(act('tomorrow', TXT.BTN_TOMORROW, 'b-tmr'));   // その日だけのやることだけ
    btns.push(act('skip', TXT.BTN_SKIP, 'b-skip'));
  }
  if (it.status === 'doing') { btns.push(act('done', TXT.BTN_DONE, 'b-start')); btns.push(act('skip', TXT.BTN_SKIP, 'b-skip')); }
  if (it.status === 'skipped' && it.note !== 'carried') btns.push(act('restore', TXT.BTN_RESTORE));   // 見送りも「戻す」で未着手に戻せる
  btns.push(el('span', { class: 'grow' }));
  if (it.status !== 'done') {
    btns.push(el('button', { type: 'button', class: 'mini', text: '▲', 'aria-label': '上へ', 'data-move': '-1', 'data-idx': String(idx), disabled: idx === 0 }));
    btns.push(el('button', { type: 'button', class: 'mini', text: '▼', 'aria-label': '下へ', 'data-move': '1', 'data-idx': String(idx), disabled: idx === S.items.length - 1 }));
    btns.push(el('button', { type: 'button', class: 'mini b-del', text: '✕', 'aria-label': '削除', 'data-remove': String(idx) }));
  }
  return el('li', { class: 'item-card' + (finished ? ' finished' : '') + (it.note === 'moved' ? ' ic-moved' : ''), 'data-id': it.id || '' }, [
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
  queueSaveDay();             // 追加したらすぐ保存する
}
// 決まったやることを、その日だけのやることとして足す
function addFromTemplate(tid) {
  const t = S.templates.find((x) => x.id === tid);
  if (!t) return;
  S.items.push({ id: '', title: t.title, minutes: Number(t.minutes), fixedTime: t.fixedTime || '', status: 'pending', templateId: '', bedOk: t.bedOk });
  markDayDirty();
  queueSaveDay();             // 追加したらすぐ保存する
}

// 保存を順番に行う（続けて追加したときに、保存が重ならないように）
let saveDayChain = Promise.resolve();
function queueSaveDay() {
  saveDayChain = saveDayChain.then(() => (S.dirty.day ? saveDay() : true));
  return saveDayChain;
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
      items: S.items.map((it) => ({ id: it.id || '', title: it.title, minutes: it.minutes, fixedTime: it.fixedTime || '', bedOk: it.bedOk || '0' })),
      quiet: quietError(S.dayQuiet, DAY_QUIET_MAX) ? undefined : S.dayQuiet.map((q) => ({ from: q.from, to: q.to }))   // 誤りがある間は送らない（GASは前のまま）
    });
    S.day = d.day; S.items = d.items; S.dirty.day = false;
    let dq = [];
    try { dq = d.day && d.day.quiet ? JSON.parse(d.day.quiet) : []; } catch (e) { dq = []; }
    S.dayQuiet = dq;
    cachePatchDay(S.date, { day: d.day, items: d.items, dayQuiet: dq });
    renderDay();
    showStatus(TXT.SAVED);
    return true;
  } catch (e) { showError(e, saveDay); return false; }
  finally { btn.disabled = false; }
}

// 画面のボタン（始める・終わった・やめる・戻す）
// 押したらすぐ画面を切り替え、送信は裏で行う。失敗したら元に戻して理由を出す
async function doItemAction(id, op) {
  if (S.dirty.day) { showStatus(TXT.SAVE_FIRST, true); return; }
  const prev = S.items.map((x) => Object.assign({}, x));
  const it = S.items.find((x) => x.id === id);
  if (it) {
    const now = new Date().toISOString();
    if (op === 'start') { it.status = 'doing'; it.startedAt = now; it.fiveStage = ''; }
    else if (op === 'done') it.status = 'done';
    else if (op === 'skip') it.status = 'skipped';
    else if (op === 'restore') { it.status = 'pending'; it.note = ''; }
    else if (op === 'tomorrow') { it.status = 'skipped'; it.note = 'moved'; }
    renderDay();
  }
  syncStart();
  try {
    const d = await callApi('itemAction', { itemId: id, op });
    if (d.result === 'already' || d.result === 'invalid') showStatus(d.result === 'already' ? 'すでに終わっています（LINEで押した可能性があります）' : '今はその操作ができません', true);
    if (d.result === 'started') showStatus(TXT.MOVE_STARTED, true);
    if (op === 'tomorrow' || op === 'restore') {   // 翌日の内容が変わるので、翌日の写しは捨てる
      const nx = addDaysStr(S.date, 1);
      delete CACHE.state[nx]; delete CACHE.stateAt[nx];
    }
    S.items = d.items;
    cachePatchDay(S.date, { items: d.items });
    if (!S.dirty.day) renderDay();
  } catch (e) {
    S.items = prev; renderDay();
    showError(e, () => doItemAction(id, op));
  } finally { syncEnd(); }
}

/* ---------- 決まったやること ---------- */

// 決まったやることを読み込む（今日の内容の写しに入っている。古ければ裏で読み直す）
function takeTemplates(d) {
  S.today = d.today; S.templates = d.templates; S.values = d.settings.values;
  applyColors(S.values);
  S.tplItems = d.templates.map((t) => Object.assign({}, t));
  let qw = [];
  try { qw = JSON.parse(S.values.quietWeekly || '[]'); } catch (e) { qw = []; }
  S.quietItems = qw.map((q) => Object.assign({}, q));
  S.dirty.tpl = false;
  renderTemplates();
}
async function loadTemplates(force) {
  const date = S.today || localToday();
  const c = CACHE.state[date];
  if (c) takeTemplates(c); else $('tpl-list').innerHTML = '';
  if (c && !force && isFresh(CACHE.stateAt[date])) return;
  syncStart();
  try {
    const d = await callApi('getState', { date });
    CACHE.state[date] = d; CACHE.stateAt[date] = Date.now(); cacheSave();
    if (S.tab === 'template' && !S.dirty.tpl) takeTemplates(d);
  } catch (e) { showError(e, () => loadTemplates(true)); }
  finally { syncEnd(); }
}

// 「決まったやること」タブを描く
function renderTemplates() {
  const list = $('tpl-list');
  list.innerHTML = '';
  S.tplItems.forEach((t, i) => list.appendChild(renderTemplateCard(t, i)));
  renderQuietWeekly();
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
  syncQuietInputs('w');
  const qerr = quietError(S.quietItems, QUIET_MAX);
  if (qerr) { renderQuietWeekly(); showStatus('送らない時間帯：' + qerr, true); return false; }
  const btn = $('tpl-save');
  btn.disabled = true;
  try {
    const d = await callApi('saveTemplates', {
      items: S.tplItems.map((t) => ({ id: t.id || '', title: t.title, minutes: t.minutes, fixedTime: t.fixedTime || '', days: t.days, bedOk: t.bedOk })),
      quiet: S.quietItems.map((q) => ({ wd: Number(q.wd), from: q.from, to: q.to }))
    });
    S.templates = d.templates;
    S.tplItems = d.templates.map((t) => Object.assign({}, t));
    S.quietItems = (d.quietWeekly || []).map((q) => Object.assign({}, q));
    S.values = Object.assign({}, S.values, { quietWeekly: JSON.stringify(d.quietWeekly || []) });
    S.dirty.tpl = false;
    // 明日以降の日が作り直されるので、今日以外の写しは捨てる
    const today = S.today || localToday();
    Object.keys(CACHE.state).forEach((k) => { if (k !== today) { delete CACHE.state[k]; delete CACHE.stateAt[k]; } });
    if (CACHE.state[today]) {
      CACHE.state[today].templates = d.templates;
      CACHE.state[today].settings.values.quietWeekly = S.values.quietWeekly;
      CACHE.stateAt[today] = 0;     // 「今は送らない時間帯です」を出し直すため、次に開いたとき読み直す
    }
    cacheSave();
    renderTemplates();
    showStatus(TXT.SAVED_TPL);
    return true;
  } catch (e) { showError(e, saveTemplates); return false; }
  finally { btn.disabled = false; }
}

/* ---------- 記録 ---------- */

// 記録を読み込んで表にする（写しがあればすぐ出し、古ければ裏で読み直す）
async function loadStats(force) {
  if (CACHE.stats) renderStats(CACHE.stats);
  if (CACHE.stats && !force && isFresh(CACHE.statsAt)) return;
  syncStart();
  try {
    const d = await callApi('getStats', { weeks: 4 });
    CACHE.stats = d; CACHE.statsAt = Date.now(); cacheSave();
    if (S.tab === 'record') renderStats(d);
  } catch (e) { showError(e, () => loadStats(true)); }
  finally { syncEnd(); }
}

// 記録タブを描く
function renderStats(d) {
  if (d.look) applyColors(d.look);
  renderFresh('rec-fresh', CACHE.statsAt);
  // GASに貼り忘れた部品のファイル（その部品は飛ばして動いている）
  const miss = $('rec-missing');
  miss.innerHTML = '';
  (d.missingParts || []).forEach((m) => miss.appendChild(el('p', { class: 'warn', text: '⚠ ' + m })));
  miss.hidden = !(d.missingParts || []).length;
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
    const title = it.title + (it.note === 'moved' ? '（翌日へ）' : '');
    rec.appendChild(el('li', {}, [el('span', { class: 'fix-date', text: dateLabel(it.date) }), el('span', { class: 'fix-title', text: title }), sel]));
  });
  $('rec-error').textContent = d.lastError ? `${d.lastError.at}　${d.lastError.message}` : TXT.NO_ERROR;
}

// 押し間違いを直す
async function fixItem(id, status) {
  syncStart();
  try {
    const d = await callApi('fixItem', { itemId: id, status, weeks: 4 });
    CACHE.stats = d; CACHE.statsAt = Date.now();
    Object.keys(CACHE.stateAt).forEach((k) => { CACHE.stateAt[k] = 0; });   // 今日タブは次に開いたとき読み直す
    cacheSave();
    renderStats(d); showStatus(TXT.SAVED);
  } catch (e) { showError(e); loadStats(true); }
  finally { syncEnd(); }
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
  // 送らない時間帯（毎週）：決まったやることと一緒に保存する
  $('quiet-add').addEventListener('click', () => {
    syncQuietInputs('w');
    S.quietItems.push(Object.assign({ wd: weekdayOfStr(S.today || localToday()) }, QUIET_NEW));
    S.dirty.tpl = true; renderQuietWeekly();
  });
  $('quiet-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-qdel]');
    if (!b) return;
    syncQuietInputs('w');
    S.quietItems.splice(Number(b.dataset.idx), 1); S.dirty.tpl = true; renderQuietWeekly();
  });
  $('quiet-list').addEventListener('change', () => { syncQuietInputs('w'); S.dirty.tpl = true; renderQuietWeekly(); });
  // この日だけ送らない時間帯：変えたらすぐ保存する
  $('day-quiet-add').addEventListener('click', () => {
    syncQuietInputs('d');
    S.dayQuiet.push(Object.assign({}, QUIET_NEW)); renderQuietDay(); changeDayQuiet();
  });
  $('day-quiet-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-qdel]');
    if (!b) return;
    syncQuietInputs('d');
    S.dayQuiet.splice(Number(b.dataset.idx), 1); renderQuietDay(); changeDayQuiet();
  });
  $('day-quiet-list').addEventListener('change', changeDayQuiet);
  $('tpl-save').addEventListener('click', saveTemplates);

  $('rec-recent').addEventListener('change', (e) => { if (e.target.dataset.fix) fixItem(e.target.dataset.fix, e.target.value); });

  initCustomize();
  cacheLoad();
  initPullToRefresh();
  document.querySelectorAll('[data-refresh]').forEach((b) => b.addEventListener('click', refreshCurrent));
  // アプリに戻ってきたとき、今のタブの内容が古ければ裏で読み直す
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || hasDirty() || !lsGet(LS_KEYS.GAS_URL)) return;
    if (S.tab === 'today') loadDay(S.date || localToday());
    else if (S.tab === 'record') loadStats();
  });

  S.date = localToday();
  const last = lsGet(LS_KEYS.LAST_TAB);
  const first = TABS.indexOf(last) >= 0 ? last : 'today';
  switchTab(lsGet(LS_KEYS.GAS_URL) ? first : 'customize', true);
  initUpdateNotice();
}

document.addEventListener('DOMContentLoaded', init);
