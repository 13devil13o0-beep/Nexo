/**
 * 🧠 Cérebro de Missão
 *
 * Decide o que fazer a seguir. É a peça mais delicada do módulo, e por isso é a
 * que tem as regras mais rígidas sobre quem decide o quê.
 *
 * ─────────────────────────────────────────────────────────────
 * A REGRA QUE NÃO SE NEGOCEIA
 * ─────────────────────────────────────────────────────────────
 * Nenhuma decisão de segurança passa por um modelo de linguagem.
 *
 * Bateria, envelope de voo, zonas proibidas, perda de comunicação: tudo isso é
 * aritmética determinística, escrita aqui, testável, sempre igual e sem rede.
 * Um modelo é lento (décimas a segundos), não é reprodutível e pode estar
 * indisponível — três defeitos que num aparelho no ar se pagam caro.
 *
 * O modelo entra num único sítio: ORDENAR alternativas que as regras JÁ
 * aprovaram, quando há tempo para pensar. Nunca acrescenta opções, nunca
 * levanta um veto, nunca é esperado por ninguém. Se falhar, cai-se na
 * ordenação por distância e a missão continua.
 *
 * Dito de outra maneira: as regras decidem o que é possível, o modelo dá
 * opinião sobre o que é preferível.
 */

const geo = require('./geo');
const planeador = require('./planeador');
const { ACCOES, AUTONOMIA, URGENCIA, decisao } = require('./contrato');

/** Chegou, para efeitos práticos. O GPS não é melhor do que isto. */
const RAIO_CHEGADA_M = 15;

/** Ciclos sem resposta do aparelho antes de se assumir que se perdeu contacto. */
const CICLOS_SEM_RESPOSTA = 3;

// ═══════════════════════════════════════════════════════════
// ORÇAMENTO DE ENERGIA
// ═══════════════════════════════════════════════════════════

/**
 * Quanta bateria custa voltar daqui à base, com margem.
 *
 * A margem existe porque a estimativa é optimista por natureza: não conta com
 * vento contra, desvios nem a subida. Por omissão 1,4× — quarenta por cento a
 * mais do que a conta diz.
 */
function energiaParaRegressar(posicao, base, capacidades, margem = 1.4) {
  const bruto = planeador.energiaNecessaria(geo.distancia(posicao, base), capacidades);
  return bruto == null ? null : bruto * margem;
}

/**
 * Ainda dá para ir ao destino E voltar?
 * @returns {boolean|null} null quando não há dados para responder — e nesse
 *   caso quem chama trata o desconhecido como risco, nunca como um sim.
 */
function cabeIdaEVolta(posicao, destino, base, bateriaPct, capacidades, margem) {
  const ida = planeador.energiaNecessaria(geo.distancia(posicao, destino), capacidades);
  const volta = planeador.energiaNecessaria(geo.distancia(destino, base), capacidades);
  if (ida == null || volta == null) return null;

  return (ida + volta) * margem <= bateriaPct;
}

// ═══════════════════════════════════════════════════════════
// DECISÃO
// ═══════════════════════════════════════════════════════════

/**
 * Avalia a situação e devolve UMA decisão.
 *
 * Síncrona, determinística e sem efeitos: a mesma entrada dá sempre a mesma
 * saída. É o que permite testá-la com cenários fabricados e é o que a torna
 * confiável para o que decide.
 *
 * @param {Object} estado        do dispositivo: posicao, bateria, obstaculos...
 * @param {Object} missao        contrato.missao()
 * @param {Object} contexto      { capacidades, destinoActual, rota, alternativas,
 *                                 ciclosSemResposta }
 * @returns {Object} contrato.decisao()
 */
function avaliar(estado, missao, contexto = {}) {
  const capacidades = contexto.capacidades || {};
  const regras = missao.regras || {};
  const base = missao.inicio;
  const destino = contexto.destinoActual || missao.destino;
  const margem = regras.margemRegresso ?? 1.4;

  // ── 1. Sem contacto: não se comanda o que não responde ──
  if ((contexto.ciclosSemResposta || 0) >= CICLOS_SEM_RESPOSTA) {
    return decisao(ACCOES.REGRESSAR, {
      urgencia: URGENCIA.SEGURANCA,
      motivo: `sem resposta do aparelho há ${contexto.ciclosSemResposta} ciclos`,
      destino: base
    });
  }

  if (!estado || !estado.posicao) {
    return decisao(ACCOES.PARAR, {
      urgencia: URGENCIA.SEGURANCA,
      motivo: 'estado do aparelho indisponível'
    });
  }

  const bateria = estado.bateria ?? 0;

  // ── 2. Bateria crítica: pousar onde se está vale mais que cair a caminho ──
  if (bateria <= (regras.bateriaCriticaPct ?? 10)) {
    return decisao(ACCOES.PARAR, {
      urgencia: URGENCIA.SEGURANCA,
      motivo: `bateria crítica (${Math.round(bateria)}%)`
    });
  }

  // ── 3. Reserva de regresso: a partir daqui só interessa voltar ──
  const custoRegresso = energiaParaRegressar(estado.posicao, base, capacidades, margem);

  if (custoRegresso != null && bateria <= custoRegresso) {
    return decisao(ACCOES.REGRESSAR, {
      urgencia: URGENCIA.SEGURANCA,
      motivo: `bateria (${Math.round(bateria)}%) já só chega para regressar (~${Math.round(custoRegresso)}%)`,
      destino: base
    });
  }

  if (bateria <= (regras.reservaRegressoPct ?? 25)) {
    return decisao(ACCOES.REGRESSAR, {
      urgencia: URGENCIA.SEGURANCA,
      motivo: `bateria abaixo da reserva de regresso (${Math.round(bateria)}%)`,
      destino: base
    });
  }

  // ── 4. Envelope: altitude e raio são limites, não sugestões ──
  const alt = estado.posicao.alt;
  if (alt != null) {
    const maxima = regras.altitudeMaxM ?? capacidades.altitudeMaxM;
    const minima = regras.altitudeMinM ?? capacidades.altitudeMinM;

    if (maxima != null && alt > maxima) {
      return decisao(ACCOES.PARAR, {
        urgencia: URGENCIA.SEGURANCA,
        motivo: `acima da altitude máxima (${Math.round(alt)} m > ${maxima} m)`
      });
    }
    if (minima != null && alt < minima) {
      return decisao(ACCOES.PARAR, {
        urgencia: URGENCIA.SEGURANCA,
        motivo: `abaixo da altitude mínima (${Math.round(alt)} m < ${minima} m)`
      });
    }
  }

  const raioMax = regras.raioMaxM ?? capacidades.raioMaxM;
  if (raioMax != null && geo.distancia(estado.posicao, base) > raioMax) {
    return decisao(ACCOES.REGRESSAR, {
      urgencia: URGENCIA.SEGURANCA,
      motivo: `fora do raio permitido (${Math.round(geo.distancia(estado.posicao, base))} m > ${raioMax} m)`,
      destino: base
    });
  }

  // ── 5. Dentro de zona proibida agora: sair já ──
  const zonas = regras.zonasProibidas || [];
  const zonaActual = zonas.find(z => geo.dentroDaZona(estado.posicao, z));
  if (zonaActual) {
    return decisao(ACCOES.DESVIAR, {
      urgencia: URGENCIA.SEGURANCA,
      motivo: `dentro de zona proibida (${zonaActual.nome || 'sem nome'})`,
      destino: geo.pontoDeContorno(estado.posicao, destino, zonaActual, regras.folgaZonaM ?? 50)
    });
  }

  // ── 6. Chegou? ──
  if (geo.distancia(estado.posicao, destino) <= (regras.raioChegadaM ?? RAIO_CHEGADA_M)) {
    return decisao(ACCOES.CONCLUIR, {
      motivo: 'destino alcançado',
      destino
    });
  }

  // ── 7. O caminho até ao destino ainda serve? ──
  const rota = planeador.replanear(estado.posicao, destino, regras, capacidades);

  if (rota.viavel) {
    // Sensores do aparelho a relatar obstáculo no caminho: desvia-se, mas
    // sem urgência de segurança — quem trava a tempo é o piloto automático.
    if (Array.isArray(estado.obstaculos) && estado.obstaculos.length) {
      const contorno = contornarObstaculo(estado, destino, regras);
      if (contorno) {
        return decisao(ACCOES.DESVIAR, {
          urgencia: URGENCIA.ATENCAO,
          motivo: `${estado.obstaculos.length} obstáculo(s) relatado(s) no caminho`,
          destino: contorno,
          rota
        });
      }
    }

    const chega = cabeIdaEVolta(estado.posicao, destino, base, bateria, capacidades, margem);
    if (chega === false) {
      return decidirPlanoB(estado, missao, contexto,
        `bateria não chega para ir ao destino e voltar (${Math.round(bateria)}%)`);
    }

    return decisao(ACCOES.CONTINUAR, {
      motivo: rota.zonasContornadas.length
        ? `a caminho, contornando ${rota.zonasContornadas.length} zona(s)`
        : 'caminho livre',
      destino,
      rota
    });
  }

  // ── 8. Destino inatingível: é aqui que a missão se salva ──
  return decidirPlanoB(estado, missao, contexto, rota.motivo || 'destino inatingível');
}

/** Um ponto que contorna o obstáculo mais próximo relatado pelos sensores. */
function contornarObstaculo(estado, destino, regras) {
  const perto = [...estado.obstaculos]
    .filter(o => o && (o.posicao || o.lat != null))
    .map(o => (o.posicao ? { ...o.posicao, raioM: o.raioM } : o))
    .sort((a, b) => geo.distancia(estado.posicao, a) - geo.distancia(estado.posicao, b))[0];

  if (!perto) return null;

  return geo.pontoDeContorno(
    estado.posicao,
    destino,
    { centro: { lat: perto.lat, lng: perto.lng }, raioM: perto.raioM || 30 },
    regras.folgaZonaM ?? 50
  );
}

/**
 * O destino não serve. Há plano B que cumpra o mesmo propósito?
 *
 * A escolha aqui é sempre a mais próxima entre as viáveis — determinística e
 * imediata. Quem quiser uma escolha ponderada chama depois ordenarAlternativas()
 * e substitui, com tempo e sem estar a bloquear o ciclo.
 */
function decidirPlanoB(estado, missao, contexto, motivo) {
  const capacidades = contexto.capacidades || {};
  const bateria = estado.bateria ?? 0;

  const avaliadas = contexto.alternativasAvaliadas || planeador.avaliarAlternativas(
    estado.posicao,
    missao.alternativas || [],
    missao,
    capacidades,
    bateria
  );

  const viaveis = avaliadas.filter(a => a.viavel).sort((a, b) => a.distanciaM - b.distanciaM);

  if (!viaveis.length) {
    return decisao(ACCOES.REGRESSAR, {
      urgencia: URGENCIA.SEGURANCA,
      motivo: `${motivo}; nenhuma alternativa viável`,
      destino: missao.inicio
    });
  }

  const escolhida = viaveis[0];

  return decisao(ACCOES.MUDAR_DESTINO, {
    urgencia: URGENCIA.ATENCAO,
    motivo: `${motivo}; "${escolhida.nome}" cumpre o mesmo propósito (${missao.objetivo?.proposito})`,
    destino: escolhida.localizacao,
    rota: escolhida.rota,
    // Trocar de destino é uma decisão de missão, não de segurança: em modo
    // supervisionado espera por uma pessoa. Regressar e parar nunca esperam.
    precisaConfirmacao: missao.autonomia !== AUTONOMIA.AUTONOMO
  });
}

// ═══════════════════════════════════════════════════════════
// OPINIÃO DO MODELO (opcional, nunca no caminho crítico)
// ═══════════════════════════════════════════════════════════

/**
 * Ordena alternativas JÁ aprovadas pelas regras, com ajuda de um modelo.
 *
 * O modelo recebe apenas a lista de viáveis e responde com uma ordem. Se
 * inventar um índice que não existe, se demorar, se falhar ou se não houver
 * fornecedor, devolve-se a ordenação por distância e ninguém dá por nada.
 *
 * O que ele NUNCA pode fazer: acrescentar destinos, aprovar um inviável ou
 * vetar um viável. Essa fronteira é o que separa isto de pôr um modelo a
 * pilotar.
 *
 * @returns {Promise<{ordem: Array, origem: 'modelo'|'regra', justificacao: string|null}>}
 */
async function ordenarAlternativas(viaveis, missao, opcoes = {}) {
  const porDistancia = [...viaveis].sort((a, b) => a.distanciaM - b.distanciaM);

  if (!opcoes.usarModelo || viaveis.length < 2) {
    return { ordem: porDistancia, origem: 'regra', justificacao: null };
  }

  let llmRouter;
  try {
    llmRouter = require('../../orchestrator/llmRouter');
  } catch (e) {
    return { ordem: porDistancia, origem: 'regra', justificacao: null };
  }

  const lista = viaveis.map((a, i) =>
    `${i}. ${a.nome} — a ${Math.round(a.distanciaM)} m, propósito "${a.proposito || '—'}"`
  ).join('\n');

  const pergunta = `Missão: ${missao.objetivo?.descricao || missao.objetivo?.proposito}.
O destino original ficou inacessível. Estas alternativas já foram verificadas
como alcançáveis e dentro das regras:

${lista}

Qual serve melhor o propósito da missão? Responde só com JSON:
{"ordem": [índices por preferência], "porque": "uma frase"}`;

  try {
    const resposta = await llmRouter.chat(
      [{ role: 'user', content: pergunta }],
      { maxTokens: 200, temperature: 0.2, timeoutMs: opcoes.timeoutMs || 8000 }
    );

    const bruto = (resposta?.text || '').match(/\{[\s\S]*\}/);
    if (!bruto) return { ordem: porDistancia, origem: 'regra', justificacao: null };

    const { ordem, porque } = JSON.parse(bruto[0]);
    if (!Array.isArray(ordem)) return { ordem: porDistancia, origem: 'regra', justificacao: null };

    // Só passam índices reais, sem repetições. O que o modelo esquecer entra
    // no fim pela ordem de distância: a lista de saída tem sempre os mesmos
    // elementos da de entrada, nem mais um nem menos um.
    const vistos = new Set();
    const escolhidas = [];

    for (const i of ordem) {
      if (Number.isInteger(i) && i >= 0 && i < viaveis.length && !vistos.has(i)) {
        vistos.add(i);
        escolhidas.push(viaveis[i]);
      }
    }
    for (const a of porDistancia) {
      if (!escolhidas.includes(a)) escolhidas.push(a);
    }

    return {
      ordem: escolhidas,
      origem: escolhidas[0] === porDistancia[0] ? 'regra' : 'modelo',
      justificacao: typeof porque === 'string' ? porque : null
    };
  } catch (e) {
    return { ordem: porDistancia, origem: 'regra', justificacao: null };
  }
}

module.exports = {
  avaliar,
  decidirPlanoB,
  ordenarAlternativas,
  energiaParaRegressar,
  cabeIdaEVolta,
  RAIO_CHEGADA_M,
  CICLOS_SEM_RESPOSTA
};
