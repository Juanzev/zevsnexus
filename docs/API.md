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
| `GET /api/v1/company/settings` | `settings.manage` | — | `{ data: { settings: { timezone, primary_color } } }` |
| `PATCH /api/v1/company/settings` | `settings.manage` | `{ timezone?, primary_color? }` (`#RRGGBB`) | `{ data: { settings } }` |
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
| `POST /documents` (`Idempotency-Key`) | `{ file_id, folder_id?, title?, description?, document_type_id?, expires_on?, tags?: string[] }` (até 10 tags de 40 caracteres) | `201 { data: { document } }`. Sem título, vale o nome do arquivo. `422 FILE_NOT_FOUND`, `FILE_NOT_UPLOADED` (PUT ainda não terminou; o arquivo continua pendente), `FILE_REJECTED` (tamanho ou conteúdo não confere; `details[0].code`: `size_mismatch`, `signature_mismatch`, `changed_during_check`), `FILE_ALREADY_USED`, `FILE_EXPIRED`, `FOLDER_NOT_FOUND`, `DOCUMENT_TYPE_NOT_FOUND`, `STORAGE_QUOTA_EXCEEDED`. `503 STORAGE_UNAVAILABLE` |
| `POST /documents/:id/versions` (`Idempotency-Key`) | `{ file_id, comment? }` | `201 { data: { document } }`. Mesmos erros de arquivo; `409 DOCUMENT_IN_TRASH` |

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
| `GET /tags` | `?q=&limit=` (máx. 50) | `{ data: { tags: [{ id, name, document_count }] } }`. Tags são criadas ao marcar um documento |

### `/dev-storage/*` (só desenvolvimento e testes)

Com `STORAGE_PROVIDER=local` ou `memory`, as "URLs assinadas" apontam para a própria API: `PUT /dev-storage/upload/<token>` e `GET /dev-storage/download/<token>`. O token (HMAC) carrega a chave, a validade, o tipo e o tamanho. Tipo ou tamanho diferente → `403 SIGNATURE_MISMATCH`; token inválido ou vencido → `403 SIGNATURE_INVALID`. Essas rotas não existem com `r2`.

## Painel ZEVS (`/api/v1/admin`)

Exige ser Platform Admin; dono de empresa recebe `403 PLATFORM_ADMIN_REQUIRED`.

| Método e rota | Corpo / query | Sucesso |
|---|---|---|
| `GET /admin/companies` | `?status=pending\|active\|suspended&q=&page=&limit=` (máx. 100) | `{ data: { companies: [{ …, owner: { name, email, email_verified }, members }] }, meta: { page, limit, total } }` |
| `POST /admin/companies/:id/approve` | `{}` | `{ data: { company } }` (só `pending`; e-mail ao dono) |
| `POST /admin/companies/:id/suspend` | `{ reason }` | `{ data: { company } }` (de `pending` ou `active`) |
| `POST /admin/companies/:id/reactivate` | `{}` | `{ data: { company } }` (só `suspended`) |

Transição inválida → `409 INVALID_COMPANY_STATUS`.
