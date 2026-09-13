/**
 * 🛡️ Regras dos comandos gerados
 *
 * O NEXO pode escrever os seus próprios comandos PowerShell para responder a
 * perguntas sobre o PC. Quem decide se um comando corre não é a IA: é este
 * ficheiro, e não se deixa convencer por um texto bem escrito.
 *
 * COMO LÊ O COMANDO
 * Nada de expressões regulares sobre o texto: o PowerShell tem demasiadas
 * formas de dizer a mesma coisa (aliases, métodos .NET, "& $variavel",
 * strings com $(...) lá dentro). Quem lê é o analisador do próprio
 * PowerShell, que devolve a árvore do comando SEM o correr. O código recebe
 * essa árvore e verifica cada comando, cada método e cada atribuição.
 *
 * LISTA DO QUE É PERMITIDO, NÃO DO QUE É PROIBIDO
 * Uma lista de coisas proibidas esquece-se sempre de uma. Aqui só passa o que
 * está na lista de leituras conhecidas; tudo o resto é recusado, mesmo que
 * fosse inofensivo. Na dúvida, não corre.
 *
 * PORQUE NÃO O MODO RESTRITO DO POWERSHELL
 * Foi medido. O ConstrainedLanguage bloqueia bem o que é perigoso, mas também
 * parte leituras normais: Get-PhysicalDisk e Get-NetAdapter deixam de carregar
 * o módulo, e [math]::Round sobre um resultado dá erro. Ficava um NEXO que não
 * consegue ver os discos. A árvore dá o mesmo controlo sem esse custo.
 */

const powershell = require('./powershell');

// ═══════════════════════════════════════════════════════════
// O QUE PODE CORRER
// ═══════════════════════════════════════════════════════════

/** Comandos que não começam por Get- mas só arrumam ou mostram dados. */
const COMANDOS_DE_ARRUMAR = new Set([
  'measure-object', 'select-object', 'sort-object', 'where-object', 'foreach-object',
  'group-object', 'format-table', 'format-list', 'format-wide', 'out-string',
  'convertto-json', 'convertto-csv', 'convertfrom-json', 'test-path', 'resolve-path',
  'split-path', 'join-path', 'compare-object', 'write-output', 'write-host',
  'new-timespan', 'measure-command'
]);

/**
 * Leituras que não entram, mesmo começando por Get-.
 *
 * Get-Content e Select-String lêem o conteúdo de ficheiros: isso tem ferramenta
 * própria, com a sua barreira. As outras mostram segredos, abrem janelas ou
 * escrevem ficheiros apesar do nome.
 */
const LEITURAS_RECUSADAS = {
  'get-content': 'lê o conteúdo de ficheiros, e para isso há a ferramenta de ler ficheiros',
  'get-clipboard': 'a área de transferência tem ferramenta própria',
  'get-credential': 'pede palavras-passe',
  'get-history': 'o histórico de comandos pode ter segredos',
  'get-bitlockervolume': 'mostra chaves de recuperação do disco',
  'get-help': 'pode abrir o navegador ou uma janela',
  'get-windowsupdatelog': 'apesar do nome, escreve um ficheiro no ambiente de trabalho'
};

/** Nomes que cheiram a segredos, em qualquer comando. */
const PARECE_SEGREDO = /credential|secret|password|passwd|recoverykey|bitlocker/i;

/** Parâmetros que levam o comando para fora deste PC ou pedem credenciais. */
const PARAMETROS_RECUSADOS = new Set([
  'computername', 'cimsession', 'session', 'pssession', 'credential', 'asjob', 'online', 'showwindow'
]);

/** Métodos que só transformam o valor que já se tem. */
const METODOS_DE_INSTANCIA = new Set([
  'tostring', 'trim', 'trimstart', 'trimend', 'substring', 'split', 'replace',
  'tolower', 'toupper', 'tolowerinvariant', 'toupperinvariant', 'startswith', 'endswith',
  'contains', 'indexof', 'lastindexof', 'padleft', 'padright', 'equals', 'compareto',
  'gettype', 'toshortdatestring', 'tolongdatestring', 'toshorttimestring',
  'adddays', 'addhours', 'addminutes', 'addseconds', 'subtract', 'getvaluenames', 'getsubkeynames',
  // Os dois intrínsecos do PowerShell, só com blocos de código lá dentro:
  // .ForEach('Delete') chamaria um método pelo nome.
  'foreach', 'where'
]);

/** Métodos estáticos permitidos, por tipo. */
const METODOS_ESTATICOS = {
  math: ['round', 'floor', 'ceiling', 'max', 'min', 'abs', 'truncate', 'pow', 'sqrt'],
  string: ['join', 'isnullorempty', 'isnullorwhitespace', 'format', 'concat'],
  environment: ['getfolderpath', 'getlogicaldrives', 'getenvironmentvariable'],
  'io.driveinfo': ['getdrives'],
  'io.path': ['combine', 'getfilename', 'getextension', 'getdirectoryname', 'getfilenamewithoutextension'],
  datetime: ['parse', 'fromfiletime', 'daysinmonth'],
  timespan: ['fromseconds', 'fromminutes', 'fromhours', 'fromdays', 'frommilliseconds'],
  'net.dns': ['gethostname'],
  convert: ['toint32', 'toint64', 'todouble', 'tostring']
};

/** Estruturas que não se usam para ler e podem esconder código. */
const ESTRUTURAS_RECUSADAS = {
  TypeDefinitionAst: 'define classes',
  UsingStatementAst: 'carrega módulos ou assemblies',
  DynamicKeywordStatementAst: 'usa palavras-chave dinâmicas',
  ConfigurationDefinitionAst: 'define configurações DSC',
  DataStatementAst: 'usa secções de dados'
};

/** Comandos que mudam o PC. Servem para explicar a recusa, não para a decidir. */
const VERBOS_QUE_MUDAM = /^(set|remove|new|stop|start|restart|clear|rename|move|copy|install|uninstall|disable|enable|add|invoke|update|register|unregister|suspend|resume|reset|format|mount|dismount|initialize|lock|unlock|send|export|import|out|write|push|pop|save|restore|repair|optimize|grant|revoke|block|unblock|protect|unprotect|connect|disconnect|debug|wait|receive|enter|exit)-/i;

// ═══════════════════════════════════════════════════════════
// O ANALISADOR
// ═══════════════════════════════════════════════════════════

/**
 * Corre dentro do PowerShell e devolve a árvore resumida em JSON.
 * O comando é só analisado: nunca é executado aqui.
 *
 * O comando chega numa variável de ambiente, e não dentro do script. Medido:
 * com o comando em base64 metido no -EncodedCommand (base64 dentro de base64),
 * o Windows recusou arrancar o processo ("spawn EPERM") sempre que o conteúdo
 * era um certo comando inofensivo com uma função. É o padrão que o antivírus
 * procura em malware. Assim a linha de comandos é sempre a mesma.
 */
const VARIAVEL_DO_CODIGO = 'NEXO_COMANDO_A_VERIFICAR';

const SCRIPT_ANALISE = String.raw`[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$codigo = [string]$env:NEXO_COMANDO_A_VERIFICAR
$tokens = $null; $errosSintaxe = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($codigo, [ref]$tokens, [ref]$errosSintaxe)
# Nomes compridos de propósito: no PowerShell $a e $A são a mesma variável, e
# um "foreach ($a in ...)" mais abaixo estragava um prefixo chamado $A.
$prefixoDaArvore = 'System.Management.Automation.Language.'

function Todos([string]$nomeDoTipo) {
  $t = [type]($prefixoDaArvore + $nomeDoTipo)
  @($ast.FindAll({ param($n) $n -is $t }.GetNewClosure(), $true))
}

function AlvoPerigoso($n) {
  if ($n -is [System.Management.Automation.Language.VariableExpressionAst]) {
    return ($n.VariablePath.IsDriveQualified -and $n.VariablePath.DriveName -notin @('env', 'variable'))
  }
  if ($n -is [System.Management.Automation.Language.ConvertExpressionAst]) { return (AlvoPerigoso $n.Child) }
  if ($n -is [System.Management.Automation.Language.ArrayLiteralAst]) {
    foreach ($e in $n.Elements) { if (AlvoPerigoso $e) { return $true } }
    return $false
  }
  if ($n -is [System.Management.Automation.Language.IndexExpressionAst]) {
    return -not ($n.Target -is [System.Management.Automation.Language.VariableExpressionAst] -and -not $n.Target.VariablePath.IsDriveQualified)
  }
  return $true
}

$comandos = @(foreach ($c in (Todos 'CommandAst')) {
  $nome = $c.GetCommandName()
  $resolvido = $null; $tipo = $null
  if ($nome -and $nome -notmatch '[\*\?\[]') {
    $cmd = Get-Command -Name $nome -ErrorAction SilentlyContinue | Select-Object -First 1
    # O ResolvedCommand vem vazio enquanto o módulo do comando não foi
    # carregado (medido com gci e gc). O Definition tem sempre o nome.
    if ($cmd -and $cmd.CommandType -eq 'Alias') { $cmd = Get-Command -Name $cmd.Definition -ErrorAction SilentlyContinue | Select-Object -First 1 }
    if ($cmd) { $resolvido = $cmd.Name; $tipo = [string]$cmd.CommandType }
  }
  # Do Windows é o que vem sem módulo (núcleo) ou de um módulo instalado com o
  # próprio Windows. Um Get- de um módulo à parte pode ler serviços na nuvem
  # com credenciais guardadas.
  $doSistema = $false
  if ($cmd) {
    $origem = [string]$cmd.Module.Path
    $doSistema = (-not $cmd.Module) -or $origem -like "$env:SystemRoot\*" -or $origem -like "$PSHOME\*"
  }
  $elementos = @(foreach ($e in @($c.CommandElements | Select-Object -Skip 1)) {
    $par = $null
    if ($e -is [System.Management.Automation.Language.CommandParameterAst]) { $par = $e.ParameterName }
    $espalhado = ($e -is [System.Management.Automation.Language.VariableExpressionAst] -and $e.Splatted)
    [ordered]@{ tipo = $e.GetType().Name; parametro = $par; espalhado = [bool]$espalhado }
  })
  [ordered]@{ nome = $nome; resolvido = $resolvido; tipo = $tipo; doSistema = [bool]$doSistema; invocacao = [string]$c.InvocationOperator; elementos = $elementos }
})

$metodos = @(foreach ($m in (Todos 'InvokeMemberExpressionAst')) {
  $nomeM = $null; $tipoM = $null
  if ($m.Member -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $nomeM = $m.Member.Value }
  if ($m.Expression -is [System.Management.Automation.Language.TypeExpressionAst]) { $tipoM = $m.Expression.TypeName.FullName }
  [ordered]@{ nome = $nomeM; estatico = [bool]$m.Static; tipo = $tipoM; argumentos = @(@($m.Arguments) | Where-Object { $_ } | ForEach-Object { $_.GetType().Name }) }
})

$atribuicoesPerigosas = @(foreach ($a in (Todos 'AssignmentStatementAst')) {
  if (AlvoPerigoso $a.Left) { $a.Left.Extent.Text }
})
foreach ($u in (Todos 'UnaryExpressionAst')) {
  if ([string]$u.TokenKind -match 'PlusPlus|MinusMinus' -and (AlvoPerigoso $u.Child)) { $atribuicoesPerigosas += $u.Extent.Text }
}

$unidades = @(foreach ($v in (Todos 'VariableExpressionAst')) {
  if ($v.VariablePath.IsDriveQualified -and $v.VariablePath.DriveName -notin @('env', 'variable')) { $v.Extent.Text }
})

$redireccoes = @(foreach ($r in (Todos 'FileRedirectionAst')) {
  $nulo = ($r.Location -is [System.Management.Automation.Language.VariableExpressionAst] -and $r.Location.VariablePath.UserPath -eq 'null')
  if (-not $nulo) { $r.Extent.Text }
})

$textos = @(@(Todos 'StringConstantExpressionAst') + @(Todos 'ExpandableStringExpressionAst') |
  Select-Object -First 300 | ForEach-Object { [string]$_.Value })

$conversoes = @(foreach ($c in (Todos 'ConvertExpressionAst')) { $c.Type.TypeName.FullName })

$estruturas = @()
foreach ($nomeE in @('TypeDefinitionAst', 'UsingStatementAst', 'DynamicKeywordStatementAst', 'ConfigurationDefinitionAst', 'DataStatementAst')) {
  if (@(Todos $nomeE).Count -gt 0) { $estruturas += $nomeE }
}

$funcoes = @(foreach ($f in (Todos 'FunctionDefinitionAst')) { $f.Name })

[ordered]@{
  errosSintaxe = @($errosSintaxe | ForEach-Object { $_.Message })
  comandos = $comandos
  metodos = $metodos
  atribuicoesPerigosas = $atribuicoesPerigosas
  unidades = $unidades
  redireccoes = $redireccoes
  textos = $textos
  conversoes = $conversoes
  estruturas = $estruturas
  funcoes = $funcoes
} | ConvertTo-Json -Depth 6 -Compress
`;

/** Pede ao PowerShell a árvore do comando, sem o correr. */
async function analisar(script) {
  const saida = await powershell.correr(SCRIPT_ANALISE, {
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, [VARIAVEL_DO_CODIGO]: String(script) }
  });
  const inicio = saida.indexOf('{');
  if (inicio < 0) throw new Error('o analisador não devolveu nada');
  return JSON.parse(saida.slice(inicio));
}

// ═══════════════════════════════════════════════════════════
// A DECISÃO
// ═══════════════════════════════════════════════════════════

/** O ConvertTo-Json do PowerShell 5.1 às vezes devolve um objecto onde se esperava uma lista. */
function lista(valor) {
  if (valor == null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

/** Normaliza nomes de tipos: [System.Math] e [math] são o mesmo. */
function nomeDeTipo(tipo) {
  return String(tipo || '').toLowerCase().replace(/^system\./, '');
}

/**
 * Decide, a partir da árvore, se o comando pode correr.
 *
 * @returns {{ classe: 'ler'|'muda'|'recusado', motivos: string[] }}
 *   'ler' corre; 'muda' é um comando que altera o PC (fica para a fase com
 *   confirmação); 'recusado' é tudo o resto que não se consegue garantir.
 */
function classificar(analise) {
  const motivos = [];
  let muda = false;

  const erros = lista(analise.errosSintaxe);
  if (erros.length) return { classe: 'recusado', motivos: [`o comando tem erros de escrita: ${erros[0]}`] };

  for (const nome of lista(analise.estruturas)) {
    motivos.push(`${ESTRUTURAS_RECUSADAS[nome] || nome}`);
  }

  const funcoes = new Set(lista(analise.funcoes).map(f => String(f).toLowerCase()));

  for (const c of lista(analise.comandos)) {
    const escrito = c.nome || '(nome calculado)';

    if (!c.nome) { motivos.push('chama um comando cujo nome só se sabe a correr'); continue; }
    if (c.invocacao && c.invocacao !== 'Unknown') { motivos.push(`invoca "${escrito}" com & ou . em vez de o chamar directamente`); continue; }

    if (funcoes.has(String(c.nome).toLowerCase()) && !c.resolvido) continue;

    if (!c.resolvido) { motivos.push(`"${escrito}" não é um comando conhecido neste PC`); continue; }
    if (c.tipo === 'Application' || c.tipo === 'ExternalScript') { motivos.push(`"${escrito}" é um programa ou script externo`); continue; }

    const nome = String(c.resolvido).toLowerCase();

    if (VERBOS_QUE_MUDAM.test(nome) && !COMANDOS_DE_ARRUMAR.has(nome)) {
      muda = true;
      motivos.push(`${c.resolvido} muda o PC`);
      continue;
    }
    if (LEITURAS_RECUSADAS[nome]) { motivos.push(`${c.resolvido} ${LEITURAS_RECUSADAS[nome]}`); continue; }
    if (PARECE_SEGREDO.test(nome)) { motivos.push(`${c.resolvido} mexe com credenciais ou segredos`); continue; }
    if (!nome.startsWith('get-') && !COMANDOS_DE_ARRUMAR.has(nome)) { motivos.push(`${c.resolvido} não está na lista de leituras`); continue; }
    if (c.doSistema === false) { motivos.push(`${c.resolvido} vem de um módulo instalado à parte, não do Windows`); continue; }

    const elementos = lista(c.elementos);
    // "Get-Process @p" leva os parâmetros escondidos numa tabela, e aí a
    // verificação de -ComputerName não os via.
    if (elementos.some(e => e.espalhado)) motivos.push(`${c.resolvido} recebe parâmetros escondidos numa variável (@)`);
    for (const e of elementos) {
      if (e.parametro && PARAMETROS_RECUSADOS.has(String(e.parametro).toLowerCase())) {
        motivos.push(`${c.resolvido} com -${e.parametro} sai deste PC ou pede credenciais`);
      }
    }

    // "ForEach-Object Delete" chama o método Delete em cada objecto.
    if (nome === 'foreach-object') {
      const soltos = elementos.filter(e => !e.parametro && e.tipo !== 'ScriptBlockExpressionAst');
      const pedeMembro = elementos.some(e => e.parametro && /^membername$/i.test(e.parametro));
      if (soltos.length || pedeMembro) motivos.push('ForEach-Object só pode receber blocos de código, não nomes de métodos');
    }
  }

  for (const m of lista(analise.metodos)) {
    if (!m.nome) { motivos.push('chama um método cujo nome só se sabe a correr'); continue; }
    const nome = String(m.nome).toLowerCase();

    if (m.estatico) {
      const tipo = nomeDeTipo(m.tipo);
      const permitidos = METODOS_ESTATICOS[tipo];
      if (!permitidos || !permitidos.includes(nome)) motivos.push(`o método [${m.tipo || '?'}]::${m.nome} não está na lista de leituras`);
      continue;
    }

    if (!METODOS_DE_INSTANCIA.has(nome)) {
      motivos.push(`o método .${m.nome}() não está na lista de leituras`);
      continue;
    }
    if ((nome === 'foreach' || nome === 'where') && lista(m.argumentos).some(t => t !== 'ScriptBlockExpressionAst')) {
      motivos.push(`.${m.nome}() só pode receber blocos de código`);
    }
  }

  for (const alvo of lista(analise.atribuicoesPerigosas)) {
    muda = true;
    motivos.push(`altera uma propriedade ou um sítio fora do comando: ${String(alvo).slice(0, 60)}`);
  }
  for (const u of lista(analise.unidades)) motivos.push(`lê ou escreve através de uma unidade: ${String(u).slice(0, 60)}`);
  for (const r of lista(analise.redireccoes)) {
    muda = true;
    motivos.push(`escreve para um ficheiro: ${String(r).slice(0, 60)}`);
  }

  // Um caminho \\servidor\partilha faz o Windows ligar-se a outra máquina e
  // entregar-lhe as credenciais de rede. O Windows aceita também //servidor e
  // file://servidor. Um texto que é só "\" ou "/" apanha as montagens aos
  // bocados, como '\' + '\servidor'.
  for (const t of lista(analise.textos)) {
    const texto = String(t);
    if (/^\s*[\\/]{2}/.test(texto) || /^\s*[\\/]\s*$/.test(texto) || /::\s*[\\/]{2}/.test(texto) || /file:|:\/\//i.test(texto)) {
      motivos.push('usa um caminho de rede ou um endereço (\\\\servidor, file://)');
      break;
    }
  }
  const conversoesRecusadas = ['char', 'char[]', 'scriptblock', 'management.automation.scriptblock', 'uri'];
  if (lista(analise.conversoes).some(t => conversoesRecusadas.includes(nomeDeTipo(t)))) {
    motivos.push('monta texto, endereços ou código a partir de outras coisas');
  }

  if (!motivos.length) return { classe: 'ler', motivos: [] };
  return { classe: muda ? 'muda' : 'recusado', motivos: [...new Set(motivos)] };
}

/** Analisa e decide de uma vez. */
async function verificar(script) {
  const texto = String(script || '').trim();
  if (!texto) return { classe: 'recusado', motivos: ['o comando está vazio'] };
  if (texto.length > 4000) return { classe: 'recusado', motivos: ['o comando é demasiado comprido para ser verificado com confiança'] };

  let analise;
  try {
    analise = await analisar(texto);
  } catch (err) {
    return { classe: 'recusado', motivos: [`não foi possível verificar o comando: ${err.message}`] };
  }
  return classificar(analise);
}

module.exports = {
  verificar,
  analisar,
  classificar,
  COMANDOS_DE_ARRUMAR,
  LEITURAS_RECUSADAS,
  METODOS_DE_INSTANCIA,
  METODOS_ESTATICOS
};
