// PWA (ARCHITECTURE §19.1): registro do service worker (rede primeiro) e situação da instalação.
// O worker nunca guarda código como fonte da verdade: online, tudo vem da rede.

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    // updateViaCache 'none': o navegador nunca usa cache HTTP para buscar o /sw.js novo.
    .register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .catch((err) => console.error('service worker não registrado', err));
}

/** O app está aberto como aplicativo instalado (tela cheia, fora do navegador)? */
export function isInstalled() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

/** Plataforma, para mostrar o passo a passo certo de "Instalar no celular". */
export function installPlatform() {
  const agent = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(agent)) return 'android';
  return 'desktop';
}
