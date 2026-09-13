/**
 * 🪟 Agente de janelas (UI Automation)
 *
 * Os comandos chegam longe, mas não carregam no botão "Guardar" de um programa
 * nem preenchem um formulário. Para isso havia duas formas: adivinhar
 * coordenadas numa captura de ecrã, ou perguntar ao Windows o que lá está.
 *
 * O UI Automation é a segunda. É o que os leitores de ecrã usam: o Windows diz,
 * para cada janela, que botões, campos, listas e menus tem, com o nome de cada
 * um e o que se pode fazer com ele. Carregar no botão "Guardar" deixa de
 * depender de onde ele está no ecrã.
 *
 * O CAMINHO DE UM PEDIDO
 *   1. ver as janelas abertas, e ler os elementos da que interessa;
 *   2. o modelo propõe os passos (escrever em "Nome", carregar em "Guardar");
 *   3. o código confirma que cada elemento existe, aceita aquela acção e não é
 *      um campo de palavra-passe, e mostra os passos ao utilizador;
 *   4. com o "sim", corre os passos e lê o estado final dos elementos.
 *
 * O QUE FICA DE FORA, SEMPRE
 * Terminais e a caixa Executar (escrever lá era contornar todas as regras dos
 * comandos), gestores de palavras-passe, o Gestor de Tarefas, janelas de
 * credenciais e o próprio NEXO. Campos de palavra-passe nem se lêem nem se
 * preenchem. O Windows também não deixa mexer em janelas de administrador.
 *
 * LIMITE CONHECIDO
 * Medido: controlos WinForms antigos aparecem só como "Pane", sem acções, a
 * este cliente de UI Automation. Aplicações modernas (Bloco de Notas,
 * Definições, WPF, browsers) aparecem completas.
 */

const powershell = require('./powershell');

const MAX_PASSOS = 10;
const MAX_TEXTO = 2000;
const MAX_ELEMENTOS = 150;

/** Processos cujas janelas não se lêem nem se tocam. */
const PROCESSOS_PROTEGIDOS = new Set([
  'powershell_ise', 'windowsterminal', 'openconsole', 'conhost', 'wt',
  'regedit', 'mmc', 'taskmgr', 'consent', 'credentialuibroker', 'lockapp', 'logonui',
  'sechealthui', 'securityhealthsystray', 'securityhealthhost',
  'searchhost', 'searchapp', 'startmenuexperiencehost', 'shellexperiencehost',
  'nexo', 'electron', 'node', 'msiexec',
  'keepass', 'keepassxc', 'bitwarden', '1password', 'lastpass', 'dashlane', 'enpass', 'nordpass', 'roboform',
  'putty', 'mstsc', 'vmconnect', 'vmware', 'virtualboxvm'
]);

/** Consolas, seja qual for o processo que o Windows diga que é o dono. */
const CLASSES_PROTEGIDAS = new Set(['consolewindowclass', 'cascadia_hosting_window_class', 'pseudoconsolewindow']);

/**
 * Shells cujas janelas gráficas (WPF, WinForms) são programas como os outros,
 * mas cuja consola fica de fora.
 */
const SHELLS = new Set(['powershell', 'pwsh', 'cmd']);
// Medido: o UI Automation diz "Window" como classe de uma janela WPF.
const CLASSES_GRAFICAS = /^(HwndWrapper|WindowsForms)|^Window$/i;

/** A caixa Executar do Windows corre qualquer programa: fica de fora. */
const TITULOS_PROTEGIDOS = /^(executar|run)$/i;

/** Botões e itens que merecem um aviso, mesmo com o "sim" a caminho. */
const NOMES_SENSIVEIS = /eliminar|apagar|excluir|remover|delete|remove|desinstalar|uninstall|formatar|format|comprar|pagar|buy|pay|checkout|encomendar|finalizar compra|enviar|send|publicar|publish|post|transferir|repor|reset|terminar sess|sign out|log ?out|sair da conta|desativar|disable/i;

const ACCOES = {
  carregar: 'carregar em',
  escrever: 'escrever em',
  marcar: 'marcar',
  desmarcar: 'desmarcar',
  escolher: 'escolher',
  expandir: 'abrir',
  recolher: 'fechar'
};

// ═══════════════════════════════════════════════════════════
// POWERSHELL
// ═══════════════════════════════════════════════════════════

const CABECALHO = String.raw`[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$pedidoDoNexo = [string]$env:NEXO_UIA | ConvertFrom-Json
$AE = [System.Windows.Automation.AutomationElement]
$walkerDoNexo = [System.Windows.Automation.TreeWalker]::ControlViewWalker

function TipoDe($e) { $e.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '' }

function ProcessoDe($e) {
  try { (Get-Process -Id $e.Current.ProcessId -ErrorAction Stop).ProcessName } catch { '' }
}

function AccoesDe($e) {
  $lista = @()
  $padroes = @($e.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName -replace 'PatternIdentifiers\.Pattern$', '' })
  if ($padroes -contains 'Invoke') { $lista += 'carregar' }
  if ($padroes -contains 'Value') {
    try { if (-not $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.IsReadOnly) { $lista += 'escrever' } } catch { }
  }
  if ($padroes -contains 'Toggle') { $lista += 'marcar'; $lista += 'desmarcar'; if ($lista -notcontains 'carregar') { $lista += 'carregar' } }
  if ($padroes -contains 'SelectionItem') { $lista += 'escolher'; if ($lista -notcontains 'carregar') { $lista += 'carregar' } }
  if ($padroes -contains 'ExpandCollapse') { $lista += 'expandir'; $lista += 'recolher' }
  ,$lista
}

function EstadoDe($e) {
  $estado = [ordered]@{}
  $padroes = @($e.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName -replace 'PatternIdentifiers\.Pattern$', '' })
  if ($padroes -contains 'Value' -and -not $e.Current.IsPassword) {
    try { $v = [string]$e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value; if ($v.Length -gt 120) { $v = $v.Substring(0, 120) + '…' }; $estado.valor = $v } catch { }
  }
  if ($padroes -contains 'Toggle') {
    try { $estado.marcado = ([string]$e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Current.ToggleState -eq 'On') } catch { }
  }
  if ($padroes -contains 'SelectionItem') {
    try { $estado.escolhido = [bool]$e.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected } catch { }
  }
  $estado
}

function Resumo($e) {
  $c = $e.Current
  $nome = [string]$c.Name; if ($nome.Length -gt 100) { $nome = $nome.Substring(0, 100) + '…' }
  [ordered]@{
    tipo = TipoDe $e; nome = $nome; id = [string]$c.AutomationId
    activo = [bool]$c.IsEnabled; senha = [bool]$c.IsPassword; visivel = -not $c.IsOffscreen
    accoes = AccoesDe $e; estado = EstadoDe $e
  }
}

function JanelaPorHandle($h) {
  try { $AE::FromHandle([IntPtr][int64]$h) } catch { $null }
}

function Procurar($raiz, $criterio) {
  $script:contagem = 0; $script:visitados = 0; $script:achado = $null
  $indice = if ($criterio.indice) { [int]$criterio.indice } else { 1 }
  function Descer($e, $prof) {
    if ($script:achado -or $script:visitados -gt 6000 -or $prof -gt 40) { return }
    $f = $walkerDoNexo.GetFirstChild($e)
    while ($f -and -not $script:achado) {
      $script:visitados++
      try {
        $c = $f.Current
        if ((TipoDe $f) -eq $criterio.tipo -and ([string]$c.Name).Trim() -eq ([string]$criterio.nome).Trim() -and (-not $criterio.id -or $c.AutomationId -eq $criterio.id)) {
          $script:contagem++
          if ($script:contagem -eq $indice) { $script:achado = $f; return }
        }
      } catch { }
      Descer $f ($prof + 1)
      $f = $walkerDoNexo.GetNextSibling($f)
    }
  }
  Descer $raiz 0
  $script:achado
}
`;

const SCRIPT_LISTAR = CABECALHO + String.raw`
$janelas = @(foreach ($j in $AE::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
  try {
    $c = $j.Current
    if (-not $c.Name) { continue }
    [ordered]@{ handle = [int64]$c.NativeWindowHandle; titulo = [string]$c.Name; processo = ProcessoDe $j; classe = [string]$c.ClassName }
  } catch { }
})
'@@NEXO@@' + (ConvertTo-Json -InputObject $janelas -Depth 4 -Compress)
`;

const SCRIPT_LER = CABECALHO + String.raw`
$janela = JanelaPorHandle $pedidoDoNexo.handle
if (-not $janela) { '@@NEXO@@' + (ConvertTo-Json -InputObject ([ordered]@{ erro = 'a janela já não existe' }) -Compress); return }
$INTERESSA = @('Button','Edit','Document','CheckBox','RadioButton','ComboBox','List','ListItem','MenuItem','TabItem','Hyperlink','SplitButton','TreeItem','Slider','Spinner','DataItem','Text','MenuBar','Menu','Tab','ToolBar','Group')
$script:elementos = New-Object System.Collections.ArrayList
$script:visitados = 0
$script:textos = 0
$max = [int]$pedidoDoNexo.max
function Colher($e, $prof) {
  if ($script:elementos.Count -ge $max -or $script:visitados -gt 5000 -or $prof -gt 40) { return }
  $f = $walkerDoNexo.GetFirstChild($e)
  while ($f -and $script:elementos.Count -lt $max) {
    $script:visitados++
    $saltar = $false
    try {
      $tipo = TipoDe $f
      if ($tipo -eq 'ScrollBar' -or $tipo -eq 'TitleBar') { $saltar = $true }
      elseif ($INTERESSA -contains $tipo) {
        $nome = [string]$f.Current.Name
        $contar = $true
        # O texto dentro de um botão repete o nome do botão: só ocupa espaço.
        if ($tipo -eq 'Text') {
          $repete = ($script:elementos.Count -gt 0 -and $script:elementos[$script:elementos.Count - 1].nome -eq $nome)
          $contar = ($nome -and -not $repete -and $nome.Length -le 100 -and $script:textos -lt 40)
          if ($contar) { $script:textos++ }
        }
        if ($tipo -in @('Group','ToolBar','Tab','MenuBar','Menu','List') -and -not $nome) { $contar = $false }
        if ($contar) { [void]$script:elementos.Add((Resumo $f)) }
      }
    } catch { }
    if (-not $saltar) { Colher $f ($prof + 1) }
    $f = $walkerDoNexo.GetNextSibling($f)
  }
}
Colher $janela 0
'@@NEXO@@' + (ConvertTo-Json -InputObject ([ordered]@{ titulo = [string]$janela.Current.Name; processo = ProcessoDe $janela; elementos = @($script:elementos); cortado = ($script:elementos.Count -ge $max) }) -Depth 6 -Compress)
`;

const SCRIPT_VALIDAR = CABECALHO + String.raw`
$janela = JanelaPorHandle $pedidoDoNexo.handle
if (-not $janela) { '@@NEXO@@' + (ConvertTo-Json -InputObject ([ordered]@{ erro = 'a janela já não existe' }) -Compress); return }
$resultado = @(foreach ($passo in @($pedidoDoNexo.passos)) {
  $e = Procurar $janela $passo
  if ($e) { [ordered]@{ encontrado = $true; elemento = (Resumo $e) } } else { [ordered]@{ encontrado = $false } }
})
'@@NEXO@@' + (ConvertTo-Json -InputObject ([ordered]@{ titulo = [string]$janela.Current.Name; processo = ProcessoDe $janela; passos = $resultado }) -Depth 6 -Compress)
`;

const SCRIPT_EXECUTAR = CABECALHO + String.raw`
# Um Invoke num botão que abre uma janela modal pode ficar à espera que ela
# feche. Corre noutra thread e segue ao fim de alguns segundos.
function CarregarSemPrender($e) {
  $padrao = $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $outra = [powershell]::Create()
  [void]$outra.AddScript({ param($p) $p.Invoke() }).AddArgument($padrao)
  $espera = $outra.BeginInvoke()
  if (-not $espera.AsyncWaitHandle.WaitOne(4000)) { return 'carregado; abriu-se algo que ficou à espera' }
  $outra.EndInvoke($espera) | Out-Null
  if ($outra.HadErrors) { throw $outra.Streams.Error[0].Exception }
  return $null
}

$protegidos = @($pedidoDoNexo.protegidos)
$resultados = New-Object System.Collections.ArrayList
$parou = $false
foreach ($passo in @($pedidoDoNexo.passos)) {
  if ($parou) { break }
  $r = [ordered]@{ ok = $false; nota = $null; erro = $null }
  try {
    $janela = JanelaPorHandle $pedidoDoNexo.handle
    if (-not $janela) { throw 'a janela fechou-se' }
    $processo = (ProcessoDe $janela).ToLower()
    if ($protegidos -contains $processo) { throw "a janela é de $processo, que não se toca" }
    $e = $null
    for ($tentativa = 0; $tentativa -lt 6 -and -not $e; $tentativa++) {
      $e = Procurar $janela $passo
      if (-not $e) { Start-Sleep -Milliseconds 500 }
    }
    if (-not $e) { throw "não encontrei $($passo.tipo) '$($passo.nome)'" }
    if (-not $e.Current.IsEnabled) { throw "$($passo.tipo) '$($passo.nome)' está desactivado" }
    switch ($passo.accao) {
      'carregar' {
        $padroes = @($e.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName -replace 'PatternIdentifiers\.Pattern$', '' })
        if ($padroes -contains 'Invoke') { $r.nota = CarregarSemPrender $e }
        elseif ($padroes -contains 'Toggle') { $e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Toggle() }
        elseif ($padroes -contains 'SelectionItem') { $e.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select() }
        elseif ($padroes -contains 'ExpandCollapse') { $e.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand() }
        else { throw 'este elemento não se pode carregar' }
      }
      'escrever' {
        if ($e.Current.IsPassword) { throw 'é um campo de palavra-passe' }
        $valor = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($valor.Current.IsReadOnly) { throw 'o campo só dá para ler' }
        $valor.SetValue([string]$passo.texto)
      }
      { $_ -in @('marcar', 'desmarcar') } {
        $t = $e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
        $quer = if ($passo.accao -eq 'marcar') { 'On' } else { 'Off' }
        for ($i = 0; $i -lt 3 -and [string]$t.Current.ToggleState -ne $quer; $i++) { $t.Toggle() }
        if ([string]$t.Current.ToggleState -ne $quer) { throw 'não ficou no estado pedido' }
      }
      'escolher' { $e.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select() }
      'expandir' { $e.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand() }
      'recolher' { $e.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Collapse() }
      default { throw "acção desconhecida: $($passo.accao)" }
    }
    $r.ok = $true
    Start-Sleep -Milliseconds 400
  } catch {
    $r.erro = [string]$_.Exception.Message
    if (-not $r.erro) { $r.erro = [string]$_ }
    $parou = $true
  }
  [void]$resultados.Add($r)
}

# O estado final dos elementos em que se mexeu, para confirmar.
$janela = JanelaPorHandle $pedidoDoNexo.handle
$finais = @(foreach ($passo in @($pedidoDoNexo.passos)) {
  $e = if ($janela) { Procurar $janela $passo } else { $null }
  if ($e) { [ordered]@{ existe = $true; estado = (EstadoDe $e) } } else { [ordered]@{ existe = $false } }
})
$titulo = if ($janela) { try { [string]$janela.Current.Name } catch { $null } } else { $null }
'@@NEXO@@' + (ConvertTo-Json -InputObject ([ordered]@{ resultados = @($resultados); finais = $finais; titulo = $titulo; janelaAberta = [bool]$janela }) -Depth 6 -Compress)
`;

async function correrUIA(script, pedido = {}, timeout = 45000) {
  const bruto = await powershell.correr(script, {
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NEXO_UIA: JSON.stringify(pedido) }
  });
  const marca = bruto.lastIndexOf('@@NEXO@@');
  if (marca < 0) throw new Error('o Windows não respondeu sobre as janelas');
  return JSON.parse(bruto.slice(marca + '@@NEXO@@'.length));
}

function lista(valor) {
  if (valor == null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

// ═══════════════════════════════════════════════════════════
// REGRAS
// ═══════════════════════════════════════════════════════════

/** @returns {string|null} o motivo por que a janela fica de fora */
function janelaProtegida(janela) {
  const processo = String(janela?.processo || '').toLowerCase();
  const classe = String(janela?.classe || '');
  if (PROCESSOS_PROTEGIDOS.has(processo)) return `as janelas de ${janela.processo} ficam de fora (terminais, credenciais, palavras-passe e o próprio NEXO nunca se tocam)`;
  if (CLASSES_PROTEGIDAS.has(classe.toLowerCase())) return 'as consolas e terminais ficam de fora: escrever lá era correr comandos sem as regras dos comandos';
  if (SHELLS.has(processo) && !CLASSES_GRAFICAS.test(classe)) return `a consola de ${janela.processo} fica de fora: escrever lá era correr comandos sem as regras dos comandos`;
  if (processo === 'explorer' && TITULOS_PROTEGIDOS.test(String(janela?.titulo || '').trim())) return 'a caixa Executar do Windows corre qualquer programa, e fica de fora';
  if (/\b(nexo)\b/i.test(String(janela?.titulo || '')) && /nexo|electron|node/i.test(processo)) return 'a janela do próprio NEXO fica de fora';
  return null;
}

/**
 * Verifica os passos antes de os mostrar.
 * @returns {{ motivo: string } | { passos: Array }}
 */
function validarPassos(passos, janela) {
  const lista_ = lista(passos);
  if (!lista_.length) return { motivo: 'não há passos' };
  if (lista_.length > MAX_PASSOS) return { motivo: `são ${lista_.length} passos; o máximo é ${MAX_PASSOS}, para o utilizador conseguir ler o que aprova` };

  const limpos = [];
  for (const [i, p] of lista_.entries()) {
    const accao = String(p?.accao || '').toLowerCase();
    if (!ACCOES[accao]) return { motivo: `o passo ${i + 1} tem uma acção desconhecida ("${p?.accao}"); as possíveis são ${Object.keys(ACCOES).join(', ')}` };
    const nome = String(p?.nome || '').trim();
    const tipo = String(p?.tipo || '').trim();
    if (!nome || !tipo) return { motivo: `o passo ${i + 1} precisa do tipo e do nome do elemento, tal como aparecem na leitura da janela` };
    const passo = { accao, tipo, nome, id: p?.id ? String(p.id) : '', indice: Number.isInteger(p?.indice) && p.indice > 0 ? p.indice : 1 };
    if (accao === 'escrever') {
      const texto = String(p?.texto ?? '');
      if (texto.length > MAX_TEXTO) return { motivo: `o texto do passo ${i + 1} tem mais de ${MAX_TEXTO} caracteres` };
      // O Explorador corre programas escritos na barra de endereço.
      if (String(janela?.processo || '').toLowerCase() === 'explorer') return { motivo: 'escrever no Explorador de Ficheiros fica de fora: a barra de endereço corre programas' };
      if (/^\s*(javascript|vbscript|data|file):/i.test(texto)) return { motivo: `o texto do passo ${i + 1} é um endereço que corre código` };
      passo.texto = texto;
    }
    limpos.push(passo);
  }
  return { passos: limpos };
}

// ═══════════════════════════════════════════════════════════
// O QUE O MODELO USA
// ═══════════════════════════════════════════════════════════

async function listarJanelas() {
  const todas = lista(await correrUIA(SCRIPT_LISTAR, {}, 20000));
  return todas
    .filter(j => j.titulo && !['Program Manager'].includes(j.titulo))
    .map(j => ({ ...j, protegida: janelaProtegida(j) }));
}

/**
 * Encontra a janela pedida: pelo número (handle), pelo nome do programa ou
 * por parte do título.
 */
async function encontrarJanela(pedido) {
  const texto = String(pedido || '').trim();
  if (!texto) return { erro: 'diz qual é a janela (parte do título ou o nome do programa)' };
  const janelas = await listarJanelas();
  const baixo = texto.toLowerCase();

  let candidatas = janelas.filter(j => String(j.handle) === texto);
  if (!candidatas.length) candidatas = janelas.filter(j => j.processo.toLowerCase() === baixo.replace(/\.exe$/, ''));
  if (!candidatas.length) candidatas = janelas.filter(j => j.titulo.toLowerCase().includes(baixo));

  if (!candidatas.length) {
    return { erro: `não há nenhuma janela aberta com "${texto}". Abertas: ${janelas.filter(j => !j.protegida).map(j => `"${j.titulo}" (${j.processo})`).join('; ').slice(0, 800)}` };
  }
  if (candidatas.length > 1) {
    return { erro: `há ${candidatas.length} janelas com "${texto}": ${candidatas.map(j => `${j.handle} "${j.titulo}"`).join('; ').slice(0, 800)}. Usa o número da janela.` };
  }
  const janela = candidatas[0];
  if (janela.protegida) return { erro: janela.protegida };
  return { janela };
}

function textoDasJanelas(janelas) {
  const livres = janelas.filter(j => !j.protegida);
  if (!livres.length) return 'Não há janelas abertas em que o NEXO possa mexer.';
  return 'Janelas abertas (número, título, programa):\n' +
    livres.map(j => `- ${j.handle}: "${j.titulo}" (${j.processo})`).join('\n') +
    (janelas.length > livres.length ? `\n(${janelas.length - livres.length} janela(s) de terminais, credenciais ou do NEXO ficaram de fora)` : '');
}

function descreverElemento(e) {
  const estado = e.estado || {};
  const partes = [`${e.tipo} "${e.nome}"`];
  if (e.id) partes.push(`id=${e.id}`);
  if (e.senha) partes.push('palavra-passe (não se lê nem se preenche)');
  if (!e.activo) partes.push('desactivado');
  if (e.visivel === false) partes.push('fora do ecrã');
  if (estado.valor !== undefined && !e.senha) partes.push(`valor="${estado.valor}"`);
  if (estado.marcado !== undefined) partes.push(estado.marcado ? 'marcado' : 'desmarcado');
  if (estado.escolhido) partes.push('escolhido');
  const accoes = lista(e.accoes).filter(a => !(e.senha && a === 'escrever'));
  if (accoes.length) partes.push(`acções: ${accoes.join(', ')}`);
  return partes.join(' · ');
}

async function lerJanela(pedido) {
  const achada = await encontrarJanela(pedido);
  if (achada.erro) return achada.erro;
  const r = await correrUIA(SCRIPT_LER, { handle: achada.janela.handle, max: MAX_ELEMENTOS });
  if (r.erro) return r.erro;
  const elementos = lista(r.elementos);
  if (!elementos.length) {
    return `A janela "${r.titulo}" (${r.processo}) não mostra elementos ao UI Automation. Alguns programas antigos (WinForms) aparecem vazios assim.`;
  }
  return `Janela ${achada.janela.handle}: "${r.titulo}" (${r.processo})\n` +
    elementos.map(e => `- ${descreverElemento(e)}`).join('\n') +
    (r.cortado ? `\n(mostrados os primeiros ${MAX_ELEMENTOS})` : '') +
    '\nPara agir, usa o tipo e o nome exactamente como aparecem aqui.';
}

/**
 * Prepara os passos numa janela, para ficarem à espera do "sim".
 * @returns {Promise<Object>} como as outras preparações: { success, titulo, descricao, instrucao, rodape, executar } ou { success: false, error }
 */
async function prepararAccaoJanela({ tarefa, explicacao, janela, passos } = {}) {
  const descricaoDaTarefa = String(tarefa || '').trim() || 'acção numa janela';
  const achada = await encontrarJanela(janela);
  if (achada.erro) return { success: false, error: achada.erro };

  const validos = validarPassos(passos, achada.janela);
  if (validos.motivo) return { success: false, error: validos.motivo };

  const verificacao = await correrUIA(SCRIPT_VALIDAR, { handle: achada.janela.handle, passos: validos.passos });
  if (verificacao.erro) return { success: false, error: verificacao.erro };

  const linhas = [];
  const avisos = [];
  for (const [i, passo] of validos.passos.entries()) {
    const v = lista(verificacao.passos)[i] || {};
    const alvo = `${passo.tipo} "${passo.nome}"${passo.indice > 1 ? ` (o ${passo.indice}.º)` : ''}`;
    const descricao = passo.accao === 'escrever'
      ? `escrever "${passo.texto.length > 80 ? `${passo.texto.slice(0, 80)}…` : passo.texto}" em ${alvo}`
      : `${ACCOES[passo.accao]} ${alvo}`;

    if (v.encontrado) {
      const e = v.elemento;
      if (e.senha) return { success: false, error: `${alvo} é um campo de palavra-passe: o NEXO não lê nem preenche palavras-passe` };
      const aceita = lista(e.accoes).includes(passo.accao);
      if (!aceita) return { success: false, error: `${alvo} não aceita "${passo.accao}". Aceita: ${lista(e.accoes).join(', ') || 'nada'}` };
      if (i === 0 && !e.activo) return { success: false, error: `${alvo} está desactivado` };
    } else if (i === 0) {
      return { success: false, error: `não encontrei ${alvo} na janela "${verificacao.titulo}". Lê a janela e usa o tipo e o nome exactamente como aparecem.` };
    }

    const sensivel = NOMES_SENSIVEIS.test(passo.nome);
    if (sensivel) avisos.push(passo.nome);
    linhas.push(`${i + 1}. ${descricao}${v.encontrado ? '' : ' (ainda não está visível: vai ser procurado depois dos passos anteriores)'}${sensivel ? ' ⚠️ sensível' : ''}`);
  }

  const partes = [
    `**${String(explicacao || descricaoDaTarefa).slice(0, 400)}**`,
    '',
    `Na janela "${verificacao.titulo}" (${verificacao.processo}), por esta ordem:`,
    ...linhas
  ];
  if (avisos.length) partes.push('', `⚠️ Atenção: ${avisos.map(a => `"${a}"`).join(', ')} pode apagar, enviar ou pagar alguma coisa.`);
  partes.push('', 'O NEXO confirmou que os elementos visíveis existem e aceitam estas acções. Não carrega em mais nada além disto.');

  const handle = achada.janela.handle;
  const processo = achada.janela.processo;
  const executar = async () => executarAccaoJanela({ tarefa: descricaoDaTarefa, handle, processo, passos: validos.passos, linhas });

  return {
    success: true,
    titulo: descricaoDaTarefa,
    descricao: partes.join('\n'),
    instrucao: 'Mostra ao utilizador os passos acima tal como estão e pergunta se confirma. Ele responde "sim" para avançar ou "não" para cancelar. Não digas que já foi feito.',
    rodape: '',
    executar
  };
}

async function executarAccaoJanela({ tarefa, handle, processo, passos, linhas }) {
  let r;
  try {
    r = await correrUIA(SCRIPT_EXECUTAR, { handle, passos, protegidos: [...PROCESSOS_PROTEGIDOS] }, 90000);
  } catch (err) {
    return { success: false, message: `❌ ${tarefa}: ${err.killed ? 'demorou demasiado e foi interrompido' : err.message}` };
  }

  const resultados = lista(r.resultados);
  const finais = lista(r.finais);
  const sucesso = resultados.length === passos.length && resultados.every(x => x.ok);

  const saida = [sucesso ? `✅ Feito: ${tarefa}.` : `❌ ${tarefa}: parou a meio.`];
  for (const [i, linha] of linhas.entries()) {
    const res = resultados[i];
    const marca = !res ? '— não chegou a correr' : res.ok ? `✓${res.nota ? ` (${res.nota})` : ''}` : `✗ ${traduzirErroUIA(res.erro)}`;
    saida.push(`${linha.replace(/ \(ainda não está visível[^)]*\)/, '').replace(' ⚠️ sensível', '')} ${marca}`);
  }

  const estados = [];
  for (const [i, passo] of passos.entries()) {
    const f = finais[i];
    if (!f) continue;
    if (!f.existe) { estados.push(`${passo.tipo} "${passo.nome}": já não está na janela`); continue; }
    const e = f.estado || {};
    if (e.valor !== undefined) estados.push(`${passo.tipo} "${passo.nome}" = "${e.valor}"`);
    else if (e.marcado !== undefined) estados.push(`${passo.tipo} "${passo.nome}": ${e.marcado ? 'marcado' : 'desmarcado'}`);
    else if (e.escolhido !== undefined) estados.push(`${passo.tipo} "${passo.nome}": ${e.escolhido ? 'escolhido' : 'não escolhido'}`);
  }
  if (estados.length || r.titulo !== undefined) {
    saida.push('');
    saida.push(`Estado depois: ${[...new Set(estados)].join('; ') || '—'}${r.janelaAberta ? `; janela "${r.titulo}"` : '; a janela fechou-se'}`);
  }

  if (sucesso) {
    try {
      const comandosAgent = require('./comandosAgent');
      comandosAgent.registarSucesso(tarefa, JSON.stringify(passos), { tipo: 'janela', processo });
    } catch (e) { /* aprender não pode estragar o resultado */ }
  }

  return { success: sucesso, message: saida.join('\n') };
}

function traduzirErroUIA(erro) {
  const texto = String(erro || '');
  if (/access is denied|acesso negado|UIPI|0x80070005/i.test(texto)) return 'o Windows não deixou (a janela pode ser de administrador)';
  if (/ElementNotAvailable|not available/i.test(texto)) return 'o elemento desapareceu entretanto';
  return texto.slice(0, 200);
}

module.exports = {
  listarJanelas,
  encontrarJanela,
  textoDasJanelas,
  lerJanela,
  prepararAccaoJanela,
  executarAccaoJanela,
  validarPassos,
  janelaProtegida,
  descreverElemento,
  PROCESSOS_PROTEGIDOS,
  NOMES_SENSIVEIS,
  MAX_PASSOS
};
