/**
 * ⚡ Sandbox de Código — Processo Isolado
 *
 * Corre SEMPRE num processo-filho separado, lançado por codeRunner.js. Nunca
 * deve ser importado pelo resto da aplicação.
 *
 * Porquê um processo à parte: o módulo `vm` do Node não é uma fronteira de
 * segurança. Qualquer objecto do anfitrião injectado no contexto — até um
 * `console` falso — dá acesso, via `.constructor.constructor`, ao Function do
 * anfitrião e daí ao `process` e às chaves de API. Ficou provado que código
 * de chat conseguia ler a GROQ_API_KEY.
 *
 * A defesa real é este processo ser lançado com o ambiente vazio. Mesmo que o
 * código escape ao contexto, não há segredos para roubar e o processo é
 * descartável, morto ao fim do tempo limite.
 *
 * Lê o código do stdin e escreve um envelope JSON no stdout.
 */

const vm = require('vm');

const TIMEOUT_MS = parseInt(process.env.SANDBOX_TIMEOUT_MS) || 5000;

function ler(fd) {
  const fs = require('fs');
  try {
    return fs.readFileSync(fd, 'utf8');
  } catch (e) {
    return '';
  }
}

/** Expressão primeiro (para "2+2" devolver 4), bloco como recurso. */
function compilar(code) {
  const moldes = [
    `try { result = (function() { return ( ${code} \n); })(); } catch (e) { result = { __error: e.message }; }`,
    `try { result = (function() { ${code} \n})(); } catch (e) { result = { __error: e.message }; }`
  ];
  let ultimoErro;
  for (const molde of moldes) {
    try {
      return new vm.Script(molde);
    } catch (err) {
      ultimoErro = err;
    }
  }
  throw ultimoErro;
}

function main() {
  const code = ler(0);

  const logs = [];
  const push = (marca) => (...args) => logs.push(marca + args.map(String).join(' '));

  // Contexto sem built-ins do anfitrião. O vm dá ao contexto os seus próprios
  // Math, JSON, Array, Object..., que são locais e seguros. Só acrescentamos
  // um console para capturar output; aqui um vazamento não expõe nada, porque
  // este processo não tem segredos no ambiente.
  const sandbox = {
    console: { log: push(''), warn: push('⚠️ '), error: push('❌ '), info: push('ℹ️ ') },
    result: undefined
  };

  const envelope = { logs, result: undefined, error: null };

  try {
    const context = vm.createContext(sandbox);
    compilar(code).runInContext(context, { timeout: TIMEOUT_MS });

    if (sandbox.result && sandbox.result.__error) {
      envelope.error = sandbox.result.__error;
    } else if (sandbox.result !== undefined) {
      try {
        envelope.result = JSON.stringify(sandbox.result);
      } catch (e) {
        envelope.result = String(sandbox.result);
      }
    }
  } catch (err) {
    envelope.error = err.message;
  }

  process.stdout.write(JSON.stringify(envelope));
}

main();
