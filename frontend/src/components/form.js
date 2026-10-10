// Campos e feedback de formulário (pág. 10): regra visível, erro por campo, nunca falhar em silêncio.
// Alvos de toque ≥ 44 px e fonte de 16 px (evita o zoom automático do iOS).
import { html } from '../lib/html.js';
import { icon } from '../lib/icons.js';

export function field({ name, label, type = 'text', autocomplete = 'off', hint, inputmode, required = true, value = '' }) {
  const id = `f-${name}`;
  return html`<div class="field">
    <label for="${id}" class="label">${label}</label>
    <input id="${id}" name="${name}" type="${type}" class="input" autocomplete="${autocomplete}"
      ${inputmode ? html`inputmode="${inputmode}"` : ''} ${required ? html`required aria-required="true"` : ''}
      value="${value}" aria-describedby="${id}-hint ${id}-error">
    ${hint ? html`<p id="${id}-hint" class="hint">${hint}</p>` : ''}
    <p id="${id}-error" class="field-error" hidden></p>
  </div>`;
}

export function passwordField({ name, label, autocomplete, hint }) {
  const id = `f-${name}`;
  return html`<div class="field">
    <label for="${id}" class="label">${label}</label>
    <div class="relative">
      <input id="${id}" name="${name}" type="password" class="input pr-12" autocomplete="${autocomplete}"
        required aria-required="true" aria-describedby="${id}-hint ${id}-error">
      <button type="button" class="password-toggle" data-toggle-password="${id}" aria-label="Mostrar senha" aria-pressed="false">
        <span data-icon-show>${icon('eye')}</span><span data-icon-hide hidden>${icon('eye-off')}</span>
      </button>
    </div>
    ${hint ? html`<p id="${id}-hint" class="hint">${hint}</p>` : ''}
    <p id="${id}-error" class="field-error" hidden></p>
  </div>`;
}

export function checkboxField({ name, label }) {
  const id = `f-${name}`;
  return html`<div class="field">
    <label class="flex items-start gap-3 text-sm text-slate-700">
      <input id="${id}" name="${name}" type="checkbox" class="checkbox" aria-describedby="${id}-error">
      <span>${label}</span>
    </label>
    <p id="${id}-error" class="field-error" hidden></p>
  </div>`;
}

export function formAlert() {
  return html`<div class="alert alert-error" data-form-alert role="alert" hidden></div>`;
}

export function bindPasswordToggles(root) {
  for (const button of root.querySelectorAll('[data-toggle-password]')) {
    button.addEventListener('click', () => {
      const input = root.querySelector(`#${button.dataset.togglePassword}`);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.setAttribute('aria-pressed', String(show));
      button.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
      button.querySelector('[data-icon-show]').hidden = show;
      button.querySelector('[data-icon-hide]').hidden = !show;
    });
  }
}

export function formValues(form) {
  const values = {};
  for (const element of form.elements) {
    if (!element.name) continue;
    values[element.name] = element.type === 'checkbox' ? element.checked : element.value;
  }
  return values;
}

export function clearErrors(form) {
  const alert = form.querySelector('[data-form-alert]');
  if (alert) {
    alert.hidden = true;
    alert.textContent = '';
  }
  for (const element of form.querySelectorAll('[aria-invalid="true"]')) element.removeAttribute('aria-invalid');
  for (const element of form.querySelectorAll('.field-error')) {
    element.hidden = true;
    element.textContent = '';
  }
}

/** Mostra erros por campo ({ field, message }[]) e/ou a mensagem geral; foca o primeiro campo inválido. */
export function showErrors(form, { message, details = [] }) {
  let firstInvalid = null;
  const unmatched = [];
  for (const detail of details) {
    const input = form.elements.namedItem(detail.field);
    const errorElement = input && form.querySelector(`#f-${detail.field}-error`);
    if (!errorElement) {
      unmatched.push(detail.message);
      continue;
    }
    input.setAttribute('aria-invalid', 'true');
    errorElement.textContent = detail.message;
    errorElement.hidden = false;
    firstInvalid ??= input;
  }
  const alert = form.querySelector('[data-form-alert]');
  const general = details.length === 0 ? message : unmatched.join(' ');
  if (alert && general) {
    alert.textContent = general;
    alert.hidden = false;
  }
  (firstInvalid ?? alert)?.focus?.();
}

/** Botão em andamento: desabilitado, com rótulo de progresso; devolve a função que restaura. */
export function setBusy(button, busyLabel) {
  const original = button.textContent;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = busyLabel;
  return () => {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = original;
  };
}

/** Ctrl+Enter / Cmd+Enter envia o formulário (pág. 10). */
export function bindSubmitShortcut(form) {
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
}
