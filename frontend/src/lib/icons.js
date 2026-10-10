// Ícones Lucide via sprite SVG gerado no build (só os usados — pág. 02).
// O script de build procura as chamadas de icon() no código: passe sempre o nome como texto literal.
import { html } from './html.js';

const VALID_NAME = /^[a-z0-9-]+$/;

export function icon(name, className = 'size-5') {
  if (!VALID_NAME.test(name)) throw new Error(`ícone inválido: ${name}`);
  return html`<svg class="${className}" aria-hidden="true" focusable="false"><use href="/assets/icons.svg#${name}"></use></svg>`;
}
