# CLAUDE.md — ZEVS Nexus

> **Em vigor desde 09/10/2026** (D1–D13 aprovados em [`docs/FASE-0.md`](docs/FASE-0.md)). Leia este arquivo no início de toda sessão.

## O que é

**ZEVS Nexus — Central de Organização Empresarial.** É um SaaS **multi-tenant** (empresa = tenant), SPA + PWA, que centraliza documentos, planilhas, notas fiscais, prestadores e controle financeiro **administrativo** de uma empresa.

- O primeiro cliente é uma empresa de engenharia civil. **Isso é só contexto: nenhum comportamento pode depender desse cliente.**
- **Sistema de registro e organização:** não paga, não emite nota, não movimenta saldo.
- **Princípio:** robusto por dentro, simples por fora. Não é ERP. Não construir módulo só porque ele poderia existir.

## Estado atual

- **F0 aprovada (09/10/2026) · F1 aprovada (10/10/2026) · F2 aprovada (11/10/2026) · F3 aprovada (11/10/2026) · F4 aprovada (11/10/2026) · F5 aprovada (11/10/2026; go-live depende do Juan: `docs/PRODUCTION.md`) · F6 concluída (11/10/2026), aguardando aprovação.**
- **Plano:** F1 Fundação + Auth → F2 Tenant/RBAC/Empresa/Plataforma → F3 Armazenamento + Documentos → F4 Prestadores + Financeiro → F5 PWA + piloto → F6 Planilhas → F7 Notas → F8 Busca + dashboard → F9 Importação → F10 Equipe/LGPD/hardening → F11 Painel ZEVS completo.

## Fonte das regras

1. **ZEVS STRUCTURE** (Notion): <https://app.notion.com/p/3ee11dc780718135bdadd1e500dd0079>.
2. **Hierarquia:**
   - ADR **Accepted** é obrigatório.
   - `Core` é obrigatório (não adotar exige exceção registrada).
   - `Conditional` só o que está listado como adotado em `docs/FASE-0.md` §8.
   - **Proposed nunca é adotado sem aprovação explícita** (os aprovados estão em D12).
3. Solução de outro projeto ZEVS (Wash, Barber, Store, Vale, Market) **não vira regra aqui** sem estar aprovada na STRUCTURE ou nas decisões deste projeto.
4. Se a STRUCTURE e este repositório divergirem, ou se a STRUCTURE estiver inacessível: **pare e pergunte**. Não invente o conteúdo.
5. `docs/ARCHITECTURE.md` é a fonte da verdade técnica: mudança de modelagem passa por ele **antes** do código.

## Stack e deploy

| Camada | Tecnologia |
|---|---|
| Backend | Node.js 24 LTS (ESM), Express 5, PostgreSQL 16+ com `pg` (**sem ORM**), node-pg-migrate 9, Zod 4, jsonwebtoken + bcryptjs, helmet, cors, express-rate-limit, cookie-parser, pino |
| Frontend | HTML + ES Modules **sem framework e sem bundler**, Tailwind v4 **compilado**, sprite Lucide gerado no build, Chart.js vendorizado |
| Testes | Jest + Supertest, Playwright (E2E), ESLint 9 |
| Infra | GitHub + Actions, Render (Virginia, serviço único API + SPA), Cloudflare, Cloudflare R2 (arquivos), Resend (e-mail) |

API em `/api/v1`. Fora da versão: `/health`, `/ready`, `/api/version`.

## Como rodar local

Detalhes em `docs/DEPLOYMENT.md`.

```bash
# backend/
npm ci
npm run db:local -- setup   # cluster PostgreSQL próprio na porta 5434 + bancos dev/test/e2e
npm run migrate             # node-pg-migrate up (também: migrate:down [-- n|all], migrate:redo, migrate:status)
npm run dev                 # API + SPA em http://localhost:3000
npm run lint
npm test                    # unit + integração + segurança + concorrência + guardas estáticas
npm run audit               # dependências de produção
npm run prod:rehearsal      # ensaio de produção local (NODE_ENV=production + fluxo ponta a ponta)
npm run db:restore-check -- <dump>   # restore testado num banco temporário

# frontend/
npm ci
npm run build               # Tailwind + sprite Lucide + checagem de imports (grafia exata)
npm run lint
npm test

# e2e/ (exige frontend construído e o banco local no ar)
npx playwright test
```

`npm run seed` (backend) aplica o catálogo (permissões, papéis, features, planos) e é idempotente.

## Estrutura

```plain text
backend/src/{app.js, server.js, config/, shared/, middlewares/, modules/<módulo>/, jobs/}
backend/{migrations/, seeds/, tests/}
backend/scripts/        local-db.js (cluster 5434), migrate.js, e2e-server.js
frontend/public/        index.html (versão carimbada), favicon, assets/ (gerado no build)
frontend/scripts/       build-icons.js, check-imports.js
frontend/src/           app.js, router.js, guards.js, services/, components/, layouts/, views/
e2e/                    Playwright
docs/                   ARCHITECTURE, DATABASE, SECURITY, API, DEPLOYMENT, FASE-0, adr/
```

Arquivos por módulo: `x.routes.js · x.validator.js · x.controller.js · x.service.js · x.repository.js` (+ `providers/`).

## Papéis

`owner` · `admin` · `finance` (Financeiro) · `assistant` (Assistente) · `viewer` (Visualização). Permissões `recurso.ação`: `dashboard.view`, `company.view|manage`, `settings.manage`, `users.manage`, `parties.view|manage`, `finance.view|manage|pay`, `documents.view|manage`, `spreadsheets.view|manage|import`, `invoices.view|manage`, `audit.view`, `data.export`. A matriz completa está em `docs/FASE-0.md` D10. Platform Admin (equipe ZEVS) é um eixo separado: `/api/v1/admin/*`.

## ⚠️ Regras que não podem ser quebradas

1. **O tenant nunca vem do frontend.** `X-Company-Id` é intenção, validada contra membership ativa em empresa ativa. Toda query de dados de empresa filtra por `company_id`.
2. Todo router de dados de empresa nasce com **`tenantRouter()`**. Todo repository recebe `companyId` como 1º argumento.
3. Toda relação interna usa **FK composta** `(company_id, x_id)`. **Sem associação polimórfica:** vínculo é tabela própria.
4. Recurso de outro tenant → **404**, igual a inexistente. Mutação por id só depois de `SELECT … AND company_id = $2 FOR UPDATE`.
5. **SQL 100% parametrizado.** Identificadores e `ORDER BY` só por allowlist. Curingas de busca escapados.
6. **Zod `.strict()`** em todo body, query e params. Respostas por projeção explícita, nunca `SELECT *`.
7. **Dinheiro em centavos `bigint`.** Nunca float. Vencimento e pagamento são `date`, no fuso da empresa.
8. **"Vencida" é calculada**, nunca gravada. Pagamento **não se edita**: estorna e lança outro. `paid_amount_cents` e `storage_bytes` só mudam pela função única, com `UPDATE` atômico.
9. **Arquivos:**
   - a chave do storage é gerada no servidor (`companies/<company_id>/files/<uuid>`) e nunca vem do cliente;
   - validação de extensão + MIME + magic bytes;
   - URLs assinadas curtas, que nunca vão para log;
   - nenhuma rota apaga objeto do storage diretamente (só o job, após retenção).
10. **Um arquivo, um lugar:** todo arquivo é `document`. Os módulos vinculam documentos; não guardam arquivos próprios.
11. **Importação nunca** atualiza registro existente, exclui registro por ausência na planilha, nem avalia fórmula.
12. **Auditoria** append-only, na mesma transação da mudança. Dado pessoal vira `"[dado pessoal]"`.
13. **Nenhum segredo no frontend nem no código.** Só em env; `.env` fora do git; `.env.example` versionado.
14. **Frontend:** template com escape automático; `innerHTML` proibido; access token só em memória; `localStorage` só para preferências.
15. **Service worker network-first.** Nunca cache-first para código. `/api/*` e URLs de arquivo nunca em cache.
16. **Nada de `if (empresa)`:** comportamento varia por setting, feature, permissão e plano.
17. Migration já aplicada **nunca** é editada: cria-se outra. Toda migration tem `down`.
18. **Nunca alterar produção diretamente** (ver "Produção").

## Multi-tenancy — checklist por rota nova

- [ ] `tenantRouter()` + `requirePermission` (+ `requireFeature` se for o caso)
- [ ] validator `.strict()` sem `company_id`
- [ ] repository com `companyId` em todas as funções
- [ ] referências do body (prestador, categoria, pasta, documento) conferidas no mesmo tenant → 422
- [ ] teste A × B: ler, alterar e excluir recurso do outro tenant → 404

## Segurança — checklist por funcionalidade

Responder por escrito em `docs/SECURITY.md` antes do merge:

**Quem pode executar? · Em qual tenant? · Qual permissão? · Quais dados podem ser vistos? · Existe IDOR? · Existe race condition? · Precisa de transação? · Precisa de audit log? · Há informação sensível?**

## Banco de dados e migrations

- **node-pg-migrate:** arquivos `NNNN_nome.js`, cada um com os seus índices (tenant primeiro).
- **Ordem:** 0001 extensões · 0002 auth · 0003 companies · 0004 memberships · 0005 rbac · 0006 audit · 0007 platform · 0008 idempotency · 0009+ módulos (ver `docs/ARCHITECTURE.md` §9).
- O CI prova `up → down → up` do zero. Produção roda migrations só no `preDeployCommand`; **nunca `down` em produção**.
- Seeds idempotentes (upsert por `code`); dados de demonstração só em `seed:dev`.
- Transação sempre em client dedicado (`pool.connect()`) e dentro de `withTenant()`.

## Frontend

- SPA única (`index.html`) + router History API; guardas auth → tenant → permission → feature (só escondem).
- **Mobile-first:** sem rolagem lateral em 320, 375 e 1280 px; toque ≥ 44 px; barra inferior **Início · Financeiro · Documentos · Notas · Mais**.
- Toda tela tem estados de carregando, vazio e erro. Tabelas com paginação, busca, filtros e ordenação **no servidor**.
- Textos de UI, comentários e mensagens em **PT-BR**. Identificadores em inglês.

## Testes

- Banco local dedicado; testes **recusam** banco cujo nome não termine em `_test`.
- Factories `createTenant({ roles })` / `asRole()`; providers `memory` (storage) e `log` (e-mail).
- **Obrigatório por funcionalidade:** unit + integração + isolamento A × B; concorrência quando mexe em saldo, cota ou estado.
- **Guardas estáticas:** `tenantRouter()` em todo `*.routes.js`; `.strict()` em todo validator.

## Fluxo de trabalho por fase

1. Ler `docs/ARCHITECTURE.md` e a página da STRUCTURE do tema.
2. Ordem: `migration → repository → service → controller → validator → route → teste → tela`.
3. **Ao fim de cada fase:** rodar testes → corrigir → lint → build → revisão de segurança (checklist) → atualizar docs → apresentar o resumo → **PARAR**.
4. **Nunca iniciar a próxima fase sem aprovação explícita.**
5. Definition of Done (pág. 20): backend completo · tela com estados · Zod · tenant + permissão + feature · testes (unit, integração, A × B) · mobile · checklist de segurança · docs.

## Git

- Conventional Commits em PT-BR: `tipo(escopo): descrição` (`feat`, `fix`, `docs`, `refactor`, `test`, `chore`; escopo = módulo).
- Commits lógicos por fase; nada de commit gigante sem justificativa.
- **Nunca fazer push sem aprovação.** Push na `main` faz deploy.
- Não apagar código ou arquivos sem justificar.

## Uso de IA

- A IA implementa, testa e documenta. **A decisão arquitetural é humana** (Juan aprova as decisões D).
- A IA não recebe segredos (`.env`, tokens, senhas de produção) e não os pede.
- Mudança crítica (dinheiro, tenant, auth, migration, arquivos) é revisada por Juan antes do push.
- Código gerado só sobe com a suíte verde.
- Aprendizado relevante vira registro em `docs/` e na ficha do projeto no Notion.

## Produção

- A IA **não** executa comandos contra produção: não roda `psql` nem migration manual, não altera variável no Render, não opera no bucket de produção nem no painel do Cloudflare.
- Mudança de schema chega à produção **só** por migration versionada, rodada pelo `preDeployCommand`.
- Rollback = redeploy do commit anterior; o banco nunca volta por `down` automático.

## Lições herdadas dos outros ZEVS

- O rate limit global vale **só em `/api`** (a SPA carrega dezenas de módulos) e precisa ser alto (2000/15 min): a equipe sai pelo mesmo IP.
- `NODE_ENV=production` no build do Render pula o Tailwind: o build do frontend instala devDependencies.
- A guarda CSRF precisa aceitar a própria origem do servidor (SPA no mesmo domínio).
- **Service worker cache-first prendeu o Barber em código velho.** Network-first sempre; ter o kill switch pronto.
- No Tailwind v4, não criar `@utility` própria com `backdrop-filter`: o minificador perde a versão sem prefixo.
- Sem o carimbo de versão no HTML, o banner de atualização nunca dispara.
- O Cloudflare esconde o corpo de 5xx: para diagnosticar, acessar a origem `*.onrender.com`.

## Lições deste projeto

- A porta 5433 já é usada pelo cluster de teste de outro projeto ZEVS nesta máquina: **não mexer nele**. O Nexus usa a 5434.
- No Windows, o PostgreSQL iniciado por um console que depois fecha derruba os novos backends com `0xC0000142`/`0xC000013A`. O `db:local -- start` usa `Start-Process` com janela oculta (console próprio).
- `migrate:down -- all` no banco de **desenvolvimento** apaga os dados (inclusive as contas de teste). Para provar a reversibilidade, o CI e o banco `_test` bastam.
- No `<dialog>` da SPA, o menu "Mais" é sempre o primeiro do DOM: para achar um modal aberto, use `dialog[open]`.
- **Arquivos:** o navegador só escreve na chave de envio (`…/uploads/<id>`); a confirmação copia para `…/files/<id>` condicionada à ETag conferida. Arquivo novo de um módulo entra por `filesService.verifyUpload` + `claimFile` na transação de quem usa o arquivo, nunca por um "confirmar" solto.
- `STORAGE_PROVIDER`: `local` em dev (`.storage/`), `memory` nos testes e no E2E, `r2` obrigatório em produção. Nos testes, `tests/helpers/documents.js` faz intenção → PUT no `/dev-storage` → `POST /documents`.
- No `<dialog>`, `showModal()` foca o primeiro botão (o "X"): o `openFormModal` foca o primeiro campo depois de abrir.
- **Financeiro:** `paid_amount_cents` só muda em `expensesRepository.settle`; o status só sai da expressão única do repository. Pagamento novo de outro módulo (ex.: importação na F9) passa por `expenses.service`, nunca por `INSERT` direto.
- **Espaço inseparável** (formatação de moeda, recuo de `<option>`): escreva `String.fromCharCode(0xa0)` ou `\s` na regex. O caractere literal é invisível e o ESLint recusa (`no-irregular-whitespace`).
- **`<dialog>` com a aba em segundo plano:** o navegador pode atrasar o evento `close`. Os modais entregam o resultado no próprio clique/envio; não volte a depender só do `close`.
- **Service worker:** rede primeiro, sempre; nada de `/api`, `/dev-storage` ou URL do R2 no cache. Mudou o `sw.js`? Rode `tests/pwa.spec.js`. Emergência: `SW_KILL_SWITCH=true` (ver `docs/PRODUCTION.md`).
- **Scripts de edição:** Python com `"\1"` ou `'\\n'` dentro de texto vira caractere de controle ou quebra de linha de verdade (e `\u` incompleto nem compila); use string crua (`r'''...'''`) ou edite pelo editor. Escapes `\uXXXX` escritos em arquivo também podem virar o caractere literal (BOM, NBSP): no código, use `String.fromCharCode(0xfeff)`.
- **Antes de sobrescrever um arquivo, leia-o.** Na F6 o `.gitattributes` foi sobrescrito sem leitura e as regras antigas tiveram de ser restauradas no commit seguinte.
- **Planilhas:** a ficha (`spreadsheets`) nasce em `documents.service` (`registerSpreadsheet`), no envio e na nova versão; não crie planilha por outro caminho. A prévia passa sempre por `readers/index.js` (`readSpreadsheet`), com os tetos de `readers/limits.js`; leitor novo usa `openZip`/`parseXml` (zip com teto, XML sem `DOCTYPE`) e devolve só texto.
- **Planilhas fantasma** (`fixtures/planilhas/`, geradas pelo Excel via COM): use `NumberFormatLocal` (o `NumberFormat` em inglês gera CSV local errado) e crie abas com `SheetsInNewWorkbook` (`Worksheets.Add` com `Missing` falha). O git não preserva a data de modificação: teste que dependa de `File.lastModified` monta o arquivo em memória.
- **Testes do frontend (node:test):** módulo que importa `services/session.js` abre um `BroadcastChannel` e o Node não termina; no teste, apague `globalThis.BroadcastChannel` antes de importar (`await import(...)`).
- Vulnerabilidade transitiva sem correção em ferramenta de desenvolvimento: registrar em `docs/SECURITY.md` (riscos aceitos). Se houver versão corrigida do pacote intermediário, usar `overrides` (ex.: `@parcel/watcher` do Tailwind).
