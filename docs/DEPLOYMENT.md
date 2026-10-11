# ZEVS Nexus — Ambiente, CI e deploy

## Ambiente local

Pré-requisitos: Node.js ≥ 20.11 (produção em 24 LTS) e PostgreSQL 17+ instalado (só os binários: o projeto sobe o próprio cluster).

```bash
# 1. Banco local do projeto (porta 5434, só localhost): cria o cluster e os 3 bancos
cd backend
npm ci
npm run db:local -- setup

# 2. Configuração: copie o exemplo e gere um JWT_SECRET
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"

# 3. Migrations e servidor (API + SPA em http://localhost:3000)
npm run migrate
npm run dev

# 4. Frontend (em outro terminal): CSS, sprite de ícones e checagem de imports
cd ../frontend
npm ci
npm run build          # ou npm run watch:css durante o desenvolvimento
```

- **Banco local:** `npm run db:local -- start | stop | status`.
- **E-mails:** em desenvolvimento ficam em modo log e são gravados em `.outbox/` (um JSON por mensagem, com os links). Para enviar de verdade: `EMAIL_PROVIDER=resend` + `RESEND_API_KEY`.
- **Arquivos:** em desenvolvimento ficam em disco, em `.storage/` (`STORAGE_PROVIDER=local`, fora do git); as "URLs assinadas" apontam para `/dev-storage/*` na própria API. Nos testes, `memory`. Para testar contra um bucket R2 de desenvolvimento: `STORAGE_PROVIDER=r2` + as variáveis `R2_*` (nunca o bucket de produção).

> **Windows:** o script inicia o PostgreSQL destacado do terminal. Se o console que iniciou o servidor fechar, os novos processos do Postgres morrem com `0xC0000142`. Se isso acontecer: `npm run db:local -- stop` e depois `start`.

## Testes

| Onde | Comando | O que roda |
|---|---|---|
| `backend/` | `npm run lint` | ESLint 9 (proíbe `console` e `SELECT *` no código da app) |
| `backend/` | `npm test` | Unit + integração + segurança + concorrência + guardas estáticas (banco `zevs_nexus_test`, recriado a cada execução) |
| `backend/` | `npm run audit` | `npm audit` das dependências de produção (nível alto) |
| `frontend/` | `npm run lint` | ESLint (proíbe `innerHTML`, `eval` e afins) |
| `frontend/` | `npm run build` | Tailwind compilado + sprite + checagem de imports com a grafia exata |
| `frontend/` | `npm test` | Funções puras de segurança (`node --test`) |
| `e2e/` | `npx playwright test` | Fluxos críticos e auditoria 320/375/1280. Sobe a app em `:3100` com banco `zevs_nexus_e2e_test` zerado; exige o frontend construído |

## CI (GitHub Actions)

`.github/workflows/ci.yml`, em todo push na `main` e em todo PR:

1. **Backend** (Node 20 e 24, PostgreSQL 17): `npm ci` → lint → migrations `up → down → up` → testes → auditoria.
2. **Frontend:** `npm ci` → lint → build → testes → auditoria.
3. **E2E:** só se os anteriores passarem; Playwright com Chromium.

Dependabot (`.github/dependabot.yml`): PRs semanais de dependências de backend, frontend, E2E e Actions.

## Deploy

Regra permanente: **nenhum push sem aprovação do Juan**, porque push na `main` faz deploy.

### Staging (F2) — passo a passo (feito pelo Juan)

O blueprint está em [`render.yaml`](../render.yaml):
- serviço web único, região Virginia, plano free, health check em `/ready`;
- migrations e seed no fim do build (o plano free não tem `preDeployCommand`).

1. **Banco:** crie um Postgres gratuito no Neon (ou Supabase), na região mais próxima de Virginia (`us-east`), e copie a connection string com `sslmode=require`.
2. **GitHub:** crie o repositório privado e envie a `main`. Esse é o push que você faz.
3. **Render:** *New → Blueprint* → escolha o repositório. O Render lê o `render.yaml`. Preencha as variáveis marcadas como `sync: false`:

   | Variável | Valor |
   |---|---|
   | `APP_URL` | URL do serviço (`https://zevs-nexus-staging.onrender.com`), sem barra no fim |
   | `DATABASE_URL` | Connection string do passo 1 |
   | `PLATFORM_ADMIN_EMAILS` | Seu e-mail (vale depois de verificado) |
   | `CF_ORIGIN_SECRET` | Deixe vazio até haver domínio no Cloudflare |

   `JWT_SECRET` é gerado pelo Render.
4. **E-mail:** com `EMAIL_PROVIDER=log` (padrão do staging) **nenhum e-mail sai**, nem o de confirmação, e sem e-mail confirmado não dá para cadastrar empresa. Para testar o fluxo completo:
   - crie uma chave no Resend e troque `EMAIL_PROVIDER=resend` + `RESEND_API_KEY`;
   - sem domínio verificado, o Resend só entrega para o e-mail da sua conta (remetente `onboarding@resend.dev`).
5. **Arquivos (F3) — Cloudflare R2:** o staging sobe com `STORAGE_PROVIDER=r2` e o boot falha sem as 4 variáveis abaixo.
   - No painel da Cloudflare, *R2 → Create bucket* `nexus-staging` (privado; sem domínio público).
   - *R2 → Manage API tokens → Create API token*: permissão **Object Read & Write**, restrita ao bucket `nexus-staging`. Guarde o *Access Key ID* e o *Secret Access Key* (aparecem uma vez).
   - Em *Settings → CORS policy* do bucket:

     ```json
     [
       {
         "AllowedOrigins": ["https://zevs-nexus-staging.onrender.com"],
         "AllowedMethods": ["PUT", "GET"],
         "AllowedHeaders": ["content-type"],
         "MaxAgeSeconds": 3600
       }
     ]
     ```

   - No Render, preencha:

     | Variável | Valor |
     |---|---|
     | `R2_ACCOUNT_ID` | ID da conta (32 caracteres hexadecimais, no painel do R2) |
     | `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | O token criado acima |
     | `R2_BUCKET` | `nexus-staging` |

   - Produção terá bucket e token próprios (`nexus-prod`); nunca reaproveite o token do staging.
6. **Conferir:**
   - `https://…/health` → `{"status":"ok"}`;
   - `/ready` → `{"status":"ready"}`;
   - `/api/version` → o SHA do commit.
7. **Primeiro uso:**
   - cadastre-se com o e-mail de `PLATFORM_ADMIN_EMAILS`, confirme e entre: você cai no Painel ZEVS;
   - com outra conta, cadastre uma empresa e aprove pelo Painel;
   - em *Documentos*, envie um PDF e abra: o envio vai direto ao R2 e o download usa URL de 60 s.

> O plano free dorme sem tráfego (a primeira requisição demora) e os jobs param enquanto isso. É aceitável em staging. Produção vai para plano pago (Core, pág. 18).

### Produção (F5)

O roteiro completo está em [`PRODUCTION.md`](PRODUCTION.md): Render pago (`render.production.yaml`), R2 de produção, Resend, Cloudflare, backups, restore testado, monitoramento, checklist de go-live, teste em aparelho real, kill switch e rollback.

## Scripts de prontidão (backend)

| Comando | O que faz |
|---|---|
| `npm run prod:rehearsal` | Ensaio de produção local: banco novo, migrations e seed duas vezes, API com `NODE_ENV=production` e fluxo ponta a ponta. Também roda no CI |
| `npm run db:restore-check -- <arquivo.dump> [--keep]` | Restaura um dump num banco temporário do cluster local e confere migrations, integridade e `/ready` |
| `node scripts/render-icons.mjs` (frontend) | Regera os ícones PNG da PWA a partir do desenho do favicon (usa o Chromium do Playwright de `e2e/`) |
