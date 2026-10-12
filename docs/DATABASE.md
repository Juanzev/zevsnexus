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
| `0009_documents` | `files`, `folders`, `document_types`, `documents`, `document_versions`, `tags`, `document_tags`, `document_favorites`, `company_settings` (com linha criada para as empresas existentes) |
| `0010_parties` | `parties`, `party_documents`; `company_settings.parties_folder_id` |
| `0011_finance` | `finance_categories` (com as sugeridas para empresas existentes), `expenses`, `expense_payments` (trigger append-only), `expense_documents`, `expense_tags`; `company_settings.upcoming_window_days` |
| `0012_spreadsheets` | `spreadsheets` (extensão 1:1 de `documents`: em uso e ano de referência), com a ficha criada para as planilhas já enviadas |
| `0013_invoices` | `invoices` (ciclo, recebimento e arquivamento separados; líquido gerado; número único) e `invoice_documents` |

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
- **Ainda não criada** (entra com o módulo que a usa): `invitations` (F10).

## Tabelas da F3 (destaques)

Toda relação interna usa FK composta `(company_id, x_id)`; nenhuma associação polimórfica.

- **`files`** — o binário no storage:
  - `storage_key` único, com `CHECK` do formato `companies/<uuid>/files/<uuid>` (gerado pelo servidor; sem nome nem extensão);
  - `status` `pending` → `ready` | `rejected`; `expires_at` (24 h para confirmar); `uploaded_by`;
  - `upload_purged_at`: quando o job apagou a chave de envio (`…/uploads/<uuid>`) depois que a URL de PUT expirou;
  - índices parciais para o job: pendentes por vencimento e confirmados com chave de envio ainda não apagada.
- **`folders`** — árvore por lista de adjacência (`parent_id` com FK composta na própria tabela):
  - nome de 1–80 caracteres, sem `/` nem `\`; único entre irmãs sem diferenciar maiúsculas (índice sobre `COALESCE(parent_id, uuid zero), lower(name)` entre não excluídas);
  - profundidade (8) e ciclo checados no service, sob trava por empresa; soft delete.
- **`document_types`** — nome único entre os não arquivados (`lower(name)`); arquivado, nunca apagado.
- **`documents`** — o arquivo lógico:
  - `folder_id` e `document_type_id` com FK composta; `expires_on` (`date`, D5.3); `archived_at`; `deleted_at` (lixeira); `version` (concorrência otimista);
  - `search_text` **gerada** (`f_unaccent(lower(título + descrição))`) com índice trigram GIN;
  - índices por pasta + atualização, por atualização e por validade (só não excluídos).
- **`document_versions`** — `UNIQUE (company_id, document_id, version_number)`; a versão atual é a de maior número; restaurar cria uma versão nova com o `file_id` antigo.
- **`tags`** (nome único por empresa, `lower(name)`), **`document_tags`** e **`document_favorites`** (por membership) — tabelas de vínculo com FK composta e `ON DELETE CASCADE`.
- **`company_settings`** — uma linha por empresa, com as pastas padrão (`company_folder_id`, `receipts_folder_id`, `invoices_folder_id`, `spreadsheets_folder_id`). Excluir uma pasta padrão volta a coluna para `null` (raiz).
- **Cota:** `company_usage.storage_bytes` e `file_count` sobem só em `filesRepository.consumeStorage` — um `UPDATE … WHERE storage_bytes + $n <= storage_quota_bytes` do plano. A lixeira não devolve cota (exclusão definitiva na F10).

## Ambientes locais

O cluster é próprio do projeto, na porta **5434**, só localhost e sem senha (`npm run db:local -- setup`):

| Banco | Uso |
|---|---|
| `zevs_nexus_dev` | Desenvolvimento (`backend/.env`) |
| `zevs_nexus_test` | Jest. O schema é recriado do zero a cada execução |
| `zevs_nexus_e2e_test` | Playwright. O schema é recriado a cada execução |

O cluster usa o provider de collation `builtin` (`C.UTF-8`, PostgreSQL 17+): `lower()` e `upper()` tratam acentos sem depender do locale do sistema.

## Tabelas da F4 (destaques)

- **`parties`** — `person_type` (`individual`/`company`); `document_normalized` com `CHECK` do formato por tipo (CPF 11 dígitos; CNPJ 14, alfanumérico) e único por empresa entre ativos; `roles text[]` não vazio e contido na lista; `search_text` gerada (nome + nome fantasia + especialidade) com trigram; `version`; soft delete.
- **`party_documents`** — vínculo prestador × documento (FK composta, `ON DELETE CASCADE`).
- **`finance_categories`** — `kind` (`expense`/`income`), `sort_order`, `archived_at`; nome único por empresa e tipo entre ativas.
- **`expenses`**:
  - `amount_cents bigint` (1 a 99.999.999.999.999); `paid_amount_cents` só pela função única (`settle`);
  - `CHECK`s que amarram status e valores: `paid` ⇔ pago = valor; `partially_paid` ⇔ 0 < pago < valor; `pending`/`scheduled` ⇔ nada pago; `scheduled` exige `scheduled_for`; `cancelled` exige motivo, autor e nada pago;
  - `party_id` e `category_id` com FK composta; `search_text` gerada (descrição + observações);
  - índices `(company_id, status, due_date)`, `(company_id, due_date)`, `(company_id, party_id, due_date)`, `(company_id, category_id)`, GIN da busca.
- **`expense_payments`** — `amount_cents > 0`, `method` na lista, `paid_on date`; estorno em `voided_at`/`voided_by`/`void_reason` (todos ou nenhum). Trigger `expense_payments_guard`: sem `DELETE`, sem edição, estorno uma vez; `TRUNCATE` bloqueado. `UNIQUE (company_id, expense_id, id)` para o vínculo do comprovante.
- **`expense_documents`** — vínculo despesa × documento com `role` e, no comprovante, `payment_id` (FK composta que garante pagamento da mesma despesa).
- **`expense_tags`** — tags da empresa em despesas (D11).

## Tabelas da F6 (destaques)

- **`spreadsheets`** — extensão 1:1 de `documents` (ARCHITECTURE §13.1.1): PK `(company_id, document_id)` e FK composta para `documents (company_id, id)` com `ON DELETE CASCADE` (a planilha nunca sobrevive ao documento). `in_use boolean`, `reference_year smallint` com `CHECK` 1990–2100, `updated_by`, `set_updated_at`. Índice `(company_id, in_use, reference_year)` para as visões. Arquivar e lixeira continuam em `documents` (`archived_at`, `deleted_at`): não há estado duplicado.
- **Backfill da 0012:** documentos (inclusive arquivados e na lixeira) cuja versão atual é `.xlsx`, `.xls`, `.csv` ou `.ods` ganham a ficha com o ano de criação do documento no fuso da empresa (limitado a 1990–2100). O `down` só remove a tabela: os documentos não mudam.

## Tabelas da F7 (destaques)

- **`invoices`** — só `direction = 'issued'` é usado no MVP (`received` reservado). `kind` (`nfse`, `nfe`, `other`); `number` e `series` em texto; `competence` é um `date` sempre no dia 1; `party_id` (tomador) com FK composta; `net_amount_cents` **gerado** (bruto − retenções); `search_text` gerado (número, descrição e observações) com trigram; `version`.
  - `CHECK`s: retenções entre 0 e o bruto; emitida ⇒ número e data; cancelada ⇔ `cancelled_at`, com motivo e autor; paga ⇔ `received_on` e `received_amount_cents`; **paga ⇒ emitida**; "desfazer recebimento" com data, autor e motivo juntos.
  - Índices: número único `(company_id, kind, COALESCE(series, ''), number)` só nas emitidas pela empresa e com número (a cancelada continua ocupando); `(company_id, status, payment_status, issue_date DESC)` para as abas; tomador; vencimento das pendentes; GIN da busca.
- **`invoice_documents`** — vínculo nota × documento com `role` (`pdf`, `xml`, `receipt`, `other`), FKs compostas e índice por documento.
