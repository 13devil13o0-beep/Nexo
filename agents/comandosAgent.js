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
Remove-Item Env:\NEXO_COMANDO_A_CORRER -ErrorAction SilentlyContinue
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

async function correrLeitura(script) {
  const bruto = await powershell.correr(SCRIPT_CORRER, {
    timeout: TEMPO_MAXIMO_MS,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...ambienteLimpo(), [VARIAVEL_DO_CODIGO]: String(script) }
  });
  const marca = bruto.lastIndexOf('@@NEXO@@');
  if (marca < 0) throw new Error('o comando não chegou ao fim');
  const r = JSON.parse(bruto.slice(marca + '@@NEXO@@'.length));
  const erros = Array.isArray(r.erros) ? r.erros : (r.erros ? [r.erros] : []);
  return { saida: String(r.saida || ''), erros, totalErros: r.totalErros || 0 };
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

function registarSucesso(tarefa, script, agora = new Date()) {
  const memoria = lerMemoria();
  const chave = chaveDoComando(script);
  const quando = agora.toISOString();

  let entrada = memoria.resultaram.find(e => chaveDoComando(e.script) === chave);
  if (entrada) {
    entrada.vezes = (entrada.vezes || 0) + 1;
    entrada.ultimaVez = quando;
    if (tarefa && !entrada.tarefas?.includes(tarefa)) entrada.tarefas = [...(entrada.tarefas || []), tarefa].slice(-5);
  } else {
    entrada = { tarefa, tarefas: [tarefa], script: String(script).trim(), vezes: 1, criadoEm: quando, ultimaVez: quando };
    memoria.resultaram.push(entrada);
  }

  // Um comando que agora resultou deixa de ser um aviso.
  memoria.falharam = memoria.falharam.filter(e => chaveDoComando(e.script) !== chave);

  memoria.resultaram.sort((a, b) => String(b.ultimaVez).localeCompare(String(a.ultimaVez)));
  memoria.resultaram = memoria.resultaram.slice(0, MAX_APRENDIDOS);
  gravarMemoria(memoria);
  return entrada;
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
    for (const e of resultaram) linhas.push(`- "${e.tarefa}" (${e.vezes}x): ${e.script.slice(0, 500)}`);
  }
  if (falharam.length) {
    linhas.push('Tentativas que falharam em pedidos parecidos (não as repitas):');
    for (const e of falharam) linhas.push(`- ${e.script.slice(0, 300)} → ${e.motivo}`);
  }

  return linhas.length ? linhas.join('\n') : null;
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
        texto: `NÃO CORREU. Este comando muda o PC (${motivo}). Por agora só corro comandos que apenas leem. ` +
          'Se o pedido era para ver alguma coisa, escreve outro comando que só leia. Se o utilizador quer mudar algo, ' +
          'diz-lhe com franqueza que isso ainda não é feito por comandos gerados.'
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

module.exports = {
  consultar,
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
