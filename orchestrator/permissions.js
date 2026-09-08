/**
 * 🔐 Permissões por Ferramenta
 *
 * Quando o modelo escolhe uma ferramenta sozinho, nem todas devem correr sem
 * pedir licença. Ler um ficheiro é uma coisa; carregar teclas, mexer no rato
 * ou correr um comando no sistema é outra.
 *
 * Cada ferramenta declara uma CLASSE DE RISCO. A política decide o que cada
 * classe pode fazer sem aprovação:
 *
 *   ler      — só lê (pesquisa, ficheiros, estado do sistema). Sempre permitido.
 *   escrever — cria ou altera dentro do projecto (nota, PDF). Permitido, registado.
 *   sistema  — controla a máquina: teclado, rato, comandos, abrir apps.
 *              NEGADO até o utilizador aprovar explicitamente, uma vez por sessão.
 *
 * A classe 'sistema' é a razão de este módulo existir. É o cadeado que faltava
 * para se poder, nas fases seguintes, deixar o modelo controlar o computador.
 *
 * As aprovações persistem em memory/permissions.json e podem ser revogadas.
 */

const fs = require('fs');
const path = require('path');
const security = require('./security');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const STORE = path.join(PROJECT_ROOT, 'memory', 'permissions.json');

const CLASSES = ['ler', 'escrever', 'sistema'];

/**
 * Política por omissão. 'sistema' exige aprovação; o resto passa.
 * Pode ser endurecida com TOOLS_STRICT=1, que passa também 'escrever' a
 * exigir aprovação — útil em máquinas partilhadas ou expostas.
 */
function politica() {
  const estrito = process.env.TOOLS_STRICT === '1';
  return {
    ler: 'permitir',
    escrever: estrito ? 'aprovar' : 'permitir',
    sistema: 'aprovar'
  };
}

// ═══════════════════════════════════════════════════════════
// PERSISTÊNCIA
// ═══════════════════════════════════════════════════════════

let concessoes = null; // { "userId::ferramenta": { quando } }

function carregar() {
  if (concessoes) return concessoes;
  try {
    concessoes = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  } catch (e) {
    concessoes = {};
  }
  return concessoes;
}

function gravar() {
  try {
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    fs.writeFileSync(STORE, JSON.stringify(concessoes, null, 2));
  } catch (e) {
    console.warn('⚠️ Não consegui gravar permissões:', e.message);
  }
}

const chave = (userId, ferramenta) => `${userId || 'anon'}::${ferramenta}`;

// ═══════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════

/**
 * A ferramenta pode correr para este utilizador?
 * @returns {{ permitido: boolean, motivo: string, risco: string, precisaAprovacao: boolean }}
 */
function verificar(userId, ferramenta, risco = 'ler') {
  if (!CLASSES.includes(risco)) risco = 'sistema'; // desconhecido = trata como perigoso

  const regra = politica()[risco];

  if (regra === 'permitir') {
    return { permitido: true, risco, precisaAprovacao: false, motivo: 'classe permitida' };
  }

  // regra === 'aprovar': depende de haver concessão do utilizador
  const store = carregar();
  if (store[chave(userId, ferramenta)]) {
    return { permitido: true, risco, precisaAprovacao: false, motivo: 'aprovado antes' };
  }

  return {
    permitido: false,
    risco,
    precisaAprovacao: true,
    motivo: `A ferramenta "${ferramenta}" controla o teu sistema (classe: ${risco}) e precisa de aprovação. Diz "permite ${ferramenta}" para autorizar.`
  };
}

/** Concede permissão a uma ferramenta para um utilizador. */
function conceder(userId, ferramenta) {
  const store = carregar();
  store[chave(userId, ferramenta)] = { quando: new Date().toISOString() };
  gravar();
  security.logAction(userId, 'permission-granted', { ferramenta });
  return true;
}

/** Revoga uma permissão. */
function revogar(userId, ferramenta) {
  const store = carregar();
  const k = chave(userId, ferramenta);
  const existia = !!store[k];
  delete store[k];
  gravar();
  if (existia) security.logAction(userId, 'permission-revoked', { ferramenta });
  return existia;
}

/** Lista as ferramentas aprovadas por este utilizador. */
function listar(userId) {
  const store = carregar();
  const prefixo = `${userId || 'anon'}::`;
  return Object.keys(store)
    .filter(k => k.startsWith(prefixo))
    .map(k => ({ ferramenta: k.slice(prefixo.length), quando: store[k].quando }));
}

module.exports = {
  verificar,
  conceder,
  revogar,
  listar,
  politica,
  CLASSES,
  STORE
};
