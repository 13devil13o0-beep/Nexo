/**
 * ⏱️ Prazos
 *
 * O fetch do Node não desiste sozinho. Um servidor que aceita a ligação e
 * depois adormece deixa o pedido pendurado para sempre, e foi assim que o
 * NEXO ficou mudo: a pesquisa web ficou à espera, o WebSocket nunca respondeu
 * e no ecrã ficou um cursor a piscar sem fim.
 *
 * Silêncio é a pior forma de falhar. Quem espera não sabe se há-de continuar
 * à espera ou desistir. Um erro ao fim de meio minuto é sempre melhor.
 *
 * DOIS TIPOS DE PRAZO, PORQUE SÃO COISAS DIFERENTES
 *
 *   Prazo total       — para um pedido que responde de uma vez. Conta desde o
 *                       início e não se renova.
 *   Prazo sem sinal   — para streaming. Uma resposta longa pode demorar um
 *                       minuto legitimamente, e matá-la ao cronómetro seria
 *                       cortar texto bom. O que não pode é ficar calada. Cada
 *                       pedaço que chega adia o prazo.
 */

/** Quanto tempo se espera por uma resposta que vem de uma vez. */
const PRAZO_RESPOSTA_MS = parseInt(process.env.PRAZO_RESPOSTA_MS) || 45000;

/** Quanto tempo se aceita de silêncio no meio de um streaming. */
const PRAZO_SEM_SINAL_MS = parseInt(process.env.PRAZO_SEM_SINAL_MS) || 25000;

/** Pesquisa na internet: ou é rápida ou não serve para responder. */
const PRAZO_PESQUISA_MS = parseInt(process.env.PRAZO_PESQUISA_MS) || 12000;

/** Tecto para um pedido inteiro, ferramentas incluídas. */
const PRAZO_PEDIDO_MS = parseInt(process.env.PRAZO_PEDIDO_MS) || 120000;

function segundos(ms) {
  return Math.round(ms / 1000);
}

/**
 * Um cronómetro que corta a ligação quando o tempo acaba.
 *
 * @param {number} ms      quanto tempo se espera
 * @param {string} etiqueta  quem está a ser esperado, para a mensagem de erro
 * @returns {Object} { signal, adiar(), parar(), expirou, erro() }
 */
function relogio(ms, etiqueta = 'O serviço') {
  const controlador = new AbortController();
  let expirou = false;
  let temporizador = null;

  const parar = () => {
    if (temporizador) clearTimeout(temporizador);
    temporizador = null;
  };

  const adiar = () => {
    parar();
    temporizador = setTimeout(() => {
      expirou = true;
      controlador.abort();
    }, ms);
    // Um cronómetro pendente não deve segurar o processo ao sair.
    if (typeof temporizador.unref === 'function') temporizador.unref();
  };

  adiar();

  return {
    signal: controlador.signal,
    adiar,
    parar,
    get expirou() { return expirou; },
    erro: () => new Error(`${etiqueta} não respondeu em ${segundos(ms)}s`)
  };
}

/**
 * Traduz o erro de uma ligação cortada para linguagem que se entende.
 *
 * O AbortError diz "This operation was aborted", que não explica nada a
 * ninguém. Quando fomos nós a cortar, dizemos porquê.
 */
function traduzirErro(err, cronometro, etiqueta = 'O serviço') {
  if (cronometro?.expirou) return cronometro.erro();
  if (err?.name === 'AbortError') {
    return new Error(`${etiqueta} foi interrompido`);
  }
  return err;
}

/**
 * Põe prazo a uma promessa que não sabe ser cancelada.
 *
 * Serve para trabalho composto, como um ciclo de ferramentas inteiro: não se
 * corta a meio, mas deixa de se esperar por ele e quem chamou recebe um erro
 * em vez de ficar preso.
 */
function comPrazo(promessa, ms, etiqueta = 'A tarefa') {
  let temporizador = null;
  const alarme = new Promise((_, rejeitar) => {
    temporizador = setTimeout(
      () => rejeitar(new Error(`${etiqueta} não terminou em ${segundos(ms)}s`)),
      ms
    );
    if (typeof temporizador.unref === 'function') temporizador.unref();
  });

  return Promise.race([promessa, alarme]).finally(() => {
    if (temporizador) clearTimeout(temporizador);
  });
}

module.exports = {
  relogio,
  comPrazo,
  traduzirErro,
  PRAZO_RESPOSTA_MS,
  PRAZO_SEM_SINAL_MS,
  PRAZO_PESQUISA_MS,
  PRAZO_PEDIDO_MS
};
