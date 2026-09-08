/**
 * 📐 Contratos do NEXO
 *
 * O núcleo do NEXO nunca deve saber se está a falar com o Claude, com o Groq
 * ou com um modelo local. Só sabe que precisa de raciocinar, pesquisar,
 * simular, executar ou validar. Estes contratos são a fronteira onde isso
 * deixa de importar.
 *
 * REGRA: este ficheiro não importa nada do projecto. É a única forma de
 * poder ser lido por qualquer camada sem criar ciclos de importação.
 *
 * ─────────────────────────────────────────────────────────────
 * AIProvider
 * ─────────────────────────────────────────────────────────────
 *   id            string            'claude', 'groq', 'ollama'
 *   nome          string            nome legível
 *   origem        'interno'|'pessoal'  de onde veio a definição
 *   configurado   boolean           tem chave ou está acessível
 *   privacidade   'local'|'remoto'  se os dados saem da máquina
 *   capacidades   { ferramentas, visao, streaming, raciocinio }
 *   custo         { entradaPorMilhao, saidaPorMilhao, conhecido }
 *   modeloPadrao  string
 *
 * Nota sobre custo: um preço desconhecido é `conhecido: false`, nunca zero.
 * Inventar um preço é pior do que admitir que não se sabe, e o router prefere
 * o que sabe medir ao que lhe disseram.
 *
 * ─────────────────────────────────────────────────────────────
 * SimulationProvider  (definido, ainda sem implementação)
 * ─────────────────────────────────────────────────────────────
 *   simular(pedido)   → SimulationResult
 *   disponivel()      → boolean
 *   capacidades()     → { agentesMax, plataformas, deterministico }
 *
 * Um SimulationResult nunca afirma probabilidades do mundo real. Descreve o
 * que aconteceu dentro da simulação:
 *   { cenarios[], factores[], incerteza, execucoes, aviso }
 *
 * A frase "esta app tem 82% de hipóteses de sucesso" é proibida por contrato.
 * A frase correcta é "nas condições desta simulação, a alternativa B saiu
 * melhor em 82% das execuções".
 */

/** Capacidades assumidas quando um fornecedor não declara nada. */
const CAPACIDADES_PADRAO = Object.freeze({
  ferramentas: false,
  visao: false,
  streaming: false,
  raciocinio: false
});

/** Custo desconhecido. Nunca confundir com gratuito. */
const CUSTO_DESCONHECIDO = Object.freeze({
  entradaPorMilhao: null,
  saidaPorMilhao: null,
  conhecido: false
});

/** Custo nulo verificado: modelo local ou camada gratuita. */
function custoZero(motivo) {
  return { entradaPorMilhao: 0, saidaPorMilhao: 0, conhecido: true, motivo };
}

function custo(entrada, saida) {
  if (typeof entrada !== 'number' || typeof saida !== 'number') return { ...CUSTO_DESCONHECIDO };
  return { entradaPorMilhao: entrada, saidaPorMilhao: saida, conhecido: true };
}

/**
 * Constrói uma entrada válida do registo, preenchendo o que faltar.
 * Aceita definições parciais para que os catálogos antigos possam ser
 * adaptados sem serem reescritos.
 */
function fornecedorIA(dados = {}) {
  return {
    id: dados.id || null,
    nome: dados.nome || dados.id || 'desconhecido',
    origem: dados.origem === 'pessoal' ? 'pessoal' : 'interno',
    configurado: !!dados.configurado,
    privacidade: dados.privacidade === 'local' ? 'local' : 'remoto',
    capacidades: { ...CAPACIDADES_PADRAO, ...(dados.capacidades || {}) },
    custo: dados.custo || { ...CUSTO_DESCONHECIDO },
    modeloPadrao: dados.modeloPadrao || null,
    formato: dados.formato || null
  };
}

/**
 * Verifica se um objecto cumpre o contrato mínimo. Usado nos testes e por
 * quem registar fornecedores novos.
 * @returns {{ valido: boolean, faltas: string[] }}
 */
function validarFornecedorIA(p) {
  const faltas = [];
  if (!p || typeof p !== 'object') return { valido: false, faltas: ['não é um objecto'] };

  if (!p.id) faltas.push('id');
  if (!p.nome) faltas.push('nome');
  if (!['local', 'remoto'].includes(p.privacidade)) faltas.push('privacidade');
  if (!p.capacidades || typeof p.capacidades !== 'object') faltas.push('capacidades');
  if (!p.custo || typeof p.custo.conhecido !== 'boolean') faltas.push('custo.conhecido');

  return { valido: faltas.length === 0, faltas };
}

module.exports = {
  CAPACIDADES_PADRAO,
  CUSTO_DESCONHECIDO,
  custoZero,
  custo,
  fornecedorIA,
  validarFornecedorIA
};
