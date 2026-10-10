# ZEVS Nexus — Segurança

Este documento segue o checklist obrigatório da ZEVS STRUCTURE (pág. 06). Cada funcionalidade responde, antes do merge: **quem pode executar · em qual tenant · qual permissão · quais dados podem ser vistos · se existe IDOR · se existe race condition · se precisa de transação · se precisa de audit log · se há informação sensível**.

As decisões de base estão em [`ARCHITECTURE.md`](ARCHITECTURE.md) §20–§21 e na Fase 0, D3.

---

## Fase 1 — Fundação e autenticação (10/10/2026)

Na F1 não há tenant: o usuário é global, e empresa, membership e RBAC chegam na F2. Por isso a coluna "Tenant" é "—" em toda a fase.

### Checklist por funcionalidade

| Funcionalidade | Quem executa | Tenant | Permissão | Dados visíveis | IDOR | Race condition | Transação | Audit log | Informação sensível |
|---|---|---|---|---|---|---|---|---|---|
| **Cadastro** `POST /auth/register` | Qualquer pessoa (rate limit 10/15 min por IP) | — | — | Só `{status: check_email}`, igual para e-mail novo ou existente | Não há id de entrada | Dois cadastros simultâneos do mesmo e-mail: o índice único resolve; o perdedor recebe a mesma resposta | Sim: usuário + token de verificação | Pendente F2 (ver abaixo) | Senha (só o hash bcrypt), e-mail. Sem enumeração: hash calculado antes da consulta, mesma resposta, aviso ao dono do e-mail |
| **Login** `POST /auth/login` | Qualquer pessoa (30/min por IP antes do bcrypt; 5 falhas/15 min por IP + e-mail) | — | — | Dados públicos do próprio usuário (sem hash, sem tokens no corpo) | Não há id de entrada | Não | Não (insere um refresh e atualiza `last_login_at`) | Pendente F2 | Mesma mensagem e mesmo tempo para e-mail inexistente e senha errada; conta desativada só é revelada a quem acertou a senha; senha > 72 bytes nunca confere (sem truncamento) |
| **Renovar sessão** `POST /auth/refresh` | Quem tem o cookie HttpOnly (CSRF: header + Origin + Sec-Fetch-Site) | — | — | Mesmo do login | O token é o próprio segredo (48 bytes aleatórios; no banco só o SHA-256) | **Sim**: o token é travado com `FOR UPDATE`; refresh simultâneo gera uma rotação só (teste de concorrência) | Sim | Reuso → `security:auth.refresh_reuse` no log + e-mail de alerta; tabela de auditoria na F2 | Rotação a cada uso; reuso após 15 s revoga a família inteira; teto de 30 dias por família (também como `CHECK` no banco) |
| **Sair** `POST /auth/logout` | Quem tem o cookie (CSRF) | — | — | Nada | Só revoga a família do próprio token | Não | Não | Pendente F2 | Cookie apagado |
| **Sair de todos** `POST /auth/logout-all` | Usuário autenticado (Bearer) | — | — | Nada | Atua só em `req.user` | Não | Sim | Pendente F2 | Revoga todas as famílias e invalida access tokens já emitidos (`sessions_revoked_at`) |
| **Esqueci a senha** `POST /auth/password/forgot` | Qualquer pessoa (10/15 min por IP) | — | — | Só `{status: check_email}` | Não há id de entrada | Não | Sim: invalida os anteriores + cria o novo | Pendente F2 | Resposta genérica; envio assíncrono; só o token mais recente vale; validade de 1 h |
| **Redefinir senha** `POST /auth/password/reset` | Quem tem o token do e-mail (10/15 min por IP) | — | — | Nada | O token é o segredo | **Sim**: token com `FOR UPDATE`; uso triplo simultâneo → 1 sucesso (teste de concorrência) | Sim | Pendente F2; e-mail "senha alterada" | Uso único; derruba todas as sessões; marca o e-mail como verificado (o token prova o controle da caixa) |
| **Trocar senha** `POST /auth/password/change` | Usuário autenticado | — | — | Novo access token | Atua só em `req.user` | Não | Sim | Pendente F2; e-mail "senha alterada" | Exige a senha atual; mantém a sessão atual, derruba as outras |
| **Verificar e-mail** `POST /auth/email/verify` | Quem tem o token do e-mail | — | — | Nada | O token é o segredo e confere o e-mail da conta | Token com `FOR UPDATE` | Sim | Pendente F2 | Uso único; 7 dias; token removido da barra de endereço |
| **Reenviar verificação** `POST /auth/email/resend` | Usuário autenticado (10/15 min por IP) | — | — | `{status}` | Atua só em `req.user` | Não | Sim | — | Invalida o link anterior |
| **Meus dados** `GET /me` | Usuário autenticado | — | — | id, nome, e-mail, `email_verified`, `created_at` | Só o próprio usuário | Não | Não | — | Projeção explícita; sem hash |
| **Infra** `/health`, `/ready`, `/api/version` | Público | — | — | Status e versão (SHA do commit) | — | — | — | — | `/ready` não expõe detalhe do erro do banco |
| **SPA** (estáticos + fallback) | Público | — | — | Código do frontend | — | — | — | — | Arquivo inexistente → 404 (nunca index.html); `no-cache` + ETag |

### Controles transversais implementados

- **Headers:**
  - Helmet com CSP estrita (`script-src 'self'`, sem script inline nem de terceiros, `frame-ancestors 'none'`, `object-src 'none'`);
  - HSTS só em produção; `nosniff`; `Referrer-Policy: no-referrer`; sem `x-powered-by`;
  - a API responde `Cache-Control: no-store` e `CSP default-src 'none'`.
- **CORS:** só as origens de `APP_URL` + `CORS_ORIGIN`; `*` derruba o boot.
- **IP real:** `CF-Connecting-IP` só é aceito com o segredo de origem do Cloudflare (comparação em tempo constante); sem ele, vale `req.ip` com `trust proxy = 1`.
- **Rate limit:** global de 2000/15 min só em `/api`; login com teto por IP antes do bcrypt e 5 falhas por IP + e-mail; IPv6 agrupado por /56.
- **Entrada:** Zod `.strict()` em todo body. A checagem roda na montagem da rota (`validate()` recusa schema frouxo) e numa guarda estática nos testes. JSON até 1 MB; JSON malformado → 400.
- **SQL:** 100% parametrizado; o lint proíbe `SELECT *` no código da app.
- **JWT:** HS256 fixo (`none` e HS512 recusados), `iss` e `aud` conferidos, 15 min, sem papel nem tenant; usuário recarregado a cada requisição.
- **Erros:** formato único com `requestId`; 5xx genérico.
- **Logs:** pino com redaction; sem corpo, sem query string, sem e-mail; eventos de segurança com `security: true`.
- **Frontend:**
  - todo HTML via `html``` com escape automático;
  - `innerHTML`, `insertAdjacentHTML`, `document.write` e `eval` proibidos por lint (o único uso autorizado fica em `src/lib/html.js`);
  - `?next=` só aceita caminho interno;
  - access token só em memória;
  - tokens de e-mail removidos da URL.
- **Banco de teste:** os testes recusam banco cujo nome não termine em `_test` ou que não esteja em host local.
- **Migrations:** `down`/`redo` bloqueados em produção.

### Testes de segurança (todos verdes)

`backend/tests/security/` (JWT adulterado, `none`, outro segredo, `aud` errado, expirado, revogado; CSRF; rate limit; enumeração; headers e CORS), `backend/tests/concurrency/` (refresh simultâneo, reset simultâneo) e `backend/tests/static/` (validators `.strict()`).

### Pendências conhecidas (para as próximas fases)

| Item | Fase |
|---|---|
| Gravar os eventos de auth (`auth.login`, `auth.login_failed`, `auth.logout`, `auth.refresh_reuse`, `auth.password_*`) em `audit_logs` (`company_id` nulo). Hoje só o reuso de refresh vai para o log de segurança | F2 (tabela `audit_logs`) |
| Contas nunca verificadas e sem empresa: limpeza por job depois de N dias | F10 |
| Lista de sessões ativas (IP e user-agent já são gravados no refresh) | F10 |
| Textos de termos de uso e política de privacidade (o aceite já é registrado em `users.terms_accepted_at`) | Antes do piloto (F5) |
| Rate limit em memória: vale por instância. Com mais de uma instância, store compartilhado | Quando houver 2+ instâncias |
| Janela de < 1 s: access token emitido no mesmo segundo de um "sair de todos" ainda vale até expirar (15 min) | Aceito |
| O aviso de "tentativa de cadastro" (que evita a enumeração) e o pedido de recuperação de senha podem ser usados para mandar e-mails repetidos a um endereço existente. Hoje só o rate limit por IP contém isso; avaliar um limite por destinatário (ex.: 3 avisos/hora por e-mail) | F2 |

### Riscos aceitos em dependências

| Pacote | Severidade | Onde | Por que é aceito |
|---|---|---|---|
| `sprintf-js` (via `@istanbuljs/load-nyc-config` → Jest) | Moderada (DoS por especificador de precisão) | Só desenvolvimento/teste do backend | Não existe versão corrigida; não roda em produção nem recebe entrada externa. O CI audita só as dependências de produção (`--omit=dev`), hoje com **0 vulnerabilidades** |

Corrigido na F1: `braces` (alta, via `@parcel/watcher` 2.5.1 do Tailwind CLI) → `overrides` para `@parcel/watcher@^2.6.0`, que não depende mais de `micromatch`/`braces`. O frontend está com **0 vulnerabilidades**.
