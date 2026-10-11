// Empresa: dados cadastrais, endereço, contato e responsáveis. Edição só com company.manage
// (o backend confere de novo). Edição concorrente → 409 com aviso para recarregar.
import { companyStatusBadge, badge } from '../components/badge.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import {
  bindSubmitShortcut,
  checkboxField,
  clearErrors,
  field,
  formAlert,
  formValues,
  selectField,
  setBusy,
  showErrors,
  textareaField,
} from '../components/form.js';
import { openFormModal } from '../components/modal.js';
import { emptyState, errorState, loadingState } from '../components/states.js';
import { toast } from '../components/toast.js';
import { formatCep, formatCnpj, formatOnBlur, formatPhone } from '../lib/format.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { UFS } from '../lib/timezones.js';
import { api } from '../services/api.js';
import { can, loadMe } from '../services/tenant.js';

const TAX_REGIMES = [
  { value: 'mei', label: 'MEI' },
  { value: 'simples', label: 'Simples Nacional' },
  { value: 'presumido', label: 'Lucro Presumido' },
  { value: 'real', label: 'Lucro Real' },
  { value: 'other', label: 'Outro' },
];

const dash = (value) => value || html`<span class="text-slate-400">—</span>`;

function row(label, value) {
  return html`<div class="min-w-0"><dt class="text-sm text-slate-500">${label}</dt><dd class="mt-0.5 break-words text-sm font-medium text-slate-900">${dash(value)}</dd></div>`;
}

function addressText(address) {
  if (!address.street && !address.city) return '';
  const line1 = [address.street, address.number, address.complement].filter(Boolean).join(', ');
  const line2 = [address.district, address.city && `${address.city}${address.state ? `/${address.state}` : ''}`].filter(Boolean).join(' — ');
  return [line1, line2, address.cep && `CEP ${formatCep(address.cep)}`].filter(Boolean).join(' · ');
}

function profileView(company, editable) {
  const regime = TAX_REGIMES.find((item) => item.value === company.tax_regime)?.label;
  return html`<section class="card">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-base font-semibold text-slate-900">Dados da empresa</h2>
      ${editable ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="edit">${icon('pencil', 'size-4')} Editar</button>` : ''}
    </div>
    <dl class="mt-4 grid gap-4 sm:grid-cols-2">
      ${row('Razão social', company.legal_name)}
      ${row('Nome fantasia', company.trade_name)}
      ${row('CNPJ', company.cnpj && formatCnpj(company.cnpj))}
      ${row('Regime tributário', regime)}
      ${row('Inscrição estadual', company.state_registration)}
      ${row('Inscrição municipal', company.municipal_registration)}
      ${row('E-mail', company.email)}
      ${row('Telefone', company.phone && formatPhone(company.phone))}
      <div class="sm:col-span-2">${row('Endereço', addressText(company.address))}</div>
    </dl>
  </section>`;
}

function profileForm(company) {
  const address = company.address;
  return html`<section class="card">
    <h2 class="text-base font-semibold text-slate-900">Editar dados da empresa</h2>
    <form class="mt-4 space-y-6" novalidate data-form="profile">
      ${formAlert()}
      <fieldset class="grid gap-4 sm:grid-cols-2">
        <legend class="sr-only">Identificação</legend>
        <div class="sm:col-span-2">${field({ name: 'legal_name', label: 'Razão social', value: company.legal_name })}</div>
        ${field({ name: 'trade_name', label: 'Nome fantasia', required: false, value: company.trade_name ?? '' })}
        ${field({ name: 'cnpj', label: 'CNPJ', required: false, value: company.cnpj ? formatCnpj(company.cnpj) : '' })}
        ${selectField({ name: 'tax_regime', label: 'Regime tributário', required: false, placeholder: 'Não informado', options: TAX_REGIMES, value: company.tax_regime ?? '' })}
        ${field({ name: 'state_registration', label: 'Inscrição estadual', required: false, value: company.state_registration ?? '' })}
        ${field({ name: 'municipal_registration', label: 'Inscrição municipal', required: false, value: company.municipal_registration ?? '' })}
      </fieldset>
      <fieldset class="grid gap-4 sm:grid-cols-2">
        <legend class="mb-2 text-sm font-semibold text-slate-900">Contato</legend>
        ${field({ name: 'email', label: 'E-mail', type: 'email', required: false, inputmode: 'email', value: company.email ?? '' })}
        ${field({ name: 'phone', label: 'Telefone', type: 'tel', required: false, inputmode: 'tel', value: company.phone ? formatPhone(company.phone) : '' })}
      </fieldset>
      <fieldset class="grid gap-4 sm:grid-cols-6">
        <legend class="mb-2 text-sm font-semibold text-slate-900">Endereço</legend>
        <div class="sm:col-span-2">${field({ name: 'address_cep', label: 'CEP', required: false, inputmode: 'numeric', value: address.cep ? formatCep(address.cep) : '' })}</div>
        <div class="sm:col-span-4">${field({ name: 'address_street', label: 'Logradouro', required: false, value: address.street ?? '' })}</div>
        <div class="sm:col-span-2">${field({ name: 'address_number', label: 'Número', required: false, value: address.number ?? '' })}</div>
        <div class="sm:col-span-4">${field({ name: 'address_complement', label: 'Complemento', required: false, value: address.complement ?? '' })}</div>
        <div class="sm:col-span-2">${field({ name: 'address_district', label: 'Bairro', required: false, value: address.district ?? '' })}</div>
        <div class="sm:col-span-3">${field({ name: 'address_city', label: 'Cidade', required: false, value: address.city ?? '' })}</div>
        <div class="sm:col-span-1">${selectField({ name: 'address_state', label: 'UF', required: false, placeholder: '—', options: UFS.map((uf) => ({ value: uf, label: uf })), value: address.state ?? '' })}</div>
      </fieldset>
      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" class="btn btn-secondary" data-action="cancel">Cancelar</button>
        <button type="submit" class="btn btn-primary">Salvar</button>
      </div>
    </form>
  </section>`;
}

function profileBody(values, version) {
  const address = {};
  for (const key of ['cep', 'street', 'number', 'complement', 'district', 'city', 'state']) address[key] = values[`address_${key}`];
  return {
    version,
    legal_name: values.legal_name,
    trade_name: values.trade_name,
    cnpj: values.cnpj,
    tax_regime: values.tax_regime,
    state_registration: values.state_registration,
    municipal_registration: values.municipal_registration,
    email: values.email,
    phone: values.phone,
    address,
  };
}

function contactsCard(contacts, editable) {
  return html`<section class="card">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-base font-semibold text-slate-900">Contatos e responsáveis</h2>
      ${editable ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="add-contact">${icon('plus', 'size-4')} Adicionar</button>` : ''}
    </div>
    ${
      contacts.length === 0
        ? emptyState({ title: 'Nenhum contato cadastrado', message: 'Cadastre sócios, administradores e pessoas de referência da empresa.' })
        : html`<ul class="mt-4 divide-y divide-slate-100">
            ${contacts.map(
              (contact) => html`<li class="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0">
                  <p class="flex flex-wrap items-center gap-2 font-medium text-slate-900">${contact.name}
                    ${contact.is_responsible ? badge('Responsável', 'primary') : ''}</p>
                  ${contact.role_title ? html`<p class="text-sm text-slate-600">${contact.role_title}</p>` : ''}
                  <p class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                    ${contact.email ? html`<span class="inline-flex min-w-0 items-center gap-1 break-all">${icon('mail', 'size-4 shrink-0')}${contact.email}</span>` : ''}
                    ${contact.phone ? html`<span class="inline-flex items-center gap-1">${icon('phone', 'size-4 shrink-0')}${formatPhone(contact.phone)}</span>` : ''}
                  </p>
                  ${contact.notes ? html`<p class="mt-1 text-sm text-slate-500">${contact.notes}</p>` : ''}
                </div>
                ${
                  editable
                    ? html`<div class="flex shrink-0 gap-2">
                        <button type="button" class="btn btn-secondary btn-sm" data-action="edit-contact" data-id="${contact.id}">${icon('pencil', 'size-4')} Editar</button>
                        <button type="button" class="btn btn-ghost btn-sm text-red-700" data-action="delete-contact" data-id="${contact.id}" aria-label="Excluir ${contact.name}">${icon('trash-2', 'size-4')}</button>
                      </div>`
                    : ''
                }
              </li>`,
            )}
          </ul>`
    }
  </section>`;
}

function contactFields(contact = {}) {
  return html`
    ${field({ name: 'name', label: 'Nome', value: contact.name ?? '' })}
    ${field({ name: 'role_title', label: 'Cargo ou função', required: false, value: contact.role_title ?? '' })}
    <div class="grid gap-4 sm:grid-cols-2">
      ${field({ name: 'email', label: 'E-mail', type: 'email', required: false, inputmode: 'email', value: contact.email ?? '' })}
      ${field({ name: 'phone', label: 'Telefone', type: 'tel', required: false, inputmode: 'tel', value: contact.phone ? formatPhone(contact.phone) : '' })}
    </div>
    ${checkboxField({ name: 'is_responsible', label: 'É responsável pela empresa (sócio, administrador).', checked: Boolean(contact.is_responsible) })}
    ${textareaField({ name: 'notes', label: 'Observações', value: contact.notes ?? '' })}`;
}

export default {
  title: 'Empresa',

  render: () => html`
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-bold tracking-tight text-slate-900">Empresa</h1>
      <span data-status></span>
    </div>
    <div class="mt-6 space-y-4" data-content>${loadingState()}</div>`,

  mount(root, { navigate }) {
    const content = root.querySelector('[data-content]');
    const editable = can('company.manage');
    let company;
    let contacts;

    function showProfile(mode) {
      const slot = content.querySelector('[data-profile]');
      setContent(slot, mode === 'edit' ? profileForm(company) : profileView(company, editable));
      if (mode !== 'edit') {
        slot.querySelector('[data-action="edit"]')?.addEventListener('click', () => showProfile('edit'));
        return;
      }
      const form = slot.querySelector('form');
      bindSubmitShortcut(form);
      formatOnBlur(form.elements.namedItem('cnpj'), formatCnpj);
      formatOnBlur(form.elements.namedItem('phone'), formatPhone);
      formatOnBlur(form.elements.namedItem('address_cep'), formatCep);
      form.querySelector('[data-action="cancel"]').addEventListener('click', () => showProfile('view'));
      form.querySelector('[name="legal_name"]').focus();
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearErrors(form);
        const done = setBusy(form.querySelector('[type="submit"]'), 'Salvando…');
        try {
          const { data } = await api('/company', { method: 'PATCH', body: profileBody(formValues(form), company.version) });
          const nameChanged = data.company.name !== company.name;
          company = data.company;
          toast('Dados da empresa salvos.', { type: 'success' });
          if (nameChanged) {
            // O nome aparece no cabeçalho: recarrega a lista de empresas e remonta o layout.
            await loadMe();
            navigate('/app/empresa', { replace: true });
            return;
          }
          showProfile('view');
        } catch (err) {
          if (err.code === 'VERSION_CONFLICT') {
            showErrors(form, { message: 'Estes dados foram alterados em outro lugar. Recarregue a página para ver a versão mais recente.' });
          } else {
            showErrors(form, err);
          }
          done();
        }
      });
    }

    function showContacts() {
      const slot = content.querySelector('[data-contacts]');
      setContent(slot, contactsCard(contacts, editable));
      slot.querySelector('[data-action="add-contact"]')?.addEventListener('click', () => editContact());
      for (const button of slot.querySelectorAll('[data-action="edit-contact"]')) {
        button.addEventListener('click', () => editContact(contacts.find((contact) => contact.id === button.dataset.id)));
      }
      for (const button of slot.querySelectorAll('[data-action="delete-contact"]')) {
        button.addEventListener('click', () => deleteContact(contacts.find((contact) => contact.id === button.dataset.id)));
      }
    }

    async function editContact(contact) {
      const saved = await openFormModal({
        title: contact ? 'Editar contato' : 'Novo contato',
        body: contactFields(contact),
        onMount: (dialog) => formatOnBlur(dialog.querySelector('[name="phone"]'), formatPhone),
        onSubmit: async (form) => {
          const values = formValues(form);
          if (!values.name.trim()) {
            throw { details: [{ field: 'name', message: 'Informe o nome.' }] };
          }
          const { data } = contact
            ? await api(`/company/contacts/${contact.id}`, { method: 'PATCH', body: values })
            : await api('/company/contacts', { method: 'POST', body: values });
          return data.contact;
        },
      });
      if (!saved) return;
      const { data } = await api('/company/contacts');
      contacts = data.contacts;
      showContacts();
      toast(contact ? 'Contato atualizado.' : 'Contato adicionado.', { type: 'success' });
    }

    async function deleteContact(contact) {
      const confirmed = await ConfirmDialog.ask({
        title: `Excluir ${contact.name}?`,
        message: 'O contato sai da lista da empresa.',
        confirmLabel: 'Excluir',
      });
      if (!confirmed) return;
      try {
        await api(`/company/contacts/${contact.id}`, { method: 'DELETE' });
        contacts = contacts.filter((item) => item.id !== contact.id);
        showContacts();
        toast('Contato excluído.', { type: 'success' });
      } catch (err) {
        toast(err.message, { type: 'error' });
      }
    }

    Promise.all([api('/company'), api('/company/contacts')])
      .then(([profile, list]) => {
        if (!content.isConnected) return;
        company = profile.data.company;
        contacts = list.data.contacts;
        setContent(root.querySelector('[data-status]'), companyStatusBadge(company.status));
        setContent(content, html`<div data-profile></div><div data-contacts></div>`);
        showProfile('view');
        showContacts();
      })
      .catch((err) => {
        if (content.isConnected) setContent(content, errorState({ message: err.message }));
      });
  },
};
