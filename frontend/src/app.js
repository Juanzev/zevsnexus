// Ponto de entrada da SPA: recupera a sessão pelo cookie, carrega as empresas, liga o router e o
// verificador de versão.
import { getCurrentRoute, refreshRoute, remountLayout, startRouter } from './router.js';
import { isAuthenticated, onSessionChange, restore } from './services/session.js';
import { onTenantChange } from './services/tenant.js';
import { startUpdateChecker } from './services/version.js';

await restore();

// Sessão encerrada (nesta ou em outra aba, ou pelo servidor): sai das telas que exigem login.
onSessionChange(() => {
  remountLayout();
  if (!isAuthenticated() && getCurrentRoute()?.access === 'auth') refreshRoute();
});

// Empresa trocada, marca ou permissões novas: o layout é remontado na próxima tela.
onTenantChange(remountLayout);

startUpdateChecker();
await startRouter();
