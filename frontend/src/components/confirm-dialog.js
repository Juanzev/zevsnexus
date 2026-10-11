// Confirmação de ação destrutiva (pág. 10) com <dialog> nativo: foco preso, Esc cancela.
import { html, setContent } from '../lib/html.js';

export const ConfirmDialog = {
  ask({ title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = true }) {
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'dialog';
      dialog.setAttribute('aria-labelledby', 'confirm-dialog-title');
      setContent(
        dialog,
        html`<form method="dialog" class="space-y-4">
          <h2 id="confirm-dialog-title" class="text-lg font-semibold text-slate-900">${title}</h2>
          <p class="text-sm text-slate-600">${message}</p>
          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button value="cancel" class="btn btn-secondary">${cancelLabel}</button>
            <button value="confirm" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${confirmLabel}</button>
          </div>
        </form>`,
      );
      let finished = false;
      // Uma resposta só; não depende apenas do evento `close` (atrasado com a aba em segundo plano).
      const finish = (confirmed) => {
        if (finished) return;
        finished = true;
        if (dialog.open) dialog.close();
        dialog.remove();
        resolve(confirmed);
      };
      for (const button of dialog.querySelectorAll('button[value]')) {
        button.addEventListener('click', (event) => {
          event.preventDefault();
          finish(button.value === 'confirm');
        });
      }
      dialog.addEventListener('close', () => finish(dialog.returnValue === 'confirm'));
      document.body.append(dialog);
      dialog.showModal();
    });
  },
};
