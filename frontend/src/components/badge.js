import { html } from '../lib/html.js';

const TONES = {
  green: 'badge badge-green',
  amber: 'badge badge-amber',
  red: 'badge badge-red',
  slate: 'badge badge-slate',
  primary: 'badge badge-primary',
};

export function badge(label, tone = 'slate') {
  return html`<span class="${TONES[tone] ?? TONES.slate}">${label}</span>`;
}

const COMPANY_STATUS = {
  pending: ['Em análise', 'amber'],
  active: ['Ativa', 'green'],
  suspended: ['Suspensa', 'red'],
};

export function companyStatusBadge(status) {
  const [label, tone] = COMPANY_STATUS[status] ?? [status, 'slate'];
  return badge(label, tone);
}
