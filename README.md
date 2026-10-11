# ZEVS Nexus

**Central de Organização Empresarial.** SaaS multi-tenant (SPA + PWA) que centraliza documentos, planilhas, notas fiscais, prestadores e o controle financeiro administrativo de uma empresa.

> Robusto por dentro. Simples por fora.

O primeiro cliente é uma empresa de engenharia civil, mas nenhum comportamento é específico desse cliente. O projeto segue os padrões da **ZEVS STRUCTURE** (Notion).

## Status por fase

| Fase | Entrega | Status |
|---|---|---|
| 0 | Proposta, decisões D1–D13, arquitetura | ✅ Aprovada (09/10/2026) |
| 1 | Fundação + autenticação + base da SPA (telas de acesso) | ✅ Aprovada (10/10/2026) |
| 2 | Tenant, RBAC, Empresa, onboarding, Painel ZEVS mínimo, staging | ✅ Aprovada (11/10/2026) |
| 3 | Armazenamento (R2) + Central de Documentos | ✅ Aprovada (11/10/2026) |
| 4 | Prestadores + Financeiro | ✅ Concluída — aguardando aprovação |
| 5 | PWA + mobile + produção paga → **piloto** | ⏳ |
| 6 | Planilhas (níveis 1 e 2) | ⏳ |
| 7 | Notas fiscais | ⏳ |
| 8 | Busca global + dashboard completo → **MVP completo** | ⏳ |
| 9 | Importação estruturada de planilhas (nível 3) | ⏳ |
| 10 | Equipe, LGPD, hardening | ⏳ |
| 11 | Painel ZEVS completo + SaaS | ⏳ |

## Stack

- **Backend:** Node.js 24 LTS (ESM), Express 5, PostgreSQL (`pg`, sem ORM), node-pg-migrate, Zod 4, JWT + bcryptjs, pino.
- **Frontend:** HTML + ES Modules, sem framework e sem bundler; Tailwind v4 compilado; sprite Lucide.
- **Testes:** Jest + Supertest, Playwright.
- **Infra:** GitHub Actions, Render, Cloudflare (+ R2), Resend.

## Começando

Veja [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Resumo:

```bash
cd backend && npm ci && npm run db:local -- setup && cp .env.example .env   # preencha JWT_SECRET
npm run migrate && npm run dev                                               # http://localhost:3000
cd ../frontend && npm ci && npm run build
```

## Documentação

| Documento | Conteúdo |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Regras do projeto, para pessoas e para a IA |
| [`docs/FASE-0.md`](docs/FASE-0.md) | Proposta e decisões aprovadas |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Fonte da verdade técnica |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Checklist de segurança por funcionalidade |
| [`docs/API.md`](docs/API.md) | Contratos da API |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Migrations e tabelas |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Ambiente local, CI e deploy |
