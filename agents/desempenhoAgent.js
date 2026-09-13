/**
 * 🩺 Desempenho do PC — revisão e otimização com confirmação
 *
 * Pediram ao NEXO "o pc está muito lento, faz uma revisão" e ele respondeu
 * com uma lista de conselhos genéricos. Não por preguiça: não tinha como ver
 * nada. A informação do sistema que existia dizia o processador e a memória
 * total, e o número de CPU que o listar-processos devolve é tempo acumulado
 * desde que cada programa abriu, não uso actual. O Explorador aparecia com
 * 850, o que assusta e não quer dizer nada.
 *
 * Este agente mede a sério e só propõe.
 *
 *   rever()            Lê. Não muda nada, por isso não pede autorização.
 *   preparar*()        Não fazem nada. Devolvem a descrição exacta do que se
 *                      faria e a função que o faz. Quem decide se corre é o
 *                      utilizador, com um "sim", uma acção de cada vez.
 *                      Ver orchestrator/accoesPendentes.js.
 *
 * FICA DE FORA DE PROPÓSITO
 * Apagar ficheiros do utilizador, desinstalar programas, mexer no registo
 * além da lista de arranque, drivers e "optimizadores" que desligam serviços
 * do Windows. São coisas difíceis de desfazer, e um assistente não as deve
 * fazer por conta própria nem com um "sim" dito de passagem.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const powershell = require('./powershell');

const E_WINDOWS = process.platform === 'win32';

/** Quanto tempo se mede o uso do processador. Mais curto engana, mais longo cansa. */
const AMOSTRA_MS = 1500;

/** Temporários mais novos do que isto podem estar a ser usados por um instalador a correr. */
const IDADE_MINIMA_TEMPORARIO_MS = 24 * 60 * 60 * 1000;

/** Tecto da travessia dos temporários, para uma pasta monstruosa não pendurar a revisão. */
const MAX_ENTRADAS_TEMPORARIOS = 150000;

const PASTA_REGISTOS = path.join(__dirname, '..', 'user_data');
const REGISTO_ARRANQUE = path.join(PASTA_REGISTOS, 'arranque-alteracoes.json');

/**
 * Programas que nunca se propõe fechar.
 *
 * Os do Windows, porque fechá-los deixa o PC instável ou bloqueia a sessão.
 * O antivírus, porque fechá-lo por "estar a pesar" é trocar lentidão por
 * risco. E o próprio NEXO, que não se deve desligar a meio de uma conversa.
 */
const PROTEGIDOS = new Set([
  'system', 'idle', 'registry', 'memory compression', 'secure system',
  'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'lsaiso', 'svchost',
  'dwm', 'explorer', 'fontdrvhost', 'sihost', 'taskhostw', 'ctfmon', 'conhost',
  'runtimebroker', 'startmenuexperiencehost', 'shellexperiencehost', 'searchhost',
  'textinputhost', 'audiodg', 'spoolsv', 'wudfhost', 'dllhost', 'smartscreen',
  'msmpeng', 'nissrv', 'securityhealthservice', 'securityhealthsystray', 'mpdefendercoreservice',
  'node', 'electron', 'nexo', 'powershell'
]);

// ═══════════════════════════════════════════════════════════
// FORMATOS
// ═══════════════════════════════════════════════════════════

function gb(bytes) {
  return `${(bytes / 1024 ** 3).toLocaleString('pt-PT', { maximumFractionDigits: 1 })} GB`;
}

function tamanho(bytes) {
  if (bytes >= 1024 ** 3) return gb(bytes);
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2).toLocaleString('pt-PT')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('pt-PT')} KB`;
}

function duracao(segundos) {
  const d = Math.floor(segundos / 86400);
  const h = Math.floor((segundos % 86400) / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  if (d > 0) return `${d} ${d === 1 ? 'dia' : 'dias'} e ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

function semExtensao(nome) {
  return String(nome || '').trim().replace(/\.exe$/i, '');
}

// ═══════════════════════════════════════════════════════════
// MEDIR
// ═══════════════════════════════════════════════════════════

/** Uso total do processador, medido pela diferença entre duas leituras. */
function medirProcessador(ms = AMOSTRA_MS) {
  const ler = () => os.cpus().map(c => c.times);
  const antes = ler();
  return new Promise(resolve => {
    setTimeout(() => {
      const depois = ler();
      let ocupado = 0;
      let total = 0;
      depois.forEach((t, i) => {
        const a = antes[i];
        const idle = t.idle - a.idle;
        const soma = (t.user - a.user) + (t.nice - a.nice) + (t.sys - a.sys) + (t.irq - a.irq) + idle;
        ocupado += soma - idle;
        total += soma;
      });
      resolve(total > 0 ? Math.round((ocupado / total) * 100) : 0);
    }, ms);
  });
}

/**
 * A pasta de temporários só é tocada se parecer mesmo uma pasta de
 * temporários. Um TEMP mal configurado a apontar para C:\ ou para a pasta
 * pessoal transformaria "limpar temporários" em apagar o que não se deve.
 */
function pastaDeTemporariosSegura() {
  const pasta = path.resolve(os.tmpdir());
  const raiz = path.parse(pasta).root;
  if (pasta === raiz) return null;
  if (pasta === path.resolve(os.homedir())) return null;
  if (!/(^|[\\/])te?mp$/i.test(pasta)) return null;
  return pasta;
}

/**
 * Percorre os temporários sem seguir atalhos de pasta.
 *
 * Um link simbólico ou junction lá dentro pode apontar para qualquer sítio do
 * disco. Segui-lo seria medir, e depois apagar, fora dos temporários.
 */
function percorrerTemporarios(pasta, aoEncontrar) {
  const pilha = [pasta];
  let vistos = 0;
  while (pilha.length && vistos < MAX_ENTRADAS_TEMPORARIOS) {
    const dir = pilha.pop();
    let entradas;
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entradas) {
      if (++vistos > MAX_ENTRADAS_TEMPORARIOS) break;
      const caminho = path.join(dir, e.name);
      let info;
      try {
        info = fs.lstatSync(caminho);
      } catch {
        continue;
      }
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        pilha.push(caminho);
        aoEncontrar({ caminho, info, pasta: true });
      } else if (info.isFile()) {
        aoEncontrar({ caminho, info, pasta: false });
      }
    }
  }
  return { truncado: vistos >= MAX_ENTRADAS_TEMPORARIOS };
}

function medirTemporarios(agora = Date.now()) {
  const pasta = pastaDeTemporariosSegura();
  if (!pasta) return { pasta: os.tmpdir(), segura: false, total: 0, velhos: 0, ficheirosVelhos: 0 };

  let total = 0;
  let velhos = 0;
  let ficheirosVelhos = 0;
  const { truncado } = percorrerTemporarios(pasta, ({ info, pasta: ehPasta }) => {
    if (ehPasta) return;
    total += info.size;
    if (agora - info.mtimeMs > IDADE_MINIMA_TEMPORARIO_MS) {
      velhos += info.size;
      ficheirosVelhos++;
    }
  });
  return { pasta, segura: true, total, velhos, ficheirosVelhos, truncado };
}

/**
 * Tudo o que precisa do Windows vem num só PowerShell: arrancá-lo custa mais
 * de um segundo, e quatro arranques seguidos faziam a revisão parecer parada.
 */
const SCRIPT_RECOLHA = String.raw`
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'

$relogio = [Diagnostics.Stopwatch]::StartNew()
$antes = @{}
foreach ($p in Get-Process) { $antes[$p.Id] = $p.TotalProcessorTime.TotalMilliseconds }
Start-Sleep -Milliseconds ` + AMOSTRA_MS + String.raw`
$grupos = @{}
foreach ($p in Get-Process) {
  $a = $antes[$p.Id]
  $d = $p.TotalProcessorTime.TotalMilliseconds
  $delta = 0
  if ($a -ne $null -and $d -ne $null) { $delta = $d - $a }
  $nome = $p.ProcessName
  if (-not $grupos.ContainsKey($nome)) {
    $grupos[$nome] = [ordered]@{ nome = $nome; cpuMs = 0.0; memoria = [int64]0; instancias = 0; comJanela = $false }
  }
  $g = $grupos[$nome]
  $g.cpuMs += $delta
  $g.memoria += [int64]$p.WorkingSet64
  $g.instancias += 1
  if ($p.MainWindowHandle -ne 0) { $g.comJanela = $true }
}
$decorrido = $relogio.ElapsedMilliseconds

$discos = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
  [ordered]@{ letra = $_.DeviceID; total = [int64]$_.Size; livre = [int64]$_.FreeSpace }
})

$tipoSistema = ''
try {
  $letra = $env:SystemDrive.TrimEnd(':')
  $numero = (Get-Partition -DriveLetter $letra | Get-Disk).Number
  $tipoSistema = [string]((Get-PhysicalDisk | Where-Object { $_.DeviceId -eq [string]$numero }).MediaType)
} catch {}

$apr = 'Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved'
function Ligado($chave, $nome) {
  $v = (Get-ItemProperty -Path $chave -Name $nome -ErrorAction SilentlyContinue).$nome
  if ($v -eq $null -or $v.Length -eq 0) { return $true }
  return (($v[0] -band 1) -eq 0)
}
$arranque = @()
$fontes = @(
  @{ reg = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'; aprov = "HKCU:\$apr\Run"; origem = 'utilizador' },
  @{ reg = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run'; aprov = "HKLM:\$apr\Run"; origem = 'todos' },
  @{ reg = 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'; aprov = "HKLM:\$apr\Run32"; origem = 'todos' }
)
foreach ($f in $fontes) {
  $item = Get-Item -Path $f.reg -ErrorAction SilentlyContinue
  if ($item) {
    foreach ($nome in $item.GetValueNames()) {
      if ($nome -eq '') { continue }
      $arranque += [ordered]@{ nome = $nome; comando = [string]$item.GetValue($nome); origem = $f.origem; tipo = 'registo'; aprovacao = $f.aprov; ligado = (Ligado $f.aprov $nome) }
    }
  }
}
$pastas = @(
  @{ dir = [Environment]::GetFolderPath('Startup'); aprov = "HKCU:\$apr\StartupFolder"; origem = 'utilizador' },
  @{ dir = [Environment]::GetFolderPath('CommonStartup'); aprov = "HKLM:\$apr\StartupFolder"; origem = 'todos' }
)
foreach ($p in $pastas) {
  if ($p.dir -and (Test-Path $p.dir)) {
    Get-ChildItem -Path $p.dir -File | Where-Object { $_.Name -ne 'desktop.ini' } | ForEach-Object {
      $arranque += [ordered]@{ nome = $_.Name; comando = $_.FullName; origem = $p.origem; tipo = 'pasta'; aprovacao = $p.aprov; ligado = (Ligado $p.aprov $_.Name) }
    }
  }
}

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$energia = ((powercfg /getactivescheme) -join ' ')
$portatil = [bool](Get-CimInstance Win32_Battery)

[ordered]@{
  decorridoMs = $decorrido
  nucleos = [Environment]::ProcessorCount
  processos = @($grupos.Values)
  discos = $discos
  tipoDiscoSistema = $tipoSistema
  arranque = $arranque
  admin = $admin
  energia = $energia
  portatil = $portatil
} | ConvertTo-Json -Depth 5 -Compress
`;

function lerJson(texto) {
  const inicio = String(texto || '').indexOf('{');
  if (inicio < 0) throw new Error('o PowerShell não devolveu dados');
  return JSON.parse(texto.slice(inicio));
}

/** Os programas com mais peso agora, agrupados por nome (o Chrome são dezenas de processos). */
function ordenarProcessos(processos, decorridoMs, nucleos) {
  const janela = Math.max(1, decorridoMs) * Math.max(1, nucleos);
  const lista = (processos || [])
    .filter(p => p && p.nome && !/^idle$/i.test(p.nome))
    .map(p => ({
      nome: p.nome,
      cpu: Math.max(0, Math.round((p.cpuMs / janela) * 1000) / 10),
      memoria: Number(p.memoria) || 0,
      instancias: p.instancias || 1,
      comJanela: !!p.comJanela
    }));

  return {
    porProcessador: [...lista].sort((a, b) => b.cpu - a.cpu).slice(0, 8),
    porMemoria: [...lista].sort((a, b) => b.memoria - a.memoria).slice(0, 8)
  };
}

function nomeDoPlanoDeEnergia(texto) {
  const m = String(texto || '').match(/\(([^)]+)\)\s*\*?\s*$/);
  return m ? m[1].trim() : '';
}

/**
 * O que merece ser dito. Os limiares são conservadores de propósito: um
 * alarme por qualquer coisa ensina a ignorar os alarmes.
 */
function sinais(d) {
  const s = [];

  if (d.memoria.percentagem >= 85) {
    s.push(`A memória está quase cheia (${d.memoria.percentagem}%). Quando falta memória, o Windows passa a usar o disco e tudo fica lento.`);
  } else if (d.memoria.percentagem >= 75) {
    s.push(`A memória está bastante ocupada (${d.memoria.percentagem}%).`);
  }

  if (d.processador >= 80) s.push(`O processador está quase no máximo (${d.processador}%).`);

  // Os do Windows ficam nas tabelas mas não viram sinal: o svchost são dezenas
  // de serviços somados, e apontá-lo como problema levaria a querer fechá-lo.
  const doUtilizador = (p) => !PROTEGIDOS.has(String(p.nome).toLowerCase());

  for (const p of d.processos.porProcessador.filter(doUtilizador)) {
    if (p.cpu >= 25) s.push(`O ${p.nome} está a usar ${p.cpu.toLocaleString('pt-PT')}% do processador.`);
  }
  for (const p of d.processos.porMemoria.filter(doUtilizador)) {
    if (p.memoria >= 1.5 * 1024 ** 3) s.push(`O ${p.nome} ocupa ${gb(p.memoria)} de memória.`);
  }

  const sistema = d.discoSistema;
  if (sistema && sistema.total > 0) {
    const livre = sistema.livre / sistema.total;
    if (livre < 0.1 || sistema.livre < 10 * 1024 ** 3) {
      s.push(`O disco ${sistema.letra} tem pouco espaço livre (${gb(sistema.livre)}). Com o disco quase cheio, o Windows abranda.`);
    }
  }
  if (/hdd/i.test(d.tipoDiscoSistema)) {
    s.push('O Windows está num disco mecânico (HDD). É das causas mais comuns de lentidão, e só se resolve trocando por um SSD.');
  }

  const ligados = d.arranque.filter(a => a.ligado).length;
  if (ligados > 6) s.push(`Há ${ligados} programas a arrancar com o Windows, o que atrasa o arranque e ocupa memória desde o início.`);

  if (d.temporarios.velhos >= 1024 ** 3) {
    s.push(`Há ${gb(d.temporarios.velhos)} de temporários com mais de um dia que podem ser limpos.`);
  }

  if (d.ligadoHaSegundos > 7 * 86400) {
    s.push(`O PC está ligado há ${duracao(d.ligadoHaSegundos)} sem reiniciar. Reiniciar costuma devolver fluidez.`);
  }

  if (/econom|poupan|saver/i.test(d.planoEnergia)) {
    s.push(`O plano de energia está em "${d.planoEnergia}", que limita o processador para poupar bateria.`);
  }

  return s;
}

function textoDaRevisao(d) {
  const linhas = [];
  linhas.push('🩺 **Revisão do desempenho** (medido agora)');
  linhas.push('');
  linhas.push(`- Processador: ${d.processador}% em uso (${d.modeloProcessador.trim()}, ${d.nucleos} núcleos)`);
  linhas.push(`- Memória: ${gb(d.memoria.usada)} de ${gb(d.memoria.total)} em uso (${d.memoria.percentagem}%)`);
  for (const disco of d.discos) {
    const tipo = disco.letra === d.discoSistema?.letra && d.tipoDiscoSistema ? `, ${d.tipoDiscoSistema}` : '';
    linhas.push(`- Disco ${disco.letra} ${gb(disco.livre)} livres de ${gb(disco.total)}${tipo}`);
  }
  linhas.push(`- Ligado há: ${duracao(d.ligadoHaSegundos)}`);
  if (d.planoEnergia) linhas.push(`- Plano de energia: ${d.planoEnergia}`);
  if (d.temporarios.segura) {
    linhas.push(`- Temporários: ${tamanho(d.temporarios.total)}, dos quais ${tamanho(d.temporarios.velhos)} com mais de um dia`);
  }

  linhas.push('');
  linhas.push('**Programas que mais usam o processador agora:**');
  for (const p of d.processos.porProcessador.slice(0, 5)) {
    linhas.push(`- ${p.nome}: ${p.cpu.toLocaleString('pt-PT')}%${p.instancias > 1 ? ` (${p.instancias} processos)` : ''}`);
  }

  linhas.push('');
  linhas.push('**Programas que mais memória ocupam:**');
  for (const p of d.processos.porMemoria.slice(0, 5)) {
    linhas.push(`- ${p.nome}: ${tamanho(p.memoria)}${p.instancias > 1 ? ` (${p.instancias} processos)` : ''}`);
  }

  if (d.arranque.length) {
    const ligados = d.arranque.filter(a => a.ligado);
    linhas.push('');
    linhas.push(`**Arrancam com o Windows** (${ligados.length} ligados, ${d.arranque.length - ligados.length} desligados):`);
    for (const a of d.arranque) {
      const quem = a.origem === 'todos' ? 'para todos os utilizadores' : 'só para ti';
      linhas.push(`- ${a.nome}: ${a.ligado ? 'ligado' : 'desligado'}, ${quem}`);
    }
  }

  linhas.push('');
  if (d.sinais.length) {
    linhas.push('**Sinais encontrados:**');
    for (const s of d.sinais) linhas.push(`- ${s}`);
  } else {
    linhas.push('**Nada fora do normal neste momento.** Se a lentidão aparece só às vezes, repete a revisão quando ela acontecer.');
  }

  linhas.push('');
  linhas.push('_Posso preparar, sempre com a tua confirmação: fechar um programa, limpar temporários com mais de um dia, desligar ou ligar um programa do arranque._');
  return linhas.join('\n');
}

/**
 * Revisão completa. Só lê.
 *
 * @returns {Promise<Object>} { success, dados, message }
 */
async function rever() {
  const memoriaTotal = os.totalmem();
  const memoriaUsada = memoriaTotal - os.freemem();

  const base = {
    modeloProcessador: os.cpus()[0]?.model || 'processador',
    nucleos: os.cpus().length,
    memoria: {
      total: memoriaTotal,
      usada: memoriaUsada,
      percentagem: Math.round((memoriaUsada / memoriaTotal) * 100)
    },
    ligadoHaSegundos: Math.round(os.uptime())
  };

  if (!E_WINDOWS) {
    const processador = await medirProcessador();
    return {
      success: true,
      dados: { ...base, processador },
      message: `🩺 Processador ${processador}% · Memória ${gb(memoriaUsada)} de ${gb(memoriaTotal)} · Ligado há ${duracao(base.ligadoHaSegundos)}\n\n` +
        '_A revisão completa e as otimizações só estão disponíveis no Windows._'
    };
  }

  // Tudo em paralelo: a amostra do processador, a recolha do Windows e a
  // travessia dos temporários não dependem umas das outras.
  const [processador, bruto, temporarios] = await Promise.all([
    medirProcessador(),
    powershell.correr(SCRIPT_RECOLHA, { timeout: 45000, maxBuffer: 8 * 1024 * 1024 }),
    Promise.resolve().then(() => medirTemporarios())
  ]);

  const w = lerJson(bruto);
  const discos = (w.discos || []).map(x => ({ letra: x.letra, total: Number(x.total) || 0, livre: Number(x.livre) || 0 }));
  const letraSistema = (process.env.SystemDrive || 'C:').toUpperCase();

  const dados = {
    ...base,
    processador,
    nucleos: w.nucleos || base.nucleos,
    processos: ordenarProcessos(w.processos, w.decorridoMs, w.nucleos || base.nucleos),
    discos,
    discoSistema: discos.find(x => String(x.letra).toUpperCase() === letraSistema) || discos[0] || null,
    tipoDiscoSistema: w.tipoDiscoSistema && !/unspecified|^0$/i.test(w.tipoDiscoSistema) ? w.tipoDiscoSistema : '',
    arranque: Array.isArray(w.arranque) ? w.arranque : (w.arranque ? [w.arranque] : []),
    admin: !!w.admin,
    planoEnergia: nomeDoPlanoDeEnergia(w.energia),
    portatil: !!w.portatil,
    temporarios
  };
  dados.sinais = sinais(dados);

  return { success: true, dados, message: textoDaRevisao(dados) };
}

// ═══════════════════════════════════════════════════════════
// PREPARAR ACÇÕES (nenhuma corre aqui)
// ═══════════════════════════════════════════════════════════

/**
 * Prepara o fecho de um programa pelo nome exacto.
 *
 * Nome exacto, sem curingas: "chrome" não pode apanhar tudo o que começa por
 * "chrome". Por omissão pede ao programa que feche como se se carregasse no
 * X, o que lhe dá oportunidade de perguntar se se quer guardar. Forçar só
 * quando pedido, e a descrição diz o que isso custa.
 */
async function prepararFecho({ programa, forcar = false } = {}) {
  if (!E_WINDOWS) return { success: false, error: 'Fechar programas só está disponível no Windows.' };

  const nome = semExtensao(programa);
  if (!nome || /[*?[\]]/.test(nome)) {
    return { success: false, error: 'Diz-me o nome exacto do programa, tal como aparece na revisão.' };
  }
  if (PROTEGIDOS.has(nome.toLowerCase())) {
    return { success: false, error: `O ${nome} é do Windows, do antivírus ou do próprio NEXO. Fechá-lo deixa o PC instável ou desprotegido, por isso não o proponho.` };
  }

  const script = String.raw`
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
$alvo = ` + powershell.comPlicas(nome) + String.raw`
$lista = @(Get-Process | Where-Object { $_.ProcessName -ieq $alvo })
$parecidos = @(Get-Process | Where-Object { $_.ProcessName -ilike ('*' + $alvo + '*') -and $_.ProcessName -ine $alvo } | Select-Object -ExpandProperty ProcessName -Unique | Select-Object -First 5)
[ordered]@{
  nome = if ($lista.Count) { $lista[0].ProcessName } else { $alvo }
  ids = @($lista | ForEach-Object { $_.Id })
  memoria = [int64](($lista | Measure-Object WorkingSet64 -Sum).Sum)
  comJanela = [bool]($lista | Where-Object { $_.MainWindowHandle -ne 0 })
  parecidos = $parecidos
} | ConvertTo-Json -Compress
`;

  const info = lerJson(await powershell.correr(script, { timeout: 20000 }));
  const ids = (info.ids || []).map(Number).filter(Boolean);

  if (!ids.length) {
    const sugestao = (info.parecidos || []).length ? ` Nomes parecidos abertos: ${info.parecidos.join(', ')}.` : '';
    return { success: false, error: `Não encontrei nenhum programa aberto chamado "${nome}".${sugestao}` };
  }

  const qual = info.nome;
  const peso = `${ids.length} ${ids.length === 1 ? 'processo' : 'processos'}, ${tamanho(info.memoria)} de memória`;
  const descricao = forcar
    ? `Forçar o fecho do ${qual} (${peso}). Atenção: se houver trabalho por guardar nesse programa, perde-se.`
    : info.comJanela
      ? `Pedir ao ${qual} que feche (${peso}), como se carregasses no X. Se tiver trabalho por guardar, o programa pode perguntar-te antes.`
      : `O ${qual} não tem janela aberta (${peso}), por isso não dá para lhe pedir que feche com calma. Só é possível forçar o fecho.`;

  if (!forcar && !info.comJanela) {
    return { success: false, error: descricao + ' Se quiseres mesmo, pede para forçar.' };
  }

  return {
    success: true,
    titulo: `${forcar ? 'Forçar o fecho do' : 'Fechar o'} ${qual}`,
    descricao,
    executar: () => fecharAgora(qual, ids, forcar)
  };
}

async function fecharAgora(nome, ids, forcar) {
  const lista = ids.join(',');
  const script = String.raw`
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
$ids = @(` + lista + String.raw`)
$forcar = ` + (forcar ? '$true' : '$false') + String.raw`
foreach ($id in $ids) {
  $p = Get-Process -Id $id
  if (-not $p) { continue }
  if ($forcar) { Stop-Process -Id $id -Force }
  elseif ($p.MainWindowHandle -ne 0) { [void]$p.CloseMainWindow() }
}
Start-Sleep -Seconds 3
$restam = @($ids | Where-Object { Get-Process -Id $_ }).Count
[ordered]@{ restam = $restam; total = $ids.Count } | ConvertTo-Json -Compress
`;

  const r = lerJson(await powershell.correr(script, { timeout: 30000 }));
  const fechados = r.total - r.restam;

  if (r.restam === 0) {
    return { success: true, message: `✅ Fechei o ${nome}.` };
  }
  if (fechados > 0) {
    return {
      success: true,
      message: `⚠️ Fechei parte do ${nome}: ${r.restam} de ${r.total} processos continuam abertos. ` +
        'Alguns programas ficam a correr em segundo plano depois de fechares a janela.'
    };
  }
  return {
    success: false,
    message: forcar
      ? `❌ O ${nome} não fechou, nem forçando. Pode precisar de permissões de administrador.`
      : `⚠️ O ${nome} não fechou. Pode estar à espera que guardes alguma coisa: espreita a janela dele. Se quiseres, posso forçar o fecho.`
  };
}

/** Prepara a limpeza dos temporários com mais de um dia. */
async function prepararLimpezaTemporarios() {
  const medida = medirTemporarios();
  if (!medida.segura) {
    return { success: false, error: `A pasta de temporários (${medida.pasta}) não parece uma pasta de temporários, por isso não lhe mexo.` };
  }
  if (!medida.ficheirosVelhos) {
    return { success: false, error: 'Não há temporários com mais de um dia para limpar.' };
  }

  return {
    success: true,
    titulo: 'Limpar temporários',
    descricao: `Apagar ${medida.ficheirosVelhos.toLocaleString('pt-PT')} ficheiros com mais de um dia da pasta de temporários ` +
      `(${medida.pasta}), cerca de ${tamanho(medida.velhos)}. Os que estiverem a ser usados são saltados, e não toco em mais nenhuma pasta. ` +
      'É o que o próprio Windows faz no "Sensor de armazenamento".',
    executar: () => limparTemporariosAgora()
  };
}

function limparTemporariosAgora(agora = Date.now()) {
  const pasta = pastaDeTemporariosSegura();
  if (!pasta) return { success: false, message: '❌ A pasta de temporários deixou de parecer segura. Não apaguei nada.' };

  let libertado = 0;
  let apagados = 0;
  let emUso = 0;
  const pastas = [];

  percorrerTemporarios(pasta, ({ caminho, info, pasta: ehPasta }) => {
    if (ehPasta) {
      pastas.push({ caminho, mtimeMs: info.mtimeMs });
      return;
    }
    if (agora - info.mtimeMs <= IDADE_MINIMA_TEMPORARIO_MS) return;
    try {
      fs.unlinkSync(caminho);
      libertado += info.size;
      apagados++;
    } catch {
      emUso++;
    }
  });

  // Pastas vazias e antigas, das mais fundas para cima. rmdir só apaga pastas
  // vazias: se lá dentro ficou alguma coisa em uso, a pasta fica.
  pastas.sort((a, b) => b.caminho.length - a.caminho.length);
  for (const p of pastas) {
    if (agora - p.mtimeMs <= IDADE_MINIMA_TEMPORARIO_MS) continue;
    try { fs.rmdirSync(p.caminho); } catch {}
  }

  return {
    success: true,
    message: `✅ Limpei ${apagados.toLocaleString('pt-PT')} ficheiros temporários e libertei ${tamanho(libertado)}.` +
      (emUso ? ` ${emUso.toLocaleString('pt-PT')} estavam a ser usados e ficaram.` : '')
  };
}

/** Lista de arranque, tal como a revisão a vê. */
async function lerArranque() {
  const w = lerJson(await powershell.correr(SCRIPT_RECOLHA, { timeout: 45000, maxBuffer: 8 * 1024 * 1024 }));
  const lista = Array.isArray(w.arranque) ? w.arranque : (w.arranque ? [w.arranque] : []);
  return { lista, admin: !!w.admin };
}

/**
 * Prepara desligar (ou voltar a ligar) um programa do arranque do Windows.
 *
 * Usa o mesmo mecanismo do Gestor de Tarefas: marca a entrada como desligada
 * em StartupApproved, sem a apagar. O programa continua instalado, deixa só
 * de abrir sozinho, e voltar a ligá-lo é pôr a marca de volta.
 */
async function prepararArranque({ programa, ligar = false } = {}) {
  if (!E_WINDOWS) return { success: false, error: 'A lista de arranque só está disponível no Windows.' };

  const procurado = String(programa || '').trim().toLowerCase();
  if (!procurado) return { success: false, error: 'Diz-me o nome do programa, tal como aparece na revisão.' };

  const { lista, admin } = await lerArranque();
  const entrada = lista.find(a => a.nome.toLowerCase() === procurado) ||
    lista.find(a => semExtensao(a.nome.replace(/\.lnk$/i, '')).toLowerCase() === semExtensao(procurado));

  if (!entrada) {
    const nomes = lista.map(a => a.nome).join(', ');
    return { success: false, error: `Não encontrei "${programa}" na lista de arranque.${nomes ? ` Os que lá estão: ${nomes}.` : ''}` };
  }
  if (entrada.ligado === !!ligar) {
    return { success: false, error: `O ${entrada.nome} já está ${ligar ? 'ligado' : 'desligado'} no arranque.` };
  }
  if (entrada.origem === 'todos' && !admin) {
    return {
      success: false,
      error: `O ${entrada.nome} arranca para todos os utilizadores do PC, e mudar isso precisa de administrador. ` +
        'Podes fazê-lo no Gestor de Tarefas (Ctrl+Shift+Esc), separador "Aplicações de arranque".'
    };
  }

  const descricao = ligar
    ? `Voltar a ligar o ${entrada.nome} no arranque do Windows. Passa a abrir sozinho quando ligas o PC.`
    : `Desligar o ${entrada.nome} do arranque do Windows. Deixa de abrir sozinho quando ligas o PC, mas continua instalado ` +
      'e podes abri-lo à mão. É o mesmo que desligar no Gestor de Tarefas, e posso voltar a ligá-lo quando quiseres.';

  return {
    success: true,
    titulo: `${ligar ? 'Ligar' : 'Desligar'} o ${entrada.nome} no arranque`,
    descricao,
    executar: () => mudarArranqueAgora(entrada, !!ligar)
  };
}

async function mudarArranqueAgora(entrada, ligar) {
  const script = String.raw`
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$chave = ` + powershell.comPlicas(entrada.aprovacao) + String.raw`
$nome = ` + powershell.comPlicas(entrada.nome) + String.raw`
$ligar = ` + (ligar ? '$true' : '$false') + String.raw`
try {
  if (-not (Test-Path $chave)) { New-Item -Path $chave -Force | Out-Null }
  $b = New-Object byte[] 12
  if ($ligar) { $b[0] = 2 } else {
    $b[0] = 3
    [Array]::Copy([BitConverter]::GetBytes([DateTime]::UtcNow.ToFileTimeUtc()), 0, $b, 4, 8)
  }
  New-ItemProperty -Path $chave -Name $nome -PropertyType Binary -Value $b -Force | Out-Null
  $v = (Get-ItemProperty -Path $chave -Name $nome).$nome
  [ordered]@{ ok = $true; ligado = (($v[0] -band 1) -eq 0) } | ConvertTo-Json -Compress
} catch {
  [ordered]@{ ok = $false; erro = $_.Exception.Message } | ConvertTo-Json -Compress
}
`;

  const r = lerJson(await powershell.correr(script, { timeout: 20000 }));
  if (!r.ok || r.ligado !== ligar) {
    return { success: false, message: `❌ Não consegui mudar o ${entrada.nome}: ${r.erro || 'o Windows não aceitou a alteração'}.` };
  }

  registarAlteracaoDeArranque(entrada, ligar);
  return {
    success: true,
    message: ligar
      ? `✅ O ${entrada.nome} volta a abrir com o Windows.`
      : `✅ O ${entrada.nome} já não abre com o Windows. Nota-se no próximo arranque do PC.`
  };
}

/** Guarda o que se mudou, para se saber sempre o que o NEXO desligou e quando. */
function registarAlteracaoDeArranque(entrada, ligar) {
  try {
    fs.mkdirSync(PASTA_REGISTOS, { recursive: true });
    let historico = [];
    try { historico = JSON.parse(fs.readFileSync(REGISTO_ARRANQUE, 'utf8')); } catch {}
    historico.push({
      quando: new Date().toISOString(),
      nome: entrada.nome,
      origem: entrada.origem,
      accao: ligar ? 'ligado' : 'desligado'
    });
    fs.writeFileSync(REGISTO_ARRANQUE, JSON.stringify(historico.slice(-200), null, 2));
  } catch {}
}

module.exports = {
  rever,
  prepararFecho,
  prepararLimpezaTemporarios,
  prepararArranque,
  // Para os testes
  sinais,
  ordenarProcessos,
  nomeDoPlanoDeEnergia,
  pastaDeTemporariosSegura,
  percorrerTemporarios,
  PROTEGIDOS,
  AMOSTRA_MS
};
