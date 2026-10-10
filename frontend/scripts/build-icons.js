// Gera public/assets/icons.svg só com os ícones Lucide usados no código (pág. 02: ~5 KB em vez de 444 KB).
// Procura chamadas icon('nome') em src/. Padrão visual: traço 1.8, pontas arredondadas, currentColor.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(frontendDir, 'src');
const lucideDir = path.join(frontendDir, 'node_modules', 'lucide-static', 'icons');
const output = path.join(frontendDir, 'public', 'assets', 'icons.svg');

const ICON_CALL = /\bicon\(\s*['"]([a-z0-9-]+)['"]/g;

function usedIcons() {
  const names = new Set();
  for (const file of readdirSync(srcDir, { recursive: true })) {
    if (!file.endsWith('.js')) continue;
    const source = readFileSync(path.join(srcDir, file), 'utf8');
    for (const match of source.matchAll(ICON_CALL)) names.add(match[1]);
  }
  return [...names].sort();
}

function symbolFor(name) {
  let svg;
  try {
    svg = readFileSync(path.join(lucideDir, `${name}.svg`), 'utf8');
  } catch {
    throw new Error(`Ícone "${name}" não existe no Lucide (usado em src/).`);
  }
  const inner = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `<symbol id="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</symbol>`;
}

const names = usedIcons();
const sprite = `<svg xmlns="http://www.w3.org/2000/svg">${names.map(symbolFor).join('')}</svg>\n`;
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, sprite);
console.log(`icons.svg: ${names.length} ícones (${(Buffer.byteLength(sprite) / 1024).toFixed(1)} KB) — ${names.join(', ')}`);
