/**
 * 🧠 Agente de comandos
 *
 * Nenhuma lista de ferramentas escrita à mão cobre tudo o que se pode perguntar
 * sobre um PC: quanto ocupa uma pasta, que serviços estão parados, quando foi
 * a última actualização. Em vez de uma ferramenta para cada pergunta, o NEXO
 * escreve o comando PowerShell de que precisa.
 *
 * O caminho de cada comando:
 *
 *   1. O modelo escreve-o, já com o que se sabe deste PC e com os comandos que
 *      resultaram antes em pedidos parecidos (ver notasPara).
 *   2. As regras em código decidem se corre (agents/regrasComandos.js). Nesta
 *      fase só correm leituras.
 *   3. Corre sem as chaves do NEXO no ambiente.
 *   4. O que resultou fica guardado e é sugerido da próxima vez. O que falhou
 *      também, com o motivo, para não se repetir o mesmo erro.
 *
 * A memória é deste PC e fica neste PC.
 */

const fs = require('fs');
const path = require('path');
const powershell = require('./powershell');
const regras = require('./regrasComandos');
const perfilPC = require('./perfilPC');

const MAX_APRENDIDOS = 200;
const MAX_FALHADOS = 60;
const MAX_SAIDA = 6000;
const TEMPO_MAXIMO_MS = 30000;

function pastaDeDados() {
  return process.env.USER_DATA_PATH
    ? path.join(process.env.USER_DATA_PATH, 'data')
    : path.join(__dirname, '..', 'user_data');
}

function ficheiroDaMemoria() {
  return path.join(pastaDeDados(), 'comandos-aprendidos.json');
}

// ═══════════════════════════════════════════════════════════
// CORRER SEM SEGREDOS À VISTA
// ═══════════════════════════════════════════════════════════

/**
 * As variáveis de ambiente que um comando pode ver.
 *
 * O PowerShell herda o ambiente do NEXO, e é lá que estão as chaves das IAs e
 * o token do GitHub. Um "Get-ChildItem env:" mostrava-as todas ao modelo.
 * Lista do que se deixa passar, não do que se esconde: uma chave com um nome
 * inesperado ficaria de fora de qualquer lista de proibidas.
 */
const AMBIENTE_PERMITIDO = new Set([
  'allusersprofile', 'appdata', 'commonprogramfiles', 'commonprogramfiles(x86)', 'commonprogramw6432',
  'computername', 'comspec', 'homedrive', 'homepath', 'localappdata', 'number_of_processors',
  'onedrive', 'onedriveconsumer', 'os', 'path', 'pathext', 'processor_architecture',
  'processor_identifier', 'processor_level', 'processor_revision', 'programdata', 'programfiles',
  'programfiles(x86)', 'programw6432', 'psmodulepath', 'public', 'systemdrive', 'systemroot',
  'temp', 'tmp', 'userdomain', 'username', 'userprofile', 'windir'
]);

function ambienteLimpo(origem = process.env) {
  const limpo = {};
  for (const [chave, valor] of Object.entries(origem)) {
    if (AMBIENTE_PERMITIDO.has(chave.toLowerCase())) limpo[chave] = valor;
  }
  return limpo;
}

const VARIAVEL_DO_CODIGO = 'NEXO_COMANDO_A_CORRER';

/**
 * Corre o comando e separa o resultado dos erros.
 *
 * O comando chega por variável de ambiente, pela mesma razão do analisador: o
 * antivírus recusa arrancar o PowerShell com base64 dentro de base64. Os erros
 * são apanhados lá dentro, porque no stderr chegam em XML ilegível.
 */
const SCRIPT_CORRER = String.raw`[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$codigoDoNexo = [string]$env:NEXO_COMANDO_A_CORRER
$modoDoNexo = [string]$env:NEXO_MODO
Remove-Item Env:\NEXO_COMANDO_A_CORRER, Env:\NEXO_MODO -ErrorAction SilentlyContinue
# Simular: os comandos que o sabem fazer dizem o que fariam, e não fazem.
if ($modoDoNexo -eq 'simular') { $WhatIfPreference = $true }
# Confirmado pelo utilizador: o PowerShell não volta a perguntar (e sem
# consola, perguntar era falhar).
if ($modoDoNexo -eq 'confirmado') { $ConfirmPreference = 'None' }
$errosDoNexo = New-Object System.Collections.ArrayList
$dadosDoNexo = @()
try {
  $blocoDoNexo = [scriptblock]::Create($codigoDoNexo)
  $dadosDoNexo = @(& $blocoDoNexo 2>&1 6>&1 | ForEach-Object {
    if ($_ -is [System.Management.Automation.ErrorRecord]) { [void]$errosDoNexo.Add($_.Exception.Message) }
    elseif ($_ -is [System.Management.Automation.InformationRecord]) { [string]$_.MessageData }
    else { $_ }
  })
} catch {
  [void]$errosDoNexo.Add($_.Exception.Message)
}
$textoDoNexo = ($dadosDoNexo | Out-String -Width 200).Trim()
'@@NEXO@@' + ([ordered]@{ saida = $textoDoNexo; erros = @($errosDoNexo | Select-Object -First 5); totalErros = $errosDoNexo.Count } | ConvertTo-Json -Compress)
`;

/**
 * @param {string} script
 * @param {{ modo?: 'ler'|'simular'|'confirmado', timeout?: number }} opcoes
 * @returns {{ saida, erros, totalErros, anfitriao }} — `anfitriao` é o que o
 *   PowerShell escreveu fora da pipeline, onde aparecem as linhas "What if:".
 */
async function correrComando(script, opcoes = {}) {
  const bruto = await powershell.correr(SCRIPT_CORRER, {
    timeout: opcoes.timeout || TEMPO_MAXIMO_MS,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...ambienteLimpo(), [VARIAVEL_DO_CODIGO]: String(script), NEXO_MODO: opcoes.modo || 'ler' }
  });
  const marca = bruto.lastIndexOf('@@NEXO@@');
  if (marca < 0) throw new Error('o comando não chegou ao fim');
  const r = JSON.parse(bruto.slice(marca + '@@NEXO@@'.length));
  const erros = Array.isArray(r.erros) ? r.erros : (r.erros ? [r.erros] : []);
  return { saida: String(r.saida || ''), erros, totalErros: r.totalErros || 0, anfitriao: bruto.slice(0, marca).trim() };
}

function correrLeitura(script) {
  return correrComando(script, { modo: 'ler' });
}

// ═══════════════════════════════════════════════════════════
// A MEMÓRIA DO QUE RESULTOU
// ═══════════════════════════════════════════════════════════

function memoriaVazia() {
  return { versao: 1, resultaram: [], falharam: [] };
}

function lerMemoria() {
  try {
    const m = JSON.parse(fs.readFileSync(ficheiroDaMemoria(), 'utf8'));
    return {
      versao: 1,
      resultaram: Array.isArray(m.resultaram) ? m.resultaram : [],
      falharam: Array.isArray(m.falharam) ? m.falharam : []
    };
  } catch (e) {
    return memoriaVazia();
  }
}

function gravarMemoria(memoria) {
  const destino = ficheiroDaMemoria();
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const temporario = `${destino}.${process.pid}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(memoria, null, 2));
  fs.renameSync(temporario, destino);
}

/** O mesmo comando com espaços diferentes é o mesmo comando. */
function chaveDoComando(script) {
  return String(script || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * @param {Object} [extra]  para as alterações: { tipo: 'alteracao', verificacao, desfazer }
 */
function registarSucesso(tarefa, script, extra = {}, agora = new Date()) {
  if (extra instanceof Date) { agora = extra; extra = {}; }
  const memoria = lerMemoria();
  const chave = chaveDoComando(script);
  const quando = agora.toISOString();

  let entrada = memoria.resultaram.find(e => chaveDoComando(e.script) === chave);
  if (entrada) {
    entrada.vezes = (entrada.vezes || 0) + 1;
    entrada.ultimaVez = quando;
    if (tarefa && !entrada.tarefas?.includes(tarefa)) entrada.tarefas = [...(entrada.tarefas || []), tarefa].slice(-5);
    Object.assign(entrada, limparExtra(extra));
  } else {
    entrada = { tarefa, tarefas: [tarefa], script: String(script).trim(), vezes: 1, criadoEm: quando, ultimaVez: quando, ...limparExtra(extra) };
    memoria.resultaram.push(entrada);
  }

  // Um comando que agora resultou deixa de ser um aviso.
  memoria.falharam = memoria.falharam.filter(e => chaveDoComando(e.script) !== chave);

  memoria.resultaram.sort((a, b) => String(b.ultimaVez).localeCompare(String(a.ultimaVez)));
  memoria.resultaram = memoria.resultaram.slice(0, MAX_APRENDIDOS);
  gravarMemoria(memoria);
  return entrada;
}

function limparExtra(extra = {}) {
  const limpo = {};
  if (extra.tipo) limpo.tipo = extra.tipo;
  if (extra.verificacao) limpo.verificacao = String(extra.verificacao).trim();
  if (extra.desfazer) limpo.desfazer = String(extra.desfazer).trim();
  if (extra.processo) limpo.processo = String(extra.processo);
  return limpo;
}

function registarFalha(tarefa, script, motivo, agora = new Date()) {
  const memoria = lerMemoria();
  const chave = chaveDoComando(script);
  memoria.falharam = memoria.falharam.filter(e => chaveDoComando(e.script) !== chave);
  memoria.falharam.unshift({ tarefa, script: String(script).trim(), motivo: String(motivo).slice(0, 300), quando: agora.toISOString() });
  memoria.falharam = memoria.falharam.slice(0, MAX_FALHADOS);
  gravarMemoria(memoria);
}

const PALAVRAS_VAZIAS = new Set([
  'que', 'qual', 'quais', 'quanto', 'quanta', 'quantos', 'quantas', 'para', 'por', 'com', 'sem',
  'dos', 'das', 'uma', 'uns', 'umas', 'meu', 'minha', 'meus', 'minhas', 'teu', 'tua', 'este', 'esta',
  'isto', 'esse', 'essa', 'aquele', 'tenho', 'tem', 'ter', 'estao', 'esta', 'sao', 'ser', 'foi', 'ver',
  'diz', 'dizer', 'mostra', 'mostrar', 'lista', 'listar', 'quero', 'saber', 'podes', 'pode', 'favor',
  'como', 'onde', 'quando', 'nao', 'sim', 'mais', 'muito', 'pouco', 'agora', 'nexo', 'computador'
]);

function palavras(texto) {
  return new Set(
    String(texto || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(p => p.length >= 3 && !PALAVRAS_VAZIAS.has(p))
  );
}

/** Quanto de um pedido reaparece noutro, de 0 a 1. */
function parecenca(pedido, outro) {
  const a = palavras(pedido);
  const b = palavras(outro);
  if (!a.size || !b.size) return 0;
  let comuns = 0;
  for (const p of a) if (b.has(p)) comuns++;
  return comuns / Math.min(a.size, b.size);
}

const PARECENCA_MINIMA = 0.5;

/**
 * Os comandos que resultaram e falharam em pedidos parecidos com este.
 * @returns {{ resultaram: Array, falharam: Array }}
 */
function semelhantes(pedido, max = 3) {
  const memoria = lerMemoria();
  const pontuar = (texto) => parecenca(pedido, texto);

  const resultaram = memoria.resultaram
    .map(e => ({ e, p: Math.max(...(e.tarefas?.length ? e.tarefas : [e.tarefa]).map(pontuar)) }))
    .filter(x => x.p >= PARECENCA_MINIMA)
    .sort((x, y) => y.p - x.p || (y.e.vezes || 0) - (x.e.vezes || 0))
    .slice(0, max)
    .map(x => x.e);

  const falharam = memoria.falharam
    .map(e => ({ e, p: pontuar(e.tarefa) }))
    .filter(x => x.p >= PARECENCA_MINIMA)
    .sort((x, y) => y.p - x.p)
    .slice(0, 2)
    .map(x => x.e);

  return { resultaram, falharam };
}

// ═══════════════════════════════════════════════════════════
// O QUE O MODELO FICA A SABER ANTES DE ESCREVER
// ═══════════════════════════════════════════════════════════

/**
 * Notas para acompanhar o pedido quando a ferramenta de comandos vai no menu.
 *
 * Sem isto, o modelo escrevia o mesmo comando genérico em qualquer PC e
 * repetia os erros da vez anterior. Com isto, sabe a língua do Windows, onde
 * ficam as pastas, e o que já resultou aqui.
 *
 * Não recolhe o perfil se ainda não existir: isso leva segundos, e é feito à
 * parte (ver prepararPerfil).
 */
function notasPara(pedido) {
  const linhas = [];

  const resumo = perfilPC.resumoCurto(perfilPC.jaConhecido());
  if (resumo) linhas.push(`Sobre este PC: ${resumo}.`);

  const { resultaram, falharam } = semelhantes(pedido);
  if (resultaram.length) {
    linhas.push('Comandos que já resultaram neste PC em pedidos parecidos (reutiliza se servirem):');
    for (const e of resultaram) {
      if (e.tipo === 'janela') {
        linhas.push(`- "${e.tarefa}" (${e.vezes}x, passos numa janela de ${e.processo || '?'}): ${e.script.slice(0, 500)}`);
      } else if (e.tipo === 'alteracao') {
        linhas.push(`- "${e.tarefa}" (${e.vezes}x, alteração): ${e.script.slice(0, 500)}` +
          (e.verificacao ? ` | verificação: ${e.verificacao.slice(0, 200)}` : '') +
          (e.desfazer ? ` | desfazer: ${e.desfazer.slice(0, 200)}` : ''));
      } else {
        linhas.push(`- "${e.tarefa}" (${e.vezes}x): ${e.script.slice(0, 500)}`);
      }
    }
  }
  if (falharam.length) {
    linhas.push('Tentativas que falharam em pedidos parecidos (não as repitas):');
    for (const e of falharam) linhas.push(`- ${e.script.slice(0, 300)} → ${e.motivo}`);
  }

  // "Desfaz isso" não tem palavras do pedido original. As últimas alterações
  // vão com o comando de desfazer que o próprio NEXO propôs na altura.
  if (PEDE_PARA_DESFAZER.test(normalizarTexto(pedido))) {
    const recentes = lerHistorico().slice(-3).reverse();
    if (recentes.length) {
      linhas.push('Últimas alterações feitas neste PC, da mais recente para a mais antiga:');
      for (const h of recentes) {
        linhas.push(`- ${h.quando}: "${h.tarefa}" → ${h.sucesso ? 'resultou' : 'falhou'}; comando: ${String(h.comando).slice(0, 300)}` +
          (h.desfazer ? `; para desfazer: ${String(h.desfazer).slice(0, 300)}` : '; sem comando para desfazer'));
      }
    }
  }

  return linhas.length ? linhas.join('\n') : null;
}

const PEDE_PARA_DESFAZER = /\b(desfaz|desfazer|anula|anular|reverte|reverter|repoe|repor|volta atras|voltar atras|como estava|a ultima alteracao)/;

function normalizarTexto(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

let recolhaEmCurso = null;

/** Recolhe o perfil em fundo, se ainda não houver, sem fazer ninguém esperar. */
function prepararPerfil() {
  // Os testes montam o ciclo de ferramentas muitas vezes e não podem pôr o
  // PowerShell a recolher o PC real em fundo.
  if (process.env.NEXO_PERFIL_EM_FUNDO === '0') return null;
  if (perfilPC.jaConhecido() || recolhaEmCurso) return recolhaEmCurso;
  recolhaEmCurso = perfilPC.obter()
    .catch(e => console.warn(`  ⚠️ Perfil do PC não recolhido: ${e.message}`))
    .finally(() => { recolhaEmCurso = null; });
  return recolhaEmCurso;
}

// ═══════════════════════════════════════════════════════════
// O PEDIDO COMPLETO
// ═══════════════════════════════════════════════════════════

/**
 * Verifica, corre e aprende.
 *
 * @param {{ tarefa: string, script: string }} pedido
 * @returns {Promise<{ corrido: boolean, classe: string, texto: string }>}
 *   `texto` é o que volta ao modelo.
 */
async function consultar({ tarefa, script } = {}) {
  const descricao = String(tarefa || '').trim() || 'consulta sem descrição';
  const comando = String(script || '').trim();

  const veredicto = await regras.verificar(comando);

  if (veredicto.classe !== 'ler') {
    const motivo = veredicto.motivos.join('; ');
    registarFalha(descricao, comando, `recusado: ${motivo}`);

    if (veredicto.classe === 'muda') {
      return {
        corrido: false,
        classe: 'muda',
        texto: `NÃO CORREU. Este comando muda o PC (${motivo}), e esta ferramenta só lê. ` +
          'Se o pedido era para ver alguma coisa, escreve outro comando que só leia. Se o utilizador quer mudar algo, ' +
          'prepara a alteração com a ferramenta de alterações, que pede confirmação.'
      };
    }
    return {
      corrido: false,
      classe: 'recusado',
      texto: `NÃO CORREU. As regras de segurança recusaram o comando: ${motivo}. ` +
        'Escreve outro que só use comandos Get-, Select-Object, Where-Object, Measure-Object e afins, sem métodos que mudem nada, sem programas externos e sem caminhos de rede. Não tentes contornar a regra.'
    };
  }

  let resultado;
  try {
    resultado = await correrLeitura(comando);
  } catch (err) {
    const motivo = err.killed ? `demorou mais de ${TEMPO_MAXIMO_MS / 1000}s` : err.message;
    registarFalha(descricao, comando, motivo);
    return { corrido: false, classe: 'ler', texto: `O comando não chegou ao fim: ${motivo}.` };
  }

  const saida = resultado.saida.length > MAX_SAIDA
    ? `${resultado.saida.slice(0, MAX_SAIDA)}\n(… resultado cortado, era muito comprido)`
    : resultado.saida;
  const avisos = resultado.totalErros
    ? `\n\nAvisos (${resultado.totalErros}): ${resultado.erros.join(' | ').slice(0, 600)}`
    : '';

  if (saida) {
    registarSucesso(descricao, comando);
    return { corrido: true, classe: 'ler', texto: `${saida}${avisos}` };
  }

  if (resultado.totalErros) {
    registarFalha(descricao, comando, resultado.erros.join(' | '));
    return { corrido: true, classe: 'ler', texto: `O comando correu mas deu erro e não devolveu nada: ${resultado.erros.join(' | ').slice(0, 600)}` };
  }

  // Sem erros e sem nada: pode ser a resposta certa ("não há impressoras") ou
  // um comando que procurou no sítio errado. Não se aprende nem num sentido
  // nem no outro.
  return { corrido: true, classe: 'ler', texto: 'O comando correu sem erros e não devolveu nada.' };
}

// ═══════════════════════════════════════════════════════════
// ALTERAÇÕES: PREPARAR, SIMULAR, ESPERAR PELO "SIM", CONFIRMAR
// ═══════════════════════════════════════════════════════════

const TEMPO_ALTERACAO_MS = 120000;
const MAX_HISTORICO = 100;

function ficheiroDoHistorico() {
  return path.join(pastaDeDados(), 'alteracoes-pc.json');
}

function lerHistorico() {
  try {
    const h = JSON.parse(fs.readFileSync(ficheiroDoHistorico(), 'utf8'));
    return Array.isArray(h) ? h : [];
  } catch (e) {
    return [];
  }
}

function registarNoHistorico(entrada) {
  const historico = [...lerHistorico(), entrada].slice(-MAX_HISTORICO);
  const destino = ficheiroDoHistorico();
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const temporario = `${destino}.${process.pid}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(historico, null, 2));
  fs.renameSync(temporario, destino);
}

/**
 * As pastas onde as alterações de ficheiros podem mexer.
 *
 * As do perfil primeiro: se o Ambiente de trabalho estiver no OneDrive, é lá
 * que o utilizador o vê, e não em C:\Users\nome\Desktop.
 */
function raizesDoUtilizador(ambiente = process.env) {
  const casa = ambiente.USERPROFILE || '';
  const pastas = perfilPC.jaConhecido()?.dados?.pastas || {};
  const raizes = [pastas.ambienteDeTrabalho, pastas.documentos, pastas.transferencias, pastas.imagens];
  if (casa) for (const p of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos']) raizes.push(path.win32.join(casa, p));
  const nuvem = ambiente.OneDrive || ambiente.OneDriveConsumer;
  if (nuvem) for (const p of ['Desktop', 'Documents', 'Pictures', 'Ambiente de Trabalho', 'Documentos', 'Imagens']) raizes.push(path.win32.join(nuvem, p));
  return [...new Set(raizes.filter(Boolean).map(r => String(r).replace(/[\\/]+$/, '')))];
}

/** O que as alterações confirmadas criaram: é a única coisa que se pode apagar. */
function criadosPeloNexo() {
  return new Set(lerHistorico().filter(h => h.sucesso).flatMap(h => h.criados || []));
}

function contextoDasRegras(opcoes = {}) {
  const ambiente = ambienteLimpo();
  return {
    raizes: opcoes.raizes || raizesDoUtilizador(ambiente),
    ambiente,
    protegidos: require('./desempenhoAgent').PROTEGIDOS,
    criadosPeloNexo: criadosPeloNexo()
  };
}

/**
 * Erros do PowerShell que ninguém percebe, em português.
 *
 * O "NonInteractive mode" aparece quando o PowerShell queria perguntar alguma
 * coisa. Com um Remove-Item sem -Recurse, isso só acontece quando a pasta ou a
 * chave já tem coisas lá dentro: é a protecção a funcionar.
 */
function explicarErro(erro, comando) {
  const texto = String(erro || '');
  if (/NonInteractive mode/i.test(texto) && /remove-item/i.test(String(comando || ''))) {
    return 'a pasta ou chave já não está vazia (tem ficheiros, pastas ou subchaves lá dentro), e o NEXO só apaga o que está vazio, para não levar nada do utilizador';
  }
  if (/NonInteractive mode/i.test(texto)) return 'o comando queria fazer uma pergunta a meio, e isso não é possível aqui';
  return texto;
}

function cortar(texto, max) {
  const t = String(texto || '').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** O nome das operações que o PowerShell 5.1 escreve em inglês. */
const OPERACOES = {
  'move file': 'mover ficheiro', 'move directory': 'mover pasta', 'copy file': 'copiar ficheiro',
  'copy directory': 'copiar pasta', 'rename file': 'mudar o nome do ficheiro', 'rename directory': 'mudar o nome da pasta',
  'create file': 'criar ficheiro', 'create directory': 'criar pasta', 'new item': 'criar', 'create key': 'criar chave',
  'set property': 'mudar valor', 'new property': 'criar valor', 'remove property': 'apagar valor',
  'remove key': 'apagar chave', 'remove directory': 'apagar pasta', 'remove file': 'apagar ficheiro',
  'stop-process': 'fechar', 'add content': 'acrescentar texto', 'set-clipboard': 'área de transferência',
  'invoke-cimmethod': 'aplicar'
};

/** As linhas "What if:" em texto legível. */
function linhasDaSimulacao(anfitriao) {
  return String(anfitriao || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => /^(what if|e se)\s*:/i.test(l))
    .map(l => l.replace(/^(what if|e se)\s*:\s*/i, ''))
    .map(l => {
      const m = l.match(/^Performing the operation "(.+?)" on target "(.*)"\.?$/i);
      if (!m) return l;
      const operacao = OPERACOES[m[1].toLowerCase()] || m[1];
      const alvo = m[2]
        .replace(/^Item:\s*(.*?)\s+Destination:\s*(.*)$/i, '$1 → $2')
        .replace(/^Item:\s*(.*?)\s+Property:\s*(.*)$/i, '$2 em $1')
        .replace(/^(Destination|Item):\s*/i, '');
      return `${operacao}: ${alvo}`;
    });
}

async function lerSemFalhar(script) {
  try {
    const r = await correrLeitura(script);
    return r.saida || (r.totalErros ? `(erro: ${r.erros.join(' | ')})` : '(nada)');
  } catch (e) {
    return `(não foi possível ler: ${e.message})`;
  }
}

/**
 * Prepara uma alteração ao PC escrita pelo modelo.
 *
 * Nada muda aqui. As regras verificam o comando, a verificação e o desfazer;
 * a simulação corre quando o comando o permite; e o que volta é uma acção
 * pronta para ficar à espera do "sim" (ver orchestrator/accoesPendentes.js).
 *
 * @returns {Promise<Object>} { success, titulo, descricao, instrucao, rodape, executar }
 *   ou { success: false, error } com o motivo, para o modelo corrigir.
 */
async function prepararAlteracao({ tarefa, explicacao, comando, verificacao, desfazer } = {}, opcoes = {}) {
  const descricaoDaTarefa = String(tarefa || '').trim() || 'alteração sem descrição';
  const script = String(comando || '').trim();
  // opcoes.raizes só existe para os testes trabalharem numa pasta descartável.
  const ctx = contextoDasRegras(opcoes);

  const veredicto = await regras.verificar(script, ctx);
  if (veredicto.classe === 'ler') {
    return { success: false, error: 'Este comando não muda nada. Para ver informação, usa a ferramenta de consultar o PC.' };
  }
  if (veredicto.classe !== 'alteracao') {
    const motivo = veredicto.motivos.join('; ');
    registarFalha(descricaoDaTarefa, script, `recusado: ${motivo}`);
    return {
      success: false,
      error: `As regras de segurança recusaram o comando: ${motivo}. ` +
        'Se houver outra forma dentro do que é permitido, prepara-a; se não, diz ao utilizador com franqueza o que não é possível fazer por aqui. Não tentes contornar a regra.'
    };
  }

  const leitura = String(verificacao || '').trim();
  if (leitura) {
    const v = await regras.verificar(leitura);
    if (v.classe !== 'ler') {
      return { success: false, error: `O comando de verificação tem de só ler, e foi recusado: ${v.motivos.join('; ')}. Escreve outro.` };
    }
  }

  const criados = veredicto.alteracoes.flatMap(a => a.criados || []);

  let paraDesfazer = String(desfazer || '').trim();
  let notaDesfazer = '';
  if (paraDesfazer) {
    // O desfazer de uma criação apaga o que esta alteração vai criar.
    const ctxDesfazer = { ...ctx, criadosPeloNexo: new Set([...ctx.criadosPeloNexo, ...criados]) };
    const d = await regras.verificar(paraDesfazer, ctxDesfazer);
    if (d.classe !== 'alteracao') {
      notaDesfazer = ` (o comando para desfazer foi posto de lado: ${(d.motivos || []).join('; ') || 'não muda nada'})`;
      paraDesfazer = '';
    }
  }

  // Simular quando todas as alterações o permitem.
  let simulacao = null;
  const simulavel = veredicto.alteracoes.every(a => a.simulavel);
  if (simulavel) {
    try {
      const s = await correrComando(script, { modo: 'simular' });
      const linhas = linhasDaSimulacao(s.anfitriao);
      if (s.totalErros && !linhas.length) {
        const erro = s.erros.map(e => explicarErro(String(e).replace(/\.+\s*$/, ''), script)).join(' | ');
        registarFalha(descricaoDaTarefa, script, `a simulação falhou: ${erro}`);
        return {
          success: false,
          error: `A simulação deu erro e não mostrou nada que fosse feito: ${cortar(erro, 500)}. ` +
            'Confirma primeiro com uma leitura se os caminhos e nomes existem, e depois prepara o comando corrigido.'
        };
      }
      simulacao = { linhas, avisos: s.erros };
    } catch (e) {
      simulacao = { linhas: [], avisos: [`a simulação não chegou ao fim: ${e.message}`] };
    }
  }

  const irreversivel = veredicto.alteracoes.some(a => a.irreversivel);
  const partes = [];
  partes.push(`**${cortar(explicacao || descricaoDaTarefa, 400)}**`);
  partes.push('');
  partes.push('O que o NEXO confirmou no comando:');
  for (const a of veredicto.alteracoes) partes.push(`- ${a.resumo}${a.irreversivel ? ' ⚠️ não se desfaz' : ''}`);

  if (simulacao) {
    partes.push('');
    if (simulacao.linhas.length) {
      partes.push(`Simulação, sem mudar nada (${simulacao.linhas.length} ${simulacao.linhas.length === 1 ? 'operação' : 'operações'}):`);
      for (const l of simulacao.linhas.slice(0, 12)) partes.push(`- ${cortar(l, 220)}`);
      if (simulacao.linhas.length > 12) partes.push(`- … e mais ${simulacao.linhas.length - 12}`);
    } else {
      partes.push('Simulação: o comando não indicou nenhuma operação.');
    }
    if (simulacao.avisos.length) {
      // Criar a chave e depois o valor: a simulação não cria a chave, e o
      // segundo passo queixa-se de que ela não existe.
      const dependentes = simulacao.linhas.length ? ' (quando um passo depende de outro, a simulação queixa-se porque não fez o primeiro)' : '';
      partes.push(`Avisos da simulação${dependentes}: ${cortar(simulacao.avisos.join(' | '), 300)}`);
    }
  } else {
    partes.push('');
    partes.push('Este comando não se pode simular antes; o alvo acima foi verificado pelo código.');
  }

  partes.push('');
  partes.push('Comando:');
  partes.push('```powershell');
  partes.push(script);
  partes.push('```');
  partes.push(paraDesfazer ? `Para desfazer depois: \`${cortar(paraDesfazer, 300)}\`` : (irreversivel ? 'Isto não se desfaz.' : 'Não há um comando para desfazer.'));

  const executar = async () => executarAlteracao({ tarefa: descricaoDaTarefa, comando: script, verificacao: leitura, desfazer: paraDesfazer, criados });

  return {
    success: true,
    titulo: descricaoDaTarefa,
    descricao: partes.join('\n'),
    instrucao: 'Mostra ao utilizador o que está acima tal como está, com o comando, sem o resumir nem tirar partes, ' +
      `e pergunta se confirma. Ele responde "sim" para avançar ou "não" para cancelar. Não digas que já foi feito.${notaDesfazer}`,
    rodape: paraDesfazer ? '_Se quiseres voltar atrás, diz "desfaz a última alteração"._' : '',
    executar
  };
}

/**
 * Corre a alteração que o utilizador confirmou, e confirma com uma leitura.
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function executarAlteracao({ tarefa, comando, verificacao, desfazer, criados = [] }) {
  const antes = verificacao ? await lerSemFalhar(verificacao) : null;

  let resultado;
  try {
    resultado = await correrComando(comando, { modo: 'confirmado', timeout: TEMPO_ALTERACAO_MS });
  } catch (err) {
    const motivo = err.killed ? `demorou mais de ${TEMPO_ALTERACAO_MS / 1000}s e foi interrompido (pode ter ficado a meio)` : err.message;
    registarFalha(tarefa, comando, motivo);
    registarNoHistorico({ quando: new Date().toISOString(), tarefa, comando, desfazer, sucesso: false, erro: motivo });
    return { success: false, message: `❌ ${tarefa}: ${motivo}.` };
  }

  const depois = verificacao ? await lerSemFalhar(verificacao) : null;
  const sucesso = resultado.totalErros === 0;
  resultado.erros = resultado.erros.map(e => explicarErro(e, comando));

  if (sucesso) registarSucesso(tarefa, comando, { tipo: 'alteracao', verificacao, desfazer });
  else registarFalha(tarefa, comando, resultado.erros.join(' | '));
  registarNoHistorico({ quando: new Date().toISOString(), tarefa, comando, desfazer, verificacao, antes, depois, sucesso, criados, erro: sucesso ? undefined : resultado.erros.join(' | ') });

  const linhas = [];
  linhas.push(sucesso ? `✅ Feito: ${tarefa}.` : `❌ ${tarefa}: o comando deu erro.`);
  if (!sucesso) linhas.push(`Erro: ${cortar(resultado.erros.join(' | '), 600)}`);
  if (resultado.saida) linhas.push(`Resposta do comando: ${cortar(resultado.saida, 600)}`);

  if (verificacao) {
    linhas.push('');
    linhas.push(`Verificação, antes: \`${cortar(antes, 300)}\``);
    linhas.push(`Verificação, depois: \`${cortar(depois, 300)}\``);
    if (sucesso && antes === depois) {
      linhas.push('⚠️ A verificação mostra o mesmo antes e depois. Pode já estar assim, ou só se notar depois de reabrir a aplicação ou de reiniciar a sessão.');
    }
  }
  return { success: sucesso, message: linhas.join('\n') };
}

module.exports = {
  consultar,
  prepararAlteracao,
  executarAlteracao,
  raizesDoUtilizador,
  lerHistorico,
  linhasDaSimulacao,
  correrComando,
  correrLeitura,
  notasPara,
  prepararPerfil,
  semelhantes,
  parecenca,
  registarSucesso,
  registarFalha,
  lerMemoria,
  ambienteLimpo,
  ficheiroDaMemoria,
  AMBIENTE_PERMITIDO
};
