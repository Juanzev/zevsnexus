// Formulário de prestador ou fornecedor (pessoa física ou jurídica) e a linha da lista.
import { badge } from './badge.js';
import { checkboxField, field, selectField, textareaField } from './form.js';
import { fieldError, PARTY_ROLES } from './finance.js';
import { openFormModal } from './modal.js';
import { formatCnpj, formatOnBlur, formatPhone } from '../lib/format.js';
import { html } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { api } from '../services/api.js';

const PERSON_TYPES = [
  { value: 'individual', label: 'Pessoa física (CPF)' },
  { value: 'company', label: 'Pessoa jurídica (CNPJ)' },
];

export function formatCpf(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length === 11 ? `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}` : (value ?? '');
}

export function formatPartyDocument(party) {
  if (!party.document) return '';
  return party.person_type === 'individual' ? formatCpf(party.document) : formatCnpj(party.document);
}

export function partyRoleBadges(party) {
  return party.roles.map((role) => badge(PARTY_ROLES.find((item) => item.value === role)?.label ?? role, 'slate'));
}

export function partyRow(party) {
  return html`<li>
    <a href="/app/prestadores/${party.id}" class="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-xs hover:border-primary/40 sm:rounded-none sm:border-0 sm:shadow-none sm:hover:bg-slate-50">
      <span class="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        ${party.person_type === 'company' ? icon('building-2', 'size-5') : icon('user', 'size-5')}</span>
      <span class="min-w-0 flex-1">
        <span class="block truncate font-medium text-slate-900">${party.name}</span>
        <span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          ${party.specialty ? html`<span>${party.specialty}</span>` : ''}
          ${party.phone ? html`<span class="tabular-nums">${formatPhone(party.phone)}</span>` : ''}
          ${partyRoleBadges(party)}
        </span>
      </span>
      ${icon('chevron-right', 'size-4 shrink-0 text-slate-400')}
    </a>
  </li>`;
}

/** Novo cadastro ou edição (com versão). Devolve o prestador salvo, ou null. */
export function openPartyForm(party = null) {
  return openFormModal({
    title: party ? 'Editar cadastro' : 'Novo prestador ou fornecedor',
    submitLabel: party ? 'Salvar' : 'Cadastrar',
    body: html`
      ${selectField({ name: 'person_type', label: 'Tipo', options: PERSON_TYPES, value: party?.person_type ?? 'individual' })}
      ${field({ name: 'name', label: 'Nome', value: party?.name ?? '', hint: 'Pessoa física: nome completo. Empresa: razão social.' })}
      <div data-company-only>${field({ name: 'trade_name', label: 'Nome fantasia', required: false, value: party?.trade_name ?? '' })}</div>
      ${field({ name: 'document', label: 'CPF ou CNPJ (opcional)', required: false, inputmode: 'text', value: party ? formatPartyDocument(party) : '' })}
      <fieldset class="field">
        <legend class="label">Papel</legend>
        <div class="grid gap-1 sm:grid-cols-3">
          ${PARTY_ROLES.map((role) =>
            checkboxField({ name: `role_${role.value}`, label: role.label, checked: party ? party.roles.includes(role.value) : role.value === 'service_provider' }),
          )}
        </div>
        <p id="f-roles-error" class="field-error" hidden></p>
      </fieldset>
      ${field({ name: 'specialty', label: 'Especialidade (opcional)', required: false, value: party?.specialty ?? '', hint: 'Ex.: Eletricista, Pedreiro, Material elétrico.' })}
      <div class="grid gap-4 sm:grid-cols-2">
        ${field({ name: 'phone', label: 'Telefone', type: 'tel', inputmode: 'tel', required: false, value: party?.phone ? formatPhone(party.phone) : '' })}
        ${field({ name: 'email', label: 'E-mail', type: 'email', inputmode: 'email', required: false, value: party?.email ?? '' })}
      </div>
      ${field({ name: 'pix_key', label: 'Chave PIX (opcional)', required: false, value: party?.pix_key ?? '' })}
      ${textareaField({ name: 'notes', label: 'Observações', value: party?.notes ?? '', maxlength: 2000 })}`,
    onMount: (dialog) => {
      const type = dialog.querySelector('[name="person_type"]');
      const companyOnly = dialog.querySelector('[data-company-only]');
      const sync = () => {
        companyOnly.hidden = type.value !== 'company';
      };
      type.addEventListener('change', sync);
      sync();
      formatOnBlur(dialog.querySelector('[name="phone"]'), formatPhone);
      formatOnBlur(dialog.querySelector('[name="document"]'), (value) => (type.value === 'individual' ? formatCpf(value) : formatCnpj(value)));
    },
    onSubmit: async (form) => {
      const values = form.elements;
      const roles = PARTY_ROLES.map((role) => role.value).filter((role) => values[`role_${role}`].checked);
      if (roles.length === 0) throw fieldError('roles', 'Marque pelo menos um papel.');
      const body = {
        person_type: values.person_type.value,
        name: values.name.value,
        trade_name: values.person_type.value === 'company' ? values.trade_name.value : null,
        document: values.document.value,
        roles,
        specialty: values.specialty.value,
        phone: values.phone.value,
        email: values.email.value,
        pix_key: values.pix_key.value,
        notes: values.notes.value,
      };
      const { data } = party
        ? await api(`/parties/${party.id}`, { method: 'PATCH', body: { ...body, version: party.version } })
        : await api('/parties', { method: 'POST', body });
      return data.party;
    },
  });
}
