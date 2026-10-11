# Gera as "planilhas fantasma" da F6: planilhas FICTÍCIAS, mas salvas pelos programas de verdade
# (Excel 16 e LibreOffice), para escolher a biblioteca de leitura e testar a prévia (FASE-0 D6).
# Dados determinísticos (semente fixa). Nenhuma pessoa ou empresa real: nomes inventados e CPF/CNPJ
# de exemplo, públicos, usados em documentação (529.982.247-25, 11.222.333/0001-81…).
#
# Formatos com NumberFormatLocal (códigos em português, como quem usa o Excel em pt-BR pelo menu):
# com os códigos em inglês, a exportação CSV "local" sai com "yyyy" literal e casas decimais erradas.
#
# Uso (Windows, com Excel e LibreOffice instalados):
#   powershell -ExecutionPolicy Bypass -File fixtures\planilhas\gerar-planilhas.ps1
# Os arquivos gerados ficam versionados; rode de novo só para mudar o conteúdo.

$ErrorActionPreference = 'Stop'
$out = Split-Path -Parent $MyInvocation.MyCommand.Path
$tmp = Join-Path $env:TEMP "nexus-planilhas-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$rnd = [System.Random]::new(2026)

# Constantes do Excel
$xlOpenXMLWorkbook = 51; $xlExcel8 = 56; $xlCSV = 6; $xlCSVUTF8 = 62
$M = [System.Reflection.Missing]::Value

function New-Grid([int]$rows, [int]$cols) { New-Object 'object[,]' $rows, $cols }
function OA([datetime]$d) { $d.ToOADate() }
function Pick($list) { $list[$rnd.Next($list.Count)] }
function Money([double]$min, [double]$max) { [math]::Round($min + $rnd.NextDouble() * ($max - $min), 2) }

$parties = @(
  @{ name = 'Carlos Alberto Souza'; doc = '529.982.247-25'; kind = 'Mão de obra'; what = @('Diárias de pedreiro', 'Assentamento de blocos', 'Reboco interno') ; min = 180; max = 2400 },
  @{ name = 'Antônio Ferreira Lima'; doc = '111.444.777-35'; kind = 'Mão de obra'; what = @('Instalação elétrica', 'Passagem de cabos', 'Montagem de quadro') ; min = 350; max = 3200 },
  @{ name = 'Marcos Vinícius Rocha'; doc = '123.456.789-09'; kind = 'Serviços de terceiros'; what = @('Instalação hidráulica', 'Troca de registro', 'Ligação de esgoto') ; min = 250; max = 2800 },
  @{ name = 'Depósito Bom Preço Materiais Ltda'; doc = '11.222.333/0001-81'; kind = 'Materiais'; what = @('Cimento CP-II (50 sacos)', 'Areia média e brita', 'Blocos cerâmicos 9x19x19', 'Argamassa AC-II') ; min = 400; max = 15000 },
  @{ name = 'Elétrica Central Comércio Ltda'; doc = '12.ABC.345/01DE-35'; kind = 'Materiais'; what = @('Cabos 2,5 mm e disjuntores', 'Quadro de distribuição', 'Eletrodutos e caixas') ; min = 300; max = 8000 },
  @{ name = 'Concreteira Exemplo Rio Negro'; doc = ''; kind = 'Materiais'; what = @('Concreto usinado fck 25', 'Bombeamento de concreto') ; min = 2500; max = 18000 },
  @{ name = 'Locadora de Equipamentos Norte'; doc = ''; kind = 'Equipamentos e ferramentas'; what = @('Aluguel de betoneira', 'Aluguel de andaimes', 'Aluguel de compactador') ; min = 200; max = 2200 },
  @{ name = 'Conta de energia (obra)'; doc = ''; kind = 'Contas de consumo'; what = @('Energia elétrica do canteiro') ; min = 180; max = 900 },
  @{ name = 'Prefeitura (taxas)'; doc = ''; kind = 'Impostos e taxas'; what = @('Taxa de alvará de obra', 'ISS retido') ; min = 120; max = 3500 },
  @{ name = 'Posto Combustível Avenida'; doc = ''; kind = 'Transporte e combustível'; what = @('Combustível da caminhonete', 'Frete de material') ; min = 150; max = 1200 }
)
$works = @('Residencial Aurora', 'Reforma Escritório Centro', 'Galpão Distrito')
$methods = @('PIX', 'PIX', 'PIX', 'Boleto', 'Transferência', 'Dinheiro')

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.ScreenUpdating = $false

function Save-As($wb, [string]$path, [int]$format, [bool]$local = $false) {
  if (Test-Path $path) { Remove-Item $path -Force }
  if ($local) { $wb.SaveAs($path, $format, $M, $M, $M, $M, $M, $M, $M, $M, $M, $true) } else { $wb.SaveAs($path, $format) }
}

# Pasta de trabalho já com N abas nomeadas (Worksheets.Add com argumento omitido falha via COM no PowerShell).
function New-Book([string[]]$names) {
  $xl.SheetsInNewWorkbook = $names.Count
  $wb = $xl.Workbooks.Add()
  $xl.SheetsInNewWorkbook = 1
  for ($i = 0; $i -lt $names.Count; $i++) { $wb.Worksheets.Item($i + 1).Name = $names[$i] }
  $wb
}

function Title($ws, [string]$range, [string]$text) {
  $cell = $ws.Range($range)
  $cell.Merge() | Out-Null
  $cell.Cells.Item(1, 1).Value2 = $text
  $cell.Font.Bold = $true; $cell.Font.Size = 14
}

function Header($ws, [string]$start, [string[]]$labels) {
  $range = $ws.Range($start).Resize(1, $labels.Count)
  $grid = New-Grid 1 $labels.Count
  for ($i = 0; $i -lt $labels.Count; $i++) { $grid[0, $i] = $labels[$i] }
  $range.Value2 = $grid
  $range.Font.Bold = $true
  $range.Interior.Color = 0xEBD9C6
  $range.WrapText = $true
}

function Freeze($ws, [int]$row) {
  $ws.Activate()
  $xl.ActiveWindow.SplitRow = $row
  $xl.ActiveWindow.FreezePanes = $true
}

try {
  # ---------------------------------------------------------------------------------------------
  # 1. Controle de pagamentos 2026.xlsx — título mesclado, cabeçalho na linha 4, 120 lançamentos,
  #    datas, moeda, fórmula de situação (valor salvo), linha de total, autofiltro, 3 abas.
  # ---------------------------------------------------------------------------------------------
  $wb = New-Book @('Pagamentos', 'Resumo por categoria', 'Prestadores')
  $ws = $wb.Worksheets.Item(1)
  Title $ws 'A1:K1' 'CONTROLE DE PAGAMENTOS 2026 — Construtora Exemplo (dados fictícios)'
  $ws.Range('A2').Value2 = 'Atualizado pelo escritório. Valores em R$.'
  Header $ws 'A4' @('Lançamento', 'Vencimento', 'Pago em', 'Prestador / fornecedor', 'CPF/CNPJ', 'Descrição', 'Categoria', 'Obra', 'Valor', 'Forma', 'Situação')
  $rows = 120
  $grid = New-Grid $rows 10
  $cutoff = [datetime]'2026-10-08'
  for ($r = 0; $r -lt $rows; $r++) {
    $p = Pick $parties
    $due = ([datetime]'2026-01-05').AddDays([math]::Floor($r * 2.6) + $rnd.Next(0, 3))
    $launch = $due.AddDays(-$rnd.Next(3, 20))
    $paid = $null
    if ($due -lt $cutoff -and $rnd.NextDouble() -lt 0.88) { $paid = $due.AddDays($rnd.Next(-2, 4)) }
    $grid[$r, 0] = OA $launch
    $grid[$r, 1] = OA $due
    $grid[$r, 2] = if ($paid) { OA $paid } else { $null }
    $grid[$r, 3] = $p.name
    $grid[$r, 4] = $p.doc
    $grid[$r, 5] = Pick $p.what
    $grid[$r, 6] = $p.kind
    $grid[$r, 7] = Pick $works
    $grid[$r, 8] = Money $p.min $p.max
    $grid[$r, 9] = if ($paid) { Pick $methods } else { '' }
  }
  $ws.Range('A5').Resize($rows, 10).Value2 = $grid
  $last = 4 + $rows
  $ws.Range("A5:C$last").NumberFormatLocal = 'dd/mm/aaaa'
  $ws.Range("I5:I$($last + 1)").NumberFormatLocal = '"R$" #.##0,00'
  $ws.Range("K5:K$last").Formula = '=IF(C5="",IF(B5<DATE(2026,10,8),"Vencida","A vencer"),"Paga")'
  $ws.Range("H$($last + 1)").Value2 = 'TOTAL'
  $ws.Range("H$($last + 1)").Font.Bold = $true
  $ws.Range("I$($last + 1)").Formula = "=SUM(I5:I$last)"
  $ws.Range("I$($last + 1)").Font.Bold = $true
  $ws.Range("A4:K$last").AutoFilter() | Out-Null
  $ws.Columns.Item('A:K').AutoFit() | Out-Null
  Freeze $ws 4

  $res = $wb.Worksheets.Item(2)
  Title $res 'A1:C1' 'Resumo por categoria (fórmulas)'
  Header $res 'A3' @('Categoria', 'Total lançado', 'Total pago')
  $kinds = @($parties | ForEach-Object { $_.kind } | Select-Object -Unique)
  for ($i = 0; $i -lt $kinds.Count; $i++) {
    $row = 4 + $i
    $res.Range("A$row").Value2 = $kinds[$i]
    $res.Range("B$row").Formula = "=SUMIF(Pagamentos!`$G`$5:`$G`$$last,A$row,Pagamentos!`$I`$5:`$I`$$last)"
    $res.Range("C$row").Formula = "=SUMIFS(Pagamentos!`$I`$5:`$I`$$last,Pagamentos!`$G`$5:`$G`$$last,A$row,Pagamentos!`$K`$5:`$K`$$last,""Paga"")"
  }
  $res.Range("B4:C$(3 + $kinds.Count)").NumberFormatLocal = '"R$" #.##0,00'
  $res.Columns.Item('A:C').AutoFit() | Out-Null

  $pr = $wb.Worksheets.Item(3)
  Header $pr 'A1' @('Nome', 'CPF/CNPJ', 'Especialidade', 'Telefone', 'Chave PIX')
  $grid = New-Grid $parties.Count 5
  for ($i = 0; $i -lt $parties.Count; $i++) {
    $grid[$i, 0] = $parties[$i].name
    $grid[$i, 1] = $parties[$i].doc
    $grid[$i, 2] = $parties[$i].kind
    $grid[$i, 3] = '(92) 9' + $rnd.Next(1000, 9999) + '-' + $rnd.Next(1000, 9999)
    $grid[$i, 4] = if ($parties[$i].doc) { $parties[$i].doc } else { '' }
  }
  $pr.Range('A2').Resize($parties.Count, 5).Value2 = $grid
  $pr.Columns.Item('A:E').AutoFit() | Out-Null
  $ws.Activate()
  Save-As $wb (Join-Path $out 'Controle de pagamentos 2026.xlsx') $xlOpenXMLWorkbook

  $wb.Close($false)

  # ---------------------------------------------------------------------------------------------
  # 2. Medições obra Residencial Aurora 2025.xlsx — bloco de identificação antes do cabeçalho,
  #    3 abas iguais, fórmulas (percentual, valor do período e acumulado), totais, texto longo.
  # ---------------------------------------------------------------------------------------------
  $items = @(
    @('1.1', 'Escavação manual de valas', 'm³', 48), @('1.2', 'Fundação em sapata corrida', 'm³', 22),
    @('2.1', 'Alvenaria de bloco cerâmico 9x19x19', 'm²', 640), @('2.2', 'Chapisco e reboco interno', 'm²', 1180),
    @('3.1', 'Instalações elétricas (pontos)', 'pt', 96), @('3.2', 'Instalações hidrossanitárias (pontos)', 'pt', 58),
    @('4.1', 'Contrapiso regularizado', 'm²', 420), @('4.2', 'Revestimento cerâmico de piso', 'm²', 380),
    @('5.1', 'Pintura látex PVA (2 demãos)', 'm²', 1450)
  )
  $prices = @(68.5, 742.0, 61.9, 38.4, 118.0, 135.5, 42.7, 74.9, 19.8)
  $wb = New-Book @('Medição 01', 'Medição 02', 'Medição 03')
  $accumulated = @(0) * $items.Count
  for ($m = 1; $m -le 3; $m++) {
    $ws = $wb.Worksheets.Item($m)
    Title $ws 'A1:J1' ("BOLETIM DE MEDIÇÃO Nº {0:D2}" -f $m)
    $ws.Range('A2').Value2 = 'Obra: Residencial Aurora (fictícia)'
    $ws.Range('A3').Value2 = 'Contrato: 014/2025 — Contratante: Incorporadora Exemplo (fictícia)'
    $start = [datetime]::new(2025, 4 + $m, 1)
    $ws.Range('A4').Value2 = 'Período: ' + $start.ToString('dd/MM/yyyy') + ' a ' + $start.AddMonths(1).AddDays(-1).ToString('dd/MM/yyyy')
    Header $ws 'A6' @('Item', 'Serviço', 'Unid.', 'Qtd. contratada', 'Qtd. no período', 'Qtd. acumulada', '% executado', 'Preço unitário', 'Valor do período', 'Valor acumulado')
    for ($i = 0; $i -lt $items.Count; $i++) {
      $row = 7 + $i
      $period = [math]::Round($items[$i][3] * (0.15 + $rnd.NextDouble() * 0.2), 2)
      $accumulated[$i] = [math]::Min($items[$i][3], $accumulated[$i] + $period)
      $ws.Range("A$row").NumberFormat = '@'
      $ws.Range("A$row").Value2 = $items[$i][0]
      $ws.Range("B$row").Value2 = $items[$i][1]
      $ws.Range("C$row").Value2 = $items[$i][2]
      $ws.Range("D$row").Value2 = $items[$i][3]
      $ws.Range("E$row").Value2 = $period
      $ws.Range("F$row").Value2 = $accumulated[$i]
      $ws.Range("G$row").Formula = "=F$row/D$row"
      $ws.Range("H$row").Value2 = $prices[$i]
      $ws.Range("I$row").Formula = "=E$row*H$row"
      $ws.Range("J$row").Formula = "=F$row*H$row"
    }
    $end = 6 + $items.Count
    $ws.Range("D7:F$end").NumberFormatLocal = '#.##0,00'
    $ws.Range("G7:G$end").NumberFormatLocal = '0,0%'
    $ws.Range("H7:J$($end + 1)").NumberFormatLocal = '"R$" #.##0,00'
    $ws.Range("B$($end + 1)").Value2 = 'TOTAL DA MEDIÇÃO'
    $ws.Range("I$($end + 1)").Formula = "=SUM(I7:I$end)"
    $ws.Range("J$($end + 1)").Formula = "=SUM(J7:J$end)"
    $ws.Range("A$($end + 1):J$($end + 1)").Font.Bold = $true
    $ws.Range("A$($end + 3)").Value2 = "Observações: medição conferida em campo pelo engenheiro responsável.`nChuvas no período atrasaram a fundação; reprogramado no cronograma."
    $ws.Range("A$($end + 3):J$($end + 3)").Merge() | Out-Null
    $ws.Range("A$($end + 3)").WrapText = $true
    $ws.Rows.Item($end + 3).RowHeight = 32
    $ws.Columns.Item('A:J').AutoFit() | Out-Null
  }
  $wb.Worksheets.Item(1).Activate()
  $medicoes = Join-Path $out 'Medições obra Residencial Aurora 2025.xlsx'
  Save-As $wb $medicoes $xlOpenXMLWorkbook
  $wb.Close($false)

  # ---------------------------------------------------------------------------------------------
  # 3. Controle de pagamentos 2019.xls — formato legado (BIFF8): só armazenamento e download.
  # ---------------------------------------------------------------------------------------------
  $wb = New-Book @('Pagamentos 2019')
  $ws = $wb.Worksheets.Item(1)
  Header $ws 'A1' @('Data', 'Fornecedor', 'Descrição', 'Valor')
  $grid = New-Grid 40 4
  for ($r = 0; $r -lt 40; $r++) {
    $p = Pick $parties
    $grid[$r, 0] = OA (([datetime]'2019-01-10').AddDays($r * 8))
    $grid[$r, 1] = $p.name
    $grid[$r, 2] = Pick $p.what
    $grid[$r, 3] = Money $p.min $p.max
  }
  $ws.Range('A2').Resize(40, 4).Value2 = $grid
  $ws.Range('A2:A41').NumberFormatLocal = 'dd/mm/aaaa'
  $ws.Range('D2:D42').NumberFormatLocal = '"R$" #.##0,00'
  $ws.Range('D42').Formula = '=SUM(D2:D41)'
  $ws.Columns.Item('A:D').AutoFit() | Out-Null
  $legacy = Join-Path $out 'Controle de pagamentos 2019.xls'
  Save-As $wb $legacy $xlExcel8
  $wb.Close($false)

  # ---------------------------------------------------------------------------------------------
  # 4. Folha de diaristas - setembro 2026.csv — "CSV UTF-8" do Excel (BOM, ";", vírgula decimal).
  # ---------------------------------------------------------------------------------------------
  $wb = New-Book @('Diaristas')
  $ws = $wb.Worksheets.Item(1)
  Header $ws 'A1' @('Nome', 'CPF', 'Função', 'Obra', 'Dias trabalhados', 'Valor da diária', 'Total')
  $workers = @(
    @('Carlos Alberto Souza', '529.982.247-25', 'Pedreiro', 220), @('João Batista Nogueira', '', 'Servente', 150),
    @('Raimundo Nonato Silva', '', 'Servente', 150), @('Antônio Ferreira Lima', '111.444.777-35', 'Eletricista', 280),
    @('Francisco das Chagas Melo', '', 'Carpinteiro', 240), @('José Ribamar Costa', '', 'Pintor', 210),
    @('Marcos Vinícius Rocha', '123.456.789-09', 'Encanador', 260), @('Pedro Henrique Araújo', '', 'Ajudante geral', 140)
  )
  for ($i = 0; $i -lt $workers.Count; $i++) {
    $row = 2 + $i
    $ws.Range("A$row").Value2 = $workers[$i][0]
    $ws.Range("B$row").NumberFormat = '@'
    $ws.Range("B$row").Value2 = $workers[$i][1]
    $ws.Range("C$row").Value2 = $workers[$i][2]
    $ws.Range("D$row").Value2 = Pick $works
    $ws.Range("E$row").Value2 = $rnd.Next(12, 23)
    $ws.Range("F$row").Value2 = $workers[$i][3]
    $ws.Range("G$row").Formula = "=E$row*F$row"
  }
  $ws.Range("F2:G$(1 + $workers.Count)").NumberFormatLocal = '#.##0,00'
  Save-As $wb (Join-Path $out 'Folha de diaristas - setembro 2026.csv') $xlCSVUTF8 $true
  $wb.Close($false)

  # ---------------------------------------------------------------------------------------------
  # 5. Extrato conta corrente - setembro 2026.csv — "CSV" antigo do Excel: Windows-1252 (ANSI), ";".
  # ---------------------------------------------------------------------------------------------
  $wb = New-Book @('Extrato')
  $ws = $wb.Worksheets.Item(1)
  Header $ws 'A1' @('Data', 'Histórico', 'Documento', 'Valor', 'Saldo')
  $balance = 48250.37
  $history = @('Pagamento boleto Depósito Bom Preço', 'PIX enviado Carlos Alberto Souza', 'Transferência recebida — medição', 'Tarifa de manutenção de conta', 'Débito automático energia', 'PIX enviado Elétrica Central', 'Saque em espécie — diárias')
  for ($i = 0; $i -lt 30; $i++) {
    $row = 2 + $i
    $text = Pick $history
    $value = if ($text -like 'Transferência recebida*') { Money 8000 35000 } elseif ($text -like 'Tarifa*') { -39.9 } else { - (Money 120 6500) }
    $balance = [math]::Round($balance + $value, 2)
    $ws.Range("A$row").Value2 = OA (([datetime]'2026-09-01').AddDays([math]::Floor($i / 1.1)))
    $ws.Range("B$row").Value2 = $text
    $ws.Range("C$row").NumberFormat = '@'
    $ws.Range("C$row").Value2 = '{0:D6}' -f $rnd.Next(1, 999999)
    $ws.Range("D$row").Value2 = $value
    $ws.Range("E$row").Value2 = $balance
  }
  $ws.Range('A2:A31').NumberFormatLocal = 'dd/mm/aaaa'
  $ws.Range('D2:E31').NumberFormatLocal = '#.##0,00;-#.##0,00'
  Save-As $wb (Join-Path $out 'Extrato conta corrente - setembro 2026.csv') $xlCSV $true
  $wb.Close($false)

  # ---------------------------------------------------------------------------------------------
  # 6. Orçamento reforma do escritório.ods — montado no Excel e convertido pelo LibreOffice
  #    (o .ods sai com as repetições de linhas e colunas vazias típicas do LibreOffice).
  # ---------------------------------------------------------------------------------------------
  $wb = New-Book @('Orçamento', 'Cronograma')
  $ws = $wb.Worksheets.Item(1)
  Title $ws 'A1:F1' 'Orçamento — reforma do escritório (fictício)'
  Header $ws 'A3' @('Item', 'Descrição', 'Qtd.', 'Unid.', 'Preço unitário', 'Total')
  $budget = @(
    @('Demolição de divisórias', 18, 'm²', 35), @('Drywall com isolamento acústico', 42, 'm²', 128.5),
    @('Forro mineral', 60, 'm²', 96.4), @('Pontos de rede e elétrica', 24, 'pt', 165),
    @('Piso vinílico em régua', 60, 'm²', 142.9), @('Pintura acrílica', 180, 'm²', 22.5),
    @('Ar-condicionado split 18.000 BTU (instalado)', 2, 'un', 4890)
  )
  for ($i = 0; $i -lt $budget.Count; $i++) {
    $row = 4 + $i
    $ws.Range("A$row").Value2 = $i + 1
    $ws.Range("B$row").Value2 = $budget[$i][0]
    $ws.Range("C$row").Value2 = $budget[$i][1]
    $ws.Range("D$row").Value2 = $budget[$i][2]
    $ws.Range("E$row").Value2 = $budget[$i][3]
    $ws.Range("F$row").Formula = "=C$row*E$row"
  }
  $end = 3 + $budget.Count
  $ws.Range("E4:F$($end + 1)").NumberFormatLocal = '"R$" #.##0,00'
  $ws.Range("E$($end + 1)").Value2 = 'Total'
  $ws.Range("F$($end + 1)").Formula = "=SUM(F4:F$end)"
  $ws.Columns.Item('A:F').AutoFit() | Out-Null
  $cr = $wb.Worksheets.Item(2)
  Header $cr 'A1' @('Etapa', 'Início', 'Fim', 'Dias')
  $steps = @('Demolição', 'Drywall e forro', 'Elétrica e rede', 'Piso', 'Pintura e limpeza')
  $begin = [datetime]'2026-11-03'
  for ($i = 0; $i -lt $steps.Count; $i++) {
    $row = 2 + $i
    $finish = $begin.AddDays($rnd.Next(3, 9))
    $cr.Range("A$row").Value2 = $steps[$i]
    $cr.Range("B$row").Value2 = OA $begin
    $cr.Range("C$row").Value2 = OA $finish
    $cr.Range("D$row").Formula = "=C$row-B$row"
    $begin = $finish.AddDays(1)
  }
  $cr.Range("B2:C$(1 + $steps.Count)").NumberFormatLocal = 'dd/mm/aaaa'
  $cr.Range("D2:D$(1 + $steps.Count)").NumberFormat = '0'
  $cr.Columns.Item('A:D').AutoFit() | Out-Null
  $ws.Activate()
  $odsSource = Join-Path $tmp 'Orçamento reforma do escritório.xlsx'
  Save-As $wb $odsSource $xlOpenXMLWorkbook
  $wb.Close($false)
}
finally {
  $xl.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}

$soffice = 'C:\Program Files\LibreOffice\program\soffice.exe'
& $soffice --headless --convert-to ods --outdir $out $odsSource | Out-Null
Start-Sleep -Milliseconds 500

# Datas de modificação: o navegador sugere o "ano de referência" por elas (File.lastModified).
(Get-Item $medicoes).LastWriteTime = [datetime]'2025-12-15 18:30'
(Get-Item $legacy).LastWriteTime = [datetime]'2019-12-20 17:05'

Remove-Item $tmp -Recurse -Force
Get-ChildItem $out -File | Where-Object { $_.Extension -ne '.ps1' -and $_.Extension -ne '.md' } |
  Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
