#!/usr/bin/env node
/**
 * 🧭 Demonstração de Missão — tudo simulado, nada levanta voo
 *
 *   npm run missao
 *
 * Corre uma missão inteira num aparelho simulado e mostra o registo de
 * decisões. O cenário é o caso interessante, não o caso fácil:
 *
 *   1. Descolagem com rota planeada, já a contornar uma zona proibida conhecida.
 *   2. A meio do caminho aparece uma proibição nova em cima do destino — como
 *      acontece quando sai um aviso à navegação aérea a meio de um voo.
 *   3. O destino passa a inatingível. O cérebro procura um plano B que cumpra o
 *      MESMO propósito, verifica se cabe na bateria, e segue para lá.
 *
 * Passa-se o tempo a correr 30× mais depressa para a demonstração durar
 * segundos em vez de minutos.
 */

const { criarSimulado, ControladorDeMissao, geo } = require('../nexo/navegacao');

// ── Cenário: inspecção de uma zona a sul, perto de Coimbra ──

const BASE = { lat: 40.150, lng: -8.650, alt: 60 };
const DESTINO = { lat: 40.180, lng: -8.680, alt: 60 };

const ZONA_CONHECIDA = {
  nome: 'aeródromo',
  centro: { lat: 40.166, lng: -8.667 },
  raioM: 400,
  motivo: 'espaço aéreo controlado'
};

/** A proibição que aparece a meio, em cima do destino. */
const ZONA_NOVA = {
  nome: 'restrição temporária',
  centro: { lat: 40.180, lng: -8.680 },
  raioM: 500,
  motivo: 'operação de emergência em curso'
};

const drone = criarSimulado({
  nome: 'Drone de inspecção',
  posicao: { ...BASE },
  velocidadeMs: 12,
  bateria: 100,
  consumoPorSegundo: 0.09,
  factorTempo: 30,
  ventoMs: 0.4,
  obstaculos: [
    { nome: 'grua', lat: 40.1585, lng: -8.6600, raioM: 40, apareceAosS: 0 }
  ]
});

const controlador = new ControladorDeMissao({
  dispositivo: drone,
  intervaloMs: 120,
  missao: {
    nome: 'Inspecção da zona sul',
    objetivo: {
      proposito: 'inspecionar',
      alvo: 'zona-sul',
      descricao: 'obter imagens da zona sul para avaliação de danos'
    },
    inicio: BASE,
    destino: DESTINO,
    // Os planos B declaram o propósito: sem isso não seriam aceites como
    // substitutos legítimos do destino original.
    alternativas: [
      {
        nome: 'Ponto de observação A',
        localizacao: { lat: 40.1740, lng: -8.6740, alt: 60 },
        proposito: 'inspecionar'
      },
      {
        nome: 'Ponto de observação B',
        localizacao: { lat: 40.1690, lng: -8.6600, alt: 60 },
        proposito: 'inspecionar'
      },
      {
        nome: 'Depósito de material',
        localizacao: { lat: 40.1600, lng: -8.6550, alt: 60 },
        proposito: 'entregar'   // propósito diferente: nunca serve de plano B
      }
    ],
    regras: {
      zonasProibidas: [ZONA_CONHECIDA],
      altitudeMinM: 20,
      altitudeMaxM: 120,
      raioMaxM: 5000,
      reservaRegressoPct: 25,
      bateriaCriticaPct: 10
    },
    // Autónomo: decide sozinho e relata. Só é aceitável porque o aparelho é
    // simulado — com hardware, o controlador exigiria aprovação explícita.
    autonomia: 'autonomo'
  }
});

// ── Acompanhamento ──

let proibicaoLancada = false;

controlador.on('estado', (estado) => {
  const percorrido = geo.distancia(BASE, estado.posicao);

  // A meio do caminho, o mundo muda: sai um aviso e o destino fecha.
  if (!proibicaoLancada && percorrido > 1200) {
    proibicaoLancada = true;
    controlador.missao.regras.zonasProibidas.push(ZONA_NOVA);
    console.log('\n  📡 AVISO RECEBIDO: restrição temporária sobre o destino (raio 500 m)\n');
  }
});

controlador.on('decisao', (d) => {
  const marca = d.urgencia === 'seguranca' ? '🔴' : d.urgencia === 'atencao' ? '🟡' : '  ';
  console.log(`  ${marca} ${d.accao.padEnd(14)} ${d.motivo}`);
});

controlador.on('confirmacao', (d) => {
  console.log(`\n  ⏸️  À espera de confirmação: ${d.motivo}`);
  console.log('     (em modo supervisionado, aqui perguntar-se-ia ao utilizador)\n');
  controlador.confirmar(true);
});

controlador.on('fim', ({ resultado, motivo, resumo }) => {
  console.log('\n' + '─'.repeat(62));
  console.log('  REGISTO DA MISSÃO');
  console.log('─'.repeat(62));
  console.log(controlador.formatarRegisto());

  console.log('\n' + '─'.repeat(62));
  console.log('  RESUMO');
  console.log('─'.repeat(62));
  console.log(`  resultado        ${resultado} — ${motivo}`);
  console.log(`  objetivo         ${resumo.objetivo.proposito} ${resumo.objetivo.alvo}`);
  console.log(`  destino trocado  ${resumo.destinoTrocado ? 'sim' : 'não'}`);
  if (resumo.destinoTrocado) {
    console.log(`                   ${resumo.destinoInicial.lat.toFixed(4)}, ${resumo.destinoInicial.lng.toFixed(4)}` +
                ` → ${resumo.destinoFinal.lat.toFixed(4)}, ${resumo.destinoFinal.lng.toFixed(4)}`);
  }
  console.log(`  duração          ${resumo.duracaoS}s de voo simulado`);
  console.log(`  bateria final    ${resumo.bateriaFinal}%`);
  console.log(`  decisões         ${resumo.decisoes}`);
  console.log(`  simulado         ${resumo.simulado ? 'sim — nada levantou voo' : 'NÃO'}`);
  console.log('');
  process.exit(0);
});

controlador.on('erro', (e) => {
  console.error('  ❌', e.message);
  process.exit(1);
});

// ── Arranque ──

console.log('');
console.log('='.repeat(62));
console.log('  NEXO — Demonstração de missão (aparelho simulado)');
console.log('='.repeat(62));
console.log(`  base     ${BASE.lat}, ${BASE.lng}`);
console.log(`  destino  ${DESTINO.lat}, ${DESTINO.lng}  (${Math.round(geo.distancia(BASE, DESTINO))} m)`);
console.log(`  regras   evitar "${ZONA_CONHECIDA.nome}", 20–120 m de altitude, reserva de 25%`);
console.log('='.repeat(62));
console.log('');

controlador.iniciar().catch(e => {
  console.error('  ❌', e.message);
  process.exit(1);
});

// Rede de segurança: uma demonstração nunca deve ficar pendurada.
setTimeout(() => {
  console.log('\n  ⏱️  Tempo limite da demonstração atingido.');
  console.log(controlador.formatarRegisto());
  process.exit(1);
}, 60000).unref();
