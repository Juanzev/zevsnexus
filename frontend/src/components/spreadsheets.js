// Peças das Planilhas: selos (em uso, ano, arquivada) e a tabela da prévia somente leitura.
// A prévia só mostra texto: cada célula passa pelo escape do html`` (fórmula, HTML ou script num
// arquivo de terceiro aparecem como texto e nunca são interpretados).
import { html } from '../lib/html.js';
import { badge } from './badge.js';
import { field } from './form.js';
import { openFormModal } from './modal.js';

export function spreadsheetBadges(sheet) {
  return html`${sheet.in_use ? badge('Em uso', 'green') : ''}${badge(String(sheet.reference_year), 'primary')}${sheet.archived_at ? badge('Arquivada', 'slate') : ''}`;
}

/** 0 → "A", 25 → "Z", 26 → "AA" (cabeçalho de coluna como no Excel). */
export function columnLetter(index) {
  let letters = '';
  let rest = index + 1;
  while (rest > 0) {
    const remainder = (rest - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    rest = Math.floor((rest - 1) / 26);
  }
  return letters;
}

/**
 * Tabela da página atual. Rola só dentro do próprio contêiner (a página nunca ganha rolagem
 * lateral); cabeçalho de colunas e números de linha ficam presos ao rolar. Cada coluna toma a
 * largura do conteúdo, até 20rem (depois disso o texto quebra).
 */
export function previewTable(sheet, { label }) {
  const columns = Array.from({ length: sheet.columns }, (_, index) => columnLetter(index));
  return html`<div class="max-h-[70vh] overflow-auto rounded-xl border border-slate-200 bg-white" tabindex="0" role="region" aria-label="${label}" data-preview-scroll>
    <table class="w-max min-w-full border-separate border-spacing-0 text-sm">
      <thead>
        <tr>
          <th scope="col" class="sticky top-0 left-0 z-20 border-b border-r border-slate-200 bg-slate-100 px-2 py-1.5 text-xs font-medium text-slate-500"><span class="sr-only">Linha</span></th>
          ${columns.map((letter) => html`<th scope="col" class="sticky top-0 z-10 min-w-24 border-b border-r border-slate-200 bg-slate-100 px-2 py-1.5 text-center text-xs font-medium text-slate-500">${letter}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${sheet.rows.map(
          (row) => html`<tr>
            <th scope="row" class="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-right text-xs font-medium text-slate-500 tabular-nums">${row.number}</th>
            ${row.cells.map((cell) => html`<td class="border-b border-r border-slate-100 px-2 py-1.5 align-top text-slate-800"><div class="max-w-80 whitespace-pre-line break-words">${cell}</div></td>`)}
          </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

/** Modal do ano de referência (lote ou uma planilha). Devolve o ano escolhido ou null. */
export function askYear({ title, value }) {
  return openFormModal({
    title,
    body: field({
      name: 'reference_year',
      label: 'Ano de referência',
      type: 'number',
      inputmode: 'numeric',
      value: value ?? '',
      hint: 'O ano a que a planilha se refere (ex.: 2019 para o controle de pagamentos de 2019).',
    }),
    submitLabel: 'Salvar ano',
    onMount: (dialog) => dialog.querySelector('[name="reference_year"]').select(),
    onSubmit: async (form) => {
      const year = Number(form.elements.reference_year.value);
      if (!Number.isInteger(year) || year < 1990 || year > 2100) {
        const err = new Error('Informe um ano entre 1990 e 2100.');
        err.details = [{ field: 'reference_year', message: err.message }];
        throw err;
      }
      return year;
    },
  });
}
