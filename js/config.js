/* KEhaz config.js　目的：アプリの定数と表示文言をまとめる。基づく仕様書：KEhaz_仕様書_v3.5.1 */
const APP_VERSION = '3.5.1';
const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const LS_KEYS = { GAS_URL: 'haz_gasUrl', PASS: 'haz_pass', LAST_TAB: 'haz_lastTab', OPEN_SECS: 'haz_openSecs', THEME: 'haz_theme', CACHE: 'haz_cache' };
const FRESH_MS = 5 * 60 * 1000;   // 読んでからこの時間以内なら、タブを切り替えても読み直さない
const PULL_PX = 80;               // 画面のいちばん上で、これだけ下に引っぱると読み直す

// 見た目ごとの色（style.css の値と同じ。app：アプリの色、line：LINEのボタンの色、bar：iPhone上部の色）
const THEMES = {
  athlete: { app: { accent: '#C2410C', start: '#111111', skip: '#6B6B6B' }, line: { start: '#111111', skip: '#6B6B6B' }, bar: '#FAFAF7' },
  night: { app: { accent: '#5B9BFF', start: '#2FC27A', skip: '#F2B33D' }, line: { start: '#1A7F37', skip: '#9A6700' }, bar: '#0D1321' },
  glass: { app: { accent: '#4F46E5', start: '#0E7A55', skip: '#9A4A08' }, line: { start: '#0E7A55', skip: '#9A4A08' }, bar: '#A5C8FF' },
  plain: { app: { accent: '#1F6FEB', start: '#1A7F37', skip: '#9A6700' }, line: { start: '#1A7F37', skip: '#9A6700' }, bar: '#1B4FA8' }
};
const DEFAULT_THEME = 'athlete';
const MINUTES_CHOICES = [5, 10, 15, 30, 45, 60, 90, 120];
const WARN_ITEM_COUNT = 5;   // これを超えたら「多すぎるかも」と警告
const MAX_DAYS_AHEAD = 30;   // その日だけのやることを足せる先の日数
const ITEM_MARK = { TEMPLATE: '🔁', ONEOFF: '★' };
const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];
const QUIET_MAX = 20;          // 送らない時間帯（毎週）の最大の個数（GASの HAZ_QUIET_MAX と同じ）
const DAY_QUIET_MAX = 10;      // この日だけ送らない時間帯の最大の個数（GASの HAZ_DAY_QUIET_MAX と同じ）
const QUIET_NEW = { from: '19:00', to: '21:00' };   // ［＋ 時間帯を足す］で入る値
const DAY_START_HOUR = 4;    // 午前4時で日付を切り替える（GASと同じ）
const CONFIRM_MS = 4000;     // 「もう一度押すと…」の受付時間
const TABS = ['today', 'template', 'record', 'customize'];

// カスタマイズタブのまとまり（並び順）
const CZ_GROUPS = [
  { id: 'time', title: '時刻' }, { id: 'count', title: '回数' }, { id: 'msg', title: '文言（LINEのメッセージ）' },
  { id: 'btn', title: 'ボタンの文字' }, { id: 'color', title: '色' }, { id: 'part', title: '部品のON／OFF' },
  { id: 'phrase', title: 'ひと言' }, { id: 'rest', title: '休む' }, { id: 'line', title: 'LINE' }
];

// 見本に差し込む値
const CZ_SAMPLE = { title: 'スペイン語学習', minutes: 60, time: '22:30', endTime: '17:30', titles: '買い物リスト', days: 3,
  count: 3, done: 2, total: 4, planned: 20, date: '11/7（土）' };

const TXT = {
  STATUS: { pending: '', asked: 'LINEで案内中', doing: '実行中', done: '済 ✓', skipped: 'やめた' },
  FIX_STATUS: { done: '終わった', skipped: 'やめた', pending: '終わらなかった' },
  BTN_START: '始める', BTN_DONE: '終わった', BTN_SKIP: 'やめる', BTN_RESTORE: '戻す', BTN_TOMORROW: '翌日へ',
  MOVED: '↪ 翌日へ', MOVED_COUNT: '↪ まわして{n}回目', MOVE_STARTED: '翌日の分がもう始まっているため、戻せません',
  QUIET_NOW: '今は送らない時間帯です（〜{t}）。LINEの案内は、時間帯が終わってから届きます',
  QUIET_SAME: '開始と終わりが同じです', QUIET_FORMAT: '開始と終わりの時刻を入れてください', QUIET_MAX: '時間帯は{n}個までです',
  SAVED: '保存しました',
  SAVED_TPL: '保存しました。明日以降の予定にも反映しました（今日の分は「今日」タブで直してください）',
  LOADING: '読み込み中…',
  SAVE_FIRST: '先に「保存する」を押してください',
  NO_DAYS_ON: 'どの曜日にも入りません',
  WARN_COUNT: '⚠ 多すぎるかも（{n}件）',
  WARN_TIME: '⚠ 就寝までに終わらないかも',
  DAY_OFF_NOTE: 'この日はLINEで送りません',
  REST_NOTE: '休む期間です（{d}まで）。LINEでは案内しません',
  LINE_STOPPED: '今月はLINEから案内しません（送れる数の上限です）。ボタンへの返事と、このアプリは使えます',
  NEED_TITLE: '名前を入れてください',
  TEST_SENT: 'テスト送信しました（アカウント{a}）',
  CONN_SAVED: 'この端末に保存しました',
  NO_ERROR: 'なし',
  TODAY: '今日', TOMORROW: '明日',
  SYNCING: '更新中…', FRESH: '{t} に読み込み', REFRESH: '↻ 更新',
  CZ_DIRTY: '保存していない変更 {n}件',
  CZ_HAS_ERROR: '赤字の所を直すと保存できます',
  CONFIRM_AGAIN: 'もう一度押すと実行します',
  COPIED: 'コピーしました。Claude とのチャットに貼ってください',
  CONTRAST_WARN: '⚠ 読みにくい組み合わせです（明るさの差 {r}。4.5以上がおすすめ）',
  IMPORTED: '控えを読み込みました（読み込む前の状態は自動の控えに残しました）',
  RESTORED: '戻しました（戻す前の状態は自動の控えに残しました）'
};
