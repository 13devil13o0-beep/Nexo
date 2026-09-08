/**
 * 🧭 Navegação e Missão
 *
 * Ponto de entrada do módulo. O NEXO como supervisor de missão de um aparelho
 * que se move — drone, robô, veículo — sem nunca lhe assumir o comando de voo.
 *
 *   contrato.js              o que um dispositivo tem de saber fazer
 *   geo.js                   distâncias, rumos, zonas
 *   planeador.js             rota, contornos, energia
 *   cerebro.js               decisões (regras determinísticas + opinião opcional da IA)
 *   controlador.js           o ciclo que junta tudo
 *   dispositivos/simulado.js o único aparelho incluído
 *
 * A divisão de responsabilidades, que é a razão de este módulo poder existir:
 *
 *   piloto automático do aparelho  →  não bater, não cair, não sair da cerca
 *   NEXO (isto)                    →  vale a pena continuar? qual o plano B?
 *
 * Exemplo mínimo:
 *
 *   const { criarSimulado, ControladorDeMissao } = require('./nexo/navegacao');
 *
 *   const drone = criarSimulado({ posicao: { lat: 40.15, lng: -8.65, alt: 60 } });
 *   const c = new ControladorDeMissao({ dispositivo: drone, missao: { ... } });
 *   c.on('decisao', d => console.log(d.accao, d.motivo));
 *   await c.iniciar();
 */

const contrato = require('./contrato');
const geo = require('./geo');
const planeador = require('./planeador');
const cerebro = require('./cerebro');
const { ControladorDeMissao, INTERVALO_PADRAO_MS } = require('./controlador');
const { criarSimulado } = require('./dispositivos/simulado');

module.exports = {
  contrato,
  geo,
  planeador,
  cerebro,
  ControladorDeMissao,
  INTERVALO_PADRAO_MS,
  criarSimulado,

  // Atalhos usados com mais frequência
  missao: contrato.missao,
  ACCOES: contrato.ACCOES,
  AUTONOMIA: contrato.AUTONOMIA,
  URGENCIA: contrato.URGENCIA
};
