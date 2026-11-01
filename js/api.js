/* KEhaz api.js　目的：GAS（Webアプリ）との通信。失敗の理由を分かる形で返す。基づく仕様書：KEhaz_仕様書_v3.1.2 */

// 通信の失敗を表すエラー（code・message・details を持つ）
class ApiError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details || null; }
}

// 端末内の保存を安全に読む
function lsGet(key) { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }
// 端末内の保存を安全に書く
function lsSet(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* 保存できない環境では何もしない */ } }

// GASを呼ぶ。成功したら data を返し、失敗したら ApiError を投げる
async function callApi(action, payload) {
  const url = lsGet(LS_KEYS.GAS_URL);
  const pass = lsGet(LS_KEYS.PASS);
  if (!url || !pass) throw new ApiError('NO_SETTINGS', 'カスタマイズタブの「つなぎ先」で、GASのURLと合言葉を入れてください');
  let res;
  try {
    res = await fetch(url, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ pass, action }, payload || {}))
    });
  } catch (e) { throw new ApiError('NETWORK', 'つながりません（電波を確認）'); }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch (e) { throw new ApiError('BAD_RESPONSE', `HTTP ${res.status}: ${text.slice(0, 80)}`); }
  if (!json.ok) throw new ApiError(json.code, json.message, json.details);
  return json.data;
}
