#!/usr/bin/env node

/**
 * 🧰 Instalador Guiado do NEXO
 *
 *   npm run instalar
 *
 * Trata da primeira meia hora, que é onde as pessoas desistem. Verifica o que
 * falta, descarrega o que este computador precisa e ajuda a escolher o motor
 * de IA — em português, sem jargão e sem obrigar a perceber o que é uma
 * variável de ambiente.
 *
 * ─────────────────────────────────────────────────────────────
 * TRÊS REGRAS QUE ESTE FICHEIRO NÃO QUEBRA
 * ─────────────────────────────────────────────────────────────
 *
 * 1. Só instala o que está no package.json, nas versões que o package-lock
 *    fixa. Nunca um pacote decidido em tempo de execução, e NUNCA um pacote
 *    escolhido pela IA — seria abrir a porta a que uma frase mal interpretada
 *    instalasse código arbitrário na máquina de quem confiou no programa.
 *
 * 2. Não descarrega executáveis. O Node, o git e o Ollama são DETECTADOS e
 *    ligados ao site oficial, nunca instalados às escondidas. Ir buscar
 *    binários a URLs é exactamente como se distribui malware, e esse padrão
 *    não entra aqui.
 *
 * 3. Pergunta antes de qualquer descarga grande, com o tamanho à frente.
 *    "Automático" não pode querer dizer "sem o utilizador perceber o que
 *    aconteceu ao disco dele".
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const diagnostico = require('./orchestrator/diagnostico');
const dispositivo = require('./orchestrator/dispositivo');
const definicoes = require('./orchestrator/definicoes');

const RAIZ = __dirname;
const ENV = path.join(RAIZ, '.env');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const perguntar = (texto) => new Promise(resolve => rl.question(texto, r => resolve(r.trim())));
const linha = (c = '─') => console.log(c.repeat(62));

async function escolher(pergunta, opcoes) {
  console.log('');
  console.log(pergunta);
  console.log('');
  opcoes.forEach((o, i) => {
    console.log(`   ${i + 1}. ${o.titulo}`);
    if (o.detalhe) console.log(`      ${o.detalhe}`);
  });
  console.log('');

  while (true) {
    const r = await perguntar(`   Escolhe (1-${opcoes.length}): `);
    const i = parseInt(r, 10) - 1;
    if (i >= 0 && i < opcoes.length) return opcoes[i];
    console.log('   Não percebi. Escreve só o número.');
  }
}

const sim = async (pergunta, omissao = true) => {
  const r = await perguntar(`${pergunta} ${omissao ? '(S/n)' : '(s/N)'}: `);
  if (!r) return omissao;
  return /^s|^y/i.test(r);
};

// ═══════════════════════════════════════════════════════════
// .ENV
// ═══════════════════════════════════════════════════════════

/**
 * Grava chaves no .env sem destruir o que lá está.
 * Actualiza as que já existem, acrescenta as novas, deixa o resto intacto.
 */
function gravarNoEnv(pares) {
  let conteudo = '';
  try { conteudo = fs.readFileSync(ENV, 'utf8'); } catch (e) { /* ainda não existe */ }

  for (const [chave, valor] of Object.entries(pares)) {
    const padrao = new RegExp(`^${chave}=.*$`, 'm');
    if (padrao.test(conteudo)) {
      conteudo = conteudo.replace(padrao, `${chave}=${valor}`);
    } else {
      if (conteudo && !conteudo.endsWith('\n')) conteudo += '\n';
      conteudo += `${chave}=${valor}\n`;
    }
    process.env[chave] = valor;
  }

  fs.writeFileSync(ENV, conteudo);
  return true;
}

// ═══════════════════════════════════════════════════════════
// DEPENDÊNCIAS
// ═══════════════════════════════════════════════════════════

function correr(comando, argumentos) {
  return new Promise((resolve) => {
    const p = spawn(comando, argumentos, { cwd: RAIZ, stdio: 'inherit', shell: true });
    p.on('close', codigo => resolve(codigo === 0));
    p.on('error', () => resolve(false));
  });
}

/**
 * Instala as bibliotecas. Num perfil sem janela salta o Electron, que são
 * ~200 MB que ninguém deve descarregar para correr um servidor sem ecrã.
 */
async function instalarDependencias(perfil) {
  const precisaJanela = perfil === 'completo';

  console.log('');
  linha();
  console.log('  📦 BIBLIOTECAS');
  linha();
  console.log('');
  console.log('   O NEXO precisa de algumas bibliotecas para funcionar.');
  console.log('   São descarregadas do registo oficial do npm, nas versões');
  console.log('   já fixadas neste projecto.');
  console.log('');

  if (precisaJanela) {
    console.log('   Este computador tem ecrã, por isso vem também a janela');
    console.log('   de secretária (Electron) — cerca de 250 MB no total.');
  } else {
    console.log('   Este computador vai correr sem janela própria, por isso');
    console.log('   salto o Electron e poupo-te ~200 MB.');
  }
  console.log('');

  if (!await sim('   Descarrego agora?')) {
    console.log('\n   Sem problema. Quando quiseres: npm install\n');
    return false;
  }

  console.log('');
  const argumentos = precisaJanela ? ['install'] : ['install', '--omit=dev'];
  const ok = await correr('npm', argumentos);

  console.log('');
  console.log(ok ? '   ✅ Bibliotecas instaladas.' : '   ❌ A instalação falhou. Vê o erro acima.');
  return ok;
}

// ═══════════════════════════════════════════════════════════
// MOTOR DE IA
// ═══════════════════════════════════════════════════════════

/** Os que funcionam só com uma chave no .env. */
const GRATUITOS = [
  {
    id: 'groq',
    env: 'GROQ_API_KEY',
    nome: 'Groq',
    porque: 'O mais rápido que há. 14.400 pedidos por dia, sem cartão.',
    onde: 'https://console.groq.com/keys'
  },
  {
    id: 'cerebras',
    env: 'CEREBRAS_API_KEY',
    nome: 'Cerebras',
    porque: 'Também gratuito e muito rápido. Serve de reserva quando o Groq atinge o limite.',
    onde: 'https://cloud.cerebras.ai'
  }
];

const PAGOS = [
  { id: 'openai', env: 'OPENAI_API_KEY', nome: 'OpenAI (GPT)', onde: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', env: 'ANTHROPIC_API_KEY', nome: 'Anthropic (Claude)', onde: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', env: 'GEMINI_API_KEY', nome: 'Google Gemini', onde: 'https://aistudio.google.com/apikey' }
];

/** Pede uma chave e confirma que funciona mesmo antes de a gravar. */
async function pedirEValidar(fornecedor) {
  console.log('');
  console.log(`   🔑 ${fornecedor.nome}`);
  if (fornecedor.porque) console.log(`      ${fornecedor.porque}`);
  console.log(`      Cria a chave aqui: ${fornecedor.onde}`);
  console.log('');

  const chave = await perguntar('      Cola a chave aqui (ou Enter para saltar): ');
  if (!chave) {
    console.log('      Saltado.');
    return false;
  }

  process.stdout.write('      A confirmar que funciona... ');
  const teste = await diagnostico.testarChave(fornecedor.id, chave);

  if (teste.valida === false) {
    console.log('❌');
    console.log(`      A chave foi recusada: ${teste.erro}`);
    return await sim('      Queres tentar outra vez?', true) ? pedirEValidar(fornecedor) : false;
  }

  if (teste.valida === null) {
    console.log('⚠️');
    console.log(`      ${teste.erro}. Gravo à mesma.`);
  } else {
    console.log(`✅  (${teste.modelos} modelos disponíveis)`);
  }

  gravarNoEnv({ [fornecedor.env]: chave });
  return true;
}

/** Caminho das opções gratuitas: Groq e Cerebras. */
async function caminhoGratuito() {
  console.log('');
  linha();
  console.log('  🆓 OPÇÕES GRATUITAS');
  linha();
  console.log('');
  console.log('   Vou guiar-te por dois serviços gratuitos. Chegam os dois,');
  console.log('   mas com ambos ficas protegido: se um atingir o limite');
  console.log('   diário, o NEXO passa para o outro sozinho.');
  console.log('');
  console.log('   Em cada um: criar conta → copiar a chave → colar aqui.');

  let algum = false;
  for (const f of GRATUITOS) {
    if (await pedirEValidar(f)) algum = true;
  }

  return algum;
}

/** Caminho de quem já paga por uma IA. */
async function caminhoPago() {
  const escolha = await escolher(
    '   Qual é o serviço que já tens?',
    [
      ...PAGOS.map(p => ({ titulo: p.nome, valor: p })),
      { titulo: 'Outro (Mistral, DeepSeek, xAI, Cohere, OpenRouter…)', valor: 'outro' }
    ]
  );

  if (escolha.valor === 'outro') {
    console.log('');
    console.log('   Esses configuram-se dentro do próprio NEXO, porque a chave');
    console.log('   fica associada ao teu utilizador e não ao computador:');
    console.log('');
    console.log('      abre o NEXO → Definições → Fornecedor de IA');
    console.log('');
    console.log('   Para já, vamos deixar-te a funcionar com uma opção gratuita.');
    console.log('');
    return await caminhoGratuito();
  }

  const ok = await pedirEValidar(escolha.valor);

  if (ok) {
    // Sem entrar na ordem, a chave fica no ficheiro mas nunca é usada: a
    // cadeia só percorre o que está em LLM_PROVIDER_ORDER.
    const ordemActual = process.env.LLM_PROVIDER_ORDER || 'groq,cerebras,gemini,huggingface,ollama';
    const ids = ordemActual.split(',').map(s => s.trim()).filter(Boolean);
    const nova = [escolha.valor.id, ...ids.filter(i => i !== escolha.valor.id)];

    gravarNoEnv({ LLM_PROVIDER_ORDER: nova.join(',') });
    console.log(`      ✅ O ${escolha.valor.nome} passa a ser o primeiro a responder.`);

    console.log('');
    if (await sim('   Queres também uma opção gratuita como reserva, para quando essa falhar?', true)) {
      await caminhoGratuito();
    }
  }

  return ok;
}

/** Caminho local: nada sai do computador. */
async function caminhoLocal() {
  console.log('');
  linha();
  console.log('  🏠 NO TEU COMPUTADOR (OLLAMA)');
  linha();
  console.log('');

  const estado = await diagnostico.verificarOllama();

  if (!estado.presente) {
    console.log('   O Ollama não está a correr nesta máquina.');
    console.log('');
    console.log('   É um programa gratuito que corre os modelos localmente:');
    console.log('   sem conta, sem chave, sem internet e sem que nada do que');
    console.log('   escreves saia deste computador.');
    console.log('');
    console.log('      Descarrega em: https://ollama.com/download');
    console.log('      Depois abre um terminal e corre: ollama pull llama3.2');
    console.log('');
    console.log('   (Não o descarrego por ti de propósito: não instalo');
    console.log('    programas que não venham do registo oficial do npm.)');
    console.log('');

    if (await sim('   Queres entretanto configurar uma opção gratuita online?', true)) {
      return await caminhoGratuito();
    }
    return false;
  }

  console.log(`   ✅ Ollama encontrado em ${estado.url}`);

  if (!estado.modelos.length) {
    console.log('');
    console.log('   Está a correr, mas ainda não tem nenhum modelo descarregado.');
    console.log('   Abre outro terminal e corre:');
    console.log('');
    console.log('      ollama pull llama3.2        (~2 GB, bom para conversa)');
    console.log('');
    return false;
  }

  console.log(`   Modelos disponíveis: ${estado.modelos.join(', ')}`);

  const ordemActual = process.env.LLM_PROVIDER_ORDER || 'groq,cerebras,gemini,huggingface,ollama';
  const ids = ordemActual.split(',').map(s => s.trim()).filter(Boolean);
  gravarNoEnv({
    LLM_PROVIDER_ORDER: ['ollama', ...ids.filter(i => i !== 'ollama')].join(','),
    OLLAMA_MODEL: estado.modelos[0]
  });

  console.log('');
  console.log(`   ✅ O NEXO passa a usar o ${estado.modelos[0]} primeiro, sem sair daqui.`);
  return true;
}

/**
 * A pergunta de abertura. É a bifurcação que decide todo o resto, e por isso é
 * feita antes de qualquer outra coisa sobre IA.
 */
async function configurarIA() {
  console.log('');
  linha();
  console.log('  🧠 O MOTOR DE INTELIGÊNCIA');
  linha();
  console.log('');
  console.log('   Antes de começarmos: utilizas alguma IA pessoal contratada');
  console.log('   que queiras usar com o NEXO?');

  const escolha = await escolher('   O que preferes?', [
    {
      titulo: 'Não — quero as opções gratuitas (recomendado)',
      detalhe: 'Groq e Cerebras. Ambos GRÁTIS, rápidos e prontos em 2 cliques.',
      valor: 'gratuito'
    },
    {
      titulo: 'Sim, já pago por uma IA e quero usá-la aqui',
      detalhe: 'OpenAI, Claude, Gemini e outros. Usas a tua chave.',
      valor: 'pago'
    },
    {
      titulo: 'Quero tudo no meu computador, sem internet',
      detalhe: 'Ollama. GRÁTIS, privacidade total, funciona sem ligação. Só precisas de o instalar.',
      valor: 'local'
    }
  ]);

  if (escolha.valor === 'gratuito') return await caminhoGratuito();
  if (escolha.valor === 'pago') return await caminhoPago();
  return await caminhoLocal();
}

// ═══════════════════════════════════════════════════════════
// PRINCIPAL
// ═══════════════════════════════════════════════════════════

async function principal() {
  // Sem terminal não há a quem perguntar, e um instalador que faz perguntas ao
  // vazio acaba sempre num erro sem sentido para quem o lê.
  if (!process.stdin.isTTY) {
    console.log('');
    console.log('  Este instalador faz perguntas, por isso precisa de um terminal.');
    console.log('');
    console.log('     Corre directamente:   npm run instalar');
    console.log('     Só para ver o estado: npm run diagnostico');
    console.log('');
    rl.close();
    process.exit(1);
  }

  console.clear();
  console.log('');
  console.log('='.repeat(62));
  console.log('  NEXO — Instalação guiada');
  console.log('='.repeat(62));
  console.log('');
  console.log('  Vou verificar o que falta e tratar do que puder.');
  console.log('  Podes sair a qualquer momento com Ctrl+C.');
  console.log('');

  // ── 1. Node: é o único que não posso resolver por ti ──
  const node = diagnostico.verificarNode();
  if (!node.ok) {
    console.log(`  ❌ O teu Node.js é a versão ${node.maior}, e o NEXO precisa da ${node.minimo} ou mais recente.`);
    console.log('');
    console.log('     Instala a versão LTS em https://nodejs.org');
    console.log('     Demora dois minutos e não desinstala nada do que já tens.');
    console.log('');
    console.log('     Depois volta a correr: npm run instalar');
    console.log('');
    rl.close();
    process.exit(1);
  }
  console.log(`  ✅ Node.js ${node.versao}`);

  // ── 2. Que aparelho é este ──
  const decisao = dispositivo.resolver({ definicoes: definicoes.ler() });
  const comoVaiCorrer = {
    completo: 'com janela própria',
    leve: 'no browser, em modo leve',
    consola: 'no terminal',
    servico: 'em segundo plano, sem janela'
  }[decisao.perfil];

  console.log(`  ✅ Vai correr ${comoVaiCorrer} (${decisao.motivo})`);

  // ── 3. Bibliotecas ──
  let deps = diagnostico.verificarDependencias();
  if (!deps.ok) {
    await instalarDependencias(decisao.perfil);
    deps = diagnostico.verificarDependencias();
  } else {
    console.log('  ✅ Bibliotecas instaladas');
  }

  // ── 4. Motor de IA ──
  const jaTem = diagnostico.fornecedoresConfigurados();
  const ollama = await diagnostico.verificarOllama();

  if (jaTem.length || ollama.presente) {
    const nomes = [...jaTem.map(f => f.nome), ollama.presente ? 'Ollama (local)' : null].filter(Boolean);
    console.log(`  ✅ Motor de IA: ${nomes.join(', ')}`);

    console.log('');
    if (await sim('  Queres acrescentar ou trocar de fornecedor?', false)) {
      await configurarIA();
    }
  } else {
    await configurarIA();
  }

  // ── 5. Confirmação final ──
  console.log('');
  linha('=');
  const final = await diagnostico.diagnosticarCompleto({ perfil: decisao.perfil });
  console.log(diagnostico.formatarDiagnostico(final));

  if (final.pronto) {
    linha('=');
    console.log('');
    console.log('  Está pronto. Para começar:');
    console.log('');
    console.log('     npm start');
    console.log('');
    console.log('  Outros comandos úteis:');
    console.log('     npm run diagnostico   ver o estado da instalação');
    console.log('     npm run setup         configurar Telegram, Discord e afins');
    console.log('');
  }

  rl.close();
}

principal().catch(err => {
  console.error('');
  console.error('  ❌ Alguma coisa correu mal:', err.message);
  console.error('     Se persistir, corre "npm run diagnostico" e mostra-me o resultado.');
  console.error('');
  rl.close();
  process.exit(1);
});
