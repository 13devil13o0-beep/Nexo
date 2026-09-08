/**
 * 📍 Planeador de Rota
 *
 * Transforma "daqui para ali, sem passar por aqueles sítios" numa lista de
 * pontos, com distância, tempo e energia estimados.
 *
 * O QUE ESTE PLANEADOR É
 * Geométrico. Sabe contornar zonas proibidas e recusar o que não cabe na
 * bateria. Nada mais.
 *
 * O QUE NÃO É
 * Não conhece terreno, edifícios, vento, espaço aéreo nem tráfego. Uma rota
 * planeada aqui é uma INTENÇÃO, não uma garantia de que o caminho está livre —
 * quem garante isso é o piloto automático do aparelho, com os seus sensores.
 * Dizer o contrário seria dar a este ficheiro uma autoridade que ele não tem.
 */

const geo = require('./geo');

/** Quantas vezes se tenta contornar antes de desistir de uma rota. */
const MAX_CONTORNOS = 4;

/** Distância máxima entre pontos de verificação consecutivos. */
const PASSO_PADRAO_M = 200;

/**
 * Energia (% de bateria) para percorrer uma distância.
 * Sem consumo declarado nas capacidades, devolve null — desconhecido, nunca
 * zero. Um plano com energia desconhecida é tratado como não verificado.
 */
function energiaNecessaria(distanciaM, capacidades = {}) {
  const velocidade = capacidades.velocidadeCruzeiroMs || capacidades.velocidadeMaxMs;
  if (!velocidade) return null;

  const segundos = distanciaM / velocidade;

  if (capacidades.consumoPorSegundo != null) {
    return segundos * capacidades.consumoPorSegundo;
  }

  // Sem consumo explícito, deriva-se da autonomia declarada: gastar a bateria
  // toda demora `autonomiaS` segundos.
  if (capacidades.autonomiaS) {
    return (segundos / capacidades.autonomiaS) * 100;
  }

  return null;
}

function tempoEstimado(distanciaM, capacidades = {}) {
  const velocidade = capacidades.velocidadeCruzeiroMs || capacidades.velocidadeMaxMs;
  return velocidade ? distanciaM / velocidade : null;
}

/** Comprimento total de uma sequência de pontos. */
function comprimento(pontos) {
  let total = 0;
  for (let i = 1; i < pontos.length; i++) total += geo.distancia(pontos[i - 1], pontos[i]);
  return total;
}

/**
 * Insere pontos de contorno até o caminho não atravessar zona nenhuma.
 *
 * Cada passagem trata um segmento problemático de cada vez. Contornar pode
 * criar um segmento novo que atravessa outra zona, e é por isso que se repete —
 * mas com tecto, porque duas zonas que se sobrepõem podem não ter volta e o
 * ciclo tem de acabar em "não dá" em vez de andar às voltas.
 */
function contornarZonas(pontos, zonas, folgaM) {
  if (!zonas.length) return { pontos, contornadas: [], bloqueado: null };

  let caminho = [...pontos];
  const contornadas = [];

  for (let tentativa = 0; tentativa < MAX_CONTORNOS; tentativa++) {
    let mexeu = false;

    for (let i = 1; i < caminho.length; i++) {
      const a = caminho[i - 1];
      const b = caminho[i];
      const [zona] = geo.zonasNoCaminho(a, b, zonas);
      if (!zona) continue;

      const contorno = geo.pontoDeContorno(a, b, zona, folgaM);

      // Sem contorno possível, ou um contorno que continua dentro de outra
      // zona: não vale a pena insistir, e o chamador precisa de o saber.
      if (!contorno || zonas.some(z => geo.dentroDaZona(contorno, z))) {
        return { pontos: caminho, contornadas, bloqueado: zona };
      }

      caminho.splice(i, 0, contorno);
      contornadas.push(zona);
      mexeu = true;
      break;
    }

    if (!mexeu) return { pontos: caminho, contornadas, bloqueado: null };
  }

  // Esgotou as tentativas: se ainda atravessa alguma coisa, é bloqueio.
  for (let i = 1; i < caminho.length; i++) {
    const [zona] = geo.zonasNoCaminho(caminho[i - 1], caminho[i], zonas);
    if (zona) return { pontos: caminho, contornadas, bloqueado: zona };
  }

  return { pontos: caminho, contornadas, bloqueado: null };
}

/** Parte segmentos longos em pontos de verificação regulares. */
function densificar(pontos, passoM) {
  const saida = [pontos[0]];

  for (let i = 1; i < pontos.length; i++) {
    const a = pontos[i - 1];
    const b = pontos[i];
    const d = geo.distancia(a, b);
    const partes = Math.max(1, Math.ceil(d / passoM));

    for (let k = 1; k <= partes; k++) saida.push(geo.interpolar(a, b, k / partes));
  }

  return saida;
}

/**
 * Planeia uma rota.
 *
 * @param {Object} inicio      {lat, lng, alt}
 * @param {Object} destino     {lat, lng, alt}
 * @param {Object} regras      zonasProibidas, altitudeMin/MaxM, raioMaxM
 * @param {Object} capacidades do dispositivo, para tempo e energia
 * @returns {Object} rota
 */
function planear(inicio, destino, regras = {}, capacidades = {}) {
  const zonas = regras.zonasProibidas || [];
  const folga = regras.folgaZonaM ?? 50;

  const base = {
    inicio,
    destino,
    pontos: [],
    distanciaM: 0,
    tempoEstimadoS: null,
    energiaEstimadaPct: null,
    zonasContornadas: [],
    viavel: false,
    motivo: null
  };

  // Um destino dentro de zona proibida não tem rota nenhuma: nem contornando.
  const zonaDoDestino = zonas.find(z => geo.dentroDaZona(destino, z));
  if (zonaDoDestino) {
    return { ...base, motivo: `destino dentro de zona proibida (${zonaDoDestino.nome || 'sem nome'})` };
  }

  if (regras.raioMaxM != null && geo.distancia(inicio, destino) > regras.raioMaxM) {
    return { ...base, motivo: `destino a ${Math.round(geo.distancia(inicio, destino))} m, além do raio permitido (${regras.raioMaxM} m)` };
  }

  const { pontos, contornadas, bloqueado } = contornarZonas([inicio, destino], zonas, folga);

  if (bloqueado) {
    return {
      ...base,
      pontos,
      zonasContornadas: contornadas,
      motivo: `caminho bloqueado por ${bloqueado.nome || 'zona proibida'} sem contorno viável`
    };
  }

  const caminho = densificar(pontos, regras.passoM || PASSO_PADRAO_M);
  const distanciaM = comprimento(caminho);

  // Aplicar altitude das regras a todos os pontos, quando definida.
  const altitude = regras.altitudeCruzeiroM
    ?? destino.alt
    ?? inicio.alt
    ?? regras.altitudeMinM
    ?? null;

  if (altitude != null) caminho.forEach(p => { p.alt = altitude; });

  return {
    ...base,
    pontos: caminho,
    distanciaM,
    tempoEstimadoS: tempoEstimado(distanciaM, capacidades),
    energiaEstimadaPct: energiaNecessaria(distanciaM, capacidades),
    zonasContornadas: contornadas,
    viavel: true,
    motivo: contornadas.length ? `${contornadas.length} zona(s) contornada(s)` : 'caminho directo'
  };
}

/**
 * Replaneia a partir de onde o aparelho está agora.
 * É o mesmo cálculo — a diferença é só o ponto de partida ser a posição real e
 * não o ponto de origem da missão.
 */
function replanear(posicaoActual, destino, regras = {}, capacidades = {}) {
  return planear(posicaoActual, destino, regras, capacidades);
}

/**
 * Avalia os planos B: quais têm rota, cabem na bateria e servem o propósito.
 *
 * Devolve TODOS, viáveis e inviáveis, com o motivo. Esconder os inviáveis
 * tornava impossível explicar depois porque é que se escolheu aquele.
 */
function avaliarAlternativas(posicaoActual, alternativas, missao, capacidades = {}, bateriaPct = 100) {
  const propositoDaMissao = missao?.objetivo?.proposito || null;

  return alternativas.map(alt => {
    const rota = planear(posicaoActual, alt.localizacao || alt, missao?.regras || {}, capacidades);

    const cumpreObjetivo = !propositoDaMissao
      || !alt.proposito
      || alt.proposito === propositoDaMissao;

    const energiaIda = rota.energiaEstimadaPct;
    const energiaRegresso = energiaNecessaria(
      geo.distancia(alt.localizacao || alt, missao?.inicio || posicaoActual),
      capacidades
    );

    const orcamento = (energiaIda != null && energiaRegresso != null)
      ? (energiaIda + energiaRegresso) * (missao?.regras?.margemRegresso ?? 1.4)
      : null;

    const cabeNaBateria = orcamento == null ? null : orcamento <= bateriaPct;

    let motivo = null;
    if (!rota.viavel) motivo = rota.motivo;
    else if (!cumpreObjetivo) motivo = `propósito diferente (${alt.proposito} ≠ ${propositoDaMissao})`;
    else if (cabeNaBateria === false) motivo = `não cabe na bateria (precisa de ~${Math.round(orcamento)}%, há ${Math.round(bateriaPct)}%)`;
    else if (cabeNaBateria === null) motivo = 'energia por verificar (consumo do aparelho desconhecido)';

    return {
      nome: alt.nome || 'alternativa sem nome',
      localizacao: alt.localizacao || alt,
      proposito: alt.proposito || null,
      rota,
      distanciaM: rota.distanciaM,
      energiaTotalPct: orcamento,
      cumpreObjetivo,
      cabeNaBateria,
      // Só é elegível o que tem rota, serve o propósito e não é sabidamente
      // impossível de pagar. Energia por verificar não exclui, mas fica dito.
      viavel: rota.viavel && cumpreObjetivo && cabeNaBateria !== false,
      motivo
    };
  });
}

module.exports = {
  planear,
  replanear,
  avaliarAlternativas,
  energiaNecessaria,
  tempoEstimado,
  comprimento,
  densificar,
  contornarZonas,
  MAX_CONTORNOS,
  PASSO_PADRAO_M
};
