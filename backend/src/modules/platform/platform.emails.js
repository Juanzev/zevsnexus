import { appLink, renderEmail } from '../email/templates.js';

export function companyApprovedMessage(owner, company) {
  const firstName = String(owner.name).trim().split(/\s+/)[0];
  return {
    to: owner.email,
    template: 'platform.company_approved',
    ...renderEmail({
      subject: 'Sua empresa foi aprovada no ZEVS Nexus',
      greeting: `Olá, ${firstName}!`,
      paragraphs: [`A empresa ${company.trade_name ?? company.legal_name} foi aprovada. Você já pode usar o ZEVS Nexus.`],
      action: { label: 'Entrar', url: appLink('/login') },
    }),
  };
}
