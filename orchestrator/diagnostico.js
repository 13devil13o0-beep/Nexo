/**
 * 🩹 Diagnóstico de Instalação
 *
 * Responde a uma pergunta: o NEXO está pronto a correr nesta máquina, e se não
 * está, o que falta exactamente?
 *
 * REGRA: este módulo não instala nada nem escreve nada. Observa e relata. Quem
 * age é o instalar.js — a mesma separação do orchestrator/dispositivo.js, e
 * pela mesma razão: assim isto pode ser testado com máquinas fingidas.
 *
 * ─────────────────────────────────────────────────────────────
 * A LINGUAGEM IMPORTA
 * ─────────────────────────────────────────────────────────────
 * Cada problema traz um `humano`: a mesma falha dita a quem não sabe o que é
 * uma variável de ambiente. "Falta o motor de IA — é o que faz o NEXO pensar"
 * resolve-se; "GROQ_API_KEY undefined" faz desistir.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');

/** O código usa fetch global, que só existe a partir daqui. */
const NODE_MINIMO = 18;

/** Pacotes sem os quais o motor não arranca de todo. */
const ESSENCIAIS = ['express', 'ws', 'dotenv', 'cors', 'uuid'];

/** Chaves que o llmRouter lê do .env, por ordem de recomendação. */
const CHAVES_DE_IA = [
  { env: 'GROQ_API_KEY', nome: 'Groq', gratuito: true },
  { env: 'CEREBRAS_API_KEY', nome: 'Cerebras', gratuito: true },
  { env: 'GEMINI_API_KEY', nome: 'Gemini', gratuito: true },
  { env: 'OPENAI_API_KEY', nome: 'OpenAI', gratuito: false },
  { env: 'ANTHROPIC_API_KEY', nome: 'Anthropic', gratuito: false },
  { env: 'HF_API_KEY', nome: 'HuggingFace', gratuito: true }
];

const URL_OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434';

// ═══════════════════════════════════════════════════════════
// VERIFICAÇÕES (sem rede)
// ═══════════════════════════════════════════════════════════

/** @returns {{ok:boolean, versao:string, minimo:number}} */
function verificarNode(versao = process.versions.node) {
  const maior = parseInt(String(versao).split('.')[0], 10);
  return { ok: maior >= NODE_MINIMO, versao: String(versao), maior, minimo: NODE_MINIMO };
}

/**
 * As dependências estão instaladas?
 * O Electron conta à parte: só o perfil com janela precisa dele, e são ~200 MB
 * que ninguém deve descarregar para correr um servidor sem ecrã.
 */
function verificarDependencias(raiz = RAIZ, existe = (p) => fs.existsSync(p)) {
  const modulos = path.join(raiz, 'node_modules');

  if (!existe(modulos)) {
    return { ok: false, instalado: false, faltam: ESSENCIAIS, electron: false };
  }

  const faltam = ESSENCIAIS.filter(p => !existe(path.join(modulos, p)));
  const electron = existe(path.join(modulos, 'electron'));

  return { ok: faltam.length === 0, instalado: true, faltam, electron };
}

/** Que fornecedores de IA têm chave configurada. */
function fornecedoresConfigurados(env = process.env) {
  return CHAVES_DE_IA
    .filter(c => {
      const v = env[c.env];
      // Um valor de exemplo por substituir conta como não configurado: é o
      // erro mais comum de quem copia o .env.example e não repara.
      return v && v.length > 8 && !/^(x{3,}|gsk_x|cole|coloca|mudar?|troca)/i.test(v);
    })
    .map(c => ({ ...c, chave: env[c.env] }));
}

function verificarEnv(raiz = RAIZ, existe = (p) => fs.existsSync(p)) {
  return { existe: existe(path.join(raiz, '.env')) };
}

// ═══════════════════════════════════════════════════════════
// NOMES QUASE CERTOS
// ═══════════════════════════════════════════════════════════

/**
 * Nomes de variáveis que o NEXO reconhece. Tudo o que estiver a um passo ou
 * dois de um destes, sem ser igual, é quase de certeza um erro de escrita.
 */
const NOMES_CONHECIDOS = [
  ...CHAVES_DE_IA.map(c => c.env),
  'LLM_PROVIDER_ORDER', 'OLLAMA_URL', 'OLLAMA_MODEL', 'API_KEY', 'PORT',
  'NEXO_MODO', 'TELEGRAM_BOT_TOKEN', 'DISCORD_TOKEN', 'SERPER_API_KEY'
];

/** Distância de edição, com corte: acima do limite não interessa quanto é. */
function distancia(a, b, limite = 2) {
  if (Math.abs(a.length - b.length) > limite) return limite + 1;

  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    for (let j = 1; j <= b.length; j++) {
      actual[j] = Math.min(
        anterior[j] + 1,
        actual[j - 1] + 1,
        anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    anterior = actual;
  }

  return anterior[b.length];
}

/**
 * Procura nomes de variáveis escritos por pouco.
 *
 * Nasceu de um caso real: um .env com CEREBRAS_APY_KEY em vez de
 * CEREBRAS_API_KEY. A chave estava correcta, o ficheiro estava lá, e o NEXO
 * comportava-se exactamente como se ela não existisse. Um erro destes é
 * invisível a olho nu e custa uma tarde a encontrar.
 *
 * Nunca lê valores — só nomes.
 */
function detectarNomesTrocados(caminhoEnv, lerFicheiro) {
  const ler = lerFicheiro || ((f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; } });
  const bruto = ler(caminhoEnv || path.join(RAIZ, '.env'));
  if (!bruto) return [];

  const trocados = [];

  for (const linha of bruto.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) continue;

    const igual = limpa.indexOf('=');
    if (igual < 1) continue;

    const nome = limpa.slice(0, igual).trim();
    if (NOMES_CONHECIDOS.includes(nome)) continue;

    // Sem valor não vale a pena avisar: é uma linha por preencher.
    if (!limpa.slice(igual + 1).trim()) continue;

    const parecido = NOMES_CONHECIDOS
      .map(conhecido => ({ conhecido, d: distancia(nome, conhecido) }))
      .filter(x => x.d > 0 && x.d <= 2)
      .sort((a, b) => a.d - b.d)[0];

    if (parecido) trocados.push({ escrito: nome, provavelmente: parecido.conhecido });
  }

  return trocados;
}

/**
 * Procura chaves repetidas no .env.
 *
 * Num ficheiro de ambiente, a última linha ganha. Quem edita a primeira fica
 * a olhar para o valor certo, no sítio certo, sem efeito nenhum — e não há
 * mensagem de erro que o denuncie.
 *
 * Nunca lê valores, só nomes e a linha onde aparecem.
 */
function detectarChavesRepetidas(caminhoEnv, lerFicheiro) {
  const ler = lerFicheiro || ((f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; } });
  const bruto = ler(caminhoEnv || path.join(RAIZ, '.env'));
  if (!bruto) return [];

  const vistas = new Map();

  bruto.split(/\r?\n/).forEach((linha, i) => {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) return;

    const igual = limpa.indexOf('=');
    if (igual < 1) return;

    const nome = limpa.slice(0, igual).trim();
    if (!vistas.has(nome)) vistas.set(nome, []);
    vistas.get(nome).push(i + 1);
  });

  return [...vistas.entries()]
    .filter(([, linhas]) => linhas.length > 1)
    .map(([nome, linhas]) => ({ nome, linhas, valeA: linhas[linhas.length - 1] }));
}

// ═══════════════════════════════════════════════════════════
// VERIFICAÇÕES (com rede)
// ═══════════════════════════════════════════════════════════

/** O Ollama está instalado e a correr nesta máquina? */
async function verificarOllama(url = URL_OLLAMA) {
  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), 1500);

  try {
    const r = await fetch(`${url}/api/tags`, { signal: controlador.signal });
    if (!r.ok) return { presente: false, modelos: [] };

    const dados = await r.json();
    const modelos = (dados.models || []).map(m => m.name);
    return { presente: true, modelos, url };
  } catch (e) {
    return { presente: false, modelos: [] };
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * A chave funciona mesmo?
 *
 * Pergunta ao fornecedor que modelos tem — é o pedido mais barato que existe e
 * falha de imediato com uma chave inválida. Sem isto, o utilizador termina a
 * instalação convencido de que está tudo bem e só descobre na primeira frase.
 *
 * @returns {Promise<{valida:boolean, modelos:number, erro:string|null}>}
 */
async function testarChave(idFornecedor, chave) {
  let llmRouter, providerHealth;
  try {
    llmRouter = require('./llmRouter');
    providerHealth = require('./providerHealth');
  } catch (e) {
    return { valida: null, modelos: 0, erro: 'não consegui carregar o router de modelos' };
  }

  const fornecedor = llmRouter.PROVIDERS[idFornecedor];
  if (!fornecedor) return { valida: false, modelos: 0, erro: `fornecedor desconhecido: ${idFornecedor}` };

  try {
    const modelos = await providerHealth.listModels(fornecedor, chave);
    // Alguns fornecedores não expõem lista. Nesse caso não se pode afirmar
    // que a chave é boa — e diz-se isso, em vez de assumir que sim.
    if (modelos === null) return { valida: null, modelos: 0, erro: 'este fornecedor não deixa verificar a chave sem gastar um pedido' };

    return { valida: true, modelos: modelos.length, erro: null };
  } catch (err) {
    return { valida: false, modelos: 0, erro: err.message };
  }
}

// ═══════════════════════════════════════════════════════════
// DIAGNÓSTICO
// ═══════════════════════════════════════════════════════════

/**
 * O retrato completo, sem rede.
 *
 * @param {Object} fontes  para os testes poderem fingir outra máquina
 * @returns {{pronto:boolean, problemas:Array, avisos:Array, ...}}
 */
function diagnosticar(fontes = {}) {
  const env = fontes.env || process.env;
  const raiz = fontes.raiz || RAIZ;
  const existe = fontes.existe || ((p) => fs.existsSync(p));
  const perfil = fontes.perfil || null;

  const node = verificarNode(fontes.versaoNode || process.versions.node);
  const deps = verificarDependencias(raiz, existe);
  const ficheiroEnv = verificarEnv(raiz, existe);
  const fornecedores = fornecedoresConfigurados(env);
  const ollama = fontes.ollama || { presente: false, modelos: [] };

  const problemas = [];
  const avisos = [];

  for (const r of (fontes.chavesRepetidas || detectarChavesRepetidas(path.join(raiz, '.env'), fontes.lerFicheiro))) {
    problemas.push({
      id: 'chave-repetida',
      humano: `"${r.nome}" aparece ${r.linhas.length} vezes no .env (linhas ${r.linhas.join(', ')}). Só a última conta — editar as outras não faz nada.`,
      comoResolver: `Deixa só a da linha ${r.valeA} e apaga as restantes.`,
      podeSerAutomatico: true
    });
  }

  for (const t of (fontes.nomesTrocados || detectarNomesTrocados(path.join(raiz, '.env'), fontes.lerFicheiro))) {
    problemas.push({
      id: 'nome-trocado',
      humano: `No .env está "${t.escrito}", mas o NEXO procura "${t.provavelmente}". Uma letra a mais ou a menos e é como se a linha não existisse.`,
      comoResolver: `Muda "${t.escrito}" para "${t.provavelmente}" — o valor fica igual.`,
      podeSerAutomatico: true
    });
  }

  if (!node.ok) {
    problemas.push({
      id: 'node-antigo',
      humano: `O teu Node.js é a versão ${node.maior} e o NEXO precisa da ${NODE_MINIMO} ou mais recente.`,
      comoResolver: 'Instala a versão LTS em https://nodejs.org — demora dois minutos e não desinstala nada.',
      podeSerAutomatico: false
    });
  }

  if (!deps.instalado) {
    problemas.push({
      id: 'sem-dependencias',
      humano: 'Faltam as bibliotecas de que o NEXO depende para arrancar.',
      comoResolver: 'Descarrego-as agora (só as que este computador precisa).',
      podeSerAutomatico: true
    });
  } else if (!deps.ok) {
    problemas.push({
      id: 'dependencias-incompletas',
      humano: `A instalação ficou a meio: faltam ${deps.faltam.join(', ')}.`,
      comoResolver: 'Volto a descarregar o que falta.',
      podeSerAutomatico: true
    });
  }

  const temIA = fornecedores.length > 0 || ollama.presente;
  if (!temIA) {
    problemas.push({
      id: 'sem-ia',
      humano: 'Falta o motor de inteligência — é o que faz o NEXO pensar. Sem ele responde a comandos simples, mas não conversa.',
      comoResolver: 'Ajudo-te a escolher: há opções gratuitas e há a opção de correr tudo no teu computador.',
      podeSerAutomatico: true
    });
  }

  if (perfil === 'completo' && deps.instalado && !deps.electron) {
    avisos.push({
      id: 'sem-electron',
      humano: 'A janela de secretária não está instalada. O NEXO funciona à mesma pelo browser.',
      comoResolver: 'Se quiseres a janela própria: npm install electron --save-dev'
    });
  }

  if (!ficheiroEnv.existe && temIA) {
    avisos.push({
      id: 'sem-env',
      humano: 'Não há ficheiro de configuração, mas encontrei chaves no ambiente do sistema.',
      comoResolver: 'Nada a fazer — só fica dito, para não estranhares.'
    });
  }

  if (fornecedores.length === 1 && !ollama.presente) {
    avisos.push({
      id: 'um-so-fornecedor',
      humano: `Só tens o ${fornecedores[0].nome}. Se ele ficar em baixo ou atingir o limite diário, o NEXO fica sem resposta.`,
      comoResolver: 'Um segundo fornecedor gratuito leva dois minutos e serve de reserva.'
    });
  }

  return {
    pronto: problemas.length === 0,
    problemas,
    avisos,
    node,
    dependencias: deps,
    env: ficheiroEnv,
    fornecedores: fornecedores.map(f => ({ nome: f.nome, env: f.env, gratuito: f.gratuito })),
    ollama: { presente: ollama.presente, modelos: ollama.modelos }
  };
}

/** Versão com rede: acrescenta o que só se sabe perguntando. */
async function diagnosticarCompleto(fontes = {}) {
  const ollama = await verificarOllama();
  return diagnosticar({ ...fontes, ollama });
}

function formatarDiagnostico(d) {
  const linhas = ['', '🩹 Estado da instalação do NEXO', ''];

  const marca = b => (b ? '✅' : '❌');

  linhas.push(`   ${marca(d.node.ok)} Node.js ${d.node.versao}${d.node.ok ? '' : ` (é preciso ${d.node.minimo}+)`}`);
  linhas.push(`   ${marca(d.dependencias.ok)} Bibliotecas ${d.dependencias.ok ? 'instaladas' : 'em falta'}`);
  linhas.push(`   ${marca(d.fornecedores.length > 0 || d.ollama.presente)} Motor de IA ${
    d.fornecedores.length ? d.fornecedores.map(f => f.nome).join(', ') : (d.ollama.presente ? 'Ollama (local)' : 'nenhum')
  }`);

  if (d.ollama.presente) {
    linhas.push(`   ✅ Ollama a correr${d.ollama.modelos.length ? ` — ${d.ollama.modelos.length} modelo(s)` : ' (sem modelos descarregados)'}`);
  }

  if (d.problemas.length) {
    linhas.push('', '   O que falta:');
    for (const p of d.problemas) {
      linhas.push(`     • ${p.humano}`);
      linhas.push(`       ${p.comoResolver}`);
    }
  }

  if (d.avisos.length) {
    linhas.push('', '   A ter em conta:');
    for (const a of d.avisos) linhas.push(`     • ${a.humano}`);
  }

  linhas.push('');
  linhas.push(d.pronto ? '   ✅ Está pronto a usar.' : '   ⚠️  Corre "npm run instalar" para resolver.');
  linhas.push('');

  return linhas.join('\n');
}

module.exports = {
  NODE_MINIMO,
  ESSENCIAIS,
  CHAVES_DE_IA,
  verificarNode,
  verificarDependencias,
  verificarEnv,
  fornecedoresConfigurados,
  detectarNomesTrocados,
  detectarChavesRepetidas,
  verificarOllama,
  testarChave,
  diagnosticar,
  diagnosticarCompleto,
  formatarDiagnostico
};
