/**
 * 🔍 Detecção de Dispositivo
 *
 * O NEXO adapta-se ao aparelho, não o contrário. Este módulo olha para a
 * máquina e diz qual dos quatro perfis de arranque faz sentido aqui.
 *
 * REGRA: este ficheiro não lança nada nem escreve nada. Recebe sinais e
 * devolve uma decisão. É o que permite testá-lo com ambientes simulados —
 * sem SSH, sem contentor e sem servidor à mão — e é a mesma disciplina do
 * nexo/providers.js: primeiro ver, só depois decidir.
 *
 * ─────────────────────────────────────────────────────────────
 * OS QUATRO PERFIS
 * ─────────────────────────────────────────────────────────────
 *   completo  ecrã e memória folgada        → janela Electron, bandeja, atalhos
 *   leve      ecrã pequeno ou pouca memória → só o motor, página em modo leve
 *   consola   sem gráficos, com terminal    → REPL, com o motor por trás
 *   servico   sem gráficos, sem terminal    → só o motor, sem janela nenhuma
 *
 * ─────────────────────────────────────────────────────────────
 * PRECEDÊNCIA
 * ─────────────────────────────────────────────────────────────
 * A detecção é o ÚLTIMO recurso, nunca o primeiro:
 *   1. --modo=x na linha de comandos
 *   2. NEXO_MODO no ambiente
 *   3. escolha guardada em memory/definicoes.json
 *   4. detecção automática
 *
 * Sem isto a adaptação automática deixava de ser ajuda e passava a imposição.
 */

const os = require('os');
const fs = require('fs');

const PERFIS = ['completo', 'leve', 'consola', 'servico'];

/**
 * Abaixo deste limiar a janela do Electron sozinha come uma fatia grande da
 * memória que existe, e o aparelho fica pior com interface do que sem ela.
 */
const MEMORIA_MINIMA_GB = parseFloat(process.env.NEXO_MEMORIA_MINIMA) || 4;

/** Menos de 2 núcleos não aguenta o Chromium sem engasgar. */
const NUCLEOS_MINIMOS = 2;

// ═══════════════════════════════════════════════════════════
// SINAIS
// ═══════════════════════════════════════════════════════════

/**
 * Há ambiente gráfico nesta máquina?
 *
 * Cada sistema responde a esta pergunta de maneira diferente:
 *   linux   — sem DISPLAY nem WAYLAND_DISPLAY não há onde desenhar
 *   darwin  — há sempre, excepto quando se entrou por SSH
 *   win32   — há sempre, excepto em sessões de serviço (a Sessão 0, onde o
 *             Gestor de Serviços corre as coisas sem ambiente de trabalho)
 */
function temGraficos(plataforma, env) {
  if (plataforma === 'linux') {
    return !!(env.DISPLAY || env.WAYLAND_DISPLAY);
  }

  if (plataforma === 'darwin') {
    return !(env.SSH_CONNECTION || env.SSH_TTY);
  }

  if (plataforma === 'win32') {
    // O Gestor de Serviços do Windows não define SESSIONNAME. Um utilizador
    // com sessão iniciada tem sempre "Console" ou "RDP-Tcp#n".
    if (env.NEXO_SERVICO === '1') return false;
    return !!env.SESSIONNAME || !env.USERNAME || env.USERNAME !== 'SYSTEM';
  }

  return true;
}

/**
 * Estamos dentro de um contentor?
 *
 * O ficheiro /.dockerenv é o sinal clássico. O cgroup apanha os casos em que
 * ele não existe: containerd, Podman e Kubernetes.
 */
function emContentor(lerFicheiro) {
  if (lerFicheiro('/.dockerenv') !== null) return true;

  const cgroup = lerFicheiro('/proc/1/cgroup');
  if (!cgroup) return false;

  return /docker|containerd|kubepods|podman|lxc/.test(cgroup);
}

/** Lê um ficheiro sem rebentar quando ele não existe (Windows, por exemplo). */
function lerFicheiroReal(caminho) {
  try {
    return fs.readFileSync(caminho, 'utf8');
  } catch (e) {
    return null;
  }
}

/**
 * Recolhe tudo o que interessa saber sobre a máquina.
 *
 * Todas as fontes são injectáveis para os testes poderem fingir um Raspberry
 * Pi sem ecrã sem terem de arranjar um.
 */
function recolherSinais(fontes = {}) {
  const env = fontes.env || process.env;
  const plataforma = fontes.plataforma || process.platform;
  const lerFicheiro = fontes.lerFicheiro || lerFicheiroReal;

  const memoriaTotal = fontes.memoriaTotal != null ? fontes.memoriaTotal : os.totalmem();
  const memoriaLivre = fontes.memoriaLivre != null ? fontes.memoriaLivre : os.freemem();
  const nucleos = fontes.nucleos != null ? fontes.nucleos : os.cpus().length;
  const terminal = fontes.terminal != null ? fontes.terminal : !!process.stdout.isTTY;

  return {
    plataforma,
    graficos: temGraficos(plataforma, env),
    sshRemoto: !!(env.SSH_CONNECTION || env.SSH_TTY || env.SSH_CLIENT),
    terminal,
    contentor: emContentor(lerFicheiro),
    automacao: !!(env.CI || env.GITHUB_ACTIONS || env.CONTINUOUS_INTEGRATION),
    memoriaGB: +(memoriaTotal / 1024 ** 3).toFixed(1),
    memoriaLivreGB: +(memoriaLivre / 1024 ** 3).toFixed(1),
    nucleos
  };
}

// ═══════════════════════════════════════════════════════════
// DECISÃO
// ═══════════════════════════════════════════════════════════

/**
 * Escolhe o perfil a partir dos sinais.
 *
 * A ordem das perguntas é o próprio raciocínio, e por isso está escrita em vez
 * de espalhada por condições soltas:
 *
 *   1. É automação ou contentor? Nunca abrir janela.
 *   2. Há onde desenhar? Se não há, resta terminal ou serviço.
 *   3. Vim por SSH? Estou noutra máquina — não abrir janela lá.
 *   4. A máquina aguenta a janela? Se não aguenta, modo leve.
 *   5. Caso contrário, o melhor que temos.
 *
 * @returns {{ perfil: string, motivo: string }}
 */
function escolherPerfil(sinais) {
  if (sinais.automacao) {
    return { perfil: 'servico', motivo: 'ambiente de automação (CI): nunca abrir janela' };
  }

  if (sinais.contentor) {
    return { perfil: 'servico', motivo: 'a correr dentro de um contentor' };
  }

  if (!sinais.graficos) {
    return sinais.terminal
      ? { perfil: 'consola', motivo: 'sem ambiente gráfico, mas com terminal interactivo' }
      : { perfil: 'servico', motivo: 'sem ambiente gráfico e sem terminal' };
  }

  if (sinais.sshRemoto) {
    // Pode até haver gráficos reencaminhados, mas a janela abriria na máquina
    // errada, ou pior, arrastada por uma ligação lenta.
    return sinais.terminal
      ? { perfil: 'consola', motivo: 'sessão remota por SSH' }
      : { perfil: 'servico', motivo: 'sessão remota por SSH sem terminal' };
  }

  if (sinais.memoriaGB < MEMORIA_MINIMA_GB) {
    return {
      perfil: 'leve',
      motivo: `memória curta (${sinais.memoriaGB} GB, mínimo ${MEMORIA_MINIMA_GB} GB para a janela)`
    };
  }

  if (sinais.nucleos < NUCLEOS_MINIMOS) {
    return { perfil: 'leve', motivo: `só ${sinais.nucleos} núcleo(s) de processador` };
  }

  return {
    perfil: 'completo',
    motivo: `ecrã disponível e ${sinais.memoriaGB} GB de memória`
  };
}

/** Detecção automática nesta máquina, sem passar pela precedência. */
function detectar(fontes = {}) {
  const sinais = recolherSinais(fontes);
  const { perfil, motivo } = escolherPerfil(sinais);
  return { perfil, motivo, sinais, origem: 'deteccao' };
}

// ═══════════════════════════════════════════════════════════
// PRECEDÊNCIA
// ═══════════════════════════════════════════════════════════

/** Lê --modo=x ou --modo x da linha de comandos. */
function modoDosArgumentos(argv = []) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--modo=')) return a.slice(7).toLowerCase();
    if (a === '--modo' && argv[i + 1]) return argv[i + 1].toLowerCase();
  }
  return null;
}

function perfilValido(valor) {
  return typeof valor === 'string' && PERFIS.includes(valor.toLowerCase());
}

/**
 * A decisão final, com toda a precedência aplicada.
 *
 * @param {Object} entrada
 * @param {string[]} [entrada.argv]        argumentos da linha de comandos
 * @param {Object}   [entrada.env]         ambiente
 * @param {Object}   [entrada.definicoes]  o que está guardado ({ modo: 'auto' })
 * @param {Object}   [entrada.fontes]      fontes de sinais, para testes
 * @returns {{ perfil, motivo, origem, sinais }}
 */
function resolver(entrada = {}) {
  const argv = entrada.argv || process.argv.slice(2);
  // Um ambiente dado nas fontes ganha ao real: é o que permite aos testes
  // fingirem uma máquina sem depender daquela onde estão a correr.
  const env = entrada.env || (entrada.fontes && entrada.fontes.env) || process.env;
  const definicoes = entrada.definicoes || {};
  const fontes = { ...(entrada.fontes || {}), env };

  const sinais = recolherSinais(fontes);

  const doArgumento = modoDosArgumentos(argv);
  if (perfilValido(doArgumento)) {
    return { perfil: doArgumento.toLowerCase(), motivo: 'pedido na linha de comandos', origem: 'argumento', sinais };
  }

  if (perfilValido(env.NEXO_MODO)) {
    return { perfil: env.NEXO_MODO.toLowerCase(), motivo: 'definido em NEXO_MODO', origem: 'ambiente', sinais };
  }

  if (perfilValido(definicoes.modo)) {
    return { perfil: definicoes.modo.toLowerCase(), motivo: 'escolha guardada nas definições', origem: 'definicoes', sinais };
  }

  const automatico = escolherPerfil(sinais);
  return { ...automatico, origem: 'deteccao', sinais };
}

// ═══════════════════════════════════════════════════════════
// RELATÓRIO
// ═══════════════════════════════════════════════════════════

const DESCRICAO = {
  completo: 'janela de secretária, bandeja e atalhos globais',
  leve: 'só o motor, com a página em modo leve no browser',
  consola: 'REPL no terminal, com o motor por trás',
  servico: 'só o motor, sem janela nenhuma'
};

function formatarRelatorio(decisao) {
  const s = decisao.sinais;
  const sim = b => (b ? 'sim' : 'não');

  return [
    '',
    '🔍 O que o NEXO vê deste aparelho',
    '',
    `   sistema            ${s.plataforma}`,
    `   ambiente gráfico   ${sim(s.graficos)}`,
    `   terminal           ${sim(s.terminal)}`,
    `   sessão SSH         ${sim(s.sshRemoto)}`,
    `   contentor          ${sim(s.contentor)}`,
    `   automação (CI)     ${sim(s.automacao)}`,
    `   memória            ${s.memoriaGB} GB (${s.memoriaLivreGB} GB livres)`,
    `   núcleos            ${s.nucleos}`,
    '',
    `   ➜ perfil: ${decisao.perfil.toUpperCase()} — ${DESCRICAO[decisao.perfil] || ''}`,
    `     ${decisao.motivo}`,
    `     origem da decisão: ${decisao.origem}`,
    ''
  ].join('\n');
}

module.exports = {
  PERFIS,
  MEMORIA_MINIMA_GB,
  NUCLEOS_MINIMOS,
  DESCRICAO,
  temGraficos,
  emContentor,
  recolherSinais,
  escolherPerfil,
  detectar,
  resolver,
  modoDosArgumentos,
  perfilValido,
  formatarRelatorio
};
