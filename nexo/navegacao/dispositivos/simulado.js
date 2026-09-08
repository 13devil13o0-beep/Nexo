/**
 * 🎮 Dispositivo Simulado
 *
 * O único dispositivo que vem incluído no NEXO, e é de propósito.
 *
 * PORQUE É O ÚNICO
 * Um adaptador para hardware real põe um programa a mandar num corpo que se
 * move e que magoa. Isso não se instala por omissão nem se liga por engano:
 * é código que quem o quer escreve, assina e aprova. O simulador dá tudo o que
 * é preciso para desenhar, testar e demonstrar missões inteiras sem que nada
 * levante voo.
 *
 * O QUE SIMULA
 * Movimento a velocidade constante para o ponto pedido, consumo de bateria
 * proporcional ao tempo, vento como desvio lateral, obstáculos que aparecem a
 * meio e falhas de comunicação. Chega para exercitar todos os caminhos de
 * decisão do cérebro.
 *
 * O QUE NÃO SIMULA
 * Aerodinâmica, inércia, precisão de GPS, tempo de subida. Um voo simulado que
 * corre bem não é prova nenhuma de que o voo real corre bem — é prova de que a
 * LÓGICA DE MISSÃO está sã, que é outra coisa e é só o que se promete aqui.
 */

const geo = require('../geo');
const { dispositivoDeNavegacao } = require('../contrato');

/**
 * @param {Object} opcoes
 * @param {Object} opcoes.posicao          ponto de partida {lat, lng, alt}
 * @param {number} [opcoes.velocidadeMs]   velocidade de cruzeiro
 * @param {number} [opcoes.bateria]        percentagem inicial
 * @param {number} [opcoes.consumoPorSegundo]
 * @param {number} [opcoes.factorTempo]    1 = tempo real; 20 = vinte vezes mais depressa
 * @param {Array}  [opcoes.obstaculos]     [{lat, lng, raioM, apareceAosS}]
 * @param {number} [opcoes.ventoMs]        desvio lateral constante
 * @param {Array}  [opcoes.falhasAosS]     instantes em que não responde
 */
function criarSimulado(opcoes = {}) {
  const capacidades = {
    tipo: opcoes.tipo || 'drone-simulado',
    velocidadeCruzeiroMs: opcoes.velocidadeMs || 12,
    velocidadeMaxMs: (opcoes.velocidadeMs || 12) * 1.5,
    consumoPorSegundo: opcoes.consumoPorSegundo ?? 0.12,  // ~14 min de autonomia
    autonomiaS: opcoes.autonomiaS || 800,
    altitudeMinM: opcoes.altitudeMinM ?? 10,
    altitudeMaxM: opcoes.altitudeMaxM ?? 120,
    raioMaxM: opcoes.raioMaxM ?? 5000,
    temSensorObstaculos: true,
    podeRegressarSozinho: true
  };

  const partida = { ...(opcoes.posicao || { lat: 0, lng: 0, alt: 50 }) };

  const estadoInterno = {
    posicao: { ...partida },
    alvo: null,
    bateria: opcoes.bateria ?? 100,
    ligado: false,
    aMover: false,
    segundosDecorridos: 0,
    ultimoInstanteReal: null,
    pousado: false
  };

  const obstaculos = (opcoes.obstaculos || []).map(o => ({ ...o }));
  const factorTempo = opcoes.factorTempo || 1;
  const ventoMs = opcoes.ventoMs || 0;
  const falhas = new Set(opcoes.falhasAosS || []);

  /**
   * Faz o tempo andar.
   *
   * Por omissão segue o relógio real (× factorTempo), para o simulador poder
   * ser usado com o ciclo verdadeiro do controlador. Com `passo` explícito,
   * anda exactamente o que se mandar — é assim que os testes ficam
   * determinísticos.
   */
  function avancar(passoS = null) {
    let dt = passoS;

    if (dt == null) {
      const agora = Date.now();
      dt = estadoInterno.ultimoInstanteReal
        ? ((agora - estadoInterno.ultimoInstanteReal) / 1000) * factorTempo
        : 0;
      estadoInterno.ultimoInstanteReal = agora;
    }

    if (dt <= 0 || estadoInterno.pousado) return;

    estadoInterno.segundosDecorridos += dt;

    // Bateria gasta-se sempre que está ligado, parado ou a andar. Pairar
    // custa quase o mesmo que avançar, e ignorá-lo dava uma reserva falsa.
    if (estadoInterno.ligado) {
      const consumo = capacidades.consumoPorSegundo * (estadoInterno.aMover ? 1 : 0.85);
      estadoInterno.bateria = Math.max(0, estadoInterno.bateria - consumo * dt);
    }

    if (!estadoInterno.aMover || !estadoInterno.alvo) return;

    const restante = geo.distancia(estadoInterno.posicao, estadoInterno.alvo);
    const percorrido = capacidades.velocidadeCruzeiroMs * dt;

    if (percorrido >= restante) {
      estadoInterno.posicao = { ...estadoInterno.alvo, alt: estadoInterno.alvo.alt ?? estadoInterno.posicao.alt };
      estadoInterno.aMover = false;
    } else {
      const direccao = geo.rumo(estadoInterno.posicao, estadoInterno.alvo);
      let seguinte = geo.projectar(estadoInterno.posicao, direccao, percorrido);

      // O vento empurra de lado. Serve para o caminho real nunca ser
      // exactamente a linha planeada, que é o caso interessante.
      if (ventoMs) seguinte = geo.projectar(seguinte, geo.normalizarRumo(direccao + 90), ventoMs * dt);

      seguinte.alt = interpolarAltitude(estadoInterno.posicao.alt, estadoInterno.alvo.alt, percorrido, restante);
      estadoInterno.posicao = seguinte;
    }

    if (estadoInterno.bateria <= 0) {
      estadoInterno.aMover = false;
      estadoInterno.pousado = true;
    }
  }

  function interpolarAltitude(actual, destino, percorrido, restante) {
    if (actual == null) return destino;
    if (destino == null || restante <= 0) return actual;
    return actual + (destino - actual) * Math.min(1, percorrido / restante);
  }

  /** Obstáculos que já apareceram e estão dentro do alcance dos sensores. */
  function obstaculosVisiveis() {
    const alcance = opcoes.alcanceSensoresM || 150;

    return obstaculos
      .filter(o => (o.apareceAosS || 0) <= estadoInterno.segundosDecorridos)
      .filter(o => geo.distancia(estadoInterno.posicao, o) <= alcance)
      .map(o => ({
        posicao: { lat: o.lat, lng: o.lng },
        raioM: o.raioM || 30,
        distanciaM: Math.round(geo.distancia(estadoInterno.posicao, o)),
        nome: o.nome || 'obstáculo'
      }));
  }

  const dispositivo = dispositivoDeNavegacao({
    id: opcoes.id || 'simulado',
    nome: opcoes.nome || 'Drone simulado',
    simulado: true,
    capacidades,

    async ligar() {
      estadoInterno.ligado = true;
      estadoInterno.ultimoInstanteReal = Date.now();
      return { ligado: true };
    },

    async estado() {
      avancar(opcoes.passoManualS ?? null);

      // Falha de comunicação simulada: devolver null é exactamente o que o
      // controlador vê quando um aparelho real deixa de responder.
      const segundoInteiro = Math.floor(estadoInterno.segundosDecorridos);
      if (falhas.has(segundoInteiro)) return null;

      return {
        posicao: { ...estadoInterno.posicao },
        bateria: estadoInterno.bateria,
        velocidadeMs: estadoInterno.aMover ? capacidades.velocidadeCruzeiroMs : 0,
        rumo: estadoInterno.alvo ? geo.rumo(estadoInterno.posicao, estadoInterno.alvo) : 0,
        ligado: estadoInterno.ligado,
        aMover: estadoInterno.aMover,
        pousado: estadoInterno.pousado,
        obstaculos: obstaculosVisiveis(),
        segundosDecorridos: Math.round(estadoInterno.segundosDecorridos)
      };
    },

    async irPara(ponto) {
      if (!estadoInterno.ligado) return { aceite: false, motivo: 'aparelho desligado' };
      if (estadoInterno.pousado) return { aceite: false, motivo: 'aparelho pousado sem bateria' };
      if (!ponto || ponto.lat == null || ponto.lng == null) return { aceite: false, motivo: 'ponto inválido' };

      estadoInterno.alvo = { ...ponto };
      estadoInterno.aMover = true;
      return { aceite: true };
    },

    async parar() {
      estadoInterno.aMover = false;
      estadoInterno.alvo = null;
    },

    async regressar() {
      estadoInterno.alvo = { ...partida };
      estadoInterno.aMover = true;
    },

    async desligar() {
      estadoInterno.aMover = false;
      estadoInterno.ligado = false;
    }
  });

  /** Só para testes e demonstrações: fazer o tempo andar à mão. */
  dispositivo.avancarTempo = (segundos) => avancar(segundos);
  dispositivo.interno = estadoInterno;

  return dispositivo;
}

module.exports = { criarSimulado };
