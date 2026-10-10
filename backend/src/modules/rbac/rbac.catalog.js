// Catálogo de permissões e papéis (pág. 05; matriz aprovada na Fase 0, D10).
// Fonte da verdade em código; o seed idempotente leva para as tabelas.

export const PERMISSIONS = Object.freeze(
  [
    ['dashboard.view', 'Ver o início'],
    ['company.view', 'Ver os dados da empresa'],
    ['company.manage', 'Editar os dados e os contatos da empresa'],
    ['settings.manage', 'Alterar as configurações da empresa'],
    ['users.manage', 'Gerenciar a equipe e os acessos'],
    ['parties.view', 'Ver prestadores e fornecedores'],
    ['parties.manage', 'Cadastrar e editar prestadores e fornecedores'],
    ['finance.view', 'Ver despesas, pagamentos e valores'],
    ['finance.manage', 'Lançar e editar despesas'],
    ['finance.pay', 'Registrar e estornar pagamentos'],
    ['documents.view', 'Ver documentos'],
    ['documents.manage', 'Enviar, organizar e excluir documentos'],
    ['spreadsheets.view', 'Ver planilhas'],
    ['spreadsheets.manage', 'Enviar e organizar planilhas'],
    ['spreadsheets.import', 'Importar dados de planilhas'],
    ['invoices.view', 'Ver notas fiscais'],
    ['invoices.manage', 'Registrar e atualizar notas fiscais'],
    ['audit.view', 'Ver o registro de atividades'],
    ['data.export', 'Exportar dados'],
  ].map(([code, description]) => Object.freeze({ code, description })),
);

const ALL = PERMISSIONS.map((permission) => permission.code);

const VIEW = [
  'dashboard.view',
  'company.view',
  'parties.view',
  'finance.view',
  'documents.view',
  'spreadsheets.view',
  'invoices.view',
];

const ASSISTANT = [
  ...VIEW,
  'parties.manage',
  'finance.manage',
  'documents.manage',
  'spreadsheets.manage',
  'invoices.manage',
];

export const ROLES = Object.freeze([
  {
    code: 'owner',
    name: 'Proprietário',
    description: 'Acesso total. A empresa sempre tem pelo menos um.',
    permissions: ALL,
  },
  {
    code: 'admin',
    name: 'Administrador',
    description: 'Acesso total, inclusive equipe e configurações.',
    permissions: ALL,
  },
  {
    code: 'finance',
    name: 'Financeiro',
    description: 'Lança e paga despesas, cuida de notas, documentos e planilhas.',
    permissions: [...ASSISTANT, 'finance.pay', 'spreadsheets.import', 'data.export'],
  },
  {
    code: 'assistant',
    name: 'Assistente',
    description: 'Lança despesas e organiza documentos, notas e planilhas. Não registra pagamentos.',
    permissions: ASSISTANT,
  },
  {
    code: 'viewer',
    name: 'Visualização',
    description: 'Só consulta.',
    permissions: VIEW,
  },
]);

export function rolePermissions(roleCodes) {
  const result = new Set();
  for (const role of ROLES) {
    if (roleCodes.includes(role.code)) role.permissions.forEach((code) => result.add(code));
  }
  return result;
}
