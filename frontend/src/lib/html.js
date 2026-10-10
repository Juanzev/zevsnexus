// Template com escape automático (pág. 06 §7 e pág. 09).
// Todo HTML da SPA nasce de html`...`: valores interpolados são escapados, exceto outro html``.
// setContent() é o ÚNICO ponto que injeta HTML no DOM; innerHTML direto é proibido por lint.
// Convenção: atributos sempre entre aspas (html`<a href="${url}">`), nunca handlers inline.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"'`]/g, (char) => ESCAPES[char]);
}

class SafeHtml {
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

function renderValue(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let output = strings[0];
  for (let index = 0; index < values.length; index += 1) {
    output += renderValue(values[index]) + strings[index + 1];
  }
  return new SafeHtml(output);
}

export function isSafeHtml(value) {
  return value instanceof SafeHtml;
}

/** Substitui o conteúdo de `element` por um fragmento produzido por html``. */
export function setContent(element, content) {
  if (!(content instanceof SafeHtml)) {
    throw new TypeError('setContent() só aceita conteúdo produzido por html``');
  }
  const template = document.createElement('template');
  // eslint-disable-next-line no-restricted-syntax -- único ponto autorizado: conteúdo já escapado por html``
  template.innerHTML = content.value;
  element.replaceChildren(template.content);
}
