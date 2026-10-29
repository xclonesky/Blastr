/* BLASTR service worker: serves downloaded songs/covers from the device (even offline, with seeking) and keeps the app itself available offline.
   Put this file next to your Blastr html on GitHub Pages (same folder). */
const SHELL = 'blastr-shell-v1', DL = 'blastr-dl-v1';
const STATIC_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then(c => c.add(new Request('./', { cache: 'reload' }))).catch(() => {}));
});
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('blastr-shell-') && k !== SHELL) await caches.delete(k);
  await self.clients.claim();
})()));

async function ranged(req, hit) {
  const h = req.headers.get('range');
  if (!h) return hit;
  const m = /bytes=(\d*)-(\d*)/.exec(h);
  if (!m || (m[1] === '' && m[2] === '')) return hit;
  const blob = await hit.blob(), size = blob.size;
  const s = m[1] === '' ? Math.max(0, size - (+m[2])) : +m[1];
  const e = (m[1] === '' || m[2] === '') ? size - 1 : Math.min(+m[2], size - 1);
  if (s >= size || s > e) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  return new Response(blob.slice(s, e + 1), {
    status: 206,
    headers: {
      'Content-Type': hit.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Length': String(e - s + 1),
      'Content-Range': 'bytes ' + s + '-' + e + '/' + size,
      'Accept-Ranges': 'bytes'
    }
  });
}

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  e.respondWith((async () => {
    // 1) a downloaded song / cover: always from this device
    const dl = await caches.open(DL);
    const hit = await dl.match(r.url, { ignoreVary: true });
    if (hit) return ranged(r, hit);
    // 2) the app page itself: network first, cached copy when offline
    if (r.mode === 'navigate') {
      try {
        const net = await fetch(r);
        const c = await caches.open(SHELL);
        c.put(r, net.clone()).catch(() => {}); c.put('./', net.clone()).catch(() => {});
        return net;
      } catch (err) {
        return (await caches.match(r, { ignoreSearch: true })) || (await caches.match('./')) || Response.error();
      }
    }
    // 3) fonts + CDN scripts: cached copy first, refreshed in the background
    if (STATIC_HOSTS.includes(u.hostname)) {
      const c = await caches.open(SHELL), old = await c.match(r);
      const fresh = fetch(r).then(n => { if (n && (n.ok || n.type === 'opaque')) c.put(r, n.clone()); return n; }).catch(() => old);
      return old || fresh;
    }
    return fetch(r);
  })());
});
