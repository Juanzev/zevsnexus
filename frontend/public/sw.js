// Service worker do ZEVS Nexus (STRUCTURE pág. 11, ARCHITECTURE §19.1): REDE PRIMEIRO, sempre.
// O cache é só reserva para quando não há conexão — nunca a fonte do código (lição do Barber).
// Fora do cache, sem exceção: /api/*, /dev-storage/*, o próprio /sw.js, métodos que não sejam GET e
// qualquer origem de fora (URLs assinadas do R2). Sem offline operacional: sem rede, "Sem conexão".
const CACHE = 'nexus-shell-v1';
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/assets/app.css', '/icons/icon-192.png', '/favicon.svg'];
const NEVER_CACHE = ['/api/', '/dev-storage/', '/sw.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function bypass(request) {
  const url = new URL(request.url);
  return (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    NEVER_CACHE.some((prefix) => url.pathname.startsWith(prefix))
  );
}

/** Rede primeiro; guarda a resposta boa como reserva; sem rede, devolve a reserva. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

/** Navegação (abrir uma tela): sempre da rede; sem rede, a página "Sem conexão". */
async function navigate(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE);
    return (await cache.match(OFFLINE_URL)) ?? Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (bypass(request)) return;
  event.respondWith(request.mode === 'navigate' ? navigate(request) : networkFirst(request));
});
