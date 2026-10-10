// Planos e features (pág. 13). Só existe feature que liga ou desliga algo concreto.
// Os planos comerciais definitivos chegam na F11; até lá, um plano padrão com limites folgados.

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

export const FEATURES = Object.freeze([
  { code: 'multiple_users', name: 'Vários usuários', description: 'Convidar outras pessoas para a empresa.' },
  {
    code: 'spreadsheet_import',
    name: 'Importação de planilhas',
    description: 'Converter linhas de planilhas em despesas e pagamentos.',
  },
]);

export const PLANS = Object.freeze([
  {
    code: 'standard',
    name: 'Padrão',
    maxUsers: 5,
    storageQuotaBytes: 10 * GIB,
    maxFileSizeBytes: 25 * MIB,
    isDefault: true,
    features: ['multiple_users', 'spreadsheet_import'],
  },
]);
