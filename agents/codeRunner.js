/**
 * ⚡ Code Runner - Execução de código JavaScript num processo isolado
 *
 * - Corre o código num processo-filho com o AMBIENTE VAZIO (agents/codeSandbox.js)
 * - Timeout de 5 segundos, com o processo morto à força
 * - Rate limiting por utilizador
 * - Lista de padrões proibidos como primeira barreira
 *
 * PORQUE UM PROCESSO À PARTE
 * O módulo `vm` não é uma fronteira de segurança. Ficou provado que código de
 * chat conseguia, via `Object.constructor.constructor`, chegar ao `process` do
 * anfitrião e ler a GROQ_API_KEY. Correr noutro processo sem segredos no
 * ambiente fecha essa fuga: mesmo que o código escape ao contexto, não há nada
 * para roubar e o processo é descartável.
 */

const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const EXEC_TIMEOUT_MS = parseInt(process.env.CODE_EXEC_TIMEOUT_MS) || 5000;
const SANDBOX = path.join(__dirname, 'codeSandbox.js');
const MAX_OUTPUT = 256 * 1024; // 256KB

/**
 * Ambiente mínimo para o processo-filho. Nada de segredos. No Windows, o Node
 * precisa de SystemRoot para arrancar, e é a única variável que passa.
 */
function ambienteSeguro() {
  const env = {};
  if (process.platform === 'win32') {
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
    if (process.env.TEMP) env.TEMP = process.env.TEMP;
  }
  env.SANDBOX_TIMEOUT_MS = String(EXEC_TIMEOUT_MS);
  return env;
}

const MAX_EXEC_PER_MIN = parseInt(process.env.MAX_EXEC_PER_MIN) || 5;

// Rate limiting por utilizador
const execCount = new Map();

/**
 * Verifica rate limit
 */
function checkRateLimit(userId) {
  const now = Date.now();
  const minute = Math.floor(now / 60000);
  const key = `${userId}:${minute}`;
  
  const count = execCount.get(key) || 0;
  
  // Limpar entradas antigas
  for (const [k] of execCount) {
    const kMinute = parseInt(k.split(':')[1]);
    if (kMinute < minute - 1) {
      execCount.delete(k);
    }
  }
  
  if (count >= MAX_EXEC_PER_MIN) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: 60 - (Math.floor(now / 1000) % 60)
    };
  }
  
  execCount.set(key, count + 1);
  return {
    allowed: true,
    remaining: MAX_EXEC_PER_MIN - count - 1,
    resetIn: 60 - (Math.floor(now / 1000) % 60)
  };
}

/**
 * Execuções restantes para utilizador
 */
function getRemainingExecutions(userId) {
  const now = Date.now();
  const minute = Math.floor(now / 60000);
  const key = `${userId}:${minute}`;
  const count = execCount.get(key) || 0;
  return MAX_EXEC_PER_MIN - count;
}

/**
 * Extrai código de uma mensagem
 */
function extractCode(input) {
  // Tenta extrair de bloco de código markdown
  const codeBlockMatch = input.match(/```(?:javascript|js)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  
  // Tenta extrair após "executar:/executa:" ou "run:"
  const execMatch = input.match(/(?:executa(?:r)?|run|exec|código|code)[:\s]+(.+)/i);
  if (execMatch) {
    return execMatch[1].trim();
  }
  
  // Se começa com código válido, usa diretamente
  if (input.match(/^(const|let|var|function|class|console|Math|Array|Object|String|Number)/)) {
    return input;
  }
  
  return null;
}

/**
 * Executa código em sandbox segura
 */
function runCode(code, userId = 'anonymous') {
  // Rate limit
  const rateCheck = checkRateLimit(userId);
  if (!rateCheck.allowed) {
    return {
      success: false,
      error: `⏳ Rate limit atingido. Tenta novamente em ${rateCheck.resetIn}s`,
      remaining: 0
    };
  }
  
  // Validação básica
  if (!code || typeof code !== 'string') {
    return {
      success: false,
      error: '❌ Código inválido',
      remaining: rateCheck.remaining
    };
  }
  
  // Bloquear padrões perigosos
  const dangerousPatterns = [
    /require\s*\(/,
    /import\s+/,
    /process\./,
    /global\./,
    /globalThis\./,
    /eval\s*\(/,
    /Function\s*\(/,
    /__dirname/,
    /__filename/,
    /child_process/,
    /fs\./,
    /path\./
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(code)) {
      return {
        success: false,
        error: '🔒 Código bloqueado: Contém padrões não permitidos',
        remaining: rateCheck.remaining
      };
    }
  }
  
  // Executar o código no processo-filho isolado. O código vai pelo stdin,
  // nunca pela linha de comandos, para não haver problemas de citação nem
  // limites de tamanho de argumentos.
  let bruto;
  try {
    bruto = execFileSync(process.execPath, [SANDBOX], {
      input: code,
      timeout: EXEC_TIMEOUT_MS + 500, // margem sobre o timeout interno do vm
      maxBuffer: MAX_OUTPUT,
      env: ambienteSeguro(),
      cwd: os.tmpdir(),          // longe do código do projecto
      windowsHide: true,
      encoding: 'utf8'
    });
  } catch (err) {
    // Morto por tempo excedido (parent) ou pelo backstop do próprio vm.
    const porTempo = err.killed || err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM'
      || String(err.message).toLowerCase().includes('timed out');
    if (porTempo) {
      return {
        success: false,
        error: `❌ Erro: Timeout — código demorou mais de ${EXEC_TIMEOUT_MS / 1000}s`,
        remaining: rateCheck.remaining
      };
    }
    return {
      success: false,
      error: `❌ Erro ao executar: ${String(err.message).slice(0, 160)}`,
      remaining: rateCheck.remaining
    };
  }

  // Interpretar o envelope JSON devolvido pelo sandbox.
  let envelope;
  try {
    envelope = JSON.parse(bruto);
  } catch (e) {
    return {
      success: false,
      error: '❌ Erro: resposta inválida do sandbox',
      remaining: rateCheck.remaining
    };
  }

  if (envelope.error) {
    return {
      success: false,
      error: `❌ Erro: ${envelope.error}`,
      remaining: rateCheck.remaining
    };
  }

  let output = (envelope.logs || []).join('\n');
  if (envelope.result !== undefined && envelope.result !== null) {
    if (output) output += '\n';
    output += `✅ Resultado: ${envelope.result}`;
  }

  return {
    success: true,
    output: output || '✅ Executado (sem output)',
    remaining: rateCheck.remaining
  };
}

module.exports = {
  runCode,
  extractCode,
  checkRateLimit,
  getRemainingExecutions,
  MAX_EXEC_PER_MIN
};
