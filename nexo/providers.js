/**
 * 🔌 Registo Unificado de Fornecedores de IA
 *
 * O projecto tinha DOIS sistemas de fornecedores em paralelo, sem um único em
 * comum, separados por um acidente histórico e não por interface:
 *
 *   orchestrator/llmRouter.js    groq · cerebras · gemini · huggingface · ollama
 *   agents/customProvider.js     openai · anthropic · mistral · deepseek · xai · ...
 *
 * A consequência era concreta: o suporte a ferramentas foi construído só no
 * primeiro, portanto o Claude, que vive no segundo, não conseguia usar as
 * ferramentas do NEXO.
 *
 * Este módulo é uma VISTA de leitura sobre os dois, na forma do contrato
 * comum. Deliberadamente não controla nada: quem executa continua a ser o
 * llmRouter. Assim a unificação não muda comportamento nenhum e pode ser
 * verificada pelo banco de ensaios antes de se mexer no que executa.
 *
 * A divisão "gratuito contra pago" desaparece aqui. Passa a ser dois campos,
 * custo e privacidade, que o router pode comparar.
 */

require('dotenv').config();

const contracts = require('./contracts');
const llmRouter = require('../orchestrator/llmRouter');
const customProvider = require('../agents/customProvider');
const metrics = require('../orchestrator/metrics');

/**
 * Fornecedores remotos que não cobram nos limites em que os usamos.
 * Espelha a lista do módulo de métricas, que é quem calcula o custo real.
 */
const CAMADA_GRATUITA = new Set(['groq', 'cerebras', 'gemini', 'huggingface']);

// ═══════════════════════════════════════════════════════════
// ADAPTAÇÃO DOS CATÁLOGOS EXISTENTES
// ═══════════════════════════════════════════════════════════

/** Uma entrada de llmRouter.PROVIDERS na forma do contrato. */
function daCadeiaInterna(id, p) {
  const local = id === 'ollama';
  const temChave = p.keyEnv ? !!process.env[p.keyEnv] : true;

  return contracts.fornecedorIA({
    id,
    nome: p.name,
    origem: 'interno',
    configurado: temChave,
    privacidade: local ? 'local' : 'remoto',
    formato: p.format,
    modeloPadrao: p.model,
    capacidades: {
      ferramentas: !!p.supportsTools,
      visao: !!p.supportsVision,
      streaming: !!p.supportsStreaming,
      raciocinio: !!p.reasoning
    },
    custo: local
      ? contracts.custoZero('corre na máquina do utilizador')
      : (CAMADA_GRATUITA.has(id)
          ? contracts.custoZero('camada gratuita do fornecedor')
          : precoDe(p.model))
  });
}

/** Uma entrada de customProvider.PROVIDER_CATALOG na forma do contrato. */
function doCatalogoPessoal(id, c, configurado) {
  return contracts.fornecedorIA({
    id,
    nome: c.name,
    origem: 'pessoal',
    configurado,
    privacidade: 'remoto',
    formato: c.format,
    modeloPadrao: c.defaultModel,
    capacidades: {
      // Já não é uma bandeira em baixo por omissão: cada entrada do catálogo
      // declara o que sabe fazer, e quem não declara conta como não sabendo.
      ferramentas: c.supportsTools === true,
      visao: !!c.supportsVision,
      streaming: !!c.supportsStreaming,
      raciocinio: false
    },
    custo: precoDe(c.defaultModel)
  });
}

/**
 * Preço a partir da tabela do módulo de métricas, que é a única fonte de
 * verdade sobre custos. Modelo ausente devolve desconhecido, nunca zero.
 */
function precoDe(modelo) {
  const p = metrics.PRICING[modelo];
  return p ? contracts.custo(p.in, p.out) : { ...contracts.CUSTO_DESCONHECIDO };
}

// ═══════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════

/**
 * Todos os fornecedores conhecidos, na mesma forma.
 * @param {Object} opcoes
 * @param {string} [opcoes.userId]        para saber se há fornecedor pessoal activo
 * @param {boolean} [opcoes.apenasConfigurados]
 */
function listar(opcoes = {}) {
  const lista = [];

  for (const [id, p] of Object.entries(llmRouter.PROVIDERS)) {
    lista.push(daCadeiaInterna(id, p));
  }

  // O catálogo pessoal é por utilizador: só uma entrada pode estar activa.
  let activoPessoal = null;
  if (opcoes.userId) {
    try {
      if (customProvider.hasCustomProvider(opcoes.userId)) {
        const cfg = customProvider.getUserProvider(opcoes.userId);
        activoPessoal = cfg && (cfg.providerId || cfg.provider) || null;
      }
    } catch (e) { /* sem fornecedor pessoal configurado */ }
  }

  for (const [id, c] of Object.entries(customProvider.PROVIDER_CATALOG)) {
    lista.push(doCatalogoPessoal(id, c, activoPessoal === id));
  }

  return opcoes.apenasConfigurados ? lista.filter(p => p.configurado) : lista;
}

function porId(id, opcoes = {}) {
  return listar(opcoes).find(p => p.id === id) || null;
}

/**
 * Quem é capaz de fazer o que o pedido exige.
 * É o que substitui os filtros escritos à mão espalhados pelo router.
 * @param {Object} exigencias  ex.: { ferramentas: true, privacidade: 'local' }
 */
function capazesDe(exigencias = {}, opcoes = {}) {
  return listar({ ...opcoes, apenasConfigurados: true }).filter(p => {
    for (const [chave, valor] of Object.entries(exigencias.capacidades || {})) {
      if (valor && !p.capacidades[chave]) return false;
    }
    if (exigencias.privacidade && p.privacidade !== exigencias.privacidade) return false;
    if (exigencias.custoMaximoEntrada != null) {
      if (!p.custo.conhecido) return false;
      if (p.custo.entradaPorMilhao > exigencias.custoMaximoEntrada) return false;
    }
    return true;
  });
}

/** Linha por fornecedor, para diagnóstico na consola. */
function formatarRelatorio(lista = listar()) {
  const linhas = ['', '🔌 Fornecedores de IA conhecidos pelo NEXO', ''];
  const marca = b => (b ? '·' : ' ');

  linhas.push('   id              origem    priv    cfg  ferr  visao  strm  custo');
  for (const p of lista) {
    const custo = p.custo.conhecido
      ? (p.custo.entradaPorMilhao === 0 ? 'grátis' : `$${p.custo.entradaPorMilhao}/M`)
      : '?';
    linhas.push(
      `   ${p.id.padEnd(15)} ${p.origem.padEnd(9)} ${p.privacidade.padEnd(7)} ` +
      `${marca(p.configurado)}    ${marca(p.capacidades.ferramentas)}     ` +
      `${marca(p.capacidades.visao)}      ${marca(p.capacidades.streaming)}     ${custo}`
    );
  }
  linhas.push('');
  return linhas.join('\n');
}

module.exports = {
  listar,
  porId,
  capazesDe,
  formatarRelatorio,
  CAMADA_GRATUITA
};
