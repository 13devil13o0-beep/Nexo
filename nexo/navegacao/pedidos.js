/**
 * 🗣️ Pedidos de Missão em Linguagem Natural
 *
 * A ponte entre "planeia-me uma rota daqui até ali a evitar o aeródromo" e as
 * estruturas que o planeador entende. É o que as ferramentas do NEXO chamam.
 *
 * PORQUE SÓ SIMULA
 * Tudo o que passa por aqui corre num aparelho simulado, sempre, sem excepção
 * e sem opção. Comandar hardware exige escrever código, declarar o adaptador
 * como físico e passar `permitirDispositivoReal` à mão — três actos
 * deliberados que uma frase escrita no chat nunca deve conseguir imitar.
 *
 * Um modelo de linguagem interpreta mal de vez em quando. Interpretar mal uma
 * simulação custa um parágrafo errado; interpretar mal um drone custa outra
 * coisa. A fronteira está aqui, e é por isso que está.
 */

const geo = require('./geo');
const planeador = require('./planeador');
const { criarSimulado } = require('./dispositivos/simulado');
const { ControladorDeMissao } = require('./controlador');

/** Lê "40.15,-8.65" ou "40.15 -8.65" e devolve {lat, lng}. */
function lerPonto(texto, altitude = 60) {
  if (!texto) return null;
  if (typeof texto === 'object' && texto.lat != null) return { alt: altitude, ...texto };

  const numeros = String(texto).match(/-?\d+(?:[.,]\d+)?/g);
  if (!numeros || numeros.length < 2) return null;

  const lat = parseFloat(numeros[0].replace(',', '.'));
  const lng = parseFloat(numeros[1].replace(',', '.'));
  if (!isFinite(lat) || !isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  return { lat, lng, alt: altitude };
}

/** Lê "nome:40.16,-8.66,400" ou "40.16,-8.66,400" como zona circular. */
function lerZona(texto) {
  if (!texto) return null;
  if (typeof texto === 'object' && texto.centro) return texto;

  const bruto = String(texto);
  const nome = bruto.includes(':') ? bruto.split(':')[0].trim() : 'zona proibida';
  const parte = bruto.includes(':') ? bruto.slice(bruto.indexOf(':') + 1) : bruto;

  const numeros = (parte.match(/-?\d+(?:[.,]\d+)?/g) || []).map(n => parseFloat(n.replace(',', '.')));
  if (numeros.length < 2) return null;

  return {
    nome,
    centro: { lat: numeros[0], lng: numeros[1] },
    raioM: numeros[2] || 300
  };
}

/** Lê "Ponto A:40.17,-8.67" como alternativa que serve o mesmo propósito. */
function lerAlternativa(texto, proposito) {
  if (!texto) return null;
  if (typeof texto === 'object' && texto.localizacao) return texto;

  const bruto = String(texto);
  const nome = bruto.includes(':') ? bruto.split(':')[0].trim() : 'alternativa';
  const ponto = lerPonto(bruto.includes(':') ? bruto.slice(bruto.indexOf(':') + 1) : bruto);

  return ponto ? { nome, localizacao: ponto, proposito } : null;
}

function lerLista(valor, leitor, extra) {
  if (!valor) return [];
  const bruta = Array.isArray(valor) ? valor : String(valor).split(';');
  return bruta.map(v => leitor(v, extra)).filter(Boolean);
}

const metros = m => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const minutos = s => (s == null ? '?' : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);

// ═══════════════════════════════════════════════════════════
// PLANEAR
// ═══════════════════════════════════════════════════════════

/**
 * Planeia uma rota e descreve-a em texto. Não move nada, nem simulado.
 */
function planearEmTexto(argumentos = {}) {
  const origem = lerPonto(argumentos.origem);
  const destino = lerPonto(argumentos.destino);

  if (!origem) return '❌ Não percebi a origem. Dá-me coordenadas como "40.15,-8.65".';
  if (!destino) return '❌ Não percebi o destino. Dá-me coordenadas como "40.18,-8.68".';

  const zonas = lerLista(argumentos.evitar, lerZona);

  const capacidades = {
    velocidadeCruzeiroMs: argumentos.velocidadeMs || 12,
    consumoPorSegundo: 0.09,
    autonomiaS: 900
  };

  const regras = {
    zonasProibidas: zonas,
    altitudeMaxM: argumentos.altitudeMaxM || 120
  };

  const rota = planeador.planear(origem, destino, regras, capacidades);
  const directa = geo.distancia(origem, destino);

  if (!rota.viavel) {
    return [
      `🚫 Não há rota viável.`,
      `   ${rota.motivo}`,
      ``,
      `   Distância em linha recta: ${metros(directa)}`,
      zonas.length ? `   Zonas a evitar: ${zonas.map(z => z.nome).join(', ')}` : ''
    ].filter(Boolean).join('\n');
  }

  return [
    `🧭 Rota planeada`,
    ``,
    `   Distância      ${metros(rota.distanciaM)}` +
      (rota.distanciaM > directa + 1 ? ` (linha recta: ${metros(directa)})` : ''),
    `   Tempo          ~${minutos(rota.tempoEstimadoS)}`,
    `   Bateria        ~${rota.energiaEstimadaPct != null ? Math.round(rota.energiaEstimadaPct) + '%' : 'desconhecida'} só na ida`,
    `   Pontos         ${rota.pontos.length}`,
    rota.zonasContornadas.length
      ? `   Contorna       ${rota.zonasContornadas.map(z => z.nome).join(', ')}`
      : `   Zonas          nenhuma no caminho`,
    ``,
    `   Isto é um plano geométrico, não uma autorização de voo: não conhece`,
    `   terreno, espaço aéreo real nem meteorologia.`
  ].join('\n');
}

// ═══════════════════════════════════════════════════════════
// SIMULAR
// ═══════════════════════════════════════════════════════════

/**
 * Corre uma missão inteira num aparelho simulado e devolve o registo.
 * @returns {Promise<string>}
 */
async function simularEmTexto(argumentos = {}) {
  const origem = lerPonto(argumentos.origem);
  const destino = lerPonto(argumentos.destino);

  if (!origem) return '❌ Não percebi a origem. Dá-me coordenadas como "40.15,-8.65".';
  if (!destino) return '❌ Não percebi o destino. Dá-me coordenadas como "40.18,-8.68".';

  const proposito = argumentos.proposito || 'chegar';
  const zonas = lerLista(argumentos.evitar, lerZona);
  const alternativas = lerLista(argumentos.alternativas, lerAlternativa, proposito);

  const drone = criarSimulado({
    posicao: origem,
    velocidadeMs: argumentos.velocidadeMs || 12,
    bateria: argumentos.bateria || 100,
    consumoPorSegundo: 0.09,
    factorTempo: 60          // um minuto de voo por segundo de espera
  });

  const controlador = new ControladorDeMissao({
    dispositivo: drone,
    intervaloMs: 60,
    missao: {
      nome: argumentos.nome || 'missão simulada',
      objetivo: { proposito, alvo: argumentos.alvo || null, descricao: argumentos.descricao || null },
      inicio: origem,
      destino,
      alternativas,
      regras: {
        zonasProibidas: zonas,
        altitudeMaxM: argumentos.altitudeMaxM || 120,
        reservaRegressoPct: argumentos.reservaRegressoPct ?? 25
      },
      // Numa simulação, parar à espera de confirmação não tem quem responda.
      autonomia: 'autonomo'
    }
  });

  let fim;
  const terminou = new Promise(resolve => { fim = resolve; });
  controlador.on('fim', resolve => fim(resolve));
  controlador.on('erro', e => fim({ resultado: 'erro', motivo: e.message, resumo: controlador.resumo() }));

  // Rede de segurança: uma simulação que não acabe nunca não pode prender o bot.
  const limite = setTimeout(() => {
    controlador.abortar('tempo limite da simulação');
  }, argumentos.limiteMs || 20000);

  try {
    await controlador.iniciar();
  } catch (e) {
    clearTimeout(limite);
    return `🚫 A missão nem chegou a começar.\n   ${e.message}`;
  }

  const resultado = await terminou;
  clearTimeout(limite);

  const r = resultado.resumo || controlador.resumo();

  return [
    `🎮 Missão simulada — ${r.resultado?.resultado || resultado.resultado}`,
    ``,
    controlador.formatarRegisto(),
    ``,
    `   Destino trocado  ${r.destinoTrocado ? 'sim' : 'não'}`,
    r.destinoTrocado
      ? `                    ${r.destinoInicial.lat.toFixed(4)},${r.destinoInicial.lng.toFixed(4)} → ${r.destinoFinal.lat.toFixed(4)},${r.destinoFinal.lng.toFixed(4)}`
      : '',
    `   Bateria final    ${r.bateriaFinal}%`,
    `   Duração          ${minutos(r.duracaoS)} de voo simulado`,
    ``,
    `   Nada levantou voo: isto correu inteiramente num aparelho simulado.`
  ].filter(Boolean).join('\n');
}

module.exports = {
  lerPonto,
  lerZona,
  lerAlternativa,
  lerLista,
  planearEmTexto,
  simularEmTexto
};
