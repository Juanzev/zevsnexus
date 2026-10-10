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

## Ambientes locais

O cluster é próprio do projeto, na porta **5434**, só localhost e sem senha (`npm run db:local -- setup`):

| Banco | Uso |
|---|---|
| `zevs_nexus_dev` | Desenvolvimento (`backend/.env`) |
| `zevs_nexus_test` | Jest. O schema é recriado do zero a cada execução |
| `zevs_nexus_e2e_test` | Playwright. O schema é recriado a cada execução |

O cluster usa o provider de collation `builtin` (`C.UTF-8`, PostgreSQL 17+): `lower()` e `upper()` tratam acentos sem depender do locale do sistema.
