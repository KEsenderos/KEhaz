/* KEhaz sw.js　目的：アプリの画面をキャッシュし、電波が弱くても開けるようにする。
   新しい版は、更新ボタンが押されたときだけ切り替える（install で skipWaiting を呼ばない）。
   基づく仕様書：KEhaz_仕様書_v3.1.2 */
const CACHE_VERSION = 'kehaz-v3.1.2';
const CACHE_FILES = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './js/config.js', './js/api.js', './js/customize.js', './js/app.js',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'
];

// 新しい版のファイルを取っておく
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(CACHE_FILES)));
});

// 切り替わったら古い版のキャッシュを消す
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

// 自分のサイトの GET だけキャッシュから返す（GASへの通信には触らない）
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});

// ボタンが押されたときだけ新しい版に切り替える
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
