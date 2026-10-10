// Ponto de entrada da SPA: recupera a sessão pelo cookie, liga o router e o verificador de versão.
import { getCurrentRoute, refreshRoute, startRouter } from './router.js';
import { isAuthenticated, onSessionChange, restore } from './services/session.js';
import { startUpdateChecker } from './services/version.js';

await restore();

// Sessão encerrada (nesta ou em outra aba, ou pelo servidor): sai das telas que exigem login.
onSessionChange(() => {
  if (!isAuthenticated() && getCurrentRoute()?.access === 'auth') refreshRoute();
});

startUpdateChecker();
await startRouter();
