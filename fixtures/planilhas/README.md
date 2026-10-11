# Planilhas fantasma (fictícias)

Planilhas **inventadas** para a Fase 6 (prévia e escolha da biblioteca), enquanto as reais do cliente não chegam (FASE-0, D6.4). Foram **salvas pelos programas de verdade** — Excel 16 em pt-BR e LibreOffice — para trazer as manias de cada um. Nenhuma pessoa ou empresa real: nomes inventados e CPF/CNPJ de exemplo públicos (529.982.247-25, 111.444.777-35, 123.456.789-09, 11.222.333/0001-81, 12.ABC.345/01DE-35).

Para gerar de novo (Windows, com Excel e LibreOffice): `powershell -ExecutionPolicy Bypass -File fixtures\planilhas\gerar-planilhas.ps1`. Os dados são determinísticos (semente fixa).

| Arquivo | Programa | O que exercita |
|---|---|---|
| `Controle de pagamentos 2026.xlsx` | Excel | Título mesclado e cabeçalho na linha 4; 120 lançamentos; datas, moeda `R$`, CPF/CNPJ; fórmula compartilhada de situação (valor salvo, nunca avaliado); linha de total; autofiltro e painel congelado; abas "Resumo por categoria" (SOMASE) e "Prestadores" |
| `Medições obra Residencial Aurora 2025.xlsx` | Excel | Bloco de identificação antes do cabeçalho; 3 abas iguais; porcentagem; itens como texto ("1.1"); observação longa com quebra de linha em célula mesclada. Data de modificação em 2025 (o navegador sugere 2025 como ano) |
| `Controle de pagamentos 2019.xls` | Excel (BIFF8) | Formato legado: só armazenamento e download, **sem prévia**. Data de modificação em 2019 |
| `Folha de diaristas - setembro 2026.csv` | Excel, "CSV UTF-8" | BOM UTF-8, `;`, números `4.620,00`, CPF com máscara |
| `Extrato conta corrente - setembro 2026.csv` | Excel, "CSV" | **Windows-1252** (ANSI), `;`, valores negativos, acentos (Histórico, Transferência, Depósito) |
| `Orçamento reforma do escritório.ods` | LibreOffice | Duas abas; moeda formatada no próprio arquivo (`R$ 5.784,00`); fórmulas `of:=…` com valor salvo; **16.378 colunas vazias repetidas** por linha (o leitor não pode expandir) |

A data de modificação dos arquivos não vai para o git: ela só vale na máquina que gerou (para testar o ano sugerido ao enviar).

Arquivos maliciosos (zip bomb, XML com entidade, CSV com fórmula ou HTML) não ficam aqui: os testes os montam na hora.
