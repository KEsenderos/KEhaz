/* KEhaz customize.js　目的：カスタマイズタブ（設定の一覧表から入力欄を作る、範囲チェック、見本の表示、
   保存・取り消し・初期値に戻す、LINEの送信数とテスト送信、改善メモ、控え）。
   入力欄は、GASから届く設定の一覧表（defs）から作るので、設定を足してもこのファイルは直さなくてよい。
   基づく仕様書：KEhaz_仕様書_v3.0 */

const CZ = { defs: [], defMap: {}, values: {}, warnings: [], patch: {}, errors: {}, parts: [], pushUsage: null,
  changes: [], backups: [], memos: [], focusKey: 'msg_askFirst', loaded: false };

// 今の値（変更中ならその値）
function czVal(key) { return Object.prototype.hasOwnProperty.call(CZ.patch, key) ? CZ.patch[key] : CZ.values[key]; }
function czDirtyCount() { return Object.keys(CZ.patch).length; }

/* ---------- 範囲チェック（GASの validateSetting_ と同じ決まり） ---------- */

// 値を確かめ、誤りの文（無ければ ''）を返す
function czValidate(def, raw) {
  const v = raw === undefined || raw === null ? '' : String(raw);
  switch (def.type) {
    case 'hm':
      if (v === '' && def.allowEmpty) return '';
      if (!/^\d{2}:\d{2}$/.test(v)) return '時刻は 16:30 の形で入れてください';
      return Number(v.slice(0, 2)) > 23 || Number(v.slice(3)) > 59 ? '時刻が正しくありません' : '';
    case 'int':
      if (!/^-?\d+$/.test(v.trim())) return '整数で入れてください';
      return Number(v) < def.min || Number(v) > def.max ? `${def.min}〜${def.max}で入れてください` : '';
    case 'date':
      if (v === '' && def.allowEmpty) return '';
      return /^\d{4}-\d{2}-\d{2}$/.test(v) ? '' : '日付が正しくありません';
    case 'color':
      return /^#[0-9A-Fa-f]{6}$/.test(v) ? '' : '色は #1F6FEB の形で入れてください';
    case 'msg':
    case 'label': {
      if (!v.trim()) return '空にはできません（戻すときは「このまとまりを初期値に戻す」）';
      const bad = [];
      v.replace(/\{([^{}]*)\}/g, (m, k) => { if ((def.vars || []).indexOf(k) < 0 && bad.indexOf(k) < 0) bad.push(k); return m; });
      if (bad.length) return `使えない差し込みの印：${bad.map((b) => '{' + b + '}').join(' ')}（使える印：${(def.vars || []).map((x) => '{' + x + '}').join(' ') || 'なし'}）`;
      const len = def.type === 'label' ? v.replace(/\{minutes\}/g, '00').length : v.length;
      if (len > def.maxLen) return `${def.maxLen}文字までです（今${len}文字）`;
      if (def.type === 'label' && v.indexOf('\n') >= 0) return 'ボタンの文字に改行は入れられません';
      return '';
    }
    case 'list': {
      let arr;
      try { arr = JSON.parse(v || '[]'); } catch (e) { return '一覧の形が読めません'; }
      if (arr.length > def.maxItems) return `${def.maxItems}個までです（今${arr.length}個）`;
      const long = arr.find((x) => x.length > def.maxLen);
      return long ? `1つ${def.maxLen}文字までです：「${long.slice(0, 20)}…」` : '';
    }
    default: return '';
  }
}

/* ---------- 読み込みと保存 ---------- */

// GASから設定の一覧表と今の値を読む
async function loadCustomize() {
  $('set-gas-url').value = lsGet(LS_KEYS.GAS_URL);
  $('set-pass').value = lsGet(LS_KEYS.PASS);
  $('set-version').textContent = APP_VERSION;
  if (!lsGet(LS_KEYS.GAS_URL) || !lsGet(LS_KEYS.PASS)) { $('cz-conn').open = true; $('cz-body').innerHTML = ''; return; }
  $('cz-body').textContent = TXT.LOADING;
  try { czTake(await callApi('getCustomize', {})); }
  catch (e) { $('cz-body').textContent = ''; $('cz-conn').open = true; showError(e, loadCustomize); }
}

// GASから届いた内容を当てはめて描き直す
function czTake(d) {
  CZ.defs = d.defs; CZ.defMap = {};
  d.defs.forEach((x) => { CZ.defMap[x.key] = x; });
  CZ.values = d.settings.values; CZ.warnings = d.settings.warnings;
  CZ.parts = d.parts; CZ.pushUsage = d.pushUsage; CZ.changes = d.changes; CZ.backups = d.backups; CZ.memos = d.memos;
  CZ.patch = {}; CZ.errors = {}; CZ.loaded = true;
  $('set-version').textContent = `アプリ ${APP_VERSION} ／ GAS ${d.version}` + (d.version !== APP_VERSION ? '（版が違います。更新を確かめてください）' : '');
  applyColors(CZ.values);
  renderCustomize();
}

// 変更を保存する（1つでも範囲外なら保存しない）
async function czSave() {
  if (Object.keys(CZ.errors).length) { showStatus(TXT.CZ_HAS_ERROR, true); return false; }
  if (!czDirtyCount()) return true;
  $('cz-save').disabled = true;
  try {
    czTake(await callApi('saveCustomize', { patch: CZ.patch }));
    showStatus(TXT.SAVED);
    return true;
  } catch (e) {
    if (e.details) { e.details.forEach((x) => { CZ.errors[x.key] = x.message; }); czRefreshErrors(); }
    showError(e, czSave);
    return false;
  } finally { $('cz-save').disabled = false; czUpdateBar(); }
}

// 変更を取り消す
function czDiscard(silent) {
  CZ.patch = {}; CZ.errors = {};
  if (CZ.loaded && !silent) renderCustomize();
  czUpdateBar();
}

// 値を変える（画面の入力から呼ぶ）
function czSet(key, value) {
  const def = CZ.defMap[key];
  if (!def) return;
  if (String(value) === String(CZ.values[key])) delete CZ.patch[key]; else CZ.patch[key] = String(value);
  const err = czValidate(def, value);
  if (err) CZ.errors[key] = err; else delete CZ.errors[key];
  czRefreshField(key);
  czUpdateBar();
  czRenderPreviews();
}

// 保存バーの表示
function czUpdateBar() {
  const n = czDirtyCount();
  const show = S.tab === 'customize' && n > 0;
  $('cz-bar').hidden = !show;
  $('cz-bar-text').textContent = Object.keys(CZ.errors).length ? TXT.CZ_HAS_ERROR : TXT.CZ_DIRTY.replace('{n}', n);
  $('cz-save').disabled = Object.keys(CZ.errors).length > 0;
}

/* ---------- 描画 ---------- */

// 開いているまとまりを覚える
function czOpenSecs() { try { return JSON.parse(lsGet(LS_KEYS.OPEN_SECS) || '[]'); } catch (e) { return []; } }
function czRememberOpen(id, open) {
  const s = czOpenSecs().filter((x) => x !== id);
  if (open) s.push(id);
  lsSet(LS_KEYS.OPEN_SECS, JSON.stringify(s));
}

// まとまり1つの枠
function czSection(id, title, children, resetGroup) {
  const det = el('details', { class: 'cz-sec', 'data-sec': id, open: czOpenSecs().indexOf(id) >= 0 }, [el('summary', { text: title })].concat(children));
  if (resetGroup) {
    const b = el('button', { type: 'button', class: 'mini cz-reset', text: 'このまとまりを初期値に戻す' });
    b.addEventListener('click', () => confirmTwice(b, () => czReset(resetGroup)));
    det.appendChild(el('div', { class: 'cz-foot' }, [b]));
  }
  det.addEventListener('toggle', () => czRememberOpen(id, det.open));
  return det;
}

// カスタマイズタブ全体を描く
function renderCustomize() {
  const body = $('cz-body');
  body.innerHTML = '';
  const w = $('cz-warnings');
  w.innerHTML = '';
  CZ.warnings.forEach((x) => w.appendChild(el('p', { text: x.message })));
  w.hidden = !CZ.warnings.length;
  CZ_GROUPS.forEach((g) => {
    const defs = CZ.defs.filter((d) => d.group === g.id);
    let kids;
    if (g.id === 'time') kids = czTimeGroup(defs);
    else if (g.id === 'msg') kids = [el('div', { class: 'preview', id: 'pv-msg' })].concat(defs.map(czField));
    else if (g.id === 'btn' || g.id === 'color') kids = [el('div', { class: 'preview', id: 'pv-' + g.id })].concat(defs.map(czField));
    else if (g.id === 'part') kids = [el('p', { class: 'muted small', text: '案内（「始める？」を送る）は外せません' })].concat(defs.map(czField));
    else if (g.id === 'line') kids = czLineGroup(defs);
    else kids = defs.map(czField);
    body.appendChild(czSection(g.id, g.title, kids, g.id));
  });
  if (czVal('part_memo') === '1') body.appendChild(czSection('memo', '改善メモ', czMemoGroup()));
  body.appendChild(czSection('backup', '控え・変更記録', czBackupGroup()));
  czRenderPreviews();
  czUpdateBar();
}

// 入力欄1つ（設定の種類から作る）
function czField(def) {
  const key = def.key;
  const v = czVal(key);
  let input;
  if (def.type === 'bool') {
    input = el('input', { type: 'checkbox', 'data-key': key, checked: v === '1' });
    return el('div', { class: 'cz-field', id: 'f-' + key }, [
      el('label', { class: 'check' }, [input, el('span', { class: 'cz-label', text: def.label })]),
      def.help ? el('p', { class: 'muted small', text: def.help }) : null,
      el('p', { class: 'cz-err', id: 'err-' + key, hidden: true })
    ]);
  }
  if (def.type === 'enum') input = el('select', { 'data-key': key }, def.choices.map((c) => el('option', { value: c.v, text: c.t, selected: c.v === v })));
  else if (def.type === 'hm') input = el('input', { type: 'time', 'data-key': key, value: v });
  else if (def.type === 'int') input = el('input', { type: 'number', 'data-key': key, value: v, min: def.min, max: def.max, step: 1, inputMode: 'numeric' });
  else if (def.type === 'date') input = el('input', { type: 'date', 'data-key': key, value: v });
  else if (def.type === 'color') input = el('input', { type: 'color', 'data-key': key, value: v });
  else if (def.type === 'msg') input = el('textarea', { 'data-key': key, rows: 2, value: v });
  else if (def.type === 'label') input = el('input', { type: 'text', 'data-key': key, value: v });
  else if (def.type === 'list') {
    let arr = []; try { arr = JSON.parse(v || '[]'); } catch (e) { arr = []; }
    input = el('textarea', { 'data-key': key, 'data-list': '1', rows: 6, value: arr.join('\n') });
  }
  const range = def.type === 'int' ? `（${def.min}〜${def.max}）` : '';
  const hint = [];
  if (def.vars && def.vars.length) hint.push('使える印：' + def.vars.map((x) => '{' + x + '}').join(' '));
  if (def.help) hint.push(def.help);
  const kids = [
    el('label', { class: 'cz-label', text: def.label + range }), input,
    (def.type === 'msg' || def.type === 'label' || def.type === 'list') ? el('span', { class: 'cz-count muted small', id: 'cnt-' + key }) : null,
    hint.length ? el('p', { class: 'muted small', text: hint.join('　') }) : null,
    el('p', { class: 'cz-err', id: 'err-' + key, hidden: true })
  ];
  if (def.type === 'date') {
    const clr = el('button', { type: 'button', class: 'mini', text: '空欄にする' });
    clr.addEventListener('click', () => { input.value = ''; czSet(key, ''); });
    kids.splice(2, 0, clr);
  }
  if (def.type === 'color') kids.splice(3, 0, el('p', { class: 'cz-warn small', id: 'cw-' + key, hidden: true }));
  const f = el('div', { class: 'cz-field', id: 'f-' + key }, kids);
  setTimeout(() => czRefreshField(key), 0);
  return f;
}

// 入力欄の誤り・文字数・注意を描き直す
function czRefreshField(key) {
  const def = CZ.defMap[key];
  const err = $('err-' + key);
  if (err) { err.textContent = CZ.errors[key] || ''; err.hidden = !CZ.errors[key]; }
  const f = $('f-' + key);
  if (f) f.classList.toggle('changed', Object.prototype.hasOwnProperty.call(CZ.patch, key));
  const cnt = $('cnt-' + key);
  if (cnt && def) {
    const v = czVal(key) || '';
    if (def.type === 'list') { let a = []; try { a = JSON.parse(v || '[]'); } catch (e) { a = []; } cnt.textContent = `${a.length}/${def.maxItems}個`; }
    else cnt.textContent = `${def.type === 'label' ? v.replace(/\{minutes\}/g, '00').length : v.length}/${def.maxLen}文字`;
  }
  if (def && def.type === 'color') czContrastWarn();
}
function czRefreshErrors() { Object.keys(CZ.defMap).forEach(czRefreshField); czUpdateBar(); }

// 曜日ごとの表と、そのほかの時刻
function czTimeGroup(defs) {
  const rows = WEEKDAYS_JA.map((w, i) => {
    const tdef = CZ.defMap['dayType_' + i];
    const sel = el('select', { 'data-key': 'dayType_' + i, 'data-weekday': String(i) },
      tdef.choices.map((c) => el('option', { value: c.v, text: c.t, selected: c.v === czVal('dayType_' + i) })));
    const tm = el('input', { type: 'time', 'data-key': 'startTime_' + i, id: 'in-startTime_' + i, value: czVal('startTime_' + i) });
    return el('div', { class: 'wd-row', id: 'f-startTime_' + i }, [el('span', { class: 'wd-name', text: w }), sel, tm,
      el('p', { class: 'cz-err', id: 'err-startTime_' + i, hidden: true })]);
  });
  const others = defs.filter((d) => !/^(dayType_|startTime_)/.test(d.key));
  return [el('p', { class: 'muted small', text: '曜日ごとに「仕事の日／休みの日」と最初の案内の時刻を決めます。時刻を空欄にした曜日は送りません。' }),
    el('div', { class: 'wd-table' }, rows)].concat(others.map(czField));
}

// LINEのまとまり（送信数・切り替えの境目・テスト送信）
function czLineGroup(defs) {
  const u = CZ.pushUsage;
  const lines = u ? u.accounts.map((a) => el('p', {
    text: `アカウント${a.id === '1' ? '①' : '②'}：` + (a.configured ? `${a.count} / ${u.quota} 通` + (u.active === a.id ? '（今はこちらから送っています）' : '') : '設定されていません（GASのスクリプトプロパティ）')
  })) : [];
  if (u && u.stopped) lines.push(el('p', { class: 'warn', text: TXT.LINE_STOPPED }));
  const test = el('button', { type: 'button', class: 'wide', text: 'LINEにテスト送信（1通使います）' });
  test.addEventListener('click', czTestLine);
  return [el('div', { class: 'box-in' }, lines)].concat(defs.map(czField), [
    el('p', { class: 'muted small', text: `1つのアカウントで${u ? u.hard : 195}通に届いた日は、その日の残りだけ②から送ります。毎月1日に①へ戻ります。` }), test]);
}

// 改善メモのまとまり
function czMemoGroup() {
  const ta = el('textarea', { id: 'memo-text', rows: 3, maxLength: 500, placeholder: '使っていて気づいたこと・直したいこと' });
  const add = el('button', { type: 'button', class: 'primary', text: 'メモを足す' });
  add.addEventListener('click', czAddMemo);
  const copy = el('button', { type: 'button', text: 'まとめてコピー（Claude に貼る用）' });
  copy.addEventListener('click', czCopyMemos);
  const list = el('ul', { class: 'memo-list' }, CZ.memos.map((m) => {
    const del = el('button', { type: 'button', class: 'mini b-del', text: '✕', 'aria-label': '消す' });
    del.addEventListener('click', () => confirmTwice(del, () => czDeleteMemo(m.id)));
    return el('li', {}, [el('span', { class: 'muted small', text: isoDateLabel(m.ts) }), el('span', { class: 'memo-text', text: m.text }), del]);
  }));
  return [ta, el('div', { class: 'row' }, [add, copy]), list];
}

// 控え・変更記録のまとまり
function czBackupGroup() {
  const exp = el('button', { type: 'button', text: '控えをファイルに書き出す' });
  exp.addEventListener('click', czExport);
  const file = el('input', { type: 'file', id: 'cz-import-file', accept: '.json,application/json', hidden: true });
  file.addEventListener('change', czImport);
  const imp = el('button', { type: 'button', text: '控えのファイルを読み込む' });
  imp.addEventListener('click', () => file.click());
  const bks = el('ul', { class: 'bk-list' }, CZ.backups.map((b) => {
    const r = el('button', { type: 'button', class: 'mini', text: 'この状態に戻す' });
    r.addEventListener('click', () => confirmTwice(r, () => czRestore(b.ts)));
    return el('li', {}, [el('span', { class: 'small', text: `${isoDateLabel(b.ts)}　${b.reason}` }), r]);
  }));
  const chg = el('ul', { class: 'chg-list small' }, CZ.changes.map((c) => el('li', {
    text: `${isoDateLabel(c.ts)}　${c.label}：${short(c.before)} → ${short(c.after)}`
  })));
  const all = el('button', { type: 'button', class: 'b-del', text: 'すべての設定を初期値に戻す' });
  all.addEventListener('click', () => confirmTwice(all, () => czReset('all')));
  return [
    el('p', { class: 'muted small', text: '書き出した控えには、合言葉などの秘密の値は入りません。設定を変えるたびに、直前の状態が自動で残ります（10回分）。' }),
    el('div', { class: 'row' }, [exp, imp, file]),
    el('h4', { text: '自動の控え' }), CZ.backups.length ? bks : el('p', { class: 'muted small', text: 'まだありません' }),
    el('h4', { text: '変更記録（新しい順）' }), CZ.changes.length ? chg : el('p', { class: 'muted small', text: 'まだありません' }),
    all
  ];
}
function short(s) { s = String(s || ''); return s.length > 30 ? s.slice(0, 30) + '…' : (s || '（空）'); }
function isoDateLabel(iso) { const d = new Date(iso); return isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${isoHm(iso)}`; }

/* ---------- 見本（LINEに届く形） ---------- */

// ボタンの文字（{minutes} を差し込む）
function czLabel(key) {
  const mins = { btn_five: 'fiveMin', btn_snooze: 'snoozeMin', btn_later: 'laterMin', btn_extend: 'extendMin' };
  return String(czVal(key) || '').replace(/\{minutes\}/g, mins[key] ? czVal(mins[key]) : '');
}
// 文の {印} に見本の値を入れる
function czFill(text, extra) {
  const vars = Object.assign({}, CZ_SAMPLE, extra || {});
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
}
// LINEのメッセージの見本を作る
function czBubble(text, buttons) {
  return el('div', { class: 'lb' }, [el('p', { class: 'lb-text', text })].concat(buttons.length ? [el('div', { class: 'lb-btns' }, buttons.map((b) => {
    const e = el('span', { class: 'lb-btn lb-' + b.kind, text: b.label });
    if (b.kind === 'start') e.style.background = czVal('color_start');
    if (b.kind === 'skip') e.style.color = czVal('color_skip');
    return e;
  }))] : []));
}
// 「始める？」に付くボタンの見本
function czAskButtons(first) {
  const b = [{ label: czLabel('btn_start'), kind: 'start' }];
  if (czVal('part_five') === '1') b.push({ label: czLabel('btn_five'), kind: 'normal' });
  if (Number(czVal('maxSnoozes')) > 0) b.push({ label: czLabel('btn_snooze'), kind: 'normal' });
  if (first) b.push({ label: czLabel('btn_later'), kind: 'normal' });
  b.push({ label: czLabel('btn_skip'), kind: 'skip' });
  return b;
}
// 文言ごとに付くボタン
function czButtonsFor(key) {
  if (key === 'msg_askFirst') return czAskButtons(true);
  if (['msg_askNext', 'msg_askFixed', 'msg_askAgain'].indexOf(key) >= 0) return czAskButtons(false);
  if (key === 'msg_started') return [{ label: czLabel('btn_done'), kind: 'start' }, { label: czLabel('btn_skip'), kind: 'skip' }];
  if (key === 'msg_endCheck') return [{ label: czLabel('btn_done'), kind: 'start' }, { label: czLabel('btn_extend'), kind: 'normal' }, { label: czLabel('btn_skip'), kind: 'skip' }];
  if (key === 'msg_fiveCheck') return [{ label: czLabel('btn_cont'), kind: 'start' }, { label: czLabel('btn_stopHere'), kind: 'normal' }];
  if (key === 'msg_carry') return [{ label: czLabel('btn_carryYes'), kind: 'start' }, { label: czLabel('btn_carryNo'), kind: 'skip' }];
  return [];
}
// 見本を描き直す
function czRenderPreviews() {
  const key = CZ.focusKey;
  const minutesFor = { msg_extended: czVal('extendMin'), msg_snoozed: czVal('snoozeMin'), msg_fiveStart: czVal('fiveMin'), msg_fiveCheck: czVal('fiveMin'), msg_fiveStop: czVal('fiveMin') };
  const pm = $('pv-msg');
  if (pm && CZ.defMap[key]) {
    pm.innerHTML = '';
    pm.appendChild(el('p', { class: 'muted small', text: `見本：${CZ.defMap[key].label}（入力欄を押すと切り替わります）` }));
    pm.appendChild(czBubble(czFill(czVal(key), minutesFor[key] ? { minutes: minutesFor[key] } : {}), czButtonsFor(key)));
  }
  ['pv-btn', 'pv-color'].forEach((id) => {
    const p = $(id);
    if (!p) return;
    p.innerHTML = '';
    p.appendChild(el('p', { class: 'muted small', text: '見本：その日の最初の案内' }));
    p.appendChild(czBubble(czFill(czVal('msg_askFirst')), czAskButtons(true)));
  });
  const pc = $('pv-color');
  if (pc) {
    const app = el('div', { class: 'row' }, [
      el('span', { class: 'pv-app', text: '主な色', style: `background:${czVal('color_accent')}` }),
      el('span', { class: 'pv-app', text: '始める', style: `background:${czVal('color_start')}` }),
      el('span', { class: 'pv-app pv-skip', text: 'やめる', style: `color:${czVal('color_skip')};border-color:${czVal('color_skip')}` })
    ]);
    pc.appendChild(el('p', { class: 'muted small', text: 'アプリのボタン' }));
    pc.appendChild(app);
  }
}

// 明るさの差（コントラスト比）
function contrastRatio(a, b) {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
// 読みにくい色の組み合わせに注意を出す（保存はできる）
function czContrastWarn() {
  ['color_accent', 'color_start', 'color_skip'].forEach((k) => {
    const w = $('cw-' + k);
    const v = czVal(k);
    if (!w || !/^#[0-9A-Fa-f]{6}$/.test(v || '')) return;
    const r = contrastRatio(v, '#FFFFFF');
    w.textContent = TXT.CONTRAST_WARN.replace('{r}', r.toFixed(1));
    w.hidden = r >= 4.5;
  });
}

/* ---------- 操作 ---------- */

// まとまりを初期値に戻す
async function czReset(group) {
  try { czTake(await callApi('resetCustomize', { group })); showStatus(TXT.SAVED); }
  catch (e) { showError(e); }
}

// テスト送信
async function czTestLine() {
  try {
    const d = await callApi('testLine', {});
    CZ.pushUsage = d.pushUsage;
    showStatus(TXT.TEST_SENT.replace('{a}', d.acct === '2' ? '②' : '①'));
    renderCustomize();
  } catch (e) { showError(e); }
}

// 改善メモを足す・消す
async function czAddMemo() {
  const t = $('memo-text').value.trim();
  if (!t) return;
  try { const d = await callApi('addMemo', { text: t }); CZ.memos = d.memos; renderCustomize(); showStatus(TXT.SAVED); }
  catch (e) { showError(e); }
}
async function czDeleteMemo(id) {
  try { const d = await callApi('deleteMemo', { id }); CZ.memos = d.memos; renderCustomize(); }
  catch (e) { showError(e); }
}

// 改善メモと、初期値から変えた設定を、Claude に貼る形でコピーする
async function czCopyMemos() {
  const lines = [`KEhaz v${APP_VERSION} の改善メモ（${CZ.memos.length}件）`];
  CZ.memos.slice().reverse().forEach((m) => lines.push(`- [${isoDateLabel(m.ts)}] ${m.text}`));
  const changed = CZ.defs.filter((d) => String(CZ.values[d.key]) !== String(d.def));
  lines.push('', `初期値から変えている設定（${changed.length}件）`);
  changed.forEach((d) => lines.push(`- ${d.label}（${d.key}）：${CZ.values[d.key]}`));
  const text = lines.join('\n');
  try { await navigator.clipboard.writeText(text); showStatus(TXT.COPIED); }
  catch (e) {
    // コピーできない環境では、選んでコピーできるように表示する
    const ta = el('textarea', { rows: 8, value: text, readOnly: true });
    $('memo-text').after(ta); ta.select();
    showStatus('自動でコピーできませんでした。出てきた欄を長押ししてコピーしてください', true);
  }
}

// 控えをファイルに書き出す
async function czExport() {
  try {
    const d = await callApi('exportBackup', {});
    const text = JSON.stringify(d.snapshot, null, 2);
    const now = new Date();
    const name = `KEhaz_控え_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.json`;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = el('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showStatus('書き出しました：' + name);
  } catch (e) { showError(e); }
}

// 控えのファイルを読み込む（読み込む前の状態は、GASが自動の控えに残す）
async function czImport(e) {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const snap = JSON.parse(await f.text());
    czTake(await callApi('importBackup', { snapshot: snap }));
    showStatus(TXT.IMPORTED);
  } catch (err) { showError(err.code ? err : { code: 'BAD_FILE', message: 'ファイルが読めません：' + err.message }); }
}

// 自動の控えから戻す
async function czRestore(ts) {
  try { czTake(await callApi('restoreBackup', { ts })); showStatus(TXT.RESTORED); }
  catch (e) { showError(e); }
}

// つなぎ先を端末に保存してつなぐ
function czSaveConn() {
  lsSet(LS_KEYS.GAS_URL, $('set-gas-url').value.trim());
  lsSet(LS_KEYS.PASS, $('set-pass').value.trim());
  showStatus(TXT.CONN_SAVED);
  loadCustomize();
}

// 画面の入力を受け取る
function czOnInput(e) {
  const t = e.target;
  const key = t.dataset.key;
  if (!key) return;
  let v;
  if (t.type === 'checkbox') v = t.checked ? '1' : '0';
  else if (t.dataset.list) v = JSON.stringify(t.value.split('\n').map((x) => x.trim()).filter((x) => x));
  else v = t.value;
  if (t.type === 'color') v = v.toUpperCase();
  czSet(key, v);
  // 曜日の種類を切り替えたら、その種類の時刻を入れる
  if (t.dataset.weekday !== undefined && e.type === 'change') {
    const i = t.dataset.weekday;
    const tm = czVal(v === 'off' ? 'startOff' : 'startWork');
    $('in-startTime_' + i).value = tm;
    czSet('startTime_' + i, tm);
  }
  if (t.dataset.key === 'part_memo' && e.type === 'change') renderCustomize();
}

// カスタマイズタブの準備（起動時に1回）
function initCustomize() {
  $('set-conn-save').addEventListener('click', czSaveConn);
  $('cz-save').addEventListener('click', czSave);
  $('cz-cancel').addEventListener('click', () => czDiscard(false));
  const body = $('cz-body');
  body.addEventListener('input', (e) => { if (e.target.tagName !== 'SELECT' && e.target.type !== 'checkbox') czOnInput(e); });
  body.addEventListener('change', czOnInput);
  body.addEventListener('focusin', (e) => {
    const k = e.target.dataset && e.target.dataset.key;
    if (k && CZ.defMap[k] && CZ.defMap[k].type === 'msg') { CZ.focusKey = k; czRenderPreviews(); }
  });
}
