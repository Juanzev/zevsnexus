// Modal de formulário com <dialog> nativo (foco preso, Esc fecha). O conteúdo vem de html``.
// onSubmit(form) pode lançar ApiError: os erros aparecem nos campos e o modal continua aberto.
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { bindSubmitShortcut, clearErrors, formAlert, setBusy, showErrors } from './form.js';

export function openFormModal({ title, body, submitLabel = 'Salvar', busyLabel = 'Salvando…', onSubmit, onMount }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog max-h-[90dvh] overflow-y-auto';
    dialog.setAttribute('aria-labelledby', 'modal-title');
    setContent(
      dialog,
      html`<form class="space-y-4" novalidate>
        <div class="flex items-start justify-between gap-4">
          <h2 id="modal-title" class="text-lg font-semibold text-slate-900">${title}</h2>
          <button type="button" class="btn btn-ghost btn-sm -mt-1 -mr-2" data-action="close" aria-label="Fechar">${icon('x')}</button>
        </div>
        ${formAlert()}
        ${body}
        <div class="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <button type="button" class="btn btn-secondary" data-action="close">Cancelar</button>
          <button type="submit" class="btn btn-primary">${submitLabel}</button>
        </div>
      </form>`,
    );

    let result = null;
    const form = dialog.querySelector('form');
    bindSubmitShortcut(form);
    for (const button of dialog.querySelectorAll('[data-action="close"]')) {
      button.addEventListener('click', () => dialog.close());
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearErrors(form);
      const done = setBusy(form.querySelector('[type="submit"]'), busyLabel);
      try {
        result = await onSubmit(form);
        dialog.close();
      } catch (err) {
        showErrors(form, err);
        done();
      }
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });

    document.body.append(dialog);
    dialog.showModal();
    // showModal() foca o primeiro botão (o "X"): Enter fecharia o modal. O foco vai para o primeiro
    // campo, salvo se onMount escolher outro.
    dialog.querySelector('input:not([type="hidden"]), select, textarea')?.focus();
    onMount?.(dialog);
  });
}
