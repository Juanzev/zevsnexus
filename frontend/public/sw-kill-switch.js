// KILL SWITCH do service worker (STRUCTURE pág. 11). Servido em /sw.js quando SW_KILL_SWITCH=true.
// Se um service worker ruim chegar a produção: liga a variável, o navegador busca /sw.js (sem cache),
// este arquivo apaga todos os caches, se desregistra e recarrega as abas abertas com a versão da rede.
// Roteiro completo em docs/PRODUCTION.md.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: 'window' });
      for (const client of windows) client.navigate(client.url);
    })(),
  );
});
