// Estratégia de atualização (pág. 11, ADR-011): compara a versão carimbada no HTML com
// /api/version ao abrir, ao voltar para a aba e a cada 5 min (no máximo 1 checagem a cada 30 s).
import { showUpdateBanner } from '../components/update-banner.js';

const CHECK_EVERY_MS = 5 * 60_000;
const MIN_INTERVAL_MS = 30_000;

let lastCheck = 0;
let bannerShown = false;

function stampedVersion() {
  return document.querySelector('meta[name="app-version"]')?.content ?? '';
}

async function check(current) {
  if (bannerShown || Date.now() - lastCheck < MIN_INTERVAL_MS) return;
  lastCheck = Date.now();
  try {
    const response = await fetch('/api/version', { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const { data } = await response.json();
    if (data?.version && data.version !== current) {
      bannerShown = true;
      showUpdateBanner();
    }
  } catch {
    // Sem rede: tenta de novo na próxima oportunidade.
  }
}

export function startUpdateChecker() {
  const current = stampedVersion();
  // Sem carimbo (HTML servido fora do backend) o banner nunca dispararia: não verifica.
  if (!current || current.startsWith('%%')) return;
  check(current);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check(current);
  });
  setInterval(() => check(current), CHECK_EVERY_MS);
}
