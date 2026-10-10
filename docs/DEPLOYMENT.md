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

Ainda não há deploy.

| Ambiente | Fase | O que entra |
|---|---|---|
| Staging | F2 | `render.yaml` (web service + Postgres), `preDeployCommand` com migrations, health check em `/ready` |
| Produção (antes do piloto) | F5 | Plano pago, Cloudflare (SSL Full strict, segredo de origem, WAF, "Respect Existing Headers"), R2, Resend com domínio verificado, backup externo e restore testado |

Regra permanente: **nenhum push sem aprovação do Juan**, porque push na `main` faz deploy.
