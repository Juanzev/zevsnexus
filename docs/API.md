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
| `GET /api/v1/me` (Bearer) | `200 { data: { user } }` |

Na F2, `/me` passa a trazer também as empresas, as permissões e as features da empresa atual.
