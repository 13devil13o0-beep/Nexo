#!/usr/bin/env node

/**
 * 🚦 Arranque do NEXO
 *
 * O porteiro. Olha para o aparelho, decide em que perfil o NEXO deve arrancar
 * e lança-o. Antes disto o `npm start` chamava o Electron directamente, o que
 * numa máquina sem ambiente gráfico não arranca de todo e não tinha plano B.
 *
 * TEM DE CORRER EM NODE PURO
 * Se esta decisão fosse tomada dentro do Electron já seria tarde: num servidor
 * sem ecrã o Electron nem chega a abrir. Por isso o porteiro está cá fora, e é
 * ele que decide se o Electron sequer entra em cena.
 *
 * O MOTOR É SEMPRE O MESMO
 * orchestrator/api-server.js corre igual nos quatro perfis. O que muda é a
 * janela por onde se fala com ele — ou a ausência dela.
 *
 * Uso:
 *   npm start                      escolhe sozinho
 *   npm start -- --modo=servico    força um perfil
 *   npm run dispositivo            só mostra o que detectou, não arranca nada
 */

require('dotenv').config();

const path = require('path');
const { spawn } = require('child_process');
const { abrirBrowser } = require('./orchestrator/browser');

const dispositivo = require('./orchestrator/dispositivo');
const definicoes = require('./orchestrator/definicoes');
const diagnostico = require('./orchestrator/diagnostico');
const atalho = require('./orchestrator/atalho');

const RAIZ = __dirname;
const PORTA = process.env.PORT || 7777;
const URL_MOTOR = `http://localhost:${PORTA}`;

const CAMINHO_MOTOR = path.join(RAIZ, 'orchestrator', 'api-server.js');
const CAMINHO_JANELA = path.join(RAIZ, 'desktop', 'main', 'main.js');
const CAMINHO_CONSOLA = path.join(RAIZ, 'cli', 'cli.js');

// ═══════════════════════════════════════════════════════════
// UTILITÁRIOS
// ═══════════════════════════════════════════════════════════

/**
 * Já há um motor a responder nesta porta?
 *
 * Interessa em dois sítios: para não tentar subir um segundo servidor que
 * morria com EADDRINUSE, e para reaproveitar um que já esteja de pé.
 */
async function motorJaDePe() {
  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), 800);

  try {
    const resposta = await fetch(`${URL_MOTOR}/api/status`, { signal: controlador.signal });
    return resposta.ok;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(relogio);
  }
}

/** Cabeçalho curto, para se perceber de relance o que foi decidido. */
function anunciar(decisao, nota) {
  const etiqueta = decisao.perfil.toUpperCase();
  console.log('');
  console.log('==========================================================');
  console.log(`  NEXO — modo ${etiqueta}`);
  console.log(`  ${decisao.motivo}`);
  if (nota) console.log(`  ${nota}`);
  console.log('==========================================================');
  console.log('');
}

/**
 * Segue o processo-filho até ao fim: repassa o código de saída e garante que
 * o Ctrl+C mata os dois e não deixa nada pendurado.
 */
function seguir(filho) {
  const matar = () => { try { filho.kill(); } catch (e) { /* já morreu */ } };

  process.on('SIGINT', () => { matar(); process.exit(0); });
  process.on('SIGTERM', () => { matar(); process.exit(0); });

  filho.on('close', (codigo) => process.exit(codigo ?? 0));
  filho.on('error', (err) => {
    console.error(`❌ Não consegui arrancar: ${err.message}`);
    process.exit(1);
  });
}

// ═══════════════════════════════════════════════════════════
// PERFIS
// ═══════════════════════════════════════════════════════════

/**
 * 🖥️ Completo — janela do Electron, bandeja e atalhos globais.
 *
 * O Electron pode não estar instalado (é uma dependência de desenvolvimento e
 * num servidor ninguém a instala). Nesse caso não vale a pena falhar: cai-se
 * para o modo leve, que faz a mesma coisa sem janela própria.
 */
function lancarCompleto(decisao) {
  let binarioElectron;
  try {
    binarioElectron = require('electron');
  } catch (e) {
    binarioElectron = null;
  }

  if (!binarioElectron || typeof binarioElectron !== 'string') {
    console.warn('⚠️ O Electron não está instalado nesta máquina — a arrancar em modo leve.');
    return lancarLeve({ ...decisao, perfil: 'leve', motivo: 'Electron indisponível' });
  }

  const escondido = definicoes.obter('arrancarEscondido') === true;
  anunciar(decisao, escondido ? 'a começar só na bandeja' : `interface em ${URL_MOTOR}`);

  const argumentos = [CAMINHO_JANELA];
  if (escondido) argumentos.push('--oculto');

  // ELECTRON_RUN_AS_NODE faz o Electron comportar-se como Node puro: sem
  // janelas, sem `app`, sem nada. É o que o próprio NEXO usa para lançar o
  // motor, mas se a variável estiver no ambiente da máquina — acontece, e
  // aconteceu nesta — o Electron rebentava com um "Cannot read properties of
  // undefined" que não diz nada a ninguém. Aqui vai-se embora.
  const ambiente = { ...process.env };
  delete ambiente.ELECTRON_RUN_AS_NODE;

  seguir(spawn(binarioElectron, argumentos, { stdio: 'inherit', env: ambiente }));
}

/**
 * 📱 Leve — só o motor, e a página aberta no browser do próprio aparelho.
 *
 * Sem Electron pelo meio. Quem tem pouca memória não a deve gastar a manter um
 * Chromium inteiro só para mostrar uma página que o browser já sabe mostrar.
 */
async function lancarLeve(decisao) {
  const jaDePe = await motorJaDePe();

  anunciar(decisao, `interface em ${URL_MOTOR}`);

  if (jaDePe) {
    console.log('ℹ️  Já havia um motor a responder nesta porta. Aproveitei esse.');
    abrirBrowser(URL_MOTOR);
    return;
  }

  // O motor corre neste mesmo processo: menos um processo para gerir, e o
  // Ctrl+C fecha tudo de uma vez.
  require(CAMINHO_MOTOR);

  // Dar tempo ao servidor para escutar antes de mandar o browser lá bater.
  setTimeout(() => abrirBrowser(URL_MOTOR), 1200);
}

/**
 * ⌨️ Consola — a REPL que já existe, com o motor a correr por trás.
 *
 * O motor vai para um processo à parte com a saída silenciada de propósito: se
 * partilhasse o terminal, cada pedido servido escrevia por cima da conversa.
 */
async function lancarConsola(decisao) {
  const jaDePe = await motorJaDePe();
  let motor = null;

  if (!jaDePe) {
    motor = spawn(process.execPath, [CAMINHO_MOTOR], {
      stdio: 'ignore',
      env: { ...process.env, NEXO_MODO: 'servico' }
    });
    motor.on('error', () => { /* sem motor, a REPL funciona à mesma: fala com o orchestrator directamente */ });
  }

  anunciar(decisao, `página e API acessíveis em ${URL_MOTOR}`);

  const fecharMotor = () => { if (motor) { try { motor.kill(); } catch (e) { /* já morreu */ } } };
  process.on('exit', fecharMotor);
  process.on('SIGINT', () => { fecharMotor(); process.exit(0); });

  require(CAMINHO_CONSOLA);
}

/**
 * ⚙️ Serviço — só o motor, sem janela nenhuma.
 *
 * É o perfil dos servidores e contentores, e o único em que ninguém está a
 * olhar. Por isso é o único onde a chave de API é obrigatória: o servidor
 * escuta em 0.0.0.0 e, sem janela, nada denuncia que ficou aberto.
 */
function lancarServico(decisao) {
  const security = require('./orchestrator/security');

  let chave = process.env.API_KEY;
  if (!chave) {
    chave = security.getOrCreateApiKey();
    if (chave) process.env.API_KEY = chave;
  }

  if (!process.env.API_KEY) {
    console.error('');
    console.error('❌ O modo serviço exige uma chave de API e não consegui criar nenhuma.');
    console.error('   Sem ela o servidor ficava aberto na rede sem nada a barrar o caminho.');
    console.error('');
    console.error('   Define uma no .env e arranca outra vez:');
    console.error('     API_KEY=uma-chave-so-tua');
    console.error('');
    process.exit(1);
  }

  anunciar(decisao, `sem interface gráfica · API em ${URL_MOTOR}/api`);
  require(CAMINHO_MOTOR);
}

// ═══════════════════════════════════════════════════════════
// PRIMEIRA VEZ
// ═══════════════════════════════════════════════════════════

/**
 * Uma instalação incompleta não deve rebentar com um erro de programador.
 *
 * Com terminal à frente, propõe-se resolver ali mesmo. Sem terminal — um
 * serviço, um contentor — relata-se e segue-se, porque um servidor preso à
 * espera de uma tecla que ninguém vai carregar é pior do que um servidor a
 * funcionar pela metade.
 *
 * @returns {Promise<boolean>} continuar a arrancar?
 */
/**
 * Repõe o ícone quando ele devia estar lá e não está.
 *
 * Só age quando o utilizador JÁ disse que queria um (quereAtalho), e nunca
 * pergunta nada — limita-se a repor o que foi pedido. Sem isto, quem apagasse
 * o ícone sem querer ficava sem forma de o recuperar: o `npm start` nunca os
 * cria, e o instalador tinha deixado de o oferecer.
 *
 * Para deixar de o querer: `npm run atalho -- --remover`.
 */
function reporAtalhoSeFaltar(decisao) {
  if (!definicoes.obter('quereAtalho')) return;
  if (!decisao.sinais.graficos) return;          // sem ambiente de trabalho, não há onde o pôr
  if (!atalho.sistemaSuportado()) return;
  if (atalho.existe()) return;

  const r = atalho.criar();
  if (r.ok) {
    console.log('  🖱️  O ícone tinha desaparecido do ambiente de trabalho — reposto.');
  } else {
    console.warn(`  ⚠️  Não consegui repor o ícone: ${r.motivo}`);
  }
}

async function garantirInstalacao(decisao) {
  const estado = diagnostico.diagnosticar({ perfil: decisao.perfil });
  if (estado.pronto) return true;

  console.log(diagnostico.formatarDiagnostico(estado));

  const interactivo = !!(process.stdout.isTTY && process.stdin.isTTY);
  if (!interactivo) {
    console.warn('   (sem terminal para perguntar — a arrancar assim mesmo)');
    console.warn('   Para resolver: npm run instalar');
    console.warn('');
    return true;
  }

  const resposta = await new Promise(resolve => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question('   Queres que trate disso agora? (S/n): ', r => { rl.close(); resolve(r.trim()); });
  });

  if (resposta && !/^s|^y/i.test(resposta)) {
    console.log('');
    console.log('   Quando quiseres: npm run instalar');
    console.log('');
    return true;
  }

  const instalador = spawn(process.execPath, [path.join(RAIZ, 'instalar.js')], {
    stdio: 'inherit',
    env: process.env
  });

  const codigo = await new Promise(resolve => instalador.on('close', resolve));
  if (codigo !== 0) return false;

  // Recarregar o .env que o instalador acabou de escrever, senão este
  // processo continuaria a não ver as chaves que a pessoa configurou.
  require('dotenv').config({ override: true });
  return true;
}

// ═══════════════════════════════════════════════════════════
// PRINCIPAL
// ═══════════════════════════════════════════════════════════

async function principal() {
  const argv = process.argv.slice(2);

  const decisao = dispositivo.resolver({
    argv,
    definicoes: definicoes.ler()
  });

  // --relatorio: dizer o que se vê e ir embora, sem arrancar nada.
  if (argv.includes('--relatorio') || argv.includes('--dry-run')) {
    console.log(dispositivo.formatarRelatorio(decisao));
    console.log('   (relatório apenas — não foi arrancado nada)');
    console.log('');
    return;
  }

  if (!await garantirInstalacao(decisao)) {
    console.error('   A instalação não ficou completa. Corre "npm run instalar" quando puderes.');
    process.exit(1);
  }

  reporAtalhoSeFaltar(decisao);

  switch (decisao.perfil) {
    case 'completo': return lancarCompleto(decisao);
    case 'leve':     return lancarLeve(decisao);
    case 'consola':  return lancarConsola(decisao);
    case 'servico':  return lancarServico(decisao);
    default:
      console.error(`❌ Perfil desconhecido: ${decisao.perfil}`);
      console.error(`   Perfis válidos: ${dispositivo.PERFIS.join(', ')}`);
      process.exit(1);
  }
}

principal().catch(err => {
  console.error('❌ Falha no arranque:', err.message);
  process.exit(1);
});
