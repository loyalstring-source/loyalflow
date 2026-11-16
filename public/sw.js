/* LoyalFlow service worker: network first, with a small offline fallback for the app shell. */
var CACHE = 'loyalflow-v4';
var SHELL = ['/static/app.css', '/static/theme.css', '/static/app.js', '/static/icon.svg', '/offline'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL).catch(function () {}); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.pathname.startsWith('/static/')) { e.respondWith(caches.match(e.request).then(function (r) { return r || fetch(e.request).then(function (res) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); return res; }); })); return; }
  e.respondWith(fetch(e.request).catch(function () { return caches.match('/offline'); }));
});
