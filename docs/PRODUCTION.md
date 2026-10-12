# ZEVS Nexus — Produção e piloto

> **Quem opera produção é o Juan.** A IA prepara código, blueprint, workflows e roteiros, mas não executa nada em produção: não roda `psql`, não altera variável no Render, não mexe no bucket nem no Cloudflare (CLAUDE.md, "Produção").
>
> Referências: ARCHITECTURE §19.1 (PWA) e §24.1 (infra, backups, restore); FASE-0 D9, D12b, D12f e D13; STRUCTURE páginas 11, 18 e 19.

## 0. Antes de começar

- [ ] CI verde na `main` (lint, testes, migrations up → down → up, ensaio de produção, E2E).
- [ ] Ensaio local OK: `cd backend && npm run prod:rehearsal` (≈ 30 verificações com `NODE_ENV=production`).
- [x] **Domínio (D13.2):** `zevsnexus.com.br` (Registro.br, DNS no Cloudflare). Sem domínio, a produção sobe em `https://<serviço>.onrender.com`, **mas o e-mail não funciona para o cliente** (ver §3): para o piloto, o domínio é na prática obrigatório.

## 1. Render (plano pago) e banco (Neon)

0. **Banco (Neon, D13.3):** crie um projeto no Neon na região **AWS us-east-1 (N. Virginia)**, a mesma do Render, com Postgres 17. Copie a connection string **direta** (sem `-pooler` no endereço), com `sslmode=require`. As migrations usam trava de sessão, que o pooler do Neon não mantém. O plano gratuito suspende o banco depois de alguns minutos sem uso e tem cota mensal de computação. Por isso o health check do Render é o `/health`, que não toca no banco. Acompanhe o consumo no painel do Neon e passe para o plano pago quando houver uso real.
1. *New → Blueprint* → repositório do Nexus → arquivo **`render.production.yaml`** (o `render.yaml` continua sendo o staging).
2. Confira o plano sugerido (web `starter`, região Virginia) e ajuste ao nome vigente do painel, se mudou. O blueprint não cria banco no Render.
3. Preencha as variáveis `sync: false`:

   | Variável | Valor |
   |---|---|
   | `APP_URL` | `https://<domínio>` (ou a URL `*.onrender.com` até o domínio existir), sem barra no fim |
   | `DATABASE_URL` | Connection string **direta** do Neon (passo 0) |
   | `CF_ORIGIN_SECRET` | Vazio até o Cloudflare (§4); depois, o mesmo valor da Transform Rule |
   | `RESEND_API_KEY` | Chave do Resend (§3) |
   | `EMAIL_FROM` | `ZEVS Nexus <no-reply@<domínio>>` |
   | `PLATFORM_ADMIN_EMAILS` | Seu e-mail (vale depois de verificado) |
   | `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | Token do app no bucket de produção (§2) |

   `JWT_SECRET` é gerado pelo Render. `DATABASE_SSL` já vem `true` (conexão pela internet, com verificação do certificado).
4. Primeiro deploy: o `preDeployCommand` roda migrations e seed; se falharem, a versão não entra no ar.
5. Conferir na origem: `/health` → `{"status":"ok"}`; `/ready` → `{"status":"ready"}`; `/api/version` → SHA do commit.

## 2. Cloudflare R2 (produção)

| Bucket | Uso | Token |
|---|---|---|
| `nexus-prod` | Arquivos do app (privado, sem domínio público) | **App:** Object Read & Write, só neste bucket |
| `nexus-prod-backup` | Cópia diária (§5) | **Backup (origem):** Object Read, só em `nexus-prod` · **Backup (destino):** Object Read & Write, só em `nexus-prod-backup` |

CORS do `nexus-prod` (troque pela `APP_URL`; enquanto usar `*.onrender.com`, use essa URL):

```json
[
  {
    "AllowedOrigins": ["https://<domínio>"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

Nunca reaproveite token do staging nem dê ao app acesso ao bucket de backup.

## 3. E-mail (Resend)

1. No Resend, adicione o domínio e crie no DNS (Cloudflare) os registros que ele pedir: **SPF**, **DKIM** e **DMARC** (comece com `p=none`).
2. Depois da verificação, crie a API key (permissão só de envio) → `RESEND_API_KEY` no Render; `EMAIL_FROM` com o domínio verificado.
3. Teste: "Esqueci minha senha" com o seu e-mail chega em segundos.

> **Sem domínio verificado, o Resend só entrega para o e-mail da própria conta.** O cliente não recebe o link de confirmação e não consegue cadastrar a empresa.

## 4. Cloudflare (quando houver domínio)

- DNS: `CNAME <subdomínio> → <serviço>.onrender.com`, **proxied** (nuvem laranja). No Render, adicione o domínio personalizado ao serviço.
- SSL/TLS **Full (strict)** · **Always Use HTTPS**.
- **Transform Rule** (Modify Request Header) para todo o tráfego do host: `X-Origin-Auth: <segredo>` → o mesmo valor em `CF_ORIGIN_SECRET` no Render. Gere com `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.
- **WAF:** regras gerenciadas ligadas. **Rate limiting** de borda em `/api/v1/auth/*`.
- **Cache:** Browser Cache TTL em **"Respect Existing Headers"**; nenhuma regra de "Cache Everything" (o app já manda `no-cache`/`no-store`).
- Depois: `APP_URL=https://<domínio>` no Render e o CORS do R2 atualizado.

## 5. Backups

**Banco** — `.github/workflows/db-backup.yml` (diário, 02h de Manaus, e botão *Run workflow*):

| Segredo do GitHub | Valor |
|---|---|
| `PROD_DATABASE_URL` | Connection string **direta** do Neon, com `?sslmode=require` |

O dump (`pg_dump -Fc`) fica como **artefato privado por 30 dias** (o repositório precisa ser privado). O Neon também guarda um histórico curto para restauração (a janela depende do plano). Esse histórico não substitui o dump diário.

**Arquivos (D12f)** — `.github/workflows/files-backup.yml` (diário, 03h de Manaus, e botão):

| Segredo | Valor |
|---|---|
| `R2_ACCOUNT_ID` | ID da conta Cloudflare |
| `R2_SOURCE_ACCESS_KEY_ID` / `R2_SOURCE_SECRET_KEY` | Token de **leitura** em `nexus-prod` |
| `R2_SOURCE_BUCKET` | `nexus-prod` |
| `R2_BACKUP_ACCESS_KEY_ID` / `R2_BACKUP_SECRET_KEY` | Token de **escrita** em `nexus-prod-backup` |
| `R2_BACKUP_BUCKET` | `nexus-prod-backup` |

`rclone copy` só de `companies/*/files/**`, com `--immutable`, e depois `rclone check` (todo arquivo de produção existe no backup). Cópia, nunca sincronização: apagar em produção não apaga o backup.

Depois de cadastrar os segredos, rode os dois workflows uma vez pelo botão e confira o resultado.

## 6. Restore testado (antes do piloto e a cada trimestre)

Meta (D12b): **RPO 24 h / RTO 8 h**.

1. Baixe o artefato mais recente do workflow "Backup do banco".
2. No computador (cluster local no ar: `npm run db:local -- start`):

   ```bash
   cd backend
   npm run db:restore-check -- caminho/nexus-AAAAMMDD-HHMM.dump
   ```

   O script restaura num banco **temporário** do cluster local e confere: `pg_restore` sem erro, migrations em dia, pago de cada despesa = soma dos pagamentos ativos, uso de armazenamento = soma dos arquivos, e a API respondendo `/ready` apontando para ele. Com `--keep`, o banco fica para você entrar no app (`DATABASE_URL=<url> npm run dev`) e conferir login e telas.
3. Arquivos: escolha um documento recente no app e confira que a chave existe no bucket de backup.
4. Registre na tabela abaixo (o script imprime a linha).

| Data | Responsável | Origem do dump | Resultado | Observações |
|---|---|---|---|---|
| 2026-10-11 | Claude (ensaio do roteiro) | `pg_dump -Fc` do banco local de desenvolvimento | OK (0,1 min) | Ensaio do script e do roteiro. **Falta o restore de um backup de produção**, feito pelo Juan antes do piloto. |

**Restore de verdade (incidente):** crie um banco novo no Neon (outro projeto ou um *branch* vazio), `pg_restore --no-owner --no-privileges --dbname=<URL direta nova> <dump>`, aponte o `DATABASE_URL` do serviço para ele (Render → Environment), redeploy e confira `/ready`. Nunca restaure por cima do banco em uso sem antes guardar um dump dele.

## 7. Monitoramento

- Uptime externo (ex.: UptimeRobot) em `https://<serviço>.onrender.com/health` — na **origem**, não no domínio do Cloudflare (que esconde o corpo de erro 5xx). A cada 5 min, alerta por e-mail.
- Logs no Render (JSON). Eventos de segurança têm `"security": true` (reuso de refresh, arquivo recusado, acesso negado a empresa).

## 8. Checklist de go-live (STRUCTURE pág. 18, adaptado)

- [ ] Migrations provadas no CI (up → down → up) e ensaio de produção verde
- [ ] Backup do banco e dos arquivos rodando **e restore de produção testado** (linha na tabela do §6)
- [ ] Render pago (web e banco); segredos só no painel, fora do git
- [ ] HTTPS Full (strict), segredo de origem e WAF no Cloudflare (quando houver domínio)
- [ ] E-mail com domínio verificado (SPF, DKIM, DMARC)
- [ ] R2: buckets privados, CORS só para `APP_URL`, tokens mínimos por uso
- [ ] Uptime externo apontando para a origem
- [ ] Suíte de isolamento A × B e testes de concorrência verdes; RBAC revisado (matriz D10)
- [ ] **Teste em aparelho real** (§9)

## 9. Teste em aparelho real (obrigatório, ARCHITECTURE §19)

Com um celular Android e um iPhone (ou o que houver):

1. Abrir `APP_URL`, entrar, **Configurações → Instalar no celular** e seguir o passo a passo. O ícone na tela inicial abre em **`/app`**, em tela cheia.
2. Documentos: "Tirar foto" de um papel → envio com progresso → abrir o documento.
3. Financeiro: "Já paguei" com foto do comprovante → abrir o comprovante → estornar → registrar de novo.
4. Modo avião: abrir o app → tela "Sem conexão" → voltar a rede → "Tentar de novo".
5. Fazer um deploy qualquer → no app aberto aparece "Nova versão → Atualizar" → atualizar.

## 10. Primeiro acesso do cliente (piloto)

1. O cliente se cadastra em `APP_URL/cadastro` e confirma o e-mail.
2. Cadastra a empresa (fica "em análise").
3. Você aprova em **Painel ZEVS → Empresas**; o cliente recebe o e-mail de aprovação.
4. O cliente instala o app (Configurações → Instalar no celular) e começa por Empresa, Documentos e Financeiro.

## 11. Kill switch do service worker

O service worker é **rede primeiro**: online, todo código vem da rede, então um deploy normal sempre chega. O kill switch é o plano B se um service worker com defeito for publicado.

1. Render → Environment → `SW_KILL_SWITCH=true` → salvar (reinicia o serviço).
2. Quem abrir o app recebe em `/sw.js` um worker que **apaga todos os caches, se desregistra e recarrega as abas**.
3. Corrija, faça o deploy e volte `SW_KILL_SWITCH=false`. O app registra o worker normal de novo na próxima abertura.

## 12. Rollback

- **Código:** no Render, redeploy do commit anterior (histórico de deploys → *Rollback*).
- **Banco:** nunca `down` em produção (o script recusa). Problema de schema se corrige com **nova** migration.
