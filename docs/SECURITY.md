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
| ~~Gravar os eventos de auth em `audit_logs`~~ | ✅ Feito na F2 |
| Contas nunca verificadas e sem empresa: limpeza por job depois de N dias | F10 |
| Lista de sessões ativas (IP e user-agent já são gravados no refresh) | F10 |
| Textos de termos de uso e política de privacidade (o aceite já é registrado em `users.terms_accepted_at`) | Antes do piloto (F5) |
| Rate limit em memória: vale por instância. Com mais de uma instância, store compartilhado | Quando houver 2+ instâncias |
| Janela de < 1 s: access token emitido no mesmo segundo de um "sair de todos" ainda vale até expirar (15 min) | Aceito |
| ~~Limite de e-mails por destinatário (aviso de cadastro e recuperação de senha)~~ | ✅ Feito na F2: 3 por hora |

### Riscos aceitos em dependências

| Pacote | Severidade | Onde | Por que é aceito |
|---|---|---|---|
| `sprintf-js` (via `@istanbuljs/load-nyc-config` → Jest) | Moderada (DoS por especificador de precisão) | Só desenvolvimento/teste do backend | Não existe versão corrigida; não roda em produção nem recebe entrada externa. O CI audita só as dependências de produção (`--omit=dev`), hoje com **0 vulnerabilidades** |

Corrigido na F1: `braces` (alta, via `@parcel/watcher` 2.5.1 do Tailwind CLI) → `overrides` para `@parcel/watcher@^2.6.0`, que não depende mais de `micromatch`/`braces`. O frontend está com **0 vulnerabilidades**.

---

## Fase 2 — Tenant, RBAC, Empresa e Painel ZEVS (11/10/2026)

A partir daqui toda rota de dados de empresa passa por `tenantRouter()`: `authenticate` → `tenantContext` (membership **ativa** em empresa **ativa**) → `requirePermission`. A guarda estática (`tests/static/tenant-router.test.js`) falha se um `*.routes.js` novo não usar o `tenantRouter`.

### Checklist por funcionalidade

| Funcionalidade | Quem executa | Tenant | Permissão | Dados visíveis | IDOR | Race condition | Transação | Audit log | Informação sensível |
|---|---|---|---|---|---|---|---|---|---|
| **Cadastrar empresa** `POST /companies` | Usuário com e-mail **verificado** | Cria o tenant | — | A empresa criada | Não há id de entrada; `company_id`/`status` no corpo → 422 | **Sim**: lock por usuário (`pg_advisory_xact_lock`) + uma empresa pendente por vez; `Idempotency-Key` contra duplo clique (testes de concorrência) | Sim: empresa, marca, uso, vínculo owner, assinatura e auditoria | `company.created` | CNPJ validado (inclusive alfanumérico); empresa nasce `pending` |
| **Contexto** `GET /company/context` | Membro ativo | Header `X-Company-Id` validado | — | Empresa, papéis, permissões, features, cor | Outra empresa → 404 idêntico a inexistente | Não | `withTenant` | — | Nenhuma |
| **Perfil** `GET`/`PATCH /company` | Membro (`company.view`) / gestor (`company.manage`) | `withTenant` | `company.view` / `company.manage` | Dados cadastrais | `status`, `company_id` e campos fora da allowlist → 422 | **Sim**: `SELECT … FOR UPDATE` + `version` (5 edições simultâneas → 1 vence, 4 × 409) | Sim | `company.updated`, com e-mail e telefone como `[dado pessoal]` | E-mail/telefone da empresa podem ser de pessoa física (MEI): valor nunca vai para a auditoria |
| **Configurações** `GET`/`PATCH /company/settings` | Gestor | `withTenant` | `settings.manage` | Fuso e cor | — | Empresa travada com `FOR UPDATE` | Sim | `settings.updated` | Cor só `#RRGGBB` (Zod + `CHECK` no banco): nada de CSS arbitrário virando variável |
| **Contatos** `/company/contacts` | Membro (ver) / gestor (criar, editar, excluir) | `scopedTable` impõe `company_id` | `company.view` / `company.manage` | Contatos da própria empresa | Contato de outra empresa → 404; o registro alheio não muda (suíte A × B) | Linha travada antes de editar/excluir | Sim | `company_contact.*`, nome, e-mail, telefone e observações como `[dado pessoal]` | Dados pessoais (LGPD): só para membros da empresa |
| **Painel ZEVS** `/admin/companies*` | Platform Admin (registro em `platform_admins` ou e-mail de bootstrap **verificado**) | Cross-tenant por desenho (`withSystem`) | `requirePlatformAdmin` (dono de empresa → 403) | Empresas, status, dono (nome e e-mail) | Ações por id com a empresa travada (`FOR UPDATE`) e status de origem conferido | Sim (transição de status checada dentro da transação) | Sim | `platform.company_*`, gravado **na empresa afetada** com `actor_type = platform_admin` | Busca escapa `%` e `_`; e-mail de aprovação só depois do commit |
| **Eventos de conta** (login, falha, saída, reuso, reset, troca, verificação) | — | `company_id` nulo | — | — | — | — | Na mesma transação do evento | `auth.*` | Metadata sem e-mail nem senha; IP e user-agent registrados |

### Controles da fase

- **Isolamento em camadas:**
  1. `tenantContext` resolve vínculo, papéis, permissões (papéis ∪ grants − denies) e features numa query só, a cada requisição;
  2. `tenantRouter` com guarda estática;
  3. repository escopado (`scopedTable`);
  4. FK composta (`membership_roles` e `membership_permissions` recusam vínculo de outra empresa — testado com SQL direto);
  5. `withTenant` em toda consulta de tenant (RLS fica pronto para a F10);
  6. suíte A × B.
- **Respostas de tenant:** sem header → 400 `COMPANY_REQUIRED`; inválido, inexistente, alheio ou removido → 404 `COMPANY_NOT_FOUND`; pendente → 403 `COMPANY_PENDING`; suspensa → 403 `COMPANY_SUSPENDED`; vínculo suspenso → 403 `MEMBERSHIP_SUSPENDED`.
- **Permissões:** matriz D10 testada rota a rota para os 5 papéis (`tests/security/permissions-company.test.js`). Mudança de acesso vale na próxima requisição.
- **Anti-escalada:** política pura testada (`CANNOT_CHANGE_SELF`, `OWNER_PROTECTED`, `TARGET_OUTRANKS`, `PRIVILEGE_ESCALATION`, `LAST_OWNER`). As rotas de equipe usam essa política na F10.
- **Auditoria append-only:** `UPDATE`, `DELETE` e `TRUNCATE` bloqueados por trigger (testado).
- **Idempotência:** mesma chave + mesmo corpo → resposta salva (`Idempotent-Replayed: true`); corpo diferente → 422; em andamento → 409; erro não consome a chave.
- **Teto de e-mails:** aviso de cadastro e recuperação de senha limitados a 3 por hora por destinatário (contados pela auditoria). A resposta continua igual.
- **Frontend:** a cor da marca só entra como CSS variable se for `#RRGGBB`; aviso de contraste baixo (texto branco nos botões abaixo de 4,5:1). A empresa selecionada fica em `localStorage` só como preferência; o backend valida o vínculo a cada requisição.

### Pendências da F2 (para as próximas fases)

| Item | Fase |
|---|---|
| Rotas de equipe (convites, papéis, grant/deny) usando a política de anti-escalada já testada | F10 |
| Ligar as policies de RLS (todas as consultas de tenant já passam por `withTenant`) | F10 (D2) |
| Staging com e-mail em modo log não envia o link de confirmação: para testar o cadastro completo lá, configurar o Resend | Staging |

## Fase 3 — Armazenamento e Central de Documentos (11/10/2026)

O arquivo nunca passa pela API: o navegador envia direto ao storage com URL assinada curta, e a API confere o que chegou antes de criar o documento (ARCHITECTURE §5.2 e §10.3).

### Checklist por funcionalidade

| Funcionalidade | Quem executa | Tenant | Permissão | Dados visíveis | IDOR | Race condition | Transação | Audit log | Informação sensível |
|---|---|---|---|---|---|---|---|---|---|
| **Intenção de envio** `POST /files/upload-intents` | Membro que gerencia documentos | `tenantRouter` + `withTenant` | `documents.manage` + limite de 200/h por usuário | O próprio arquivo pendente e a URL de PUT | Não há id de entrada; `company_id`, chave ou campos extras → 422. A chave é gerada no servidor (`companies/<empresa>/uploads/<uuid>`) e não sai na resposta | Pré-checagem de cota (a de verdade é atômica na confirmação) | Sim | — (o envio é auditado ao confirmar) | Tipo decidido pelo servidor pela allowlist; MIME de outro tipo → 422; `Content-Type` e `Content-Length` assinados na URL de PUT (10 min) |
| **Confirmar envio** `POST /documents` e `POST /documents/:id/versions` | Quem enviou o arquivo | `file_id` só da mesma empresa **e** do mesmo usuário | `documents.manage` + `Idempotency-Key` | O documento criado | `file_id` de outra empresa ou de outra pessoa → 422 `FILE_NOT_FOUND`; pasta/tipo de outra empresa → 422 | **Sim**: conferência no storage fora da transação; depois `FOR UPDATE` no arquivo, status reconferido e cota por `UPDATE` atômico (4 confirmações simultâneas numa cota apertada → só as que cabem passam; o mesmo arquivo 3 vezes → 1 documento) | Sim: cota, `ready`, documento, versão, tags e auditoria | `document.uploaded` / `document.version_added` (extensão, tamanho, versão; sem título nem nome) e `file.rejected` | Magic bytes nos primeiros 4 KB; cópia para a chave definitiva **condicionada à ETag** conferida (um segundo PUT na URL ainda válida não troca o arquivo guardado — testado) |
| **Listar e abrir** `GET /documents`, `/documents/:id`, `/history`, `/folders`, `/tags`, `/document-types` | Membro | `withTenant`; toda consulta filtra `company_id` | `documents.view` | Documentos ativos da empresa; lixeira só para quem gerencia | Documento de outra empresa → 404 (suíte A × B em todas as rotas por id) | Não | `withTenant` (leitura) | — | Busca com curingas escapados; ordenação só por allowlist; histórico sem valores pessoais |
| **Baixar** `POST /documents/:id/download-url` | Membro | `withTenant` | `documents.view` + limite de 600/h por usuário | URL de GET de 60 s | Documento alheio → 404; na lixeira → 404 para quem não gerencia | Não | Sim | `document.downloaded` (versão e disposição), gravado **antes** de a URL sair | `inline` só para PDF e imagem; o resto sempre `attachment`; tipo e `Content-Disposition` forçados na URL; servido pelo domínio do R2, nunca pela origem do app |
| **Editar, mover, arquivar, lixeira, restaurar, versões** | Quem gerencia documentos | `withTenant` | `documents.manage` | O documento | Mutação só depois de `SELECT … FOR UPDATE` com `company_id`; documento alheio → 404 e nada muda | **Sim**: edição com `version` (409 `VERSION_CONFLICT`); 5 versões simultâneas viram 2..6 sem buraco | Sim | `document.updated` (título, descrição e tags como `[dado pessoal]`), `document.moved`, `.archived`, `.unarchived`, `.deleted`, `.restored`, `.version_restored` | Restaurar versão cria versão nova (histórico nunca se reescreve); lixeira não devolve cota (exclusão física só pelo job da F10) |
| **Favoritos** `PUT`/`DELETE /documents/:id/favorite` | Membro | `withTenant` | `documents.view` | Os favoritos do próprio membro | Documento alheio → 404 | `ON CONFLICT DO NOTHING` | — | — (preferência pessoal) | — |
| **Pastas** `/folders` | Membro (ver) / gestor (criar, renomear, mover, excluir) | `withTenant` | `documents.view` / `documents.manage` | Árvore da empresa | Pasta alheia → 404; como pai ou destino → 422 | **Sim**: criar e mover sob trava por empresa (`pg_advisory_xact_lock`): dois movimentos cruzados nunca formam ciclo (testado); excluir trava a pasta e quem põe algo dentro usa `FOR SHARE` (pasta excluída nunca fica com documento ativo — testado) | Sim | `folder.created`, `.renamed` (sem o nome), `.moved`, `.deleted` | Até 8 níveis; nome sem `/` e `\`; único entre irmãs |
| **Tipos de documento** `/document-types` | Gestor | `withTenant` | `documents.manage` (listar: `documents.view`) | Tipos da empresa | Tipo alheio → 404 (rota) ou 422 (referência) | Índice único entre ativos | Sim | `document_type.created`, `.renamed`, `.archived` | — |
| **`/dev-storage/*`** (só `STORAGE_PROVIDER=local\|memory`) | Quem tem o token | O token carrega a chave gerada pelo servidor | Token HMAC (chave derivada do `JWT_SECRET` com rótulo próprio) | O objeto do token | Token de download não serve para envio; adulterado ou vencido → 403 | — | — | — | Não existe com `r2` (produção exige `r2` no boot); o token nunca vai para o log; respostas com CSP sem script |

### Controles da fase

- **Chaves:** `companies/<empresa>/files/<uuid>` (definitiva, só o servidor escreve) e `companies/<empresa>/uploads/<uuid>` (a única com URL de PUT). Formato validado em toda operação de provider; `CHECK` no banco.
- **Três conferências do tipo:** extensão (allowlist), MIME declarado e magic bytes. Bloqueados: executáveis, scripts, HTML, SVG, arquivos com macro e compactados.
- **Nenhuma rota apaga objeto:** arquivo recusado fica `rejected`; o job `cleanup.files` apaga envios vencidos (1 h de folga depois das 24 h), recusados com mais de um dia e a chave de envio dos confirmados depois que a URL de PUT expira.
- **URLs assinadas fora do log:** a query string nunca é registrada e o caminho `/dev-storage/<op>/<token>` vira `[redacted]` (teste unitário).
- **CSP:** a origem S3 da conta R2 entra em `connect-src` e `img-src` só com `STORAGE_PROVIDER=r2`.
- **Frontend:** "Abrir" abre a aba no clique e corta o `opener` antes de navegar para a URL curta. Nenhuma URL assinada é guardada.

### Pendências da F3 (para as próximas fases)

| Item | Fase |
|---|---|
| Exclusão definitiva (lixeira com retenção) devolvendo a cota; conferir se o arquivo não é usado por outra versão antes de apagar o objeto | F10 |
| Bucket e CORS do R2 de staging (passo a passo em `DEPLOYMENT.md`); provar o envio direto ao R2 de verdade | Staging |
| Backup diário dos objetos para um segundo bucket (D12f) | F5 |
| Varredura antivírus: fora do escopo (não prevista na ARCHITECTURE). Mitigação atual: allowlist + magic bytes + arquivos servidos por outro domínio, com `inline` só para PDF e imagem. Decisão do Juan se um cliente exigir | — |

## Fase 4 — Prestadores e Financeiro (11/10/2026)

Dinheiro em centavos `bigint` do banco à tela (a tela lê o texto digitado sem passar por float). Pagamento é fato: não se edita nem se apaga — estorna, com motivo.

### Checklist por funcionalidade

| Funcionalidade | Quem executa | Tenant | Permissão | Dados visíveis | IDOR | Race condition | Transação | Audit log | Informação sensível |
|---|---|---|---|---|---|---|---|---|---|
| **Prestadores** `/parties` | Membro (ver) / quem gerencia (criar, editar, excluir, anexar) | `tenantRouter` + `withTenant` | `parties.view` / `parties.manage` | Cadastros da empresa; totais financeiros da ficha só com `finance.view` | Cadastro alheio → 404 (suíte A × B); prestador de outra empresa no corpo da despesa → 422 | Edição com `version` (409); CPF/CNPJ único por empresa (índice parcial → 409) | Sim | `party.created`/`updated`/`deleted`/`document_linked`/`document_unlinked` | **LGPD:** nome, CPF/CNPJ, e-mail, telefone, PIX e observações viram `[dado pessoal]` na auditoria; CPF/CNPJ validados por dígito verificador |
| **Despesas** `/expenses` (listar, criar, editar, cancelar, anexar) | Membro (ver) / quem lança | `withTenant` | `finance.view` / `finance.manage` | Despesas e totais da empresa | Despesa alheia → 404 e nada muda; prestador, categoria, documento ou arquivo de outra empresa → 422 | **Sim**: mutação só depois de `SELECT … FOR UPDATE`; edição com `version` (2 edições simultâneas → 1 vence); valor nunca abaixo do pago | Sim | `expense.created`/`updated` (descrição, observações e tags como `[dado pessoal]`)/`cancelled`/`document_linked`/`document_unlinked` | Busca com curingas escapados; ordenação por allowlist; datas fora de 1990–2100 recusadas |
| **Pagamento e estorno** `POST /expenses/:id/payments`, `POST /expense-payments/:id/void` | Quem paga (lançar ≠ pagar, D10) | `withTenant` | `finance.pay` | A despesa atualizada | Pagamento alheio → 404 | **Sim**: função única do saldo (`UPDATE … WHERE paid + Δ BETWEEN 0 AND amount`) — 5 pagamentos simultâneos de 40 numa despesa de 100: só 2 passam; mesmo estorno 3 vezes: 1 vale; cancelar × pagar ao mesmo tempo: nunca fica cancelada com pagamento ativo (testes de concorrência) | Sim: despesa travada, depois o pagamento (ordem fixa, sem deadlock) | `expense.payment_registered`/`payment_voided` com valor, data, forma e o pago depois | Trigger no banco: `DELETE` e qualquer `UPDATE` em `expense_payments` são recusados, salvo marcar o estorno uma vez; data do pagamento não pode ser futura (fuso da empresa); `Idempotency-Key` contra duplo clique |
| **"Já paguei"** `POST /expenses` com `payment` | Quem lança **e** paga | `withTenant` | `finance.manage` + `finance.pay` (sem o segundo: 403 e nada é criado) | A despesa paga | Arquivo do comprovante de outra empresa ou de outra pessoa → 422 | Igual ao pagamento | Sim: despesa, pagamento, comprovante (documento) e auditoria juntos | `expense.created` + `expense.payment_registered` + `document.uploaded` | O comprovante passa pela mesma conferência da F3 (tipo, tamanho, magic bytes, cota) |
| **Categorias** `/finance-categories` | Quem lança | `withTenant` | `finance.view` / `finance.manage` | Categorias da empresa | Categoria alheia → 404 (rota) / 422 (referência) | Nome único entre ativas | Sim | `finance_category.*` | — |
| **Dashboard** `GET /dashboard` | Membro | `withTenant` + `SET LOCAL statement_timeout = '10s'` | `dashboard.view`; bloco financeiro só com `finance.view`, documentos só com `documents.view` | Indicadores da D4 e contagem de documentos vencendo | — (sem id) | Não | Leitura | — | **O backend omite** os valores para quem não pode ver (testado com deny de `finance.view`); período validado (personalizado até 2 anos) |

### Controles da fase

- **Saldo derivado:** `paid_amount_cents` fora da allowlist de escrita; só `expensesRepository.settle` o altera, com `UPDATE` atômico condicional. O status sai de uma expressão SQL única, e `CHECK`s no banco garantem que status e valores nunca discordam.
- **Append-only:** `expense_payments` com trigger (sem `DELETE`, sem edição, estorno uma vez) e `TRUNCATE` bloqueado.
- **Lançar ≠ pagar:** matriz D10 testada rota a rota para os 5 papéis (`tests/security/permissions-finance.test.js`).
- **Isolamento:** suíte A × B para despesas, pagamentos, prestadores, categorias e referências no corpo (`tests/security/isolation-finance.test.js`).
- **Frontend:** valores digitados viram centavos por manipulação de texto (`lib/money.js`, com testes); nenhum valor financeiro é calculado na tela — totais e "vencida" vêm da API.

### Pendências da F4 (para as próximas fases)

| Item | Fase |
|---|---|
| Exportação CSV do Financeiro (padrão Excel pt-BR, `data.export`, proteção contra fórmula) | F8 |
| Comparação de período no dashboard e alertas | F8 |
| Exportação e anonimização de prestador pessoa física (LGPD) | F10 |
| Contas a receber (`receivables`) e recorrência: fora do MVP (D4) | — |
