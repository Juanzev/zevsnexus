// Confere que todo import relativo de src/ aponta para um arquivo que existe COM A MESMA GRAFIA.
// No Windows "./Views/x.js" funciona; no Linux do Render, não. Sem bundler, só esta checagem pega.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(frontendDir, 'src');
const publicDir = path.join(frontendDir, 'public');

const IMPORT_PATTERNS = [
  /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** true se `target` existe com exatamente esta grafia em cada segmento do caminho. */
function existsExactly(target) {
  const relative = path.relative(frontendDir, target);
  let current = frontendDir;
  for (const segment of relative.split(path.sep)) {
    if (!readdirSync(current).includes(segment)) return false;
    current = path.join(current, segment);
  }
  return true;
}

const problems = [];
let checked = 0;

for (const file of readdirSync(srcDir, { recursive: true })) {
  if (!file.endsWith('.js')) continue;
  const absolute = path.join(srcDir, file);
  const source = readFileSync(absolute, 'utf8');
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) {
        problems.push(`${file}: import "${specifier}" não é relativo (sem bundler, só caminhos relativos)`);
        continue;
      }
      checked += 1;
      const target = path.resolve(path.dirname(absolute), specifier);
      if (!existsExactly(target)) problems.push(`${file}: "${specifier}" não encontrado (confira a grafia)`);
    }
  }
}

// Referências do index.html que precisam existir depois do build.
for (const asset of ['src/app.js', 'public/assets/app.css', 'public/assets/icons.svg', 'public/favicon.svg']) {
  if (!existsSync(path.join(frontendDir, asset))) problems.push(`index.html: ${asset} não existe (rodou o build?)`);
}
if (!readFileSync(path.join(publicDir, 'index.html'), 'utf8').includes('%%APP_VERSION%%')) {
  problems.push('index.html: falta o carimbo %%APP_VERSION%% (o banner de nova versão nunca dispararia)');
}

if (problems.length > 0) {
  console.error(`Imports com problema:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Imports conferidos: ${checked}, todos resolvem com a grafia exata.`);
