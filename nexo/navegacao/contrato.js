/**
 * 📐 Contrato de Navegação
 *
 * O NEXO nunca deve saber se está a falar com um drone, com um robô de armazém
 * ou com um simulador. Só sabe que há um corpo algures que se move, gasta
 * energia e pode recusar ordens. Este ficheiro é a fronteira onde isso deixa de
 * importar.
 *
 * REGRA: este ficheiro não importa nada do projecto. Igual ao nexo/contracts.js,
 * e pela mesma razão — pode ser lido por qualquer camada sem criar ciclos.
 *
 * ─────────────────────────────────────────────────────────────
 * ONDE ESTE MÓDULO NÃO MANDA
 * ─────────────────────────────────────────────────────────────
 * O NEXO decide MISSÃO, não VOO. A diferença não é de grau, é de camada:
 *
 *   piloto automático do aparelho   milissegundos   estabilizar, desviar de um
 *   (PX4, ArduPilot, SDK do DJI)                    obstáculo a 2 m, geofence,
 *                                                   regressar por falha
 *
 *   NEXO (isto)                     segundos        que ponto a seguir, o plano
 *                                                   ainda serve, qual o plano B
 *
 * Um obstáculo que aparece a quinze metros por segundo resolve-se na primeira
 * camada, não aqui. Um ciclo de decisão de um segundo com um modelo de
 * linguagem pelo meio nunca chega a tempo, e fingir que chega é o único erro
 * verdadeiramente perigoso que este módulo podia cometer.
 *
 * ─────────────────────────────────────────────────────────────
 * DispositivoDeNavegacao
 * ─────────────────────────────────────────────────────────────
 *   ligar()            → Promise<void>
 *   estado()           → Promise<EstadoDispositivo>
 *   irPara(ponto)      → Promise<{aceite:boolean, motivo?}>
 *   parar()            → Promise<void>    imobiliza onde está
 *   regressar()        → Promise<void>    volta ao ponto de partida
 *   desligar()         → Promise<void>
 *   capacidades        → Capacidades
 *
 * EstadoDispositivo:
 *   { posicao:{lat,lng,alt}, bateria:0-100, velocidadeMs, rumo,
 *     ligado, aMover, obstaculos:[], erro }
 *
 * ─────────────────────────────────────────────────────────────
 * O CAMPO `simulado`
 * ─────────────────────────────────────────────────────────────
 * Um dispositivo TEM de declarar se é simulado. Não há valor por omissão
 * seguro: um adaptador que não diz nada é tratado como real, e um dispositivo
 * real exige aprovação explícita antes de receber a primeira ordem.
 *
 * É a mesma regra do custo em nexo/contracts.js: um preço desconhecido é
 * `conhecido: false`, nunca zero. Aqui, um dispositivo que não se declara é
 * físico, nunca simulado. Enganar-se para o lado seguro custa uma confirmação;
 * enganar-se para o outro custa um aparelho — ou pior.
 */

/** As acções que o cérebro pode decidir. Não há mais nenhuma. */
const ACCOES = Object.freeze({
  CONTINUAR: 'continuar',       // o plano serve, seguir
  DESVIAR: 'desviar',           // mesmo destino, caminho diferente
  MUDAR_DESTINO: 'mudar_destino', // destino inatingível, plano B serve o objectivo
  REGRESSAR: 'regressar',       // voltar ao ponto de partida
  PARAR: 'parar',               // imobilizar já
  CONCLUIR: 'concluir'          // chegou
});

/** Quem manda quando o plano muda. */
const AUTONOMIA = Object.freeze({
  /** Muda de caminho sozinho; mudar de DESTINO espera por uma pessoa. */
  SUPERVISIONADO: 'supervisionado',
  /** Decide tudo e relata. Só para dispositivos simulados por omissão. */
  AUTONOMO: 'autonomo'
});

/** Gravidade de uma decisão, para se saber o que nunca espera por ninguém. */
const URGENCIA = Object.freeze({
  ROTINA: 'rotina',
  ATENCAO: 'atencao',
  SEGURANCA: 'seguranca'   // nunca pede confirmação, nunca é adiada
});

const CAPACIDADES_PADRAO = Object.freeze({
  tipo: 'desconhecido',
  velocidadeMaxMs: 5,
  velocidadeCruzeiroMs: 3,
  autonomiaS: 600,
  consumoPorSegundo: null,   // % de bateria por segundo; null = desconhecido
  altitudeMinM: 0,
  altitudeMaxM: 120,         // limite corrente para voo recreativo na UE
  raioMaxM: 500,
  temSensorObstaculos: false,
  podeRegressarSozinho: true
});

/**
 * Constrói uma entrada válida, preenchendo o que faltar.
 * Aceita definições parciais para adaptadores simples não terem de declarar
 * tudo — excepto `simulado`, que nunca é preenchido por omissão optimista.
 */
function dispositivoDeNavegacao(dados = {}) {
  return {
    id: dados.id || null,
    nome: dados.nome || dados.id || 'desconhecido',
    // Sem declaração explícita, assume-se físico. Ver cabeçalho.
    simulado: dados.simulado === true,
    capacidades: { ...CAPACIDADES_PADRAO, ...(dados.capacidades || {}) },
    ligar: dados.ligar,
    estado: dados.estado,
    irPara: dados.irPara,
    parar: dados.parar,
    regressar: dados.regressar,
    desligar: dados.desligar || (async () => {})
  };
}

/**
 * Verifica se um objecto cumpre o contrato mínimo.
 * @returns {{ valido: boolean, faltas: string[] }}
 */
function validarDispositivo(d) {
  const faltas = [];
  if (!d || typeof d !== 'object') return { valido: false, faltas: ['não é um objecto'] };

  if (!d.id) faltas.push('id');
  if (typeof d.simulado !== 'boolean') faltas.push('simulado (tem de ser declarado)');

  for (const metodo of ['ligar', 'estado', 'irPara', 'parar', 'regressar']) {
    if (typeof d[metodo] !== 'function') faltas.push(`${metodo}()`);
  }

  if (!d.capacidades || typeof d.capacidades !== 'object') faltas.push('capacidades');

  return { valido: faltas.length === 0, faltas };
}

/**
 * Uma missão bem formada.
 *
 * O `objetivo.proposito` é o que permite substituir o destino sem trair o
 * pedido: só serve de plano B um ponto que cumpra o MESMO propósito. Sem este
 * campo, "não consegui chegar" degenera em "fui para outro sítio qualquer".
 */
function missao(dados = {}) {
  return {
    nome: dados.nome || 'missão sem nome',
    objetivo: {
      proposito: dados.objetivo?.proposito || null,
      alvo: dados.objetivo?.alvo || null,
      descricao: dados.objetivo?.descricao || null
    },
    inicio: dados.inicio || null,
    destino: dados.destino || null,
    alternativas: Array.isArray(dados.alternativas) ? dados.alternativas : [],
    regras: {
      altitudeMinM: dados.regras?.altitudeMinM ?? null,
      altitudeMaxM: dados.regras?.altitudeMaxM ?? null,
      raioMaxM: dados.regras?.raioMaxM ?? null,
      zonasProibidas: dados.regras?.zonasProibidas || [],
      /** Bateria abaixo da qual só interessa voltar. */
      reservaRegressoPct: dados.regras?.reservaRegressoPct ?? 25,
      /** Bateria abaixo da qual se pousa onde se está. */
      bateriaCriticaPct: dados.regras?.bateriaCriticaPct ?? 10,
      /** Margem de segurança sobre a energia calculada para regressar. */
      margemRegresso: dados.regras?.margemRegresso ?? 1.4
    },
    autonomia: dados.autonomia === AUTONOMIA.AUTONOMO ? AUTONOMIA.AUTONOMO : AUTONOMIA.SUPERVISIONADO
  };
}

function validarMissao(m) {
  const faltas = [];
  if (!m || typeof m !== 'object') return { valido: false, faltas: ['não é um objecto'] };

  if (!m.destino || typeof m.destino.lat !== 'number' || typeof m.destino.lng !== 'number') {
    faltas.push('destino {lat, lng}');
  }
  if (!m.inicio || typeof m.inicio.lat !== 'number' || typeof m.inicio.lng !== 'number') {
    faltas.push('inicio {lat, lng}');
  }
  // Sem propósito não há como validar um plano B, e um plano B por validar é
  // pior do que nenhum: vai para outro sítio e diz que cumpriu.
  if (!m.objetivo || !m.objetivo.proposito) {
    faltas.push('objetivo.proposito (sem ele não há plano B legítimo)');
  }

  return { valido: faltas.length === 0, faltas };
}

/** Uma decisão bem formada, para o registo ficar sempre legível. */
function decisao(accao, dados = {}) {
  return {
    accao,
    urgencia: dados.urgencia || URGENCIA.ROTINA,
    motivo: dados.motivo || '',
    destino: dados.destino || null,
    rota: dados.rota || null,
    /** Verdadeiro quando uma pessoa tem de dizer que sim antes de acontecer. */
    precisaConfirmacao: dados.precisaConfirmacao === true,
    /** Quem decidiu: 'regra' (determinístico) ou 'modelo' (ordenação por IA). */
    origem: dados.origem || 'regra',
    quando: new Date().toISOString()
  };
}

module.exports = {
  ACCOES,
  AUTONOMIA,
  URGENCIA,
  CAPACIDADES_PADRAO,
  dispositivoDeNavegacao,
  validarDispositivo,
  missao,
  validarMissao,
  decisao
};
