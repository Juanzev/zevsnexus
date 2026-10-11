// Gera os ícones PNG da PWA (STRUCTURE pág. 11: o iOS exige PNG) a partir do desenho do favicon.svg.
// Roda à mão quando a marca mudar, e os PNG ficam versionados em public/icons/ (o build não depende disto):
//   node scripts/render-icons.mjs
// Usa o Chromium do Playwright instalado em e2e/ (npx playwright install chromium).
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(frontendDir, 'public', 'icons');
const require = createRequire(path.resolve(frontendDir, '../e2e/package.json'));
const { chromium } = require('@playwright/test');

const COLOR = '#1d4ed8';
// O desenho do favicon (camadas, Lucide "layers"), num quadro de 24 unidades.
const GLYPH = `
  <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/>
  <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/>
  <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>`;

/** Fundo e quanto do quadro o desenho ocupa. `rounded`: cantos transparentes (ícone "any"). */
function svg({ glyphShare, rounded }) {
  const size = 100;
  const glyph = size * glyphShare;
  const offset = (size - glyph) / 2;
  const scale = glyph / 24;
  const background = rounded
    ? `<rect width="${size}" height="${size}" rx="${size * 0.25}" fill="${COLOR}"/>`
    : `<rect width="${size}" height="${size}" fill="${COLOR}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="100%" height="100%">
    ${background}
    <g fill="none" stroke="#ffffff" stroke-width="${1.8}" stroke-linecap="round" stroke-linejoin="round"
       transform="translate(${offset} ${offset}) scale(${scale})">${GLYPH}</g>
  </svg>`;
}

const ICONS = [
  // Ícone comum: igual ao favicon (cantos arredondados, desenho em 75% do quadro).
  { file: 'icon-192.png', size: 192, glyphShare: 0.75, rounded: true },
  { file: 'icon-512.png', size: 512, glyphShare: 0.75, rounded: true },
  // Maskable: fundo até a borda e desenho dentro da zona segura central (80%) do Android.
  { file: 'icon-maskable-512.png', size: 512, glyphShare: 0.55, rounded: false },
  // iOS arredonda sozinho e não aceita transparência.
  { file: 'apple-touch-icon.png', size: 180, glyphShare: 0.62, rounded: false },
];

mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const icon of ICONS) {
    const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
    await page.setContent(`<html><body style="margin:0;width:${icon.size}px;height:${icon.size}px;overflow:hidden">${svg(icon)}</body></html>`);
    await page.screenshot({ path: path.join(outputDir, icon.file), omitBackground: icon.rounded });
    await page.close();
    console.log(`public/icons/${icon.file} (${icon.size}×${icon.size})`);
  }
} finally {
  await browser.close();
}
