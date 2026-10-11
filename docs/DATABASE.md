# ZEVS Nexus — Banco de dados

PostgreSQL 16+ (CI em 17, local em 18), `pg` sem ORM e migrations com node-pg-migrate 9. As convenções completas e o modelo conceitual estão em [`ARCHITECTURE.md`](ARCHITECTURE.md) §9.

## Regras

- **Migrations:** `backend/migrations/NNNN_nome.js`, cada uma com `up` e `down`. Migration aplicada nunca é editada: cria-se outra.
- **CI:** prova `up → down → up` do zero.
- **Produção:** só roda `up` (no `preDeployCommand`). `down` e `redo` são bloqueados pelo script quando `NODE_ENV=production`.
- **Comandos:** `npm run migrate`, `npm run migrate:down [-- n|all]`, `npm run migrate:redo`, `npm run migrate:status` (em `backend/`).

## Migrations aplicadas

| Migration | Conteúdo |
|---|---|
| `0001_extensions` | `pgcrypto`, `citext`, `pg_trgm`, `unaccent`; função `f_unaccent(text)` IMMUTABLE; triggers genéricos `set_updated_at()` e `prevent_mutation()` |
| `0002_users_auth` | `users`, `refresh_tokens`, `password_reset_tokens`, `email_verification_tokens` |
| `0003_companies` | `companies` (tenant; `version`, status `pending`/`active`/`suspended`), `company_branding`, `company_contacts`, `company_usage` |
| `0004_memberships` | `memberships` (vínculo usuário × empresa; único ativo por par) |
| `0005_rbac` | `permissions`, `roles`, `role_permissions`, `membership_roles` e `membership_permissions` (grant/deny), com FK composta `(company_id, membership_id)` |
| `0006_audit` | `audit_logs` (append-only: trigger bloqueia `UPDATE`, `DELETE` e `TRUNCATE`) |
| `0007_platform` | `platform_admins`, `features`, `plans` (um único padrão), `plan_features`, `subscriptions` (uma por empresa), `company_features` (override) |
| `0008_idempotency` | `idempotency_keys` (24 h; único por usuário + escopo + chave) |

**Seed do catálogo** (`npm run seed`, idempotente, roda em todo deploy): permissões, papéis com a matriz D10, features e planos, a partir de `src/modules/rbac/rbac.catalog.js` e `src/modules/plans/plans.catalog.js`. Nunca apaga permissão nem feature; sincroniza papel × permissão e plano × feature.

## Tabelas (F1)

### `users` — identidade global (sem `company_id`)

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` |
| `email` | citext | 3–254; único entre não excluídos (índice parcial) |
| `name` | text | 1–120 |
| `password_hash` | text | bcrypt |
| `status` | text | `active` \| `disabled` |
| `email_verified_at` | timestamptz | nulo até confirmar |
| `terms_accepted_at` | timestamptz | obrigatório (aceite no cadastro) |
| `password_changed_at` | timestamptz | |
| `sessions_revoked_at` | timestamptz | access tokens emitidos antes deste instante são recusados |
| `last_login_at` | timestamptz | |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | `updated_at` pelo trigger |

### `refresh_tokens`

- **Colunas:** `token_hash` (SHA-256 hex, único), `family_id`, `expires_at` (7 dias deslizantes), `family_expires_at` (teto de 30 dias), `replaced_by_id` / `rotated_at` (rotação), `revoked_at` / `revoked_reason`, `ip`, `user_agent` (≤ 255).
- **Restrição:** `CHECK (expires_at <= family_expires_at)`.
- **Índices:** usuário com tokens ativos, família, expiração.

### `password_reset_tokens` e `email_verification_tokens`

- **Colunas:** `token_hash` único; `expires_at` (1 h para reset, 7 dias para verificação); `used_at`; `invalidated_at` (só o mais recente vale).
- **Verificação:** guarda também o `email` confirmado. Se a conta mudar de e-mail, o token deixa de valer.

## Tabelas da F2 (destaques)

- **`companies`:**
  - `cnpj` normalizado (14 caracteres, alfanumérico), **sem unicidade na plataforma** (evita enumeração entre tenants);
  - `timezone` IANA; endereço em colunas `address_*`; `version` para concorrência otimista;
  - `approved_at`/`approved_by` e `suspended_at`/`suspended_reason` preenchidos pelo Painel ZEVS.
- **`company_branding`:** `primary_color` com `CHECK (~ '^#[0-9a-f]{6}$')`.
- **`company_contacts`:** `UNIQUE (company_id, id)`; soft delete. Nome, e-mail, telefone e observações são dados pessoais.
- **`company_usage`:** `storage_bytes`/`file_count` com `CHECK >= 0`; só muda pela função única (F3).
- **`audit_logs`:**
  - `company_id` nulo em eventos de conta;
  - `actor_type` = `user` | `platform_admin` | `system`;
  - `actor_user_id` nulo quando quem age é anônimo (ex.: login com senha errada);
  - índices por empresa + data, por entidade e por entidade + ação (teto de e-mails).
- **Ainda não criadas** (entram com o módulo que as usa): `company_settings` (F3) e `invitations` (F10).

## Ambientes locais

O cluster é próprio do projeto, na porta **5434**, só localhost e sem senha (`npm run db:local -- setup`):

| Banco | Uso |
|---|---|
| `zevs_nexus_dev` | Desenvolvimento (`backend/.env`) |
| `zevs_nexus_test` | Jest. O schema é recriado do zero a cada execução |
| `zevs_nexus_e2e_test` | Playwright. O schema é recriado a cada execução |

O cluster usa o provider de collation `builtin` (`C.UTF-8`, PostgreSQL 17+): `lower()` e `upper()` tratam acentos sem depender do locale do sistema.
