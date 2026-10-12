# ZEVS Nexus — API

Base: `/api/v1`. JSON com nomes em `snake_case`. Fora da versão: `GET /health`, `GET /ready`, `GET /api/version`.

## Convenções

- **Sucesso:** `{ "data": …, "meta": … }`.
- **Erro:** `{ "error": { "code", "message", "details", "requestId" } }`. `message` vem em PT-BR, pronta para a tela; `details` lista `{ field, code, message }` nos erros de validação (422).
- **Autenticação:** `Authorization: Bearer <access_token>` (JWT de 15 min). O refresh token vive só no cookie HttpOnly `zn_rt` (`__Secure-zn_rt` em HTTPS), com `Path=/api/v1/auth`.
- **Rotas por cookie** (`/auth/refresh`, `/auth/logout`) exigem o header `X-ZN-CSRF: 1` e um `Origin` permitido.
- **Validação:** todo corpo é `.strict()`; campo desconhecido → 422 (`unrecognized_key`).
- **Rastreio:** toda resposta traz `X-Request-Id`.

| Status | Códigos |
|---|---|
| 400 | `INVALID_JSON` |
| 401 | `AUTH_REQUIRED`, `TOKEN_INVALID`, `TOKEN_EXPIRED`, `SESSION_REVOKED`, `INVALID_CREDENTIALS`, `REFRESH_INVALID`, `REFRESH_REUSED` |
| 403 | `ACCOUNT_DISABLED`, `CSRF_REJECTED` |
| 404 | `ROUTE_NOT_FOUND`, `NOT_FOUND` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 422 | `VALIDATION_ERROR`, `RESET_TOKEN_INVALID`, `VERIFICATION_TOKEN_INVALID`, `CURRENT_PASSWORD_INVALID` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` |

O cliente renova a sessão (`POST /auth/refresh`) ao receber `TOKEN_EXPIRED`, ou antes, quando faltam menos de 30 s para o token expirar.

## Infraestrutura

| Rota | Resposta |
|---|---|
| `GET /health` | `200 { "status": "ok" }`. Não toca no banco; fora do rate limit |
| `GET /ready` | `200 { "status": "ready" }`, ou `503 { "status": "not_ready", "reason": "pending_migrations" \| "database_unavailable" }` |
| `GET /api/version` | `200 { "data": { "version": "<sha do commit>" } }`, `Cache-Control: no-cache` |
| `GET /sw.js` | Service worker (rede primeiro), `Cache-Control: no-store`. Com `SW_KILL_SWITCH=true`, o kill switch |
| `GET /manifest.webmanifest` | Manifest da PWA (`application/manifest+json`), início em `/app` |
| `GET /offline.html` | Página "Sem conexão" (reserva do service worker) |

## Autenticação (`/api/v1/auth`)

| Método e rota | Corpo | Sucesso | Observações |
|---|---|---|---|
| `POST /register` | `{ name, email, password, accept_terms: true }` | `202 { data: { status: "check_email" } }` | Mesma resposta para e-mail novo ou já cadastrado. Senha: 8 caracteres a 72 bytes. Rate limit 10/15 min |
| `POST /login` | `{ email, password }` | `200 { data: { access_token, token_type: "Bearer", expires_in: 900, user } }` + cookie de refresh | 401 `INVALID_CREDENTIALS` genérico; 403 `ACCOUNT_DISABLED` só com a senha certa |
| `POST /refresh` | `{}` (cookie + CSRF) | Igual ao login, com cookie novo | Reuso há até 15 s: devolve só um access token, sem cookie novo. Reuso depois: 401 `REFRESH_REUSED` e a família é revogada |
| `POST /logout` | `{}` (cookie + CSRF) | `204` | Revoga a família e apaga o cookie |
| `POST /logout-all` | `{}` (Bearer) | `204` | Revoga todas as sessões e access tokens já emitidos |
| `POST /password/forgot` | `{ email }` | `202 { data: { status: "check_email" } }` | Resposta igual exista ou não a conta |
| `POST /password/reset` | `{ token, password }` | `200 { data: { status: "password_reset" } }` | Uso único; derruba todas as sessões; 422 `RESET_TOKEN_INVALID` |
| `POST /password/change` | `{ current_password, new_password }` (Bearer) | `200 { data: { access_token, token_type, expires_in } }` | Mantém a sessão atual; derruba as outras; o access token antigo deixa de valer |
| `POST /email/verify` | `{ token }` | `200 { data: { status: "email_verified" } }` | Uso único, 7 dias; 422 `VERIFICATION_TOKEN_INVALID` |
| `POST /email/resend` | `{}` (Bearer) | `202 { data: { status: "check_email" \| "already_verified" } }` | Invalida o link anterior |

`user` = `{ id, name, email, email_verified, created_at }`.

## Conta

| Método e rota | Sucesso |
|---|---|
| `GET /api/v1/me` (Bearer) | `200 { data: { user, platform_admin, companies: [{ id, name, legal_name, status, membership_status, roles }] } }` |

## Empresa (tenant)

Rotas de dados de empresa exigem `Authorization: Bearer …` **e** `X-Company-Id: <uuid>`. O backend confere o vínculo a cada requisição:

| Situação | Resposta |
|---|---|
| Header ausente | `400 COMPANY_REQUIRED` |
| Inválido, inexistente, de outra empresa ou vínculo removido | `404 COMPANY_NOT_FOUND` |
| Empresa em análise | `403 COMPANY_PENDING` |
| Empresa suspensa | `403 COMPANY_SUSPENDED` |
| Vínculo suspenso | `403 MEMBERSHIP_SUSPENDED` |
| Sem a permissão | `403 PERMISSION_DENIED` (`details.permissions`) |
| Feature fora do plano | `403 FEATURE_DISABLED` (`details.feature`) |

| Método e rota | Permissão | Corpo | Sucesso |
|---|---|---|---|
| `POST /api/v1/companies` (onboarding; sem `X-Company-Id`; `Idempotency-Key` obrigatório) | E-mail verificado | `{ legal_name, trade_name?, cnpj?, timezone? }` | `201 { data: { company } }` com `status: "pending"`. `403 EMAIL_NOT_VERIFIED`, `409 PENDING_COMPANY_EXISTS` |
| `GET /api/v1/company/context` | Membro ativo | — | `{ data: { company, membership: { id, roles }, permissions[], features[], branding: { primary_color }, document_folders: { company, receipts, invoices, spreadsheets } } }` (ids das pastas padrão ou `null`) |
| `GET /api/v1/company` | `company.view` | — | `{ data: { company } }` (perfil completo, com `address` e `version`) |
| `PATCH /api/v1/company` | `company.manage` | `{ version, legal_name?, trade_name?, cnpj?, state_registration?, municipal_registration?, tax_regime?, email?, phone?, address?: { cep, street, number, complement, district, city, state } }` | `{ data: { company } }`. `409 VERSION_CONFLICT` (`details.current_version`). Texto vazio limpa o campo |
| `GET /api/v1/company/settings` | `settings.manage` | — | `{ data: { settings: { timezone, primary_color, upcoming_window_days } } }` |
| `PATCH /api/v1/company/settings` | `settings.manage` | `{ timezone?, primary_color? (#RRGGBB), upcoming_window_days? (1–60) }` | `{ data: { settings } }` |
| `GET /api/v1/company/contacts` | `company.view` | — | `{ data: { contacts: [...] } }` |
| `POST /api/v1/company/contacts` | `company.manage` | `{ name, role_title?, email?, phone?, is_responsible?, notes? }` | `201 { data: { contact } }` |
| `PATCH /api/v1/company/contacts/:id` | `company.manage` | Os mesmos campos, opcionais | `{ data: { contact } }`; outro tenant ou excluído → 404 |
| `DELETE /api/v1/company/contacts/:id` | `company.manage` | — | `204` (soft delete) |

**`Idempotency-Key`** (8–128 caracteres `[A-Za-z0-9_-]`):

| Caso | Resposta |
|---|---|
| Mesma chave e mesmo corpo | Devolve a resposta salva, com `Idempotent-Replayed: true` |
| Mesma chave e corpo diferente | `422 IDEMPOTENCY_KEY_REUSED` |
| Ainda em andamento | `409 IDEMPOTENCY_IN_PROGRESS` |

Erros não consomem a chave. A chave vale 24 h.

## Arquivos e Central de Documentos (F3)

Todas exigem `Authorization` + `X-Company-Id`. Leitura: `documents.view`. Escrita: `documents.manage`.

### Envio (3 passos)

1. `POST /files/upload-intents` → URL de PUT pré-assinada (10 min) para a chave de envio.
2. `PUT` direto no storage, com o `Content-Type` devolvido; o `Content-Length` precisa ser o declarado (os dois vão assinados).
3. `POST /documents` (documento novo) ou `POST /documents/:id/versions` (nova versão), com o `file_id`. A API confere tamanho, magic bytes e cota, e copia o arquivo para a chave definitiva.

| Método e rota | Corpo / query | Sucesso e erros |
|---|---|---|
| `POST /files/upload-intents` (200/h por usuário) | `{ filename, size_bytes, content_type? }` | `201 { data: { file: { id, original_name, extension, content_type, size_bytes, status: "pending", expires_at }, upload: { url, method: "PUT", headers: { "Content-Type" }, expires_at } } }`. `422 FILE_TYPE_NOT_ALLOWED`, `FILE_TOO_LARGE` (limite do plano), `STORAGE_QUOTA_EXCEEDED` |
| `POST /documents` (`Idempotency-Key`) | `{ file_id, folder_id?, title?, description?, document_type_id?, expires_on?, tags?: string[], reference_year? }` (até 10 tags de 40 caracteres; `reference_year` 1990–2100 só vale para planilha — ver F6) | `201 { data: { document } }`. Sem título, vale o nome do arquivo. `422 FILE_NOT_FOUND`, `FILE_NOT_UPLOADED` (PUT ainda não terminou; o arquivo continua pendente), `FILE_REJECTED` (tamanho ou conteúdo não confere; `details[0].code`: `size_mismatch`, `signature_mismatch`, `changed_during_check`), `FILE_ALREADY_USED`, `FILE_EXPIRED`, `FOLDER_NOT_FOUND`, `DOCUMENT_TYPE_NOT_FOUND`, `STORAGE_QUOTA_EXCEEDED`. `503 STORAGE_UNAVAILABLE` |
| `POST /documents/:id/versions` (`Idempotency-Key`) | `{ file_id, comment?, reference_year? }` | `201 { data: { document } }`. Mesmos erros de arquivo; `409 DOCUMENT_IN_TRASH` |

### Documentos

| Método e rota | Corpo / query | Sucesso |
|---|---|---|
| `GET /documents` | `?folder=root\|<uuid>&q=&type_id=&tag_id=&favorites=true&archived=true&expiring=true&sort=&page=&limit=` (`sort`: `updated_at`, `created_at`, `title`, `expires_on`, `size`, com `-` para decrescente; padrão `-updated_at`) | `{ data: { documents: [...] }, meta: { page, limit, total } }`. Sem `archived=true`, arquivados ficam de fora; a lixeira nunca aparece aqui. `expiring=true`: vencidos e com validade até 30 dias, no fuso da empresa |
| `GET /documents/:id` | — | `{ data: { document } }` com `path` (pastas da raiz até a do documento) e `versions[]`. Na lixeira, só para `documents.manage` |
| `PATCH /documents/:id` | `{ version, title?, description?, document_type_id?, expires_on?, tags? }` | `{ data: { document } }`. `409 VERSION_CONFLICT`, `409 DOCUMENT_IN_TRASH` |
| `POST /documents/:id/move` | `{ folder_id }` (`null` = raiz) | `{ data: { document } }` |
| `POST /documents/:id/archive` · `/unarchive` | `{}` | `{ data: { document } }` |
| `DELETE /documents/:id` | — | `204` (vai para a lixeira) |
| `POST /documents/:id/versions/:n/restore` | `{}` | `201 { data: { document } }`: cria a versão seguinte com o arquivo da versão `n`. `409 VERSION_IS_CURRENT`, `404 VERSION_NOT_FOUND` |
| `POST /documents/:id/download-url` (600/h por usuário) | `{ version?, disposition?: "attachment" \| "inline" }` | `{ data: { url, disposition, expires_at } }`: URL de GET de 60 s. `inline` só vale para PDF e imagem |
| `PUT`/`DELETE /documents/:id/favorite` | — | `204` |
| `GET /documents/:id/history` | — | `{ data: { events: [{ action, created_at, actor: { name }, details, changed_fields }] } }` (últimos 100) |
| `GET /trash` (`documents.manage`) | `?q=&sort=&page=&limit=` | Mesmo formato de `GET /documents` |
| `POST /trash/:id/restore` (`documents.manage`) | `{}` | `{ data: { document } }`. Se a pasta foi excluída, volta para a raiz |

**Documento:** `{ id, title, description, folder_id, document_type: { id, name } | null, tags[], expires_on, expiry_status: "expired" | "expiring" | "valid" | null, favorite, archived_at, deleted_at, current_version, file: { original_name, extension, content_type, size_bytes, inline }, created_by: { name }, created_at, updated_at, version }`. `expiry_status` é calculado no fuso da empresa (nunca gravado).

### Pastas, tipos e tags

| Método e rota | Corpo / query | Sucesso e erros |
|---|---|---|
| `GET /folders` | — | `{ data: { folders: [{ id, parent_id, name, document_count }] } }` (lista plana; a tela monta a árvore) |
| `GET /folders/:id` | — | `{ data: { folder } }` com `path` |
| `POST /folders` | `{ name, parent_id? }` | `201 { data: { folder } }`. `409 FOLDER_NAME_TAKEN`, `422 FOLDER_TOO_DEEP` (máx. 8 níveis), `422 FOLDER_NOT_FOUND` (pai) |
| `PATCH /folders/:id` | `{ name }` | `{ data: { folder } }` |
| `POST /folders/:id/move` | `{ parent_id }` (`null` = raiz) | `{ data: { folder } }`. `422 FOLDER_CYCLE`, `FOLDER_TOO_DEEP` |
| `DELETE /folders/:id` | — | `204`. `409 FOLDER_NOT_EMPTY` (`details: { folders, documents }`); pasta padrão excluída volta a configuração para a raiz |
| `GET /document-types` | `?include_archived=true` | `{ data: { document_types: [{ id, name, archived_at, document_count }] } }` |
| `POST /document-types` · `PATCH /document-types/:id` | `{ name }` | `201`/`200 { data: { document_type } }`. `409 DOCUMENT_TYPE_NAME_TAKEN` |
| `POST /document-types/:id/archive` | `{}` | `{ data: { document_type } }` |
| `GET /tags` | `?q=&limit=` (máx. 50) | `{ data: { tags: [{ id, name, document_count, expense_count }] } }`. Tags são criadas ao marcar um documento ou uma despesa |

### `/dev-storage/*` (só desenvolvimento e testes)

Com `STORAGE_PROVIDER=local` ou `memory`, as "URLs assinadas" apontam para a própria API: `PUT /dev-storage/upload/<token>` e `GET /dev-storage/download/<token>`. O token (HMAC) carrega a chave, a validade, o tipo e o tamanho. Tipo ou tamanho diferente → `403 SIGNATURE_MISMATCH`; token inválido ou vencido → `403 SIGNATURE_INVALID`. Essas rotas não existem com `r2`.

## Prestadores e Financeiro (F4)

Valores sempre em **centavos inteiros** (`amount_cents`); datas `AAAA-MM-DD` (calendário, no fuso da empresa). Permissões: prestadores `parties.view`/`parties.manage`; despesas `finance.view`/`finance.manage`; pagamento e estorno `finance.pay`.

### Prestadores e fornecedores (`/parties`)

| Método e rota | Corpo / query | Sucesso e erros |
|---|---|---|
| `GET /parties` | `?q=&role=supplier\|service_provider\|customer&person_type=&sort=name\|-name\|created_at\|-created_at&page=&limit=` | `{ data: { parties }, meta: { page, limit, total } }`. A busca casa nome, nome fantasia, especialidade, e-mail, CPF/CNPJ e telefone |
| `POST /parties` | `{ person_type: "individual"\|"company", name, trade_name?, document?, roles[], specialty?, email?, phone?, pix_key?, notes? }` | `201 { data: { party } }`. `422` CPF/CNPJ inválido (CPF para pessoa física, CNPJ — inclusive alfanumérico — para jurídica); `409 PARTY_DOCUMENT_TAKEN` |
| `GET /parties/:id` | — | `{ data: { party } }`; com `finance.view`, `party.finance = { expense_count, open_cents, overdue_cents, paid_cents }` |
| `PATCH /parties/:id` | `{ version, ...campos }` | `{ data: { party } }`. `409 VERSION_CONFLICT`; trocar o tipo de pessoa exige documento compatível (422) |
| `DELETE /parties/:id` | — | `204` (soft delete; despesas antigas mantêm o nome) |
| `GET /parties/:id/expenses` (`finance.view`) | mesma query de `GET /expenses` | Despesas do prestador |
| `GET /parties/:id/documents` (`documents.view`) | — | `{ data: { documents: [{ id, title, extension, size_bytes, expires_on, linked_at }] } }` |
| `POST /parties/:id/documents` (`Idempotency-Key`) | `{ file_id }` (arquivo novo, vira documento na pasta padrão de prestadores) **ou** `{ document_id }` (já na Central) | `201 { data: { documents } }` |
| `DELETE /parties/:id/documents/:documentId` | — | `204` (o documento continua na Central) |

**Prestador:** `{ id, person_type, name, trade_name, document, roles[], specialty, email, phone, pix_key, notes, version, created_at, updated_at }` (documento e telefone sem máscara).

### Despesas (`/expenses`) e pagamentos

| Método e rota | Corpo / query | Sucesso e erros |
|---|---|---|
| `GET /expenses` | `?tab=open\|overdue\|upcoming\|paid\|cancelled\|all&q=&party_id=&category_id=&tag_id=&due_from=&due_to=&sort=&page=&limit=` (`sort`: `due_date`, `amount`, `description`, `created_at`, com `-` para decrescente) | `{ data: { expenses }, meta: { page, limit, total, totals: { amount_cents, paid_cents, open_cents }, today, upcoming_window_days } }`. Os totais são de todo o filtro |
| `POST /expenses` (`finance.manage`, `Idempotency-Key`) | `{ description, amount_cents, due_date, party_id?, category_id?, scheduled_for?, notes?, tags? }` | `201 { data: { expense } }` (detalhe). `422 PARTY_NOT_FOUND`, `CATEGORY_NOT_FOUND` |
| `POST /expenses` com `payment` — **"Já paguei"** (exige também `finance.pay`) | `… , payment: { paid_on, method, amount_cents?, reference?, notes?, receipt_file_id? }` (sem `due_date`, vale `paid_on`; sem `amount_cents`, o valor da despesa) | `201` com a despesa paga e o comprovante vinculado. `403 PERMISSION_DENIED` (`details.permissions: ["finance.pay"]`) sem pagar nada |
| `GET /expenses/:id` | — | `{ data: { expense } }` com `payments[]` e `documents[]` |
| `PATCH /expenses/:id` (`finance.manage`) | `{ version, description?, amount_cents?, due_date?, party_id?, category_id?, scheduled_for?, notes?, tags? }` | `{ data: { expense } }`. `409 VERSION_CONFLICT`, `409 EXPENSE_CANCELLED`, `422 AMOUNT_BELOW_PAID` |
| `POST /expenses/:id/cancel` (`finance.manage`) | `{ reason }` | `{ data: { expense } }`. `409 EXPENSE_HAS_PAYMENTS` (estorne antes), `409 EXPENSE_CANCELLED` |
| `POST /expenses/:id/payments` (`finance.pay`, `Idempotency-Key`) | `{ paid_on, amount_cents, method: pix\|transfer\|boleto\|cash\|card\|check\|other, reference?, notes?, receipt_file_id? }` | `201 { data: { expense } }`. `422 PAYMENT_EXCEEDS_BALANCE` (`details[0].remaining_cents`), `422 PAYMENT_DATE_IN_FUTURE`, `409 EXPENSE_CANCELLED` |
| `POST /expense-payments/:id/void` (`finance.pay`) | `{ reason }` | `{ data: { expense } }`. `409 PAYMENT_ALREADY_VOIDED` |
| `POST /expenses/:id/documents` (`finance.manage`, `Idempotency-Key`) | `{ file_id \| document_id, role: boleto\|invoice\|contract\|receipt\|other }` | `201 { data: { expense } }` |
| `DELETE /expenses/:id/documents/:documentId` | — | `{ data: { expense } }` (o documento continua na Central) |
| `GET /expenses/:id/history` (`finance.view`) | — | `{ data: { events: [{ action, created_at, actor: { name }, details, changed_fields }] } }` |

**Despesa:** `{ id, description, party: { id, name } | null, category: { id, name } | null, amount_cents, paid_amount_cents, open_amount_cents, due_date, scheduled_for, status: pending|scheduled|partially_paid|paid|cancelled, overdue, tags[], has_receipt, notes, cancelled_at, cancel_reason, version, created_at, updated_at }`. `overdue` é calculado no fuso da empresa (nunca gravado).

### Categorias (`/finance-categories`)

| Método e rota | Corpo / query | Sucesso |
|---|---|---|
| `GET /finance-categories` (`finance.view`) | `?kind=expense\|income&include_archived=true` | `{ data: { categories: [{ id, kind, name, sort_order, archived_at, expense_count }] } }` |
| `POST /finance-categories` (`finance.manage`) | `{ name, kind? (expense), sort_order? }` | `201 { data: { category } }`. `409 CATEGORY_NAME_TAKEN` |
| `PATCH /finance-categories/:id` | `{ name?, sort_order? }` | `{ data: { category } }` |
| `POST /finance-categories/:id/archive` | `{}` | `{ data: { category } }` (não recebe despesas novas) |

### Dashboard (`GET /dashboard`)

`dashboard.view`. Query `?period=today|yesterday|7d|30d|this_month|last_month|this_year|custom&from=&to=` (padrão `this_month`; personalizado com início ≤ fim e até 2 anos).

```json
{ "data": {
  "period": { "key": "this_month", "from": "2026-10-01", "to": "2026-10-31" }, "today": "2026-10-11",
  "finance": {
    "overdue": { "count": 1, "open_cents": 600 },
    "due_soon": { "count": 1, "open_cents": 2000, "days": 7 },
    "paid_in_period": { "count": 1, "amount_cents": 400 },
    "expenses_in_period": { "count": 3, "amount_cents": 7000 }
  },
  "documents": { "expired_count": 0, "expiring_count": 0, "expiring_days": 30 }
} }
```

`finance` só para quem tem `finance.view`; `documents` só com `documents.view`. Definições (FASE-0, D4): **a pagar vencido** = saldo em aberto das despesas não quitadas com vencimento antes de hoje; **vence em 7 dias** = o mesmo, de hoje a hoje + 7; **pago no período** = soma dos pagamentos não estornados com data no período (caixa); **despesas do período** = soma das despesas não canceladas com vencimento no período.

## Planilhas (F6)

Todas exigem `Authorization` + `X-Company-Id`. Leitura: `spreadsheets.view`. Escrita: `spreadsheets.manage`. A planilha é um documento: envio, versões, download, mover e lixeira continuam nas rotas de documentos (o `id` é o do documento).

**Registro automático:** todo documento cuja versão enviada é `.xlsx`, `.xls`, `.csv` ou `.ods` ganha a ficha de planilha (`in_use: false`, `reference_year` = o enviado no `POST /documents` ou na nova versão — a tela manda o ano da data de modificação do arquivo — ou o ano corrente no fuso da empresa). Uma nova versão não muda a ficha já existente.

| Método e rota | Corpo / query | Sucesso e erros |
|---|---|---|
| `GET /spreadsheets` | `?view=in_use\|this_year\|older\|archived\|all&q=&year=&sort=&page=&limit=` (padrão `view=in_use`, `sort=-updated_at`; `sort`: `updated_at`, `title`, `reference_year`, com `-` para decrescente) | `{ data: { spreadsheets: [...] }, meta: { page, limit, total, current_year, years: [2026, 2019] } }`. Visões: **em uso** = marcadas e não arquivadas; **deste ano** / **antigas** = ano de referência igual / anterior ao ano corrente (fuso da empresa), não arquivadas; **arquivadas**; **todas**. A lixeira nunca aparece |
| `GET /spreadsheets/:id` | — | `{ data: { spreadsheet } }`. `404 SPREADSHEET_NOT_FOUND` (inclusive na lixeira ou de outra empresa) |
| `PATCH /spreadsheets/:id` | `{ in_use?, reference_year? }` (pelo menos um) | `{ data: { spreadsheet } }` |
| `POST /spreadsheets/bulk` | `{ ids: uuid[] (1–100), action: "mark_in_use" \| "unmark_in_use" \| "set_year" \| "archive" \| "unarchive", reference_year? }` (`set_year` exige o ano) | `{ data: { updated, not_found: [ids] } }`: o que não existir na empresa (ou estiver na lixeira) volta em `not_found` sem derrubar o resto |
| `GET /spreadsheets/:id/preview` (600/h por usuário) | `?sheet=0..99&page=1..2000&version=` (padrão: 1ª aba, página 1, versão atual) | `{ data: { version_number, extension, sheets: [{ index, name, hidden }], sheet: { index, name, total_rows, columns, page, page_size: 50, rows: [{ number, cells: string[] }], truncated_rows, truncated_columns }, csv?: { encoding, delimiter } } }`. `404 SHEET_NOT_FOUND`, `404 VERSION_NOT_FOUND`; `422 PREVIEW_NOT_SUPPORTED` (`.xls`), `SPREADSHEET_TOO_LARGE` (> 10 MB ou além de um teto de leitura), `SPREADSHEET_UNREADABLE` (corrompido, protegido por senha ou com `DOCTYPE`); `503 STORAGE_UNAVAILABLE` |

**Planilha:** `{ id, title, folder_id, in_use, reference_year, archived_at, current_version, file: { original_name, extension, size_bytes, previewable }, created_at, updated_at }`. `previewable` = não é `.xls` e tem até 10 MB.

**Prévia:** somente leitura e só texto. Cada célula traz o texto formatado em pt-BR (datas `dd/mm/aaaa`, `R$`, `%`, `VERDADEIRO/FALSO`); fórmula traz o último valor salvo no arquivo (nunca é calculada). Linhas e colunas vazias no fim não contam; `rows` traz as linhas vazias do meio. Tetos: 100 abas, 100 mil linhas varridas (`truncated_rows`), 200 colunas (`truncated_columns`), 1.000 caracteres por célula (corte com `…`) e 5 s de leitura. A abertura (sem `sheet` e na página 1) grava `document.previewed`.

## Notas fiscais (F7)

Todas exigem `Authorization` + `X-Company-Id`. Leitura: `invoices.view`. Escrita: `invoices.manage`. Só notas **emitidas** pela empresa (D7.3). Tipos: `nfse` (padrão), `nfe`, `other`.

| Método e rota | Corpo / query | Sucesso e erros |
|---|---|---|
| `GET /invoices` | `?tab=pending\|processing\|paid\|issued\|cancelled\|archived\|all&q=&party_id=&kind=&issued_from=&issued_to=&sort=&page=&limit=` (padrão `tab=pending`; `sort`: `issue_date`, `due_date`, `net_amount`, `number`, `created_at`, com `-` para decrescente) | `{ data: { invoices: [...] }, meta: { page, limit, total, totals: { gross_cents, withheld_cents, net_cents }, today } }`. Abas: **pendentes** = emitida e não paga; **pagas** = recebimento registrado (finalizadas); **emitidas** = pendentes + pagas. Só **arquivadas** e **todas** mostram as arquivadas |
| `POST /invoices` (`Idempotency-Key`) | `{ kind?, number?, series?, issue_date?, competence?: "AAAA-MM", party_id?, description, gross_amount_cents, withheld_cents?, due_date?, verification_code?, notes?, issue?: boolean }` | `201 { data: { invoice } }` em processamento; com `issue: true`, já emitida (exige número e data: `422 INVOICE_NUMBER_REQUIRED` / `INVOICE_DATE_REQUIRED`). `422 WITHHELD_ABOVE_GROSS`, `PARTY_NOT_FOUND`; `409 INVOICE_NUMBER_TAKEN` (mesmo tipo, série e número; a cancelada continua ocupando o número) |
| `GET /invoices/:id` | — | `{ data: { invoice } }` com `documents[]`. `404 INVOICE_NOT_FOUND` |
| `PATCH /invoices/:id` | `{ version, ...campos do POST (sem issue) }` | `{ data: { invoice } }`. `409 VERSION_CONFLICT`, `409 INVOICE_CANCELLED`; nota emitida não perde número nem data (`422`) |
| `GET /invoices/:id/history` | — | `{ data: { events: [{ action, created_at, actor: { name }, details, changed_fields }] } }` |
| `POST /invoices/:id/issue` | `{ number?, series?, issue_date? }` (vale o que já está na nota) | `{ data: { invoice } }`. `409 INVOICE_ALREADY_ISSUED`, `INVOICE_CANCELLED`; `422` sem número ou data |
| `POST /invoices/:id/cancel` | `{ reason }` | `{ data: { invoice } }`. `409 INVOICE_PAID` (desfaça o recebimento antes), `INVOICE_CANCELLED` |
| `POST /invoices/:id/mark-paid` | `{ received_on, received_amount_cents? }` (padrão: o líquido) | `{ data: { invoice } }`. `409 INVOICE_NOT_ISSUED`, `INVOICE_ALREADY_PAID`, `INVOICE_CANCELLED`; `422 RECEIPT_DATE_IN_FUTURE` |
| `POST /invoices/:id/unmark-paid` | `{ reason }` | `{ data: { invoice } }` com `payment_undone_at` e `payment_undo_reason`. `409 INVOICE_NOT_PAID` |
| `POST /invoices/:id/archive` · `/unarchive` | `{}` | `{ data: { invoice } }` (não muda o ciclo nem o recebimento) |
| `POST /invoices/:id/documents` (`Idempotency-Key`) | `{ file_id \| document_id, role?: "pdf" \| "xml" \| "receipt" \| "other" }` | `201 { data: { invoice } }`. Arquivo novo vira documento na pasta "Notas fiscais". `422 DOCUMENT_NOT_FOUND` e os erros de arquivo da F3 |
| `DELETE /invoices/:id/documents/:documentId` | — | `{ data: { invoice } }` (o documento continua na Central). `404 DOCUMENT_NOT_FOUND` |

**Nota:** `{ id, kind, number, series, issue_date, competence: "AAAA-MM" | null, party: { id, name } | null, description, gross_amount_cents, withheld_cents, net_amount_cents, due_date, verification_code, notes, status: "processing" | "issued" | "cancelled", payment_status: "pending" | "paid", finalized, overdue, received_on, received_amount_cents, cancelled_at, cancel_reason, payment_undone_at, payment_undo_reason, archived_at, has_pdf, version, created_at, updated_at }`. `finalized` = emitida e paga; `overdue` = emitida, pendente, não arquivada e com vencimento antes de hoje (fuso da empresa). Os dois são calculados, nunca gravados.

## Painel ZEVS (`/api/v1/admin`)

Exige ser Platform Admin; dono de empresa recebe `403 PLATFORM_ADMIN_REQUIRED`.

| Método e rota | Corpo / query | Sucesso |
|---|---|---|
| `GET /admin/companies` | `?status=pending\|active\|suspended&q=&page=&limit=` (máx. 100) | `{ data: { companies: [{ …, owner: { name, email, email_verified }, members }] }, meta: { page, limit, total } }` |
| `POST /admin/companies/:id/approve` | `{}` | `{ data: { company } }` (só `pending`; e-mail ao dono) |
| `POST /admin/companies/:id/suspend` | `{ reason }` | `{ data: { company } }` (de `pending` ou `active`) |
| `POST /admin/companies/:id/reactivate` | `{}` | `{ data: { company } }` (só `suspended`) |

Transição inválida → `409 INVALID_COMPANY_STATUS`.
