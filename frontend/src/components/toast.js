// Toast para o resultado de uma ação (pág. 10). Texto sempre via textContent.
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';

const ICONS = {
  success: icon('circle-check', 'size-5 shrink-0'),
  error: icon('circle-alert', 'size-5 shrink-0'),
  info: icon('info', 'size-5 shrink-0'),
};

function container() {
  let element = document.getElementById('toasts');
  if (!element) {
    element = document.createElement('div');
    element.id = 'toasts';
    element.className = 'toasts';
    element.setAttribute('aria-live', 'polite');
    document.body.append(element);
  }
  return element;
}

export function toast(message, { type = 'info', timeout = 5000 } = {}) {
  const item = document.createElement('div');
  item.className = `toast toast-${type}`;
  item.setAttribute('role', type === 'error' ? 'alert' : 'status');
  setContent(item, html`${ICONS[type] ?? ICONS.info}<span class="flex-1"></span>`);
  item.querySelector('span').textContent = message;
  container().append(item);
  setTimeout(() => item.remove(), timeout);
}
