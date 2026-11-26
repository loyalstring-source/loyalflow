/* LoyalFlow service worker: network first, with a small offline fallback for the app shell. */
var CACHE = 'loyalflow-v7';
var SHELL = ['/static/app.css', '/static/theme.css', '/static/app.js', '/static/icon.svg', '/offline'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL).catch(function () {}); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.pathname.startsWith('/static/')) { e.respondWith(caches.match(e.request).then(function (r) { return r || fetch(e.request).then(function (res) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); return res; }); })); return; }
  e.respondWith(fetch(e.request).catch(function () { return caches.match('/offline'); }));
});

/* Notifications: show what the server sent, and open the right page when it is tapped. */
self.addEventListener('push', function (e) {
  var d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'LoyalFlow', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'LoyalFlow', { body: d.body || '', icon: '/static/icon-192.png', badge: '/static/icon-192.png', tag: d.tag || undefined, data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close(); var url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { var c = list[i]; if ('focus' in c) { if ('navigate' in c) { try { c.navigate(url); } catch (x) {} } return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
