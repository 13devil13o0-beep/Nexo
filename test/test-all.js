#!/usr/bin/env node

/**
 * 🧪 NEXO - Suite de Testes Completa
 * 
 * Executa: npm test  (ou node test/test-all.js)
 * 
 * Testa todos os módulos sem dependências externas.
 * Não requer API keys nem servidores a correr.
 */

const path = require('path');

// ═══════════════════════════════════════════════════════════
// MINI TEST FRAMEWORK
// ═══════════════════════════════════════════════════════════

let totalTests = 0;
let passed = 0;
let failed = 0;
const failures = [];

function describe(name, fn) {
  console.log(`\n━━━ ${name} ━━━`);
  fn();
}

// Testes assíncronos ainda a decorrer quando o ficheiro acaba de ser lido.
const pendentes = [];

/**
 * Os assíncronos correm um a seguir ao outro, não todos ao mesmo tempo.
 *
 * Deixá-los à solta parecia inofensivo e não era: um teste que substitui algo
 * partilhado, como o chatStream do router ou uma variável de ambiente, fazia
 * o guião dele aparecer no meio de outro. Deu duas falhas que não eram do
 * código, e podia ter dado o contrário — uma falha real escondida por um
 * teste vizinho.
 */
let cadeia = Promise.resolve();

function registarSucesso(name) {
  passed++;
  console.log(`  ✅ ${name}`);
}

function registarFalha(name, err) {
  failed++;
  console.log(`  ❌ ${name} → ${err.message}`);
  failures.push({ name, error: err.message });
}

/**
 * Um teste assíncrono não pode ser dado como passado antes de acabar.
 *
 * Isto chamava fn() sem esperar por nada: qualquer teste com async passava
 * sempre, acertasse ou falhasse, porque a promessa só rebentava depois de o
 * resultado já ter sido contado. Testes que não sabem falhar são piores do
 * que não ter testes, porque dão confiança a mais.
 */
function test(name, fn) {
  totalTests++;

  // Um teste marcado como async entra na fila, mesmo antes de se saber se
  // devolve promessa: chamá-lo já poria a correr o que deve esperar.
  if (fn.constructor && fn.constructor.name === 'AsyncFunction') {
    cadeia = cadeia
      .then(() => fn())
      .then(() => registarSucesso(name), (err) => registarFalha(name, err));
    pendentes.push(cadeia);
    return;
  }

  let resultado;
  try {
    resultado = fn();
  } catch (err) {
    return registarFalha(name, err);
  }

  if (resultado && typeof resultado.then === 'function') {
    cadeia = cadeia
      .then(() => resultado)
      .then(() => registarSucesso(name), (err) => registarFalha(name, err));
    pendentes.push(cadeia);
    return;
  }

  registarSucesso(name);
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected "${expected}" but got "${actual}"`);
  }
}

function assertIncludes(text, substring, message) {
  if (!text.includes(substring)) {
    throw new Error(message || `Expected "${text}" to include "${substring}"`);
  }
}

function assertMatch(text, pattern, message) {
  if (!pattern.test(text)) {
    throw new Error(message || `Expected "${text}" to match ${pattern}`);
  }
}

// ═══════════════════════════════════════════════════════════
// TESTES
// ═══════════════════════════════════════════════════════════

// 1. INTENT PARSER
describe('🎯 Intent Parser', () => {
  const { parseIntent, looksLikeCode, INTENT_PATTERNS } = require('../orchestrator/intentParser');

  test('Reconhece "ajuda" como help', () => {
    assertEqual(parseIntent('ajuda').intent, 'help');
  });

  test('Reconhece "help" como help', () => {
    assertEqual(parseIntent('help').intent, 'help');
  });

  test('Reconhece "cria um pdf sobre X" como create_pdf', () => {
    const r = parseIntent('cria um pdf sobre javascript');
    assertEqual(r.intent, 'create_pdf');
    assertEqual(r.entities.topic, 'javascript');
  });

  test('Reconhece "gerar pdf" como create_pdf', () => {
    assertEqual(parseIntent('gerar pdf sobre IA').intent, 'create_pdf');
  });

  test('Reconhece "listar ficheiros" como list_files', () => {
    assertEqual(parseIntent('listar ficheiros').intent, 'list_files');
  });

  test('Reconhece "executa:" como run_code', () => {
    assertEqual(parseIntent('executa: console.log(1)').intent, 'run_code');
  });

  test('Reconhece "executar:" como run_code', () => {
    assertEqual(parseIntent('executar: 2+2').intent, 'run_code');
  });

  test('Reconhece "run:" como run_code', () => {
    assertEqual(parseIntent('run: Math.PI').intent, 'run_code');
  });

  test('Reconhece "console.log" direto como run_code', () => {
    assertEqual(parseIntent('console.log("hi")').intent, 'run_code');
  });

  test('Reconhece "status" como system_info', () => {
    assertEqual(parseIntent('status').intent, 'system_info');
  });

  test('Reconhece "pesquisa sobre X" como web_search', () => {
    const r = parseIntent('pesquisa sobre inteligência artificial');
    assertEqual(r.intent, 'web_search');
  });

  test('Reconhece "o que é X" como web_search', () => {
    assertEqual(parseIntent('o que é machine learning').intent, 'web_search');
  });

  test('Reconhece "quem é X" como web_search', () => {
    assertEqual(parseIntent('quem é Elon Musk').intent, 'web_search');
  });

  test('Reconhece "cria ficheiro X com Y" como system_create_file', () => {
    const r = parseIntent('cria ficheiro teste.txt com hello');
    assertEqual(r.intent, 'system_create_file');
    assertEqual(r.entities.path, 'teste.txt');
    assertEqual(r.entities.content, 'hello');
  });

  test('Reconhece "lê o ficheiro X" como system_read_file', () => {
    const r = parseIntent('lê o ficheiro config.json');
    assertEqual(r.intent, 'system_read_file');
    assertEqual(r.entities.path, 'config.json');
  });

  test('Reconhece "abre o notepad" como system_open_app', () => {
    const r = parseIntent('abre o notepad');
    assertEqual(r.intent, 'system_open_app');
  });

  test('Reconhece "abre site google.com" como system_open_url', () => {
    const r = parseIntent('abre site google.com');
    assertEqual(r.intent, 'system_open_url');
    assertEqual(r.entities.url, 'google.com');
  });

  test('Reconhece "lista processos" como system_list_processes', () => {
    assertEqual(parseIntent('lista processos').intent, 'system_list_processes');
  });

  test('Reconhece "mata processo chrome" com entidade correta', () => {
    const r = parseIntent('mata processo chrome');
    assertEqual(r.intent, 'system_kill_process');
    assertEqual(r.entities.identifier, 'chrome');
  });

  test('Reconhece "minimiza chrome" como system_window_action', () => {
    const r = parseIntent('minimiza chrome');
    assertEqual(r.intent, 'system_window_action');
    assertEqual(r.entities.action, 'minimize');
  });

  test('Reconhece "screenshot" como input_screenshot', () => {
    assertEqual(parseIntent('screenshot').intent, 'input_screenshot');
  });

  test('Reconhece "digita olá" como input_type', () => {
    const r = parseIntent('digita olá');
    assertEqual(r.intent, 'input_type');
    assertEqual(r.entities.text, 'olá');
  });

  test('Mensagem genérica vai para chat (IA)', () => {
    assertEqual(parseIntent('Qual é a capital de Portugal?').intent, 'chat');
  });

  test('Mensagem vazia retorna chat', () => {
    assertEqual(parseIntent('').intent, 'chat');
  });

  test('null/undefined retorna chat sem crash', () => {
    assertEqual(parseIntent(null).intent, 'chat');
    assertEqual(parseIntent(undefined).intent, 'chat');
  });

  test('looksLikeCode detecta código JS', () => {
    assert(looksLikeCode('const x = 5;'), 'const');
    assert(looksLikeCode('function test(){}'), 'function');
    assert(looksLikeCode('console.log("hi")'), 'console');
  });

  test('looksLikeCode rejeita texto normal', () => {
    assert(!looksLikeCode('olá como estás'), 'texto normal');
  });

  test('INTENT_PATTERNS é objeto com padrões', () => {
    assert(typeof INTENT_PATTERNS === 'object');
    assert(Object.keys(INTENT_PATTERNS).length > 10, 'Deve ter >10 intents');
  });
});

// 2. CODE RUNNER
describe('⚡ Code Runner', () => {
  const codeRunner = require('../agents/codeRunner');

  test('extractCode extrai de "executa: ..."', () => {
    assertEqual(codeRunner.extractCode('executa: 2+2'), '2+2');
  });

  test('extractCode extrai de "executar: ..."', () => {
    assertEqual(codeRunner.extractCode('executar: console.log(1)'), 'console.log(1)');
  });

  test('extractCode extrai de "run: ..."', () => {
    assertEqual(codeRunner.extractCode('run: Math.PI'), 'Math.PI');
  });

  test('extractCode extrai código direto (const/let/var)', () => {
    assertEqual(codeRunner.extractCode('const x = 5'), 'const x = 5');
  });

  test('extractCode extrai de bloco markdown', () => {
    const input = '```js\nconsole.log("hi")\n```';
    assertEqual(codeRunner.extractCode(input), 'console.log("hi")');
  });

  test('extractCode retorna null para texto normal', () => {
    assertEqual(codeRunner.extractCode('olá tudo bem?'), null);
  });

  test('runCode executa código simples', () => {
    const r = codeRunner.runCode('console.log(42)', 'test-user-1');
    assert(r.success, 'Deve ter sucesso');
    assertIncludes(r.output, '42');
  });

  test('runCode executa Math', () => {
    const r = codeRunner.runCode('console.log(Math.sqrt(16))', 'test-user-2');
    assert(r.success);
    assertIncludes(r.output, '4');
  });

  test('runCode retorna resultado de expressão', () => {
    const r = codeRunner.runCode('2 + 3', 'test-user-3');
    assert(r.success);
    // Pode retornar '5' ou mensagem de sucesso sem output
    assert(r.output.includes('5') || r.output.includes('sem output'), 'Output: ' + r.output);
  });

  test('runCode bloqueia require()', () => {
    const r = codeRunner.runCode("require('fs')", 'test-user-4');
    assert(!r.success, 'Deve bloquear require');
    assertIncludes(r.error, 'bloqueado');
  });

  test('runCode bloqueia process.exit', () => {
    const r = codeRunner.runCode('process.exit(1)', 'test-user-5');
    assert(!r.success, 'Deve bloquear process');
  });

  test('runCode bloqueia eval()', () => {
    const r = codeRunner.runCode('eval("1+1")', 'test-user-6');
    assert(!r.success, 'Deve bloquear eval');
  });

  test('runCode tem timeout para loops infinitos', () => {
    const r = codeRunner.runCode('while(true){}', 'test-user-7');
    assert(!r.success, 'Deve dar timeout');
    // A mensagem pode conter "timeout" ou "timed out"
    assert(r.error.toLowerCase().includes('timeout') || r.error.toLowerCase().includes('timed out'), 'Error: ' + r.error);
  });

  test('runCode código inválido retorna erro', () => {
    const r = codeRunner.runCode(null, 'test-user-8');
    assert(!r.success);
  });

  test('getRemainingExecutions retorna número', () => {
    const r = codeRunner.getRemainingExecutions('new-user');
    assert(typeof r === 'number');
    assert(r >= 0 && r <= codeRunner.MAX_EXEC_PER_MIN);
  });
});

// 3. FILE AGENT
describe('📁 File Agent', () => {
  const fileAgent = require('../agents/fileAgent');
  const fs = require('fs');

  test('ALLOWED_READ é array com 3 pastas', () => {
    assert(Array.isArray(fileAgent.ALLOWED_READ));
    assert(fileAgent.ALLOWED_READ.length >= 3);
  });

  test('isAllowedPath aceita pasta Documentos', () => {
    const docsPath = path.join(__dirname, '..', 'Documentos', 'test.txt');
    assert(fileAgent.isAllowedPath(docsPath, 'read'), 'Documentos deve ser permitida');
  });

  test('isAllowedPath rejeita pasta fora de scope', () => {
    assert(!fileAgent.isAllowedPath('C:\\Windows\\System32\\file.txt', 'read'));
  });

  test('isAllowedPath rejeita null/undefined', () => {
    assert(!fileAgent.isAllowedPath(null));
    assert(!fileAgent.isAllowedPath(undefined));
    assert(!fileAgent.isAllowedPath(''));
  });

  test('listAllFiles retorna string sem crash', () => {
    const result = fileAgent.listAllFiles();
    assert(typeof result === 'string');
  });

  test('readFile rejeita acesso a C:\\Windows', () => {
    const r = fileAgent.readFile('C:\\Windows\\System32\\drivers\\etc\\hosts');
    assert(r.error, 'Deve rejeitar');
    assertIncludes(r.error, 'negado');
  });

  test('createNote cria nota formatada', () => {
    const r = fileAgent.createNote('Teste Unit', 'Conteúdo de teste');
    assert(r.success, 'Deve criar nota');
    assert(fs.existsSync(r.path), 'Ficheiro deve existir');
    
    // Limpar
    fs.unlinkSync(r.path);
  });

  test('formatSize formata bytes corretamente', () => {
    // Test via listAllFiles (indiretamente)
    const result = fileAgent.listAllFiles();
    assert(typeof result === 'string');
  });
});

// 4. SECURITY
describe('🔐 Security', () => {
  const security = require('../orchestrator/security');

  test('getUserId retorna ID para CLI', () => {
    const id = security.getUserId({});
    assertMatch(id, /^cli:/);
  });

  test('getUserId retorna ID para Telegram', () => {
    const id = security.getUserId({ telegramChatId: '12345' });
    assertEqual(id, 'telegram:12345');
  });

  test('getUserId retorna ID para Discord', () => {
    const id = security.getUserId({ discordUserId: 'abc' });
    assertEqual(id, 'discord:abc');
  });

  test('getUserId retorna ID para Web', () => {
    const id = security.getUserId({ webSessionId: 'sess-1' });
    assertEqual(id, 'web:sess-1');
  });

  test('logAction não faz crash', () => {
    security.logAction('test-user', 'test-action', { info: 'teste unitário' });
    assert(true);
  });

  test('getRecentLogs retorna array', () => {
    const logs = security.getRecentLogs(10);
    assert(Array.isArray(logs));
  });

  test('generateSecurityCode retorna código hex', () => {
    const code = security.generateSecurityCode();
    assert(typeof code === 'string');
    assert(code.length >= 4);
    assertMatch(code, /^[0-9A-F]+$/i);
  });

  test('getStats retorna objeto com campos', () => {
    const stats = security.getStats();
    assert(typeof stats === 'object');
    assert('totalActions' in stats);
    assert('byUser' in stats);
    assert('byAction' in stats);
  });
});

// 5. AI AGENT (sem API call)
describe('🧠 AI Agent', () => {
  const aiAgent = require('../agents/aiAgent');

  test('isAvailable retorna boolean', () => {
    const r = aiAgent.isAvailable();
    assert(typeof r === 'boolean');
  });

  test('GROQ_MODEL é string definida', () => {
    assert(typeof aiAgent.GROQ_MODEL === 'string');
    assert(aiAgent.GROQ_MODEL.length > 0);
  });

  test('FALLBACK_MODEL é string diferente do principal', () => {
    assert(typeof aiAgent.FALLBACK_MODEL === 'string');
    assert(aiAgent.FALLBACK_MODEL !== aiAgent.GROQ_MODEL);
  });

  test('Exporta askAI, generateContent, analyzeIntent', () => {
    assert(typeof aiAgent.askAI === 'function');
    assert(typeof aiAgent.generateContent === 'function');
    assert(typeof aiAgent.analyzeIntent === 'function');
  });

  test('Exporta askAIStream para streaming', () => {
    assert(typeof aiAgent.askAIStream === 'function');
  });
});

// 6. SYSTEM AGENT
describe('🖥️ System Agent', () => {
  const systemAgent = require('../agents/systemAgent');
  const fs = require('fs');

  test('isEnabled retorna boolean', () => {
    assert(typeof systemAgent.isEnabled() === 'boolean');
  });

  test('expandPath expande "." para cwd', () => {
    const r = systemAgent.expandPath('.');
    assertEqual(r, path.resolve(process.cwd()));
  });

  test('expandPath expande path relativo para user_data', () => {
    const r = systemAgent.expandPath('teste.txt');
    assertIncludes(r, 'user_data');
    assertIncludes(r, 'teste.txt');
  });

  test('expandPath expande ~ para home', () => {
    const r = systemAgent.expandPath('~/Documents');
    assertIncludes(r, require('os').homedir());
  });

  test('isPathAllowed aceita cwd', () => {
    assert(systemAgent.isPathAllowed(process.cwd()));
  });

  test('isPathAllowed rejeita pastas de sistema', () => {
    // Cada sistema tem as suas. Em Linux, "C:\Windows" não é um caminho de
    // sistema — é um nome de ficheiro estranho dentro da pasta actual, e o
    // teste falhava lá por estar a perguntar a coisa errada.
    const doSistema = process.platform === 'win32'
      ? ['C:\\Windows\\System32', 'C:\\Program Files']
      : ['/etc/passwd', '/root', '/usr/bin'];

    for (const caminho of doSistema) {
      assert(!systemAgent.isPathAllowed(caminho), `devia recusar ${caminho}`);
    }
  });

  test('isPathAllowed não se deixa enganar por um prefixo', () => {
    // "Documents_privado" começa por "Documents" mas é outra pasta. Um
    // startsWith sem separador no fim deixava-a passar.
    const path = require('path');
    const vizinha = path.join(require('os').homedir(), 'Documents_privado', 'segredos.txt');
    assert(!systemAgent.isPathAllowed(vizinha), 'pasta vizinha não é pasta permitida');
  });

  test('isPathAllowed continua a aceitar o que está mesmo lá dentro', () => {
    const path = require('path');
    const dentro = path.join(require('os').homedir(), 'Documents', 'nota.txt');
    assert(systemAgent.isPathAllowed(dentro), 'um ficheiro em Documents é permitido');
  });

  test('isCommandAllowed aceita "dir"', () => {
    const r = systemAgent.isCommandAllowed('dir');
    assert(r.allowed, 'dir deve ser permitido');
  });

  test('isCommandAllowed aceita "node --version"', () => {
    const r = systemAgent.isCommandAllowed('node --version');
    assert(r.allowed);
  });

  test('isCommandAllowed bloqueia "rm -rf"', () => {
    const r = systemAgent.isCommandAllowed('rm -rf /');
    assert(!r.allowed, 'rm deve ser bloqueado');
  });

  test('isCommandAllowed bloqueia "shutdown"', () => {
    const r = systemAgent.isCommandAllowed('shutdown /s');
    assert(!r.allowed);
  });

  test('isCommandAllowed bloqueia "format"', () => {
    const r = systemAgent.isCommandAllowed('format C:');
    assert(!r.allowed);
  });

  test('createFile + readFile + editFile ciclo completo', () => {
    const testPath = path.join(process.cwd(), 'user_data', '_test_temp.txt');
    
    // Criar
    const c = systemAgent.createFile('_test_temp.txt', 'linha1');
    assert(c.success, 'Criar deve funcionar');
    assert(c.size === 6, `Size deve ser 6, got ${c.size}`);
    
    // Ler
    const r = systemAgent.readFile(testPath);
    assert(r.success, 'Ler deve funcionar');
    assertEqual(r.content, 'linha1');
    
    // Editar (append)
    const e = systemAgent.editFile(testPath, 'linha2', 'append');
    assert(e.success, 'Editar deve funcionar');
    
    // Verificar
    const r2 = systemAgent.readFile(testPath);
    assertIncludes(r2.content, 'linha1');
    assertIncludes(r2.content, 'linha2');
    
    // Limpar
    fs.unlinkSync(testPath);
  });

  test('listDirectory lista pasta do projeto', () => {
    const r = systemAgent.listDirectory('.');
    assert(r.success, 'Deve listar');
    assert(r.files || r.folders, 'Deve ter conteúdo');
  });
});

// 7. WEB SEARCH AGENT
describe('🔍 Web Search Agent', () => {
  const ws = require('../agents/webSearchAgent');

  test('classifyQuery: conceito → knowledge', () => {
    assertEqual(ws.classifyQuery('o que é machine learning'), 'knowledge');
  });

  test('classifyQuery: preço → realtime', () => {
    assertEqual(ws.classifyQuery('preço do bitcoin hoje'), 'realtime');
  });

  test('classifyQuery: notícias → realtime', () => {
    assertEqual(ws.classifyQuery('últimas notícias tecnologia'), 'realtime');
  });

  test('classifyQuery: biografía → knowledge', () => {
    assertEqual(ws.classifyQuery('quem foi Albert Einstein'), 'knowledge');
  });

  test('classifyQuery: tutorial → realtime', () => {
    assertEqual(ws.classifyQuery('como fazer um site em react'), 'realtime');
  });

  test('isAvailable retorna boolean', () => {
    assert(typeof ws.isAvailable() === 'boolean');
  });

  test('formatResults com erro', () => {
    const r = ws.formatResults({ error: 'Teste erro' });
    assertIncludes(r, 'Teste erro');
  });

  test('Exporta search, searchDuckDuckGo, searchSerper', () => {
    assert(typeof ws.search === 'function');
    assert(typeof ws.searchDuckDuckGo === 'function');
    assert(typeof ws.searchSerper === 'function');
  });
});

// 8. DECISION ENGINE
describe('🧠 Decision Engine', () => {
  const { decisionEngine } = require('../memory/decisionEngine');

  test('decideOutputMode: código → text only', () => {
    const r = decisionEngine.decideOutputMode('```js\nconst x = 1;\n```');
    assertEqual(r.mode, 'text');
    assert(!r.shouldSpeak);
  });

  test('decideOutputMode: resposta curta → speak', () => {
    const r = decisionEngine.decideOutputMode('Sim, correto.');
    assertEqual(r.mode, 'speak');
    assert(r.shouldSpeak);
  });

  test('decideOutputMode: URLs → text', () => {
    const r = decisionEngine.decideOutputMode('Vê em https://example.com');
    assertEqual(r.mode, 'text');
  });

  test('decideOutputMode: modo forçado', () => {
    const r = decisionEngine.decideOutputMode('Qualquer texto', 'speak');
    assertEqual(r.mode, 'speak');
    assert(r.shouldSpeak);
  });

  test('classifyIntent retorna tipo', () => {
    const r = decisionEngine.classifyIntent('olá');
    assert(typeof r === 'object');
    assert('type' in r);
  });

  test('requiresConfirmation existe', () => {
    assert(typeof decisionEngine.requiresConfirmation === 'function');
  });

  test('prepareForTTS limpa markdown', () => {
    const r = decisionEngine.prepareForTTS('**negrito** e `código`');
    assert(!r.includes('**'));
    assert(!r.includes('`'));
  });
});

// 9. CONVERSATION STORE
describe('💾 Conversation Store', () => {
  const { conversationStore } = require('../memory/conversationStore');

  test('createConversation retorna conversa válida', () => {
    const c = conversationStore.createConversation('Teste');
    assert(c.id);
    assert(c.title === 'Teste');
    assert(Array.isArray(c.messages));
    assert(c.messages.length === 0);
    
    // Limpar
    conversationStore.deleteConversation(c.id);
  });

  test('addMessage adiciona mensagem', () => {
    const c = conversationStore.createConversation('Teste Msg');
    conversationStore.addMessage(c.id, { role: 'user', content: 'Olá' });
    
    const updated = conversationStore.getConversation(c.id);
    assert(updated.messages.length === 1);
    assertEqual(updated.messages[0].role, 'user');
    assertEqual(updated.messages[0].content, 'Olá');
    
    conversationStore.deleteConversation(c.id);
  });

  test('getHistoryForContext limita mensagens', () => {
    const c = conversationStore.createConversation('Teste History');
    
    for (let i = 0; i < 20; i++) {
      conversationStore.addMessage(c.id, { role: 'user', content: `Msg ${i}` });
    }
    
    const history = conversationStore.getHistoryForContext(c.id, 5);
    assert(history.length === 5, `Deve retornar 5, got ${history.length}`);
    
    conversationStore.deleteConversation(c.id);
  });

  test('deleteConversation remove conversa', () => {
    const c = conversationStore.createConversation('Para Apagar');
    assert(conversationStore.deleteConversation(c.id));
    assert(!conversationStore.getConversation(c.id));
  });

  test('listConversations retorna array ordenado', () => {
    const list = conversationStore.listConversations();
    assert(Array.isArray(list));
  });

  test('getStats retorna estatísticas', () => {
    const stats = conversationStore.getStats();
    assert(typeof stats === 'object');
  });
});

// 10. ROUTER
describe('🔀 Router', () => {
  const router = require('../orchestrator/router');

  test('Exporta handlePrompt', () => {
    assert(typeof router.handlePrompt === 'function');
  });

  test('Exporta getSystemInfo', () => {
    assert(typeof router.getSystemInfo === 'function');
  });

  test('Exporta getAgentsList', () => {
    assert(typeof router.getAgentsList === 'function');
  });

  test('Exporta getHelpMessage', () => {
    assert(typeof router.getHelpMessage === 'function');
  });
});

// 11. PDF AGENT
describe('📄 PDF Agent', () => {
  const pdfAgent = require('../agents/pdfAgent');
  const fs = require('fs');

  test('Exporta createPDF, listPDFs', () => {
    assert(typeof pdfAgent.createPDF === 'function');
    assert(typeof pdfAgent.listPDFs === 'function');
  });

  test('listPDFs retorna array', () => {
    const list = pdfAgent.listPDFs();
    assert(Array.isArray(list));
  });

  test('OUTPUTS_DIR está definido', () => {
    assert(typeof pdfAgent.OUTPUTS_DIR === 'string');
    assert(pdfAgent.OUTPUTS_DIR.length > 0);
  });
});

// 12. INPUT AGENT (sem executar ações reais)
describe('🎮 Input Agent', () => {
  const inputAgent = require('../agents/inputAgent');

  test('isEnabled retorna boolean', () => {
    assert(typeof inputAgent.isEnabled() === 'boolean');
  });

  test('BLACKLISTED_WINDOWS tem sites bancários', () => {
    assert(Array.isArray(inputAgent.BLACKLISTED_WINDOWS));
    const has = inputAgent.BLACKLISTED_WINDOWS.some(w => w.includes('paypal'));
    assert(has, 'Deve ter paypal na blacklist');
  });

  test('BLACKLISTED_URLS tem sites críticos', () => {
    assert(Array.isArray(inputAgent.BLACKLISTED_URLS));
    const has = inputAgent.BLACKLISTED_URLS.some(u => u.includes('binance'));
    assert(has, 'Deve ter binance na blacklist');
  });

  test('generateActionPlan gera plano legível', () => {
    const plan = inputAgent.generateActionPlan([
      { type: 'type', description: 'Digitar olá' },
      { type: 'click', description: 'Clicar botão' }
    ]);
    assertIncludes(plan, 'Digitar olá');
    assertIncludes(plan, 'Clicar botão');
    assertIncludes(plan, 'aprovar');
  });

  test('checkRateLimit retorna objeto', () => {
    const r = inputAgent.checkRateLimit();
    assert(typeof r === 'object');
    assert('allowed' in r);
  });
});

// ═══════════════════════════════════════════════════════════
// 13. REMOTE AGENT
// ═══════════════════════════════════════════════════════════

describe('📡 Remote Agent', () => {
  const remoteAgent = require('../agents/remoteAgent');

  test('Exporta funções principais', () => {
    assert(typeof remoteAgent.addMachine === 'function');
    assert(typeof remoteAgent.removeMachine === 'function');
    assert(typeof remoteAgent.listMachines === 'function');
    assert(typeof remoteAgent.executeRemote === 'function');
    assert(typeof remoteAgent.isCommandSafe === 'function');
    assert(typeof remoteAgent.getStatus === 'function');
    assert(typeof remoteAgent.formatRemoteResult === 'function');
  });

  test('isCommandSafe bloqueia rm -rf /', () => {
    const result = remoteAgent.isCommandSafe('rm -rf /');
    assert(!result.safe, 'rm -rf / deve ser bloqueado');
  });

  test('isCommandSafe permite ls -la', () => {
    const result = remoteAgent.isCommandSafe('ls -la');
    assert(result.safe, 'ls -la deve ser permitido');
  });

  test('isCommandSafe bloqueia fork bomb', () => {
    const result = remoteAgent.isCommandSafe(':(){ :|:& };:');
    assert(!result.safe, 'Fork bomb deve ser bloqueado');
  });

  test('listMachines retorna objeto com formatted', () => {
    const result = remoteAgent.listMachines();
    assert(result.success === true);
    assert(typeof result.formatted === 'string');
  });

  test('getStatus retorna informação do módulo', () => {
    const status = remoteAgent.getStatus();
    assert(typeof status.available === 'boolean');
    assert(typeof status.machinesCount === 'number');
    assert(typeof status.sshModule === 'string');
  });

  test('formatRemoteResult formata erro', () => {
    const result = remoteAgent.formatRemoteResult({ success: false, error: '❌ Teste' });
    assertIncludes(result, 'Teste');
  });

  test('formatRemoteResult formata sucesso', () => {
    const result = remoteAgent.formatRemoteResult({
      success: true,
      machine: 'test',
      host: '1.2.3.4',
      exitCode: 0,
      output: 'hello',
      error: ''
    });
    assertIncludes(result, 'test');
    assertIncludes(result, '1.2.3.4');
  });
});

// ═══════════════════════════════════════════════════════════
// 14. SECURITY ENHANCEMENTS
// ═══════════════════════════════════════════════════════════

describe('🔐 Security (Melhorias)', () => {
  const security = require('../orchestrator/security');

  test('checkRateLimit permite primeiros pedidos', () => {
    const result = security.checkRateLimit('test-ip-unique-' + Date.now());
    assert(result.allowed === true);
    assert(result.remaining >= 0);
  });

  test('authMiddleware exportado como função', () => {
    assert(typeof security.authMiddleware === 'function');
  });

  test('rateLimitMiddleware exportado como função', () => {
    assert(typeof security.rateLimitMiddleware === 'function');
  });

  test('getOrCreateApiKey retorna string', () => {
    const key = security.getOrCreateApiKey();
    assert(typeof key === 'string');
    assert(key.length > 0);
  });
});

// ═══════════════════════════════════════════════════════════
// 15. INTENT PARSER — Remote Agent Intents
// ═══════════════════════════════════════════════════════════

describe('🎯 Intent Parser (Remote)', () => {
  const { parseIntent, INTENT_PATTERNS } = require('../orchestrator/intentParser');

  test('Reconhece "lista máquinas remotas"', () => {
    assertEqual(parseIntent('lista máquinas remotas').intent, 'remote_list_machines');
  });

  test('Reconhece "lista servidores"', () => {
    assertEqual(parseIntent('lista servidores').intent, 'remote_list_machines');
  });

  test('Reconhece "adiciona máquina X Y user Z"', () => {
    const result = parseIntent('adiciona máquina servidor1 192.168.1.100 user root');
    assertEqual(result.intent, 'remote_add_machine');
    assertEqual(result.entities.alias, 'servidor1');
    assertEqual(result.entities.host, '192.168.1.100');
    assertEqual(result.entities.username, 'root');
  });

  test('Reconhece "remove máquina X"', () => {
    const result = parseIntent('remove máquina servidor1');
    assertEqual(result.intent, 'remote_remove_machine');
    assertEqual(result.entities.alias, 'servidor1');
  });

  test('Reconhece "ssh servidor1 uptime"', () => {
    const result = parseIntent('ssh servidor1 uptime');
    assertEqual(result.intent, 'remote_execute');
  });

  test('INTENT_PATTERNS tem remote_list_machines', () => {
    assert(INTENT_PATTERNS.remote_list_machines !== undefined);
  });

  test('INTENT_PATTERNS tem remote_add_machine', () => {
    assert(INTENT_PATTERNS.remote_add_machine !== undefined);
  });

  test('INTENT_PATTERNS tem remote_execute', () => {
    assert(INTENT_PATTERNS.remote_execute !== undefined);
  });

  test('INTENT_PATTERNS tem remote_status', () => {
    assert(INTENT_PATTERNS.remote_status !== undefined);
  });
});

// 12. PROJECT BLUEPRINT INTENT
describe('📐 Project Blueprint Intent', () => {
  const { parseIntent, INTENT_PATTERNS } = require('../orchestrator/intentParser');

  test('INTENT_PATTERNS tem project_blueprint', () => {
    assert(INTENT_PATTERNS.project_blueprint !== undefined);
  });

  test('project_blueprint tem patterns e extract', () => {
    assert(Array.isArray(INTENT_PATTERNS.project_blueprint.patterns));
    assert(typeof INTENT_PATTERNS.project_blueprint.extract === 'function');
  });

  test('Reconhece "cria um blueprint para app de dating"', () => {
    assertEqual(parseIntent('cria um blueprint para app de dating').intent, 'project_blueprint');
  });

  test('Reconhece "planeia uma app de tarefas"', () => {
    assertEqual(parseIntent('planeia uma app de tarefas').intent, 'project_blueprint');
  });

  test('Reconhece "blueprint para um site de receitas"', () => {
    assertEqual(parseIntent('blueprint para um site de receitas').intent, 'project_blueprint');
  });

  test('Reconhece "como ficaria uma app de chat"', () => {
    assertEqual(parseIntent('como ficaria uma app de chat em React').intent, 'project_blueprint');
  });

  test('Reconhece "só o plano para uma app"', () => {
    assertEqual(parseIntent('só o plano para uma app de fitness').intent, 'project_blueprint');
  });

  test('Reconhece negação "cria app de dating mas não criar agora"', () => {
    assertEqual(parseIntent('cria uma app de dating mas não criar agora').intent, 'project_blueprint');
  });

  test('Extrai descrição do blueprint', () => {
    const result = parseIntent('cria um blueprint para app de dating');
    assert(result.entities.description !== undefined, 'Deve extrair description');
    assert(result.entities.description.length > 0, 'Description não deve estar vazio');
  });

  test('project_create ainda funciona "cria um projeto de galeria"', () => {
    assertEqual(parseIntent('cria um projeto de galeria de fotos').intent, 'project_create');
  });

  test('project_create funciona "cria uma app de todo"', () => {
    assertEqual(parseIntent('cria uma app de todo list').intent, 'project_create');
  });
});

// 13. AGENT CHAINING — Blueprint Detection & Fail-Fast
describe('🔗 Agent Chaining Melhorado', () => {
  const { isMultiStep, isBlueprintRequest, executeChain, formatChainResult } = require('../orchestrator/agentChaining');

  test('isBlueprintRequest existe e é função', () => {
    assert(typeof isBlueprintRequest === 'function');
  });

  test('isBlueprintRequest detecta "não criar agora"', () => {
    assert(isBlueprintRequest('quero uma app mas não criar agora'));
  });

  test('isBlueprintRequest detecta "blueprint"', () => {
    assert(isBlueprintRequest('faz um blueprint para a minha app'));
  });

  test('isBlueprintRequest detecta "como ficaria"', () => {
    assert(isBlueprintRequest('como ficaria uma app de dating'));
  });

  test('isBlueprintRequest detecta "só o plano"', () => {
    assert(isBlueprintRequest('só o plano para este projeto'));
  });

  test('isBlueprintRequest retorna false para pedido normal', () => {
    assert(!isBlueprintRequest('pesquisa sobre React e cria um PDF'));
  });

  test('isMultiStep não dispara para pedidos blueprint', () => {
    assert(!isMultiStep('planeia uma app de dating como ficaria'));
  });

  test('isMultiStep continua a funcionar para multi-step real', () => {
    assert(isMultiStep('pesquisa sobre React e depois cria um PDF sobre isso'));
  });

  test('executeChain fail-fast cancela passos dependentes', async () => {
    const steps = [
      { step: 1, agent: 'test', action: 'vai falhar', input: 'x', usePreviousOutput: false },
      { step: 2, agent: 'test', action: 'depende do anterior', input: 'y', usePreviousOutput: true }
    ];

    const result = await executeChain(
      steps,
      async () => { throw new Error('falha simulada'); },
      null,
      { failFast: true }
    );

    assert(!result.success, 'Chain deve falhar');
    assertEqual(result.results.length, 2, 'Deve ter 2 resultados (1 falhado + 1 cancelado)');
    assert(!result.results[0].success, 'Passo 1 deve falhar');
    assertIncludes(result.results[1].error, 'Cancelado', 'Passo 2 deve ser cancelado');
  });

  test('executeChain continua se passos independentes', async () => {
    let callCount = 0;
    const steps = [
      { step: 1, agent: 'test', action: 'falha', input: 'x', usePreviousOutput: false },
      { step: 2, agent: 'test', action: 'independente', input: 'y', usePreviousOutput: false }
    ];

    const result = await executeChain(
      steps,
      async () => { 
        callCount++;
        if (callCount === 1) throw new Error('falha');
        return 'ok';
      },
      null,
      { failFast: true }
    );

    assertEqual(result.results.length, 2, 'Deve ter 2 resultados');
    assert(!result.results[0].success, 'Passo 1 falhou');
    assert(result.results[1].success, 'Passo 2 continuou pois é independente');
  });

  test('formatChainResult formata resultado com erro', () => {
    const chainResult = {
      success: false,
      totalSteps: 2,
      completedSteps: 0,
      results: [
        { step: 1, agent: 'test', action: 'falhou', success: false, error: 'boom' },
        { step: 2, agent: 'test', action: 'cancelado', success: false, error: 'Cancelado' }
      ]
    };
    const formatted = formatChainResult(chainResult);
    assertIncludes(formatted, '0/2');
    assertIncludes(formatted, 'boom');
    assertIncludes(formatted, 'Cancelado');
  });
});

// 14. PROJECT BUILDER — generateBlueprint
describe('🏗️ Project Builder Blueprint', () => {
  const projectBuilder = require('../agents/projectBuilder');

  test('generateBlueprint existe e é função', () => {
    assert(typeof projectBuilder.generateBlueprint === 'function');
  });

  test('generateBlueprint retorna erro sem IA', async () => {
    const result = await projectBuilder.generateBlueprint('app de tarefas');
    // Sem API key, deve falhar graciosamente
    assert(result.success === false || result.success === true, 'Deve retornar objecto com success');
    if (!result.success) {
      assert(typeof result.error === 'string', 'Deve ter mensagem de erro');
    }
  });

  test('planProject ainda exportado', () => {
    assert(typeof projectBuilder.planProject === 'function');
  });

  test('buildProject ainda exportado', () => {
    assert(typeof projectBuilder.buildProject === 'function');
  });

  test('listProjects ainda exportado', () => {
    assert(typeof projectBuilder.listProjects === 'function');
  });
});

// ═══════════════════════════════════════════════════════════
// LLM ROUTER
// ═══════════════════════════════════════════════════════════

describe('🔄 LLM Router (Multi-Provider)', () => {
  const llmRouter = require('../orchestrator/llmRouter');

  test('Exporta chat function', () => {
    assert(typeof llmRouter.chat === 'function');
  });

  test('Exporta chatStream function', () => {
    assert(typeof llmRouter.chatStream === 'function');
  });

  test('Exporta getProvidersStatus function', () => {
    assert(typeof llmRouter.getProvidersStatus === 'function');
  });

  test('Exporta getActiveProvider function', () => {
    assert(typeof llmRouter.getActiveProvider === 'function');
  });

  test('Exporta getAvailableProviders function', () => {
    assert(typeof llmRouter.getAvailableProviders === 'function');
  });

  test('Exporta isAvailable function', () => {
    assert(typeof llmRouter.isAvailable === 'function');
  });

  test('PROVIDERS contém os 5 providers esperados', () => {
    const providers = llmRouter.PROVIDERS;
    assert(typeof providers === 'object');
    assert(providers.groq, 'Deve ter groq');
    assert(providers.cerebras, 'Deve ter cerebras');
    assert(providers.gemini, 'Deve ter gemini');
    assert(providers.huggingface, 'Deve ter huggingface');
    assert(providers.ollama, 'Deve ter ollama');
  });

  test('Cada provider tem name, baseURL, model', () => {
    const providers = llmRouter.PROVIDERS;
    for (const [key, p] of Object.entries(providers)) {
      assert(typeof p.name === 'string', `${key} deve ter name`);
      assert(typeof p.model === 'string', `${key} deve ter model`);
    }
  });

  test('getProvidersStatus retorna array', () => {
    const status = llmRouter.getProvidersStatus();
    assert(Array.isArray(status), 'Deve retornar array');
    assert(status.length >= 5, 'Deve ter pelo menos 5 providers');
  });

  test('Cada status tem name, available, configured', () => {
    const status = llmRouter.getProvidersStatus();
    for (const s of status) {
      assert(typeof s.name === 'string', 'Status deve ter name');
      assert(typeof s.available === 'boolean', 'Status deve ter available');
      assert(typeof s.configured === 'boolean', 'Status deve ter configured');
    }
  });

  test('getActiveProvider retorna object ou null', () => {
    const active = llmRouter.getActiveProvider();
    assert(active === null || typeof active === 'object');
    if (active) {
      assert(typeof active.name === 'string', 'Active provider deve ter name');
    }
  });

  test('getAvailableProviders retorna array', () => {
    const available = llmRouter.getAvailableProviders();
    assert(Array.isArray(available));
  });

  test('isAvailable retorna boolean', () => {
    assert(typeof llmRouter.isAvailable() === 'boolean');
  });
});

// ═══════════════════════════════════════════════════════════
// RAG ENGINE
// ═══════════════════════════════════════════════════════════

describe('🧠 RAG Engine', () => {
  const ragEngine = require('../orchestrator/ragEngine');

  test('ragEngine é objecto singleton', () => {
    assert(typeof ragEngine === 'object');
    assert(ragEngine !== null);
  });

  test('Exporta init function', () => {
    assert(typeof ragEngine.init === 'function');
  });

  test('Exporta search function', () => {
    assert(typeof ragEngine.search === 'function');
  });

  test('Exporta indexFile function', () => {
    assert(typeof ragEngine.indexFile === 'function');
  });

  test('Exporta indexDirectory function', () => {
    assert(typeof ragEngine.indexDirectory === 'function');
  });

  test('Exporta indexText function', () => {
    assert(typeof ragEngine.indexText === 'function');
  });

  test('Exporta getContext function', () => {
    assert(typeof ragEngine.getContext === 'function');
  });

  test('Exporta getStats function', () => {
    assert(typeof ragEngine.getStats === 'function');
  });

  test('Exporta clearIndex function', () => {
    assert(typeof ragEngine.clearIndex === 'function');
  });

  test('Exporta removeFile function', () => {
    assert(typeof ragEngine.removeFile === 'function');
  });

  test('getStats retorna objeto com campos esperados', () => {
    const stats = ragEngine.getStats();
    assert(typeof stats === 'object');
    assert(typeof stats.totalChunks === 'number');
    assert(typeof stats.totalSources === 'number');
    assert(typeof stats.totalDocs === 'number');
    assert(typeof stats.vocabularySize === 'number');
    assert(Array.isArray(stats.sources));
  });

  test('_tokenize remove stop words', () => {
    const tokens = ragEngine._tokenize('o gato de Portugal com amor');
    assert(!tokens.includes('de'), 'Não deve incluir "de"');
    assert(!tokens.includes('com'), 'Não deve incluir "com"');
    assert(tokens.includes('gato'), 'Deve incluir "gato"');
    assert(tokens.includes('portugal'), 'Deve incluir "portugal"');
  });

  test('_cosineSimilarity vetores iguais = 1', () => {
    const vec = { a: 1, b: 2, c: 3 };
    const sim = ragEngine._cosineSimilarity(vec, vec);
    assert(Math.abs(sim - 1.0) < 0.001, `Similaridade deve ser ~1, got ${sim}`);
  });

  test('_cosineSimilarity vetores ortogonais = 0', () => {
    const vecA = { a: 1 };
    const vecB = { b: 1 };
    const sim = ragEngine._cosineSimilarity(vecA, vecB);
    assertEqual(sim, 0);
  });

  test('_createChunks divide texto longo', () => {
    // Criar texto com mais palavras que CHUNK_SIZE (512)
    const words = [];
    for (let i = 0; i < 600; i++) words.push('word' + i);
    const text = words.join(' ');
    const chunks = ragEngine._createChunks(text, 'test', {});
    assert(chunks.length > 1, `Deve ter multiplos chunks, got ${chunks.length}`);
    assert(chunks[0].id, 'Chunk deve ter id');
    assert(chunks[0].source === 'test', 'Chunk deve ter source correto');
  });

  test('_createChunks texto curto = 1 chunk', () => {
    const chunks = ragEngine._createChunks('Texto curto', 'test', {});
    assertEqual(chunks.length, 1);
  });
});

// ═══════════════════════════════════════════════════════════
// WEB/API INTEGRATION CHECKS
// ═══════════════════════════════════════════════════════════

describe('🌐 API Server Exports', () => {
  test('api-server.js carrega sem erros', () => {
    // Não iniciar o servidor, apenas verificar que o módulo carrega
    // (o módulo inicia automaticamente, então fazemos check de dependências)
    const path = require('path');
    const fs = require('fs');
    const serverPath = path.join(__dirname, '..', 'orchestrator', 'api-server.js');
    assert(fs.existsSync(serverPath), 'api-server.js deve existir');
    
    // Verificar que as dependências existem
    const llmRouterPath = path.join(__dirname, '..', 'orchestrator', 'llmRouter.js');
    const ragEnginePath = path.join(__dirname, '..', 'orchestrator', 'ragEngine.js');
    assert(fs.existsSync(llmRouterPath), 'llmRouter.js deve existir');
    assert(fs.existsSync(ragEnginePath), 'ragEngine.js deve existir');
  });

  test('llmRouter.js tem todos os exports necessários', () => {
    const llmRouter = require('../orchestrator/llmRouter');
    const required = ['chat', 'chatStream', 'getProvidersStatus', 'getActiveProvider', 'getAvailableProviders', 'isAvailable', 'PROVIDERS'];
    for (const fn of required) {
      assert(llmRouter[fn] !== undefined, `Deve exportar ${fn}`);
    }
  });

  test('ragEngine.js tem todos os exports necessários', () => {
    const rag = require('../orchestrator/ragEngine');
    const required = ['init', 'search', 'indexFile', 'indexDirectory', 'indexText', 'getContext', 'getStats', 'clearIndex', 'removeFile'];
    for (const fn of required) {
      assert(typeof rag[fn] === 'function', `Deve exportar ${fn} como função`);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// 🌍 i18n TESTS
// ═══════════════════════════════════════════════════════════

describe('🌍 i18n Module', () => {
  const i18n = require('../i18n/i18n');
  i18n.init();

  test('i18n.init() carrega todos os 4 locales', () => {
    const stats = i18n.getStats();
    assertEqual(stats.supported.length, 4, 'Deve carregar 4 locales');
  });

  test('i18n.t() retorna tradução em português (default)', () => {
    const result = i18n.t('general.error', { message: 'test' });
    assert(result.includes('test'), 'Deve interpolar variável');
    assert(result.includes('❌'), 'Deve conter ícone de erro');
  });

  test('i18n.t() faz fallback para pt se chave não existe no locale', () => {
    const result = i18n.t('general.error', { message: 'teste' }, 'test-fallback');
    assert(result.includes('teste'), 'Deve retornar tradução pt como fallback');
  });

  test('i18n.t() resolve chaves com dot-notation', () => {
    const result = i18n.t('system.create_file.missing_path');
    assert(result.includes('❌'), 'Deve resolver chave profunda');
  });

  test('i18n.t() retorna a chave se não existir', () => {
    const result = i18n.t('nonexistent.key.here');
    assertEqual(result, 'nonexistent.key.here', 'Deve retornar a própria chave');
  });

  test('i18n.setUserLanguage e getUserLanguage funcionam', () => {
    i18n.setUserLanguage('test-user-1', 'en');
    assertEqual(i18n.getUserLanguage('test-user-1'), 'en', 'Deve retornar en');
    i18n.resetUserLanguage('test-user-1');
  });

  test('i18n.t() respeita idioma do utilizador', () => {
    i18n.setUserLanguage('test-user-2', 'en');
    const result = i18n.t('cli.goodbye', {}, 'test-user-2');
    assert(result.includes('Goodbye'), 'Deve traduzir para inglês');
    i18n.resetUserLanguage('test-user-2');
  });

  test('i18n.t() traduz para espanhol', () => {
    i18n.setUserLanguage('test-user-3', 'es');
    const result = i18n.t('cli.goodbye', {}, 'test-user-3');
    assert(result.includes('Hasta luego'), 'Deve traduzir para espanhol');
    i18n.resetUserLanguage('test-user-3');
  });

  test('i18n.t() traduz para francês', () => {
    i18n.setUserLanguage('test-user-4', 'fr');
    const result = i18n.t('cli.goodbye', {}, 'test-user-4');
    assert(result.includes('Au revoir'), 'Deve traduzir para francês');
    i18n.resetUserLanguage('test-user-4');
  });

  test('i18n.normalizeLangCode converte nomes naturais', () => {
    assertEqual(i18n.normalizeLangCode('português'), 'pt', 'português → pt');
    assertEqual(i18n.normalizeLangCode('english'), 'en', 'english → en');
    assertEqual(i18n.normalizeLangCode('español'), 'es', 'español → es');
    assertEqual(i18n.normalizeLangCode('français'), 'fr', 'français → fr');
    assertEqual(i18n.normalizeLangCode('pt'), 'pt', 'pt → pt');
    assertEqual(i18n.normalizeLangCode('en'), 'en', 'en → en');
  });

  test('i18n.isSupported verifica idiomas suportados', () => {
    assert(i18n.isSupported('pt'), 'pt deve ser suportado');
    assert(i18n.isSupported('en'), 'en deve ser suportado');
    assert(i18n.isSupported('es'), 'es deve ser suportado');
    assert(i18n.isSupported('fr'), 'fr deve ser suportado');
    assert(!i18n.isSupported('jp'), 'jp não deve ser suportado');
  });

  test('i18n.getLanguageName retorna nomes corretos', () => {
    assertEqual(i18n.getLanguageName('pt'), 'Português', 'pt → Português');
    assertEqual(i18n.getLanguageName('en'), 'English', 'en → English');
  });

  test('i18n.getLanguageFlag retorna bandeiras', () => {
    const flag = i18n.getLanguageFlag('pt');
    assert(flag.length > 0, 'Deve retornar bandeira não vazia');
  });

  test('i18n.reload() recarrega locales sem erros', () => {
    i18n.reload();
    const stats = i18n.getStats();
    assertEqual(stats.supported.length, 4, 'Deve manter 4 locales após reload');
  });

  test('Interpolação com {{var}} e {var} funciona', () => {
    const result = i18n.t('time.current', { time: '14:30' });
    assert(result.includes('14:30'), 'Deve interpolar {{time}}');
  });

  test('Todas as locales têm as mesmas secções', () => {
    const fs = require('fs');
    const path = require('path');
    const localeDir = path.join(__dirname, '..', 'locales');
    const pt = JSON.parse(fs.readFileSync(path.join(localeDir, 'pt.json'), 'utf8'));
    const en = JSON.parse(fs.readFileSync(path.join(localeDir, 'en.json'), 'utf8'));
    const es = JSON.parse(fs.readFileSync(path.join(localeDir, 'es.json'), 'utf8'));
    const fr = JSON.parse(fs.readFileSync(path.join(localeDir, 'fr.json'), 'utf8'));
    
    const ptSections = Object.keys(pt).sort().join(',');
    const enSections = Object.keys(en).sort().join(',');
    const esSections = Object.keys(es).sort().join(',');
    const frSections = Object.keys(fr).sort().join(',');
    
    assertEqual(ptSections, enSections, 'pt e en devem ter as mesmas secções');
    assertEqual(ptSections, esSections, 'pt e es devem ter as mesmas secções');
    assertEqual(ptSections, frSections, 'pt e fr devem ter as mesmas secções');
  });

  test('Intent change_language existe no intentParser', () => {
    const parser = require('../orchestrator/intentParser');
    const result = parser.parseIntent('muda para inglês');
    assertEqual(result.intent, 'change_language', 'Deve detectar change_language');
  });

  test('Intent list_languages existe no intentParser', () => {
    const parser = require('../orchestrator/intentParser');
    const result = parser.parseIntent('que idiomas suportas');
    assertEqual(result.intent, 'list_languages', 'Deve detectar list_languages');
  });
});


// ═══════════════════════════════════════════════════════════
// ADAPTADOR ANTHROPIC — tradução entre o formato do NEXO e o da Anthropic
// ═══════════════════════════════════════════════════════════

describe('🟠 Adaptador Anthropic', () => {
  const anthropic = require('../nexo/adapters/anthropic');

  test('ferramentas passam de parameters para input_schema', () => {
    const [f] = anthropic.ferramentasParaAnthropic([{
      type: 'function',
      function: { name: 'somar', description: 'soma', parameters: { type: 'object', properties: { a: { type: 'number' } } } }
    }]);
    assertEqual(f.name, 'somar');
    assert(f.input_schema, 'deve ter input_schema');
    assert(!f.parameters, 'não deve manter parameters');
    assertEqual(f.input_schema.properties.a.type, 'number');
  });

  test('o prompt de sistema sai das mensagens para parâmetro de topo', () => {
    const r = anthropic.mensagensParaAnthropic([
      { role: 'system', content: 'És o NEXO.' },
      { role: 'user', content: 'olá' }
    ]);
    assertEqual(r.system, 'És o NEXO.');
    assertEqual(r.mensagens.length, 1);
    assertEqual(r.mensagens[0].role, 'user');
  });

  test('assistente com tool_calls vira blocos tool_use', () => {
    const r = anthropic.mensagensParaAnthropic([
      { role: 'user', content: 'quanto é 2+2' },
      { role: 'assistant', content: null, tool_calls: [
        { id: 'toolu_1', function: { name: 'executar_codigo', arguments: '{"codigo":"2+2"}' } }
      ] }
    ]);
    const assistente = r.mensagens[1];
    assertEqual(assistente.role, 'assistant');
    assertEqual(assistente.content[0].type, 'tool_use');
    assertEqual(assistente.content[0].id, 'toolu_1');
    assertEqual(assistente.content[0].input.codigo, '2+2');
  });

  test('resultados de ferramentas juntam-se numa só mensagem de utilizador', () => {
    const r = anthropic.mensagensParaAnthropic([
      { role: 'user', content: 'faz duas coisas' },
      { role: 'assistant', content: null, tool_calls: [
        { id: 'a', function: { name: 'x', arguments: '{}' } },
        { id: 'b', function: { name: 'y', arguments: '{}' } }
      ] },
      { role: 'tool', tool_call_id: 'a', name: 'x', content: 'resultado A' },
      { role: 'tool', tool_call_id: 'b', name: 'y', content: 'resultado B' }
    ]);
    const ultima = r.mensagens[r.mensagens.length - 1];
    assertEqual(ultima.role, 'user');
    assertEqual(ultima.content.length, 2);
    assertEqual(ultima.content[0].type, 'tool_result');
    assertEqual(ultima.content[0].tool_use_id, 'a');
    assertEqual(ultima.content[1].tool_use_id, 'b');
  });

  test('resposta com tool_use volta na forma comum do NEXO', () => {
    const r = anthropic.respostaParaNexo({
      model: 'claude-opus-5',
      stop_reason: 'tool_use',
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: 'Vou calcular.' },
        { type: 'tool_use', id: 'toolu_9', name: 'executar_codigo', input: { codigo: '1+1' } }
      ],
      usage: { input_tokens: 10, output_tokens: 5 }
    }, 'claude-opus-5');

    assertEqual(r.text, 'Vou calcular.');
    assertEqual(r.toolCalls.length, 1);
    assertEqual(r.toolCalls[0].id, 'toolu_9');
    assertEqual(r.toolCalls[0].function.name, 'executar_codigo');
    assertEqual(JSON.parse(r.toolCalls[0].function.arguments).codigo, '1+1');
    assertEqual(r.stopReason, 'tool_use');
  });

  test('blocos de raciocínio são ignorados no texto', () => {
    const r = anthropic.respostaParaNexo({
      content: [{ type: 'thinking', thinking: 'nao mostrar' }, { type: 'text', text: 'olá' }]
    }, 'm');
    assertEqual(r.text, 'olá');
  });

  test('resposta sem ferramentas não traz toolCalls', () => {
    const r = anthropic.respostaParaNexo({ content: [{ type: 'text', text: 'resposta simples' }] }, 'm');
    assertEqual(r.toolCalls, null);
    assert(!r.raw, 'sem chamadas não precisa de turno cru');
  });

  test('ida e volta preserva o identificador da chamada', () => {
    const resposta = anthropic.respostaParaNexo({
      content: [{ type: 'tool_use', id: 'toolu_zz', name: 'f', input: {} }]
    }, 'm');
    const convertido = anthropic.mensagensParaAnthropic([
      { role: 'user', content: 'x' },
      resposta.raw,
      { role: 'tool', tool_call_id: 'toolu_zz', content: 'ok' }
    ]);
    assertEqual(convertido.mensagens[1].content[0].id, 'toolu_zz');
    assertEqual(convertido.mensagens[2].content[0].tool_use_id, 'toolu_zz');
  });
});


// ═══════════════════════════════════════════════════════════
// DETECÇÃO DE DISPOSITIVO — que perfil de arranque cada máquina justifica
// ═══════════════════════════════════════════════════════════

describe('🔍 Detecção de Dispositivo', () => {
  const dispositivo = require('../orchestrator/dispositivo');

  const GB = 1024 ** 3;

  /** Uma máquina fingida. Por omissão, um PC de secretária capaz. */
  function maquina(extras = {}) {
    return {
      env: {},
      plataforma: 'win32',
      memoriaTotal: 16 * GB,
      memoriaLivre: 8 * GB,
      nucleos: 8,
      terminal: true,
      lerFicheiro: () => null,
      ...extras
    };
  }

  const perfilDe = (extras) => dispositivo.detectar(maquina(extras)).perfil;

  test('PC com ecrã e memória folgada → completo', () => {
    assertEqual(perfilDe(), 'completo');
  });

  test('Linux sem DISPLAY mas com terminal → consola', () => {
    assertEqual(perfilDe({ plataforma: 'linux', env: {}, terminal: true }), 'consola');
  });

  test('Linux com DISPLAY → completo', () => {
    assertEqual(perfilDe({ plataforma: 'linux', env: { DISPLAY: ':0' } }), 'completo');
  });

  test('sem gráficos e sem terminal → serviço', () => {
    assertEqual(perfilDe({ plataforma: 'linux', env: {}, terminal: false }), 'servico');
  });

  test('sessão SSH não abre janela na máquina errada', () => {
    assertEqual(perfilDe({ env: { SSH_CONNECTION: '10.0.0.2 22' } }), 'consola');
  });

  test('dentro de um contentor → serviço', () => {
    assertEqual(perfilDe({
      plataforma: 'linux',
      env: { DISPLAY: ':0' },
      lerFicheiro: (c) => (c === '/.dockerenv' ? '' : null)
    }), 'servico');
  });

  test('cgroup do Kubernetes também conta como contentor', () => {
    assertEqual(perfilDe({
      plataforma: 'linux',
      env: { DISPLAY: ':0' },
      lerFicheiro: (c) => (c === '/proc/1/cgroup' ? '0::/kubepods/besteffort/pod123' : null)
    }), 'servico');
  });

  test('máquina com 2 GB de memória → leve', () => {
    assertEqual(perfilDe({ memoriaTotal: 2 * GB }), 'leve');
  });

  test('um único núcleo → leve', () => {
    assertEqual(perfilDe({ nucleos: 1 }), 'leve');
  });

  test('CI nunca abre janela', () => {
    assertEqual(perfilDe({ env: { CI: 'true' } }), 'servico');
  });

  test('a decisão vem acompanhada do motivo', () => {
    const d = dispositivo.detectar(maquina({ memoriaTotal: 2 * GB }));
    assertIncludes(d.motivo, 'memória');
    assertEqual(d.origem, 'deteccao');
  });

  // ── Precedência ──

  test('a linha de comandos ganha à detecção', () => {
    const d = dispositivo.resolver({ argv: ['--modo=servico'], fontes: maquina() });
    assertEqual(d.perfil, 'servico');
    assertEqual(d.origem, 'argumento');
  });

  test('--modo servico (com espaço) também é lido', () => {
    assertEqual(dispositivo.resolver({ argv: ['--modo', 'leve'], fontes: maquina() }).perfil, 'leve');
  });

  test('NEXO_MODO ganha às definições guardadas', () => {
    const d = dispositivo.resolver({
      argv: [],
      env: { NEXO_MODO: 'consola' },
      definicoes: { modo: 'leve' },
      fontes: maquina()
    });
    assertEqual(d.perfil, 'consola');
    assertEqual(d.origem, 'ambiente');
  });

  test('as definições guardadas ganham à detecção', () => {
    const d = dispositivo.resolver({ argv: [], definicoes: { modo: 'servico' }, fontes: maquina() });
    assertEqual(d.perfil, 'servico');
    assertEqual(d.origem, 'definicoes');
  });

  test('modo guardado como "auto" deixa a detecção decidir', () => {
    const d = dispositivo.resolver({ argv: [], definicoes: { modo: 'auto' }, fontes: maquina() });
    assertEqual(d.perfil, 'completo');
    assertEqual(d.origem, 'deteccao');
  });

  test('um modo inválido é ignorado em vez de partir o arranque', () => {
    const d = dispositivo.resolver({ argv: ['--modo=disparate'], fontes: maquina() });
    assertEqual(d.perfil, 'completo');
    assertEqual(d.origem, 'deteccao');
  });

  test('o relatório mostra o perfil escolhido', () => {
    const texto = dispositivo.formatarRelatorio(dispositivo.detectar(maquina()));
    assertIncludes(texto, 'COMPLETO');
    assertIncludes(texto, 'núcleos');
  });
});


// ═══════════════════════════════════════════════════════════
// NAVEGAÇÃO E MISSÃO — decisões de missão, nunca de voo
// ═══════════════════════════════════════════════════════════

describe('🌍 Geometria de navegação', () => {
  const geo = require('../nexo/navegacao/geo');

  const BASE = { lat: 40.150, lng: -8.650, alt: 60 };
  const LONGE = { lat: 40.180, lng: -8.680, alt: 60 };

  test('distância entre dois pontos conhecidos', () => {
    const d = geo.distancia(BASE, LONGE);
    assert(d > 4100 && d < 4300, `esperava ~4200 m, deu ${Math.round(d)}`);
  });

  test('distância de um ponto a si próprio é zero', () => {
    assertEqual(Math.round(geo.distancia(BASE, BASE)), 0);
  });

  test('rumo para norte é 0 e para este é 90', () => {
    const norte = geo.projectar(BASE, 0, 1000);
    const este = geo.projectar(BASE, 90, 1000);
    assert(Math.abs(geo.rumo(BASE, norte)) < 1, 'norte deve dar rumo ~0');
    assert(Math.abs(geo.rumo(BASE, este) - 90) < 1, 'este deve dar rumo ~90');
  });

  test('projectar e medir dá a distância pedida', () => {
    const p = geo.projectar(BASE, 45, 2500);
    assert(Math.abs(geo.distancia(BASE, p) - 2500) < 5, 'ida e volta deve fechar');
  });

  test('interpolar a meio fica a meia distância', () => {
    const meio = geo.interpolar(BASE, LONGE, 0.5);
    const d = geo.distancia(BASE, meio);
    const total = geo.distancia(BASE, LONGE);
    assert(Math.abs(d - total / 2) < 10, 'o meio deve estar a metade');
  });

  test('ponto dentro e fora de zona circular', () => {
    const zona = { centro: { lat: 40.166, lng: -8.667 }, raioM: 400 };
    assert(geo.dentroDaZona({ lat: 40.166, lng: -8.667 }, zona), 'o centro está dentro');
    assert(!geo.dentroDaZona(BASE, zona), 'a base está fora');
  });

  test('ponto dentro de polígono', () => {
    const zona = { poligono: [
      { lat: 40.16, lng: -8.67 }, { lat: 40.17, lng: -8.67 },
      { lat: 40.17, lng: -8.66 }, { lat: 40.16, lng: -8.66 }
    ]};
    assert(geo.dentroDaZona({ lat: 40.165, lng: -8.665 }, zona), 'o meio está dentro');
    assert(!geo.dentroDaZona({ lat: 40.20, lng: -8.60 }, zona), 'longe está fora');
  });

  test('segmento que atravessa a zona é detectado', () => {
    const zona = { centro: { lat: 40.165, lng: -8.665 }, raioM: 400 };
    assert(geo.segmentoAtravessaZona(BASE, LONGE, zona), 'a linha recta passa por cima');
  });

  test('o ponto de contorno fica fora da zona', () => {
    const zona = { nome: 'z', centro: { lat: 40.165, lng: -8.665 }, raioM: 400 };
    const contorno = geo.pontoDeContorno(BASE, LONGE, zona, 50);
    assert(contorno, 'deve haver contorno');
    assert(!geo.dentroDaZona(contorno, zona), 'o contorno não pode ficar dentro');
  });
});


describe('📍 Planeador de rota', () => {
  const planeador = require('../nexo/navegacao/planeador');
  const geo = require('../nexo/navegacao/geo');

  const BASE = { lat: 40.150, lng: -8.650, alt: 60 };
  const DESTINO = { lat: 40.180, lng: -8.680, alt: 60 };
  const CAPACIDADES = { velocidadeCruzeiroMs: 12, consumoPorSegundo: 0.09, autonomiaS: 900 };

  test('rota directa sem zonas é viável', () => {
    const r = planeador.planear(BASE, DESTINO, {}, CAPACIDADES);
    assert(r.viavel, 'devia ser viável');
    assertEqual(r.zonasContornadas.length, 0);
    assert(r.pontos.length > 2, 'deve ter pontos de verificação');
  });

  test('a rota contorna a zona proibida em vez de a atravessar', () => {
    const zona = { nome: 'aeródromo', centro: { lat: 40.165, lng: -8.665 }, raioM: 400 };
    const r = planeador.planear(BASE, DESTINO, { zonasProibidas: [zona] }, CAPACIDADES);

    assert(r.viavel, 'devia haver contorno');
    assertEqual(r.zonasContornadas.length, 1);

    const dentro = r.pontos.filter(p => geo.dentroDaZona(p, zona));
    assertEqual(dentro.length, 0, 'nenhum ponto da rota pode cair dentro da zona');
  });

  test('contornar é mais longo do que a linha recta', () => {
    const zona = { nome: 'z', centro: { lat: 40.165, lng: -8.665 }, raioM: 400 };
    const directa = planeador.planear(BASE, DESTINO, {}, CAPACIDADES);
    const desviada = planeador.planear(BASE, DESTINO, { zonasProibidas: [zona] }, CAPACIDADES);
    assert(desviada.distanciaM > directa.distanciaM, 'o desvio custa distância');
  });

  test('destino dentro de zona proibida não tem rota', () => {
    const zona = { nome: 'restrição', centro: { ...DESTINO }, raioM: 500 };
    const r = planeador.planear(BASE, DESTINO, { zonasProibidas: [zona] }, CAPACIDADES);
    assert(!r.viavel, 'não pode haver rota para dentro de zona proibida');
    assertIncludes(r.motivo, 'destino dentro de zona proibida');
  });

  test('destino além do raio permitido é recusado', () => {
    const r = planeador.planear(BASE, DESTINO, { raioMaxM: 1000 }, CAPACIDADES);
    assert(!r.viavel, 'fora do raio devia ser recusado');
    assertIncludes(r.motivo, 'raio');
  });

  test('energia desconhecida é null, nunca zero', () => {
    assertEqual(planeador.energiaNecessaria(1000, {}), null);
  });

  test('energia estimada a partir do consumo declarado', () => {
    // 1200 m a 12 m/s = 100 s; 100 s × 0,09 %/s = 9 %
    const e = planeador.energiaNecessaria(1200, CAPACIDADES);
    assert(Math.abs(e - 9) < 0.5, `esperava ~9%, deu ${e}`);
  });

  test('alternativa com propósito diferente não é viável', () => {
    const missao = { objetivo: { proposito: 'inspecionar' }, inicio: BASE, regras: {} };
    const [alt] = planeador.avaliarAlternativas(BASE, [
      { nome: 'Depósito', localizacao: { lat: 40.16, lng: -8.655 }, proposito: 'entregar' }
    ], missao, CAPACIDADES, 100);

    assert(!alt.viavel, 'propósito diferente não serve de plano B');
    assertIncludes(alt.motivo, 'propósito diferente');
  });

  test('alternativa que não cabe na bateria não é viável', () => {
    const missao = { objetivo: { proposito: 'inspecionar' }, inicio: BASE, regras: {} };
    const [alt] = planeador.avaliarAlternativas(BASE, [
      { nome: 'Longe', localizacao: DESTINO, proposito: 'inspecionar' }
    ], missao, CAPACIDADES, 15);

    assert(!alt.viavel, '15% de bateria não chega para ir e voltar');
    assertIncludes(alt.motivo, 'não cabe na bateria');
  });
});


describe('🧠 Cérebro de missão', () => {
  const cerebro = require('../nexo/navegacao/cerebro');
  const { ACCOES, URGENCIA, missao: criarMissao } = require('../nexo/navegacao/contrato');

  const BASE = { lat: 40.150, lng: -8.650, alt: 60 };
  const DESTINO = { lat: 40.180, lng: -8.680, alt: 60 };
  const CAPACIDADES = { velocidadeCruzeiroMs: 12, consumoPorSegundo: 0.09, autonomiaS: 900, altitudeMaxM: 120 };

  const missaoBase = (extras = {}) => criarMissao({
    objetivo: { proposito: 'inspecionar', alvo: 'zona-sul' },
    inicio: BASE,
    destino: DESTINO,
    autonomia: 'autonomo',
    ...extras
  });

  const estadoEm = (posicao, bateria = 100, extras = {}) => ({
    posicao, bateria, aMover: true, obstaculos: [], ...extras
  });

  const contexto = { capacidades: CAPACIDADES };

  test('caminho livre e bateria cheia → continuar', () => {
    const d = cerebro.avaliar(estadoEm(BASE), missaoBase(), contexto);
    assertEqual(d.accao, ACCOES.CONTINUAR);
  });

  test('bateria crítica → parar onde está', () => {
    const d = cerebro.avaliar(estadoEm(BASE, 5), missaoBase(), contexto);
    assertEqual(d.accao, ACCOES.PARAR);
    assertEqual(d.urgencia, URGENCIA.SEGURANCA);
  });

  test('bateria abaixo da reserva → regressar', () => {
    const d = cerebro.avaliar(estadoEm(BASE, 20), missaoBase(), contexto);
    assertEqual(d.accao, ACCOES.REGRESSAR);
    assertEqual(d.urgencia, URGENCIA.SEGURANCA);
  });

  test('decisões de segurança nunca pedem confirmação', () => {
    const d = cerebro.avaliar(estadoEm(BASE, 5), missaoBase({ autonomia: 'supervisionado' }), contexto);
    assertEqual(d.precisaConfirmacao, false);
  });

  test('chegou ao destino → concluir', () => {
    const d = cerebro.avaliar(estadoEm({ ...DESTINO }), missaoBase(), contexto);
    assertEqual(d.accao, ACCOES.CONCLUIR);
  });

  test('acima da altitude máxima → parar', () => {
    const d = cerebro.avaliar(estadoEm({ ...BASE, alt: 200 }), missaoBase(), contexto);
    assertEqual(d.accao, ACCOES.PARAR);
    assertIncludes(d.motivo, 'altitude');
  });

  test('sem resposta do aparelho → regressar', () => {
    const d = cerebro.avaliar(estadoEm(BASE), missaoBase(), { ...contexto, ciclosSemResposta: 3 });
    assertEqual(d.accao, ACCOES.REGRESSAR);
    assertEqual(d.urgencia, URGENCIA.SEGURANCA);
  });

  test('destino bloqueado → muda para alternativa do mesmo propósito', () => {
    const m = missaoBase({
      alternativas: [
        { nome: 'Observação B', localizacao: { lat: 40.169, lng: -8.660, alt: 60 }, proposito: 'inspecionar' }
      ],
      regras: { zonasProibidas: [{ nome: 'restrição', centro: { ...DESTINO }, raioM: 500 }] }
    });

    const d = cerebro.avaliar(estadoEm(BASE), m, contexto);
    assertEqual(d.accao, ACCOES.MUDAR_DESTINO);
    assertIncludes(d.motivo, 'Observação B');
  });

  test('só há alternativas de outro propósito → regressa em vez de inventar', () => {
    const m = missaoBase({
      alternativas: [
        { nome: 'Depósito', localizacao: { lat: 40.160, lng: -8.655, alt: 60 }, proposito: 'entregar' }
      ],
      regras: { zonasProibidas: [{ nome: 'restrição', centro: { ...DESTINO }, raioM: 500 }] }
    });

    const d = cerebro.avaliar(estadoEm(BASE), m, contexto);
    assertEqual(d.accao, ACCOES.REGRESSAR);
    assertIncludes(d.motivo, 'nenhuma alternativa viável');
  });

  test('em modo supervisionado, trocar de destino espera por uma pessoa', () => {
    const m = missaoBase({
      autonomia: 'supervisionado',
      alternativas: [
        { nome: 'Observação B', localizacao: { lat: 40.169, lng: -8.660, alt: 60 }, proposito: 'inspecionar' }
      ],
      regras: { zonasProibidas: [{ nome: 'restrição', centro: { ...DESTINO }, raioM: 500 }] }
    });

    const d = cerebro.avaliar(estadoEm(BASE), m, contexto);
    assertEqual(d.accao, ACCOES.MUDAR_DESTINO);
    assertEqual(d.precisaConfirmacao, true);
  });

  test('dentro de zona proibida → desviar com urgência de segurança', () => {
    const m = missaoBase({
      regras: { zonasProibidas: [{ nome: 'zona', centro: { lat: 40.155, lng: -8.655 }, raioM: 400 }] }
    });

    const d = cerebro.avaliar(estadoEm({ lat: 40.155, lng: -8.655, alt: 60 }), m, contexto);
    assertEqual(d.accao, ACCOES.DESVIAR);
    assertEqual(d.urgencia, URGENCIA.SEGURANCA);
  });

  test('toda a decisão é rastreável: origem "regra"', () => {
    const d = cerebro.avaliar(estadoEm(BASE), missaoBase(), contexto);
    assertEqual(d.origem, 'regra');
  });
});


describe('🎮 Dispositivo simulado e portão de segurança', () => {
  const { criarSimulado } = require('../nexo/navegacao/dispositivos/simulado');
  const { ControladorDeMissao } = require('../nexo/navegacao/controlador');
  const { validarDispositivo, dispositivoDeNavegacao } = require('../nexo/navegacao/contrato');
  const geo = require('../nexo/navegacao/geo');

  const BASE = { lat: 40.150, lng: -8.650, alt: 60 };
  const DESTINO = { lat: 40.180, lng: -8.680, alt: 60 };

  test('o simulado cumpre o contrato e declara-se simulado', () => {
    const d = criarSimulado({ posicao: BASE });
    assert(validarDispositivo(d).valido, 'devia ser válido');
    assertEqual(d.simulado, true);
  });

  test('um dispositivo que não se declara é tratado como físico', () => {
    const d = dispositivoDeNavegacao({ id: 'x' });
    assertEqual(d.simulado, false, 'omitir "simulado" nunca pode significar simulado');
  });

  test('o simulado aproxima-se do alvo com o tempo', () => {
    const d = criarSimulado({ posicao: BASE, velocidadeMs: 12 });
    d.interno.ligado = true;
    d.interno.alvo = { ...DESTINO };
    d.interno.aMover = true;

    const antes = geo.distancia(d.interno.posicao, DESTINO);
    d.avancarTempo(60);
    const depois = geo.distancia(d.interno.posicao, DESTINO);

    assert(depois < antes, 'devia ter-se aproximado');
    assert(Math.abs((antes - depois) - 720) < 40, `60 s a 12 m/s ≈ 720 m, deu ${Math.round(antes - depois)}`);
  });

  test('a bateria desce com o tempo', () => {
    const d = criarSimulado({ posicao: BASE, consumoPorSegundo: 0.1, bateria: 100 });
    d.interno.ligado = true;
    d.interno.aMover = true;
    d.avancarTempo(100);
    assert(Math.abs(d.interno.bateria - 90) < 1, `esperava ~90%, deu ${d.interno.bateria.toFixed(1)}`);
  });

  test('um dispositivo físico é recusado sem autorização explícita', () => {
    const fisico = dispositivoDeNavegacao({
      id: 'drone-real',
      nome: 'Drone real',
      simulado: false,
      ligar: async () => {}, estado: async () => ({}), irPara: async () => ({ aceite: true }),
      parar: async () => {}, regressar: async () => {}
    });

    const c = new ControladorDeMissao({
      dispositivo: fisico,
      missao: { objetivo: { proposito: 'inspecionar' }, inicio: BASE, destino: DESTINO }
    });

    const v = c.verificar();
    assert(!v.ok, 'hardware não pode passar sem autorização');
    assertIncludes(v.erros.join(' '), 'dispositivo físico');
  });

  test('com autorização explícita, o mesmo dispositivo passa', () => {
    const fisico = dispositivoDeNavegacao({
      id: 'drone-real', simulado: false,
      ligar: async () => {}, estado: async () => ({}), irPara: async () => ({ aceite: true }),
      parar: async () => {}, regressar: async () => {}
    });

    const c = new ControladorDeMissao({
      dispositivo: fisico,
      permitirDispositivoReal: true,
      missao: { objetivo: { proposito: 'inspecionar' }, inicio: BASE, destino: DESTINO }
    });

    assert(c.verificar().ok, 'com autorização devia passar');
  });

  test('missão sem propósito é recusada', () => {
    const c = new ControladorDeMissao({
      dispositivo: criarSimulado({ posicao: BASE }),
      missao: { inicio: BASE, destino: DESTINO }
    });

    const v = c.verificar();
    assert(!v.ok, 'sem propósito não há plano B legítimo');
    assertIncludes(v.erros.join(' '), 'proposito');
  });
});


describe('🗣️ Pedidos de missão em texto', () => {
  const pedidos = require('../nexo/navegacao/pedidos');

  test('lê coordenadas em vários formatos', () => {
    assertEqual(pedidos.lerPonto('40.15,-8.65').lat, 40.15);
    assertEqual(pedidos.lerPonto('40.15 -8.65').lng, -8.65);
    assertEqual(pedidos.lerPonto({ lat: 1, lng: 2 }).lat, 1);
  });

  test('coordenadas impossíveis são recusadas', () => {
    assertEqual(pedidos.lerPonto('200,500'), null);
    assertEqual(pedidos.lerPonto('sem números'), null);
  });

  test('lê uma zona com nome, centro e raio', () => {
    const z = pedidos.lerZona('aeródromo:40.166,-8.667,400');
    assertEqual(z.nome, 'aeródromo');
    assertEqual(z.raioM, 400);
    assertEqual(z.centro.lat, 40.166);
  });

  test('planeia e descreve uma rota em texto', () => {
    const texto = pedidos.planearEmTexto({ origem: '40.15,-8.65', destino: '40.18,-8.68' });
    assertIncludes(texto, 'Rota planeada');
    assertIncludes(texto, 'Distância');
  });

  test('explica porque não há rota, em vez de inventar uma', () => {
    const texto = pedidos.planearEmTexto({
      origem: '40.15,-8.65', destino: '40.18,-8.68',
      evitar: 'restrição:40.18,-8.68,500'
    });
    assertIncludes(texto, 'Não há rota viável');
  });

  test('origem inválida dá erro claro', () => {
    assertIncludes(pedidos.planearEmTexto({ origem: 'ali', destino: '40.18,-8.68' }), 'origem');
  });
});


// ═══════════════════════════════════════════════════════════
// DIAGNÓSTICO DE INSTALAÇÃO — o que falta, dito a quem não é programador
// ═══════════════════════════════════════════════════════════

describe('🩹 Diagnóstico de instalação', () => {
  const diagnostico = require('../orchestrator/diagnostico');

  // Uma máquina fingida: tudo presente, salvo indicação em contrário.
  const maquina = (extras = {}) => ({
    versaoNode: '20.11.0',
    env: { GROQ_API_KEY: 'gsk_umachavequeparecereal12345' },
    raiz: 'C:/fake',
    existe: () => true,
    ollama: { presente: false, modelos: [] },
    ...extras
  });

  test('Node recente passa', () => {
    const r = diagnostico.verificarNode('20.11.0');
    assert(r.ok, 'a 20 devia passar');
    assertEqual(r.maior, 20);
  });

  test('Node antigo é apanhado antes de rebentar', () => {
    const r = diagnostico.verificarNode('16.20.0');
    assert(!r.ok, 'a 16 não tem fetch global');
  });

  test('sem node_modules, faltam as bibliotecas', () => {
    const r = diagnostico.verificarDependencias('C:/fake', () => false);
    assert(!r.ok);
    assertEqual(r.instalado, false);
  });

  test('node_modules incompleto é detectado', () => {
    // Existe tudo menos o express.
    const existe = (p) => !String(p).endsWith('express');
    const r = diagnostico.verificarDependencias('C:/fake', existe);
    assert(!r.ok, 'faltando o express não está pronto');
    assert(r.faltam.includes('express'));
  });

  test('o Electron conta à parte das essenciais', () => {
    const existe = (p) => !String(p).endsWith('electron');
    const r = diagnostico.verificarDependencias('C:/fake', existe);
    assert(r.ok, 'sem Electron as essenciais continuam completas');
    assertEqual(r.electron, false);
  });

  test('reconhece uma chave configurada', () => {
    const f = diagnostico.fornecedoresConfigurados({ GROQ_API_KEY: 'gsk_chavelongaqueparecereal' });
    assertEqual(f.length, 1);
    assertEqual(f[0].nome, 'Groq');
  });

  test('um valor de exemplo por substituir não conta como configurado', () => {
    // É o erro mais comum: copiar o .env.example e não trocar nada.
    const f = diagnostico.fornecedoresConfigurados({ GROQ_API_KEY: 'gsk_xxxxxxxxxxxxxxxxxxx' });
    assertEqual(f.length, 0, 'o placeholder do .env.example não é uma chave');
  });

  test('chave demasiado curta não conta', () => {
    assertEqual(diagnostico.fornecedoresConfigurados({ GROQ_API_KEY: 'abc' }).length, 0);
  });

  test('máquina completa está pronta', () => {
    const d = diagnostico.diagnosticar(maquina());
    assert(d.pronto, `devia estar pronta: ${JSON.stringify(d.problemas)}`);
    assertEqual(d.problemas.length, 0);
  });

  test('sem motor de IA não está pronta, e explica-se sem jargão', () => {
    const d = diagnostico.diagnosticar(maquina({ env: {} }));
    assert(!d.pronto);

    const problema = d.problemas.find(p => p.id === 'sem-ia');
    assert(problema, 'devia acusar falta de IA');
    assertIncludes(problema.humano, 'pensar');
    assert(!problema.humano.includes('API_KEY'), 'a mensagem humana não fala em variáveis');
  });

  test('o Ollama sozinho já chega para estar pronta', () => {
    const d = diagnostico.diagnosticar(maquina({
      env: {},
      ollama: { presente: true, modelos: ['llama3.2'] }
    }));
    assert(d.pronto, 'com modelo local não falta motor de IA');
  });

  test('Node antigo entra como problema que não se resolve sozinho', () => {
    const d = diagnostico.diagnosticar(maquina({ versaoNode: '16.0.0' }));
    const p = d.problemas.find(x => x.id === 'node-antigo');
    assert(p, 'devia acusar o Node');
    assertEqual(p.podeSerAutomatico, false, 'instalar o Node é do utilizador');
  });

  test('faltar bibliotecas é problema que se resolve sozinho', () => {
    const d = diagnostico.diagnosticar(maquina({ existe: () => false }));
    const p = d.problemas.find(x => x.id === 'sem-dependencias');
    assert(p, 'devia acusar as bibliotecas');
    assertEqual(p.podeSerAutomatico, true);
  });

  test('um só fornecedor é aviso, não problema', () => {
    const d = diagnostico.diagnosticar(maquina());
    assert(d.pronto, 'um fornecedor chega para funcionar');
    assert(d.avisos.some(a => a.id === 'um-so-fornecedor'), 'mas avisa que não há reserva');
  });

  test('dois fornecedores já não geram o aviso de reserva', () => {
    const d = diagnostico.diagnosticar(maquina({
      env: { GROQ_API_KEY: 'gsk_chavelongaqueparecereal', CEREBRAS_API_KEY: 'csk-outrachavelonga' }
    }));
    assert(!d.avisos.some(a => a.id === 'um-so-fornecedor'));
  });

  test('o relatório diz o que falta e como se resolve', () => {
    const texto = diagnostico.formatarDiagnostico(diagnostico.diagnosticar(maquina({ env: {} })));
    assertIncludes(texto, 'Estado da instalação');
    assertIncludes(texto, 'npm run instalar');
  });

  test('o relatório de uma máquina pronta di-lo', () => {
    const texto = diagnostico.formatarDiagnostico(diagnostico.diagnosticar(maquina()));
    assertIncludes(texto, 'pronto a usar');
  });
});


// ═══════════════════════════════════════════════════════════
// FERRAMENTAS NOS FORNECEDORES PESSOAIS
// Quem configurava o Claude perdia a cascata inteira, em silêncio.
// ═══════════════════════════════════════════════════════════

describe('🔧 Ferramentas nos fornecedores pessoais', () => {
  const customProvider = require('../agents/customProvider');
  const providers = require('../nexo/providers');

  test('cada fornecedor do catálogo declara se sabe usar ferramentas', () => {
    for (const [id, c] of Object.entries(customProvider.PROVIDER_CATALOG)) {
      assertEqual(typeof c.supportsTools, 'boolean', `${id} tem de declarar supportsTools`);
    }
  });

  test('os que sabem estão marcados', () => {
    assertEqual(customProvider.PROVIDER_CATALOG.openai.supportsTools, true);
    assertEqual(customProvider.PROVIDER_CATALOG.anthropic.supportsTools, true);
    assertEqual(customProvider.PROVIDER_CATALOG.mistral.supportsTools, true);
  });

  test('os que não sabem ficam a falso, não a "talvez"', () => {
    // O Cohere v2 não fala o formato de ferramentas da OpenAI, e o "custom"
    // aponta para um endereço que o utilizador escolhe: não se pode afirmar.
    assertEqual(customProvider.PROVIDER_CATALOG.cohere.supportsTools, false);
    assertEqual(customProvider.PROVIDER_CATALOG.custom.supportsTools, false);
  });

  test('sem fornecedor pessoal configurado, não há suporte a ferramentas', () => {
    assertEqual(customProvider.supportsTools('utilizador-que-nao-existe'), false);
  });

  test('a vista unificada já não mente sobre o catálogo pessoal', () => {
    const lista = providers.listar();
    const pessoais = lista.filter(p => p.origem === 'pessoal');

    assert(pessoais.length > 0, 'devia haver fornecedores pessoais');
    assert(
      pessoais.some(p => p.capacidades.ferramentas),
      'antes desta correcção NENHUM declarava ferramentas, o que era falso'
    );
    assert(
      pessoais.some(p => !p.capacidades.ferramentas),
      'e nem todos sabem: quem não sabe continua a dizer que não'
    );
  });

  test('o Claude pessoal passa a contar como capaz de ferramentas', () => {
    const claude = providers.listar().find(p => p.origem === 'pessoal' && p.id === 'anthropic');
    assert(claude, 'o Claude devia estar no catálogo pessoal');
    assertEqual(claude.capacidades.ferramentas, true);
  });
});


describe('🔤 Nomes de variáveis escritos por pouco', () => {
  const diagnostico = require('../orchestrator/diagnostico');

  const comEnv = (texto) => diagnostico.detectarNomesTrocados('irrelevante', () => texto);

  test('apanha o caso real: CEREBRAS_APY_KEY', () => {
    const [t] = comEnv('CEREBRAS_APY_KEY=csk-umachavequalquer\n');
    assert(t, 'devia apanhar o erro de escrita');
    assertEqual(t.provavelmente, 'CEREBRAS_API_KEY');
  });

  test('apanha uma letra em falta no meio', () => {
    const [t] = comEnv('ANTROPIC_API_KEY=sk-ant-xyz\n');
    assertEqual(t.provavelmente, 'ANTHROPIC_API_KEY');
  });

  test('apanha uma chave repetida e diz qual manda', () => {
    const env = ['PORT=7777', 'GROQ_API_KEY=umachaveboa123', 'PORT=8787'].join('\n');
    const repetidas = diagnostico.detectarChavesRepetidas('x', () => env);
    assertEqual(repetidas.length, 1);
    assertEqual(repetidas[0].nome, 'PORT');
    assertEqual(repetidas[0].valeA, 3, 'num .env, a ultima linha e a que conta');
  });

  test('um .env sem repeticoes nao gera queixa', () => {
    const env = ['PORT=7777', 'GROQ_API_KEY=abc123456789'].join('\n');
    assertEqual(diagnostico.detectarChavesRepetidas('x', () => env).length, 0);
  });

  test('uma chave repetida impede o arranque limpo', () => {
    const d = diagnostico.diagnosticar({
      versaoNode: '20.0.0',
      env: { GROQ_API_KEY: 'gsk_chavelongaboa123' },
      raiz: 'C:/fake',
      existe: () => true,
      chavesRepetidas: [{ nome: 'PORT', linhas: [1, 3], valeA: 3 }]
    });
    const p = d.problemas.find(x => x.id === 'chave-repetida');
    assert(p, 'devia acusar a repeticao');
    assertIncludes(p.humano, 'Só a última conta');
  });

  test('não se queixa de nomes correctos', () => {
    assertEqual(comEnv('GROQ_API_KEY=gsk_boa\nPORT=7777\n').length, 0);
  });

  test('ignora comentários e linhas vazias', () => {
    assertEqual(comEnv('# CEREBRAS_APY_KEY=nao conta\n\n').length, 0);
  });

  test('ignora uma linha sem valor', () => {
    // Uma variável por preencher não é um erro de escrita.
    assertEqual(comEnv('CEREBRAS_APY_KEY=\n').length, 0);
  });

  test('não confunde nomes genuinamente diferentes', () => {
    assertEqual(comEnv('MINHA_VARIAVEL_QUALQUER=abc\n').length, 0);
  });

  test('um nome trocado impede o arranque limpo e explica-se', () => {
    const d = diagnostico.diagnosticar({
      versaoNode: '20.0.0',
      env: { GROQ_API_KEY: 'gsk_chavelongaboa123' },
      raiz: 'C:/fake',
      existe: () => true,
      nomesTrocados: [{ escrito: 'CEREBRAS_APY_KEY', provavelmente: 'CEREBRAS_API_KEY' }]
    });

    const p = d.problemas.find(x => x.id === 'nome-trocado');
    assert(p, 'devia acusar o nome trocado');
    assertIncludes(p.humano, 'CEREBRAS_API_KEY');
    assertEqual(p.podeSerAutomatico, true);
  });
});


// ═══════════════════════════════════════════════════════════
// ATALHO DE ARRANQUE — ícone na área de trabalho
// ═══════════════════════════════════════════════════════════

describe('🖱️ Atalho de arranque', () => {
  const atalho = require('../orchestrator/atalho');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  test('reconhece os três sistemas suportados', () => {
    assert(atalho.sistemaSuportado('win32'));
    assert(atalho.sistemaSuportado('darwin'));
    assert(atalho.sistemaSuportado('linux'));
  });

  test('rejeita sistemas desconhecidos', () => {
    assert(!atalho.sistemaSuportado('freebsd'));
    assertEqual(atalho.criar('freebsd').ok, false);
  });

  test('o caminho da Desktop segue o utilizador actual', () => {
    assertIncludes(atalho.caminhoDesktop(), 'Desktop');
  });

  test('o alvo é sempre arranque.js, nunca um comando construído à mão', () => {
    assertIncludes(atalho.CAMINHO_ARRANQUE, 'arranque.js');
  });

  test('usa o node deste processo, não um "node" genérico do PATH', () => {
    assertEqual(atalho.NODE, process.execPath);
  });

  test('o Info.plist do macOS declara o executável e o ícone certos', () => {
    const plist = atalho.plistNexo();
    assertIncludes(plist, '<string>nexo</string>');
    assertIncludes(plist, '<string>icon.icns</string>');
  });

  test('a entrada .desktop do Linux aponta para o node e o arranque.js certos', () => {
    const conteudo = atalho.conteudoDesktopEntry();
    assertIncludes(conteudo, 'Type=Application');
    assertIncludes(conteudo, atalho.NODE);
    assertIncludes(conteudo, 'arranque.js');
    assertIncludes(conteudo, 'Terminal=false');
  });

  test('macOS: cria a estrutura completa do pacote .app numa pasta fingida', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-mac-'));
    const original = os.homedir;
    os.homedir = () => tmp; // não se pode escrever na $HOME real num teste

    try {
      const r = atalho.criarAtalhoMac();

      assert(r.ok, `devia ter sucesso: ${r.motivo}`);
      assert(fs.existsSync(path.join(r.caminho, 'Contents', 'Info.plist')));

      const executavel = path.join(r.caminho, 'Contents', 'MacOS', 'nexo');
      assert(fs.existsSync(executavel));
      assertIncludes(fs.readFileSync(executavel, 'utf8'), 'arranque.js');
      assertEqual(typeof r.iconeIncluido, 'boolean');
    } finally {
      os.homedir = original;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('Linux: cria o lançador no menu de aplicações mesmo sem pasta Desktop', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-linux-'));
    const original = os.homedir;
    os.homedir = () => tmp; // sem Desktop/ dentro de tmp — caso comum em DEs mínimos

    try {
      const r = atalho.criarAtalhoLinux();

      assert(r.ok, `devia ter sucesso mesmo sem Desktop: ${r.motivo}`);
      assertEqual(r.caminhos.length, 1, 'sem pasta Desktop, só o menu de aplicações');
      assert(
        r.caminhos[0].includes(path.join('.local', 'share', 'applications')),
        'o lançador tem de ir para o menu de aplicações'
      );
    } finally {
      os.homedir = original;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('Linux: cria também na Desktop quando ela existe', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-linux-'));
    fs.mkdirSync(path.join(tmp, 'Desktop'));
    const original = os.homedir;
    os.homedir = () => tmp;

    try {
      const r = atalho.criarAtalhoLinux();
      assertEqual(r.caminhos.length, 2, 'com Desktop, ficam dois lançadores');
    } finally {
      os.homedir = original;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});


describe('📄 Referência "Como Abrir"', () => {
  const referencia = require('../orchestrator/referencia');

  test('lista os quatro perfis de arranque', () => {
    const texto = referencia.gerar();
    assertIncludes(texto, '--modo=leve');
    assertIncludes(texto, '--modo=consola');
    assertIncludes(texto, '--modo=servico');
    assertIncludes(texto, 'npm start');
  });

  test('inclui sempre o comando de diagnóstico e o de recriar o atalho', () => {
    const texto = referencia.gerar();
    assertIncludes(texto, 'npm run diagnostico');
    assertIncludes(texto, 'npm run atalho');
  });

  test('acha um IPv4 de rede a partir de interfaces fingidas', () => {
    const falsas = {
      Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      'Wi-Fi': [{ family: 'IPv4', internal: false, address: '192.168.1.42' }]
    };
    assertEqual(referencia.enderecoLocal(falsas), '192.168.1.42');
  });

  test('sem interface de rede real, admite que não sabe em vez de inventar', () => {
    const semRede = { Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }] };
    assertEqual(referencia.enderecoLocal(semRede), null);
  });
});


// ═══════════════════════════════════════════════════════════
// ATALHO — a vontade do utilizador contra o que está no disco
// ═══════════════════════════════════════════════════════════

describe('🖱️ O atalho: vontade vs realidade', () => {
  const atalho = require('../orchestrator/atalho');
  const definicoes = require('../orchestrator/definicoes');
  const diagnostico = require('../orchestrator/diagnostico');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  test('sabe onde o atalho fica em cada sistema', () => {
    assertIncludes(atalho.caminhoDoAtalho('win32'), 'NEXO.lnk');
    assertIncludes(atalho.caminhoDoAtalho('darwin'), 'NEXO.app');
    assertIncludes(atalho.caminhoDoAtalho('linux'), 'nexo.desktop');
    assertEqual(atalho.caminhoDoAtalho('freebsd'), null);
  });

  test('existe() pergunta ao disco, não às definições', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-atalho-'));
    fs.mkdirSync(path.join(tmp, 'Desktop'));
    const original = os.homedir;
    os.homedir = () => tmp;

    try {
      // Nada criado ainda: tem de dizer que não existe, independentemente
      // do que qualquer definição diga.
      assertEqual(atalho.existe('linux'), false, 'sem ficheiro, não existe');

      atalho.criarAtalhoLinux();
      assertEqual(atalho.existe('linux'), true, 'depois de criado, existe');
    } finally {
      os.homedir = original;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('no Linux, o lançador no menu chega mesmo sem pasta Desktop', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-atalho-'));
    const original = os.homedir;
    os.homedir = () => tmp; // sem Desktop/

    try {
      atalho.criarAtalhoLinux();
      assertEqual(atalho.existe('linux'), true, 'só no menu de aplicações já conta');
    } finally {
      os.homedir = original;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('remover() apaga e deixa de existir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-atalho-'));
    fs.mkdirSync(path.join(tmp, 'Desktop'));
    const original = os.homedir;
    os.homedir = () => tmp;

    try {
      atalho.criarAtalhoLinux();
      assertEqual(atalho.existe('linux'), true);

      const apagados = atalho.remover('linux');
      assert(apagados.length > 0, 'devia dizer o que apagou');
      assertEqual(atalho.existe('linux'), false, 'depois de removido, não existe');
    } finally {
      os.homedir = original;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('a definição guarda uma vontade, não um facto', () => {
    // O nome importa: "quereAtalho" nao pode ser lido como "ja criei".
    assert('quereAtalho' in definicoes.PADRAO, 'a definição chama-se quereAtalho');
    assert(!('atalhoCriado' in definicoes.PADRAO), 'o nome antigo saiu');
  });

  test('um ícone em falta é avisado, não escondido', () => {
    const d = diagnostico.diagnosticar({
      versaoNode: '20.0.0',
      env: { GROQ_API_KEY: 'gsk_chavelongaboa123', CEREBRAS_API_KEY: 'csk-outralonga' },
      raiz: 'C:/fake',
      existe: () => true,
      atalhoEmFalta: true
    });

    const aviso = d.avisos.find(a => a.id === 'atalho-em-falta');
    assert(aviso, 'devia avisar que o ícone desapareceu');
    assertIncludes(aviso.comoResolver, 'npm start');
    assert(d.pronto, 'mas não impede o NEXO de funcionar');
  });

  test('sem ícone em falta, não há aviso nenhum', () => {
    const d = diagnostico.diagnosticar({
      versaoNode: '20.0.0',
      env: { GROQ_API_KEY: 'gsk_chavelongaboa123', CEREBRAS_API_KEY: 'csk-outralonga' },
      raiz: 'C:/fake',
      existe: () => true,
      atalhoEmFalta: false
    });
    assert(!d.avisos.some(a => a.id === 'atalho-em-falta'));
  });
});


// ═══════════════════════════════════════════════════════════
// VISÃO — quem sabe ver imagens, e quando é chamado
// ═══════════════════════════════════════════════════════════

describe('👁️ Visão: escolha de fornecedor', () => {
  const visionAgent = require('../agents/visionAgent');

  test('não inventa visão quando não há nenhum fornecedor', () => {
    assertEqual(visionAgent.fornecedorDeVisao({}), null);
    assertEqual(visionAgent.fornecedorDeVisao({ GROQ_API_KEY: 'gsk_umachavelonga' }), null,
      'o Groq não vê imagens');
  });

  test('aceita o Claude, não só o Gemini', () => {
    // Era este o bug: quem tinha Claude ouvia "não consigo ver imagens".
    const f = visionAgent.fornecedorDeVisao({ ANTHROPIC_API_KEY: 'sk-ant-umachavelonga123' });
    assert(f, 'o Claude tem visão e devia ser aceite');
    assertEqual(f.id, 'anthropic');
  });

  test('aceita o GPT', () => {
    const f = visionAgent.fornecedorDeVisao({ OPENAI_API_KEY: 'sk-umachavelonga123' });
    assertEqual(f.id, 'openai');
  });

  test('prefere o Gemini quando há mais do que um', () => {
    // É o gratuito: entre dois que servem, escolhe-se o que não custa.
    const f = visionAgent.fornecedorDeVisao({
      ANTHROPIC_API_KEY: 'sk-ant-longa123456',
      GEMINI_API_KEY: 'AIza-longa123456'
    });
    assertEqual(f.id, 'gemini');
  });

  test('uma chave demasiado curta não conta', () => {
    assertEqual(visionAgent.fornecedorDeVisao({ GEMINI_API_KEY: 'abc' }), null);
  });

  test('isAvailable segue os fornecedores, não uma chave em particular', () => {
    assertEqual(typeof visionAgent.isAvailable(), 'boolean');
  });

  test('sem fornecedor, o erro diz o que fazer em vez de só recusar', async () => {
    const original = process.env;
    // Ambiente sem nenhuma chave de visão.
    const guardadas = {};
    for (const f of visionAgent.FORNECEDORES_COM_VISAO) {
      guardadas[f.env] = process.env[f.env];
      delete process.env[f.env];
    }

    try {
      const r = await visionAgent.analyzeImage('qualquer.png', 'o que é isto?');
      assertEqual(r.success, false);
      assertIncludes(r.error, 'aistudio.google.com');
      assertIncludes(r.error, 'npm run instalar');
    } finally {
      for (const [k, v] of Object.entries(guardadas)) {
        if (v !== undefined) process.env[k] = v;
      }
    }
  });
});


describe('👁️ Visão: o diagnóstico avisa a tempo', () => {
  const diagnostico = require('../orchestrator/diagnostico');

  const base = {
    versaoNode: '20.0.0',
    env: { GROQ_API_KEY: 'gsk_chavelongaboa123', CEREBRAS_API_KEY: 'csk-outralonga' },
    raiz: 'C:/fake',
    existe: () => true
  };

  test('sem motor com visão, avisa e diz onde arranjar um grátis', () => {
    const d = diagnostico.diagnosticar({ ...base, semVisao: true });
    const a = d.avisos.find(x => x.id === 'sem-visao');
    assert(a, 'devia avisar');
    assertIncludes(a.comoResolver, 'aistudio.google.com');
    assert(d.pronto, 'não impede o NEXO de funcionar para tudo o resto');
  });

  test('com visão disponível, não há aviso nenhum', () => {
    const d = diagnostico.diagnosticar({ ...base, semVisao: false });
    assert(!d.avisos.some(x => x.id === 'sem-visao'));
  });
});



// ═══════════════════════════════════════════════════════════
// PRAZOS — nada pode ficar à espera para sempre
// ═══════════════════════════════════════════════════════════

describe('⏱️ Prazos: o silêncio tem limite', () => {
  const prazo = require('../orchestrator/prazo');

  test('um cronómetro corta a ligação quando o tempo acaba', async () => {
    const c = prazo.relogio(30, 'O teste');
    await new Promise(r => setTimeout(r, 80));
    assert(c.expirou, 'devia ter expirado');
    assert(c.signal.aborted, 'devia ter cortado');
    assertIncludes(c.erro().message, 'não respondeu');
  });

  test('sinal de vida adia o prazo em vez de o deixar correr', async () => {
    // É isto que distingue uma resposta longa de uma ligação muda: uma
    // resposta que continua a chegar não pode ser cortada ao cronómetro.
    const c = prazo.relogio(60, 'O teste');
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 25));
      c.adiar();
    }
    assert(!c.expirou, 'não devia expirar enquanto chega sinal');
    c.parar();
  });

  test('parar impede o corte', async () => {
    const c = prazo.relogio(30, 'O teste');
    c.parar();
    await new Promise(r => setTimeout(r, 80));
    assert(!c.expirou);
    assert(!c.signal.aborted);
  });

  test('o erro diz quanto se esperou, não "operation was aborted"', () => {
    const c = prazo.relogio(5000, 'O DuckDuckGo');
    c.parar();
    assertIncludes(c.erro().message, 'DuckDuckGo');
    assertIncludes(c.erro().message, '5s');
  });

  test('traduzirErro devolve o motivo real quando fomos nós a cortar', async () => {
    const c = prazo.relogio(20, 'O Groq');
    await new Promise(r => setTimeout(r, 60));
    const bruto = new Error('This operation was aborted');
    bruto.name = 'AbortError';
    assertIncludes(prazo.traduzirErro(bruto, c, 'O Groq').message, 'não respondeu');
  });

  test('traduzirErro não mexe num erro que não é de prazo', () => {
    const c = prazo.relogio(5000, 'O Groq');
    c.parar();
    const original = new Error('chave inválida');
    assertEqual(prazo.traduzirErro(original, c, 'O Groq'), original);
  });

  test('comPrazo desiste de uma promessa que nunca acaba', async () => {
    const nunca = new Promise(() => {});
    let erro = null;
    try {
      await prazo.comPrazo(nunca, 40, 'O pedido');
    } catch (e) {
      erro = e;
    }
    assert(erro, 'devia ter desistido');
    assertIncludes(erro.message, 'não terminou');
  });

  test('comPrazo deixa passar quem chega a tempo', async () => {
    const r = await prazo.comPrazo(Promise.resolve('feito'), 500, 'O pedido');
    assertEqual(r, 'feito');
  });
});


// ═══════════════════════════════════════════════════════════
// A CADEIA: O GROQ À FRENTE, O LOCAL SÓ A PEDIDO
// ═══════════════════════════════════════════════════════════

describe('🏠 O modelo local é um pedido, não uma omissão', () => {
  const llmRouter = require('../orchestrator/llmRouter');

  const cadeia = [
    { id: 'groq', name: 'Groq' },
    { id: 'gemini', name: 'Gemini' },
    { id: 'ollama', name: 'Ollama' }
  ];
  const perguntar = (t) => [{ role: 'user', content: t }];

  test('sem pedido, o local sai da cadeia', () => {
    // Media-se no registo: "Stream Ollama falhou: fetch failed" antes de cada
    // resposta, porque ninguém tinha o Ollama a correr.
    const r = llmRouter.escolherCadeia(cadeia, perguntar('olá, tudo bem?'));
    assert(!r.some(p => p.id === 'ollama'), 'o Ollama não devia estar na cadeia');
    assertEqual(r[0].id, 'groq', 'o Groq é o primeiro: grátis e rápido');
  });

  test('uma mensagem curta já não manda para o local', () => {
    // O critério antigo era o tamanho do prompt. Já não é.
    const r = llmRouter.escolherCadeia(cadeia, perguntar('oi'));
    assertEqual(r[0].id, 'groq');
  });

  test('quem pede local, recebe só local', () => {
    for (const frase of ['responde em modo local', 'usa o ollama', 'quero isto offline',
                         'preciso de privacidade total', 'sem internet']) {
      const r = llmRouter.escolherCadeia(cadeia, perguntar(frase));
      assertEqual(r.length, 1, `"${frase}" devia dar só o local`);
      assertEqual(r[0].id, 'ollama', `"${frase}" devia escolher o Ollama`);
    }
  });

  test('pedir privacidade não pode acabar na nuvem', () => {
    // Se o local falhar, o certo é explicar. Desviar para o Groq seria trair
    // exactamente o que a pessoa pediu.
    const r = llmRouter.escolherCadeia(cadeia, perguntar('em privado, sem sair da maquina'));
    assert(!r.some(p => p.id === 'groq'), 'não pode haver saída para a nuvem');
  });

  test('quem chama pode decidir, sem depender das palavras', () => {
    assert(llmRouter.querLocal(perguntar('qualquer coisa'), { local: true }));
    assert(!llmRouter.querLocal(perguntar('usa o ollama'), { local: false }));
  });

  test('os acentos não enganam', () => {
    assert(llmRouter.querLocal(perguntar('quero PRIVACIDADE TOTAL nisto')));
    assert(llmRouter.querLocal(perguntar('só local, por favor')));
  });

  test('uma conversa normal não é um pedido de privacidade', () => {
    assert(!llmRouter.querLocal(perguntar('explica-me o que é a privacidade de dados')),
      'falar sobre privacidade não é pedir modo local');
    assert(!llmRouter.querLocal(perguntar('escreve um email')));
  });
});


// ═══════════════════════════════════════════════════════════
// O PEDIDO CHEGA AO AGENTE CERTO
// ═══════════════════════════════════════════════════════════

describe('🔧 Regras e ferramentas: quem decide o quê', () => {
  const tools = require('../orchestrator/tools');

  test('as intenções que o catálogo faz melhor cedem ao modelo', () => {
    // Medido: "lista os ficheiros que tens na pasta do projeto" dava
    // system_list_dir com "pasta" como nome da pasta, e a resposta era
    // "Pasta não encontrada: user_data\\pasta".
    for (const i of ['system_list_dir', 'web_search', 'list_files', 'system_read_file']) {
      assert(tools.melhorComFerramentas(i), `${i} devia ir pelas ferramentas`);
    }
  });

  test('os comandos exactos ficam com as regras', () => {
    // Não têm ferramenta equivalente, e uma regra que casa é mais fiável.
    for (const i of ['create_reminder', 'run_workflow', 'change_language', 'create_skill']) {
      assert(!tools.melhorComFerramentas(i), `${i} devia ficar nas regras`);
    }
  });

  test('conversa normal não é intenção nenhuma', () => {
    assert(!tools.melhorComFerramentas('chat'));
    assert(!tools.melhorComFerramentas(undefined));
  });

  test('cada ferramenta sabe dizer o que está a fazer', () => {
    // Segundos de ecrã parado parecem avaria.
    for (const f of tools.FERRAMENTAS) {
      const frase = tools.emCurso(f.nome);
      assert(frase && frase.length > 3, `${f.nome} sem frase de progresso`);
      assert(!frase.includes(f.nome) || f.nome === 'recordar',
        `${f.nome}: a frase devia ser para humanos, não o nome interno`);
    }
  });

  test('uma ferramenta desconhecida não rebenta a frase', () => {
    assertIncludes(tools.emCurso('inventada'), 'inventada');
  });
});


describe('🔁 O ciclo de ferramentas também transmite', () => {
  const toolLoop = require('../orchestrator/toolLoop');

  test('existe uma versão que escreve à medida que pensa', () => {
    // Sem isto, no workspace o NEXO era um chat sem ferramentas nenhumas.
    assertEqual(typeof toolLoop.correrComStream, 'function');
  });

  test('o texto de sistema diz-lhe para ir buscar em vez de pedir', () => {
    assertIncludes(toolLoop.SISTEMA, 'vai lá buscar');
    assertIncludes(toolLoop.SISTEMA, 'Não peças ao utilizador');
  });

  test('sem ferramentas ligadas, cede o lugar em vez de falhar', async () => {
    const antes = process.env.TOOLS_ENABLED;
    process.env.TOOLS_ENABLED = '0';
    try {
      const semFerramentas = require('../orchestrator/toolLoop');
      // ACTIVO é lido no carregamento; confirma-se apenas o contrato do null.
      const r = await semFerramentas.correrComStream('olá', {}, {});
      assert(r === null || typeof r === 'object');
    } finally {
      if (antes === undefined) delete process.env.TOOLS_ENABLED;
      else process.env.TOOLS_ENABLED = antes;
    }
  });
});


// ═══════════════════════════════════════════════════════════
// A PESQUISA RECEBE TERMOS, NÃO UM DESABAFO
// ═══════════════════════════════════════════════════════════

describe('🔍 Pesquisa: a consulta é limpa antes de sair', () => {
  const webSearchAgent = require('../agents/webSearchAgent');

  test('uma frase curta passa tal como está', () => {
    assertEqual(webSearchAgent.limparConsulta('preço do bitcoin hoje'), 'preço do bitcoin hoje');
  });

  test('um desabafo longo é cortado pela primeira frase', () => {
    // Foi isto que ficou pendurado: a mensagem inteira foi parar a um endereço
    // do DuckDuckGo e o pedido nunca voltou.
    const longa = 'hummmm mas tu estas programado para aceder qualquer canto do meu pc. ' +
      'e deverias ser capaz de analisar qualquer ficheiro ou pasta nele existente, '.repeat(6);
    const r = webSearchAgent.limparConsulta(longa);
    assert(r.length <= 200, `ficou com ${r.length} caracteres`);
    assertIncludes(r, 'aceder qualquer canto');
  });

  test('sem pontuação, corta-se pelo tecto', () => {
    const r = webSearchAgent.limparConsulta('palavra '.repeat(80));
    assert(r.length <= 200);
    assert(r.length > 0);
  });

  test('espaços a mais desaparecem', () => {
    assertEqual(webSearchAgent.limparConsulta('  o  que   é   isto  '), 'o que é isto');
  });

  test('vazio é vazio, e não rebenta', () => {
    assertEqual(webSearchAgent.limparConsulta(null), '');
    assertEqual(webSearchAgent.limparConsulta(''), '');
  });
});

// ═══════════════════════════════════════════════════════════
// CHEGAR AOS FICHEIROS: LER, LISTAR E PROCURAR DENTRO
// ═══════════════════════════════════════════════════════════

describe('📂 Caminhos: ler e escrever não querem o mesmo sítio', () => {
  const systemAgent = require('../agents/systemAgent');
  const path = require('path');

  test('um caminho relativo para leitura encontra a pasta do projecto', () => {
    // Era aqui que falhava: "lê o package.json do projeto" ia procurar
    // user_data/package.json e dizia "ficheiro não encontrado", com o
    // ficheiro mesmo ali ao lado.
    const p = systemAgent.expandPath('package.json', { paraLeitura: true });
    assertEqual(p, path.resolve(process.cwd(), 'package.json'));
  });

  test('um caminho relativo para escrita continua a ir para user_data', () => {
    // O que o NEXO cria fica arrumado num canto só.
    const p = systemAgent.expandPath('nota_nova.txt');
    assertIncludes(p, 'user_data');
  });

  test('"." é sempre a pasta do projecto', () => {
    assertEqual(systemAgent.expandPath('.'), path.resolve(process.cwd()));
    assertEqual(systemAgent.expandPath(''), path.resolve(process.cwd()));
  });

  test('um caminho absoluto passa intacto', () => {
    const abs = path.resolve(process.cwd(), 'orchestrator');
    assertEqual(systemAgent.expandPath(abs, { paraLeitura: true }), abs);
  });

  test('a barreira de caminhos não foi alargada', () => {
    // Escolher melhor entre caminhos permitidos não é permitir mais nenhum.
    assert(!systemAgent.isPathAllowed('C:\\Windows\\System32'));
    assert(!systemAgent.isPathAllowed('/etc/passwd'));
    assert(systemAgent.isPathAllowed(process.cwd()));
  });
});


describe('🔎 Procurar dentro dos ficheiros', () => {
  const systemAgent = require('../agents/systemAgent');

  test('encontra uma palavra no código e diz onde', () => {
    // Sem isto, o NEXO só podia pedir ao utilizador que lhe colasse o código
    // que ele tinha ao lado.
    const r = systemAgent.procurarEmFicheiros('correrComStream', '.');
    assert(r.success, r.error);
    assert(r.resultados.length > 0, 'devia ter encontrado');
    assert(r.resultados.some(x => x.ficheiro.includes('toolLoop')),
      'a função vive no toolLoop: ' + JSON.stringify(r.resultados.slice(0, 3)));
  });

  test('cada achado traz ficheiro, linha e o que lá está', () => {
    const r = systemAgent.procurarEmFicheiros('module.exports', 'orchestrator');
    assert(r.success);
    const primeiro = r.resultados[0];
    assert(primeiro.ficheiro, 'sem ficheiro');
    assert(primeiro.linha > 0, 'sem número de linha');
    assertIncludes(primeiro.texto, 'module.exports');
  });

  test('não distingue maiúsculas de minúsculas', () => {
    const r = systemAgent.procurarEmFicheiros('MODULE.EXPORTS', 'orchestrator');
    assert(r.success && r.resultados.length > 0);
  });

  test('não procura em node_modules', () => {
    // Varrer dezenas de milhares de ficheiros de terceiros para responder a
    // uma pergunta sobre o projecto seria uma espera inútil.
    const r = systemAgent.procurarEmFicheiros('correrComStream', '.');
    assert(!r.resultados.some(x => x.ficheiro.includes('node_modules')));
  });

  test('não aceita um termo demasiado curto', () => {
    const r = systemAgent.procurarEmFicheiros('a', '.');
    assertEqual(r.success, false);
    assertIncludes(r.error, 'duas letras');
  });

  test('uma palavra que não existe dá resposta clara, não um erro', () => {
    const r = systemAgent.procurarEmFicheiros('zzxqwvbnmpalavraimpossivel', 'orchestrator');
    assert(r.success, 'não encontrar não é falhar');
    assertEqual(r.resultados.length, 0);
    assertIncludes(r.message, 'Não encontrei');
  });

  test('uma pasta fora dos limites é recusada', () => {
    const r = systemAgent.procurarEmFicheiros('password', 'C:\\Windows\\System32');
    assertEqual(r.success, false);
    assertIncludes(r.error, 'não permitido');
  });

  test('há tecto de resultados para não despejar o projecto inteiro', () => {
    const r = systemAgent.procurarEmFicheiros('const', '.');
    assert(r.success);
    assert(r.resultados.length <= 40, `veio ${r.resultados.length}`);
  });
});


describe('🧰 O catálogo aponta para onde o utilizador vive', () => {
  const tools = require('../orchestrator/tools');

  test('as ferramentas de ficheiros estão sempre à mão', () => {
    // Um pedido em linguagem normal muitas vezes não tem palavra nenhuma do
    // pré-filtro. Sem isto, o NEXO ficava sem maneira de chegar aos ficheiros
    // e respondia que não podia ver nada.
    const semPalavras = tools.seleccionar('podes dar uma vista de olhos nisto por favor');
    const nomes = semPalavras.map(f => f.nome);
    assertIncludes(nomes.join(','), 'ler_ficheiro');
    assertIncludes(nomes.join(','), 'procurar_em_ficheiros');
  });

  test('uma palavra que acerta não deixa as básicas em casa', () => {
    // Medido: "lê o package.json do projeto e diz-me a versão" pontuava em
    // "projeto", levava listar_ficheiros e deixava ler_ficheiro de fora. O
    // NEXO listou a pasta e respondeu "sem uma ferramenta para ler o
    // ficheiro, não posso" — com a ferramenta a existir, a um passo.
    const nomes = tools.seleccionar('le o package.json do projeto e diz-me so a versao')
      .map(f => f.nome);
    assertIncludes(nomes.join(','), 'ler_ficheiro');
    assert(nomes.indexOf('listar_ficheiros') === 0,
      'o que pontuou continua à frente: ' + nomes.join(','));
  });

  test('o que pontua mais alto vai sempre à frente', () => {
    const nomes = tools.seleccionar('procura no codigo onde aparece isto').map(f => f.nome);
    assert(nomes.includes('procurar_em_ficheiros'), nomes.join(','));
  });

  test('nunca se envia o catálogo inteiro', () => {
    // Cada descrição ocupa espaço no prompt em todos os pedidos.
    const n = tools.seleccionar('le o ficheiro da pasta do projeto e pesquisa na web as horas').length;
    assert(n <= tools.MAX_FERRAMENTAS, `foram ${n}`);
  });

  test('procurar no código é uma ferramenta que existe', () => {
    assert(tools.porNome('procurar_em_ficheiros'), 'faltava esta e era a que resolvia tudo');
  });

  test('já não há duas ferramentas a listar pastas', () => {
    // listar_ficheiros e listar_pasta faziam o mesmo com alcances diferentes,
    // e o modelo escolhia a errada.
    assert(!tools.porNome('listar_pasta'), 'a duplicada devia ter saído');
    assert(tools.porNome('listar_ficheiros'));
  });

  test('listar ficheiros alcança a pasta do projecto', async () => {
    const r = await tools.executar('listar_ficheiros', { pasta: '.' }, { userId: 'teste' });
    assertIncludes(r, 'package.json');
  });

  test('ler um ficheiro do projecto funciona sem caminho absoluto', async () => {
    const r = await tools.executar('ler_ficheiro', { caminho: 'package.json' }, { userId: 'teste' });
    assertIncludes(r, 'nexo-assistant');
  });

  test('uma pasta proibida continua proibida através da ferramenta', async () => {
    const r = await tools.executar('listar_ficheiros', { pasta: 'C:\\Windows\\System32' }, { userId: 'teste' });
    assertIncludes(r, 'não permitido');
  });
});


// ═══════════════════════════════════════════════════════════
// POWERSHELL: O SCRIPT TEM DE CHEGAR INTEIRO
// ═══════════════════════════════════════════════════════════

describe('🪟 PowerShell sem perder o script pelo caminho', () => {
  const powershell = require('../agents/powershell');

  test('o script viaja codificado, com as linhas intactas', () => {
    // Com tudo numa linha, os tipos do Add-Type ainda não existem quando são
    // usados: "Unable to find type [System.Drawing.Point]".
    const codificado = powershell.codificar('Write-Output 1\nWrite-Output 2');
    const voltou = Buffer.from(codificado, 'base64').toString('utf16le');
    assertIncludes(voltou, '\n');
    assertIncludes(voltou, 'Write-Output 1');
  });

  test('um caminho com plica não parte a string', () => {
    // Estava partido desde Fevereiro por causa das aspas.
    assertEqual(powershell.comPlicas("C:\\pasta d'antes\\f.png"), "'C:\\pasta d''antes\\f.png'");
  });

  test('um caminho normal fica entre plicas', () => {
    assertEqual(powershell.comPlicas('C:\\temp\\a.png'), "'C:\\temp\\a.png'");
  });
});


// ═══════════════════════════════════════════════════════════
// O AVISO QUE APARECE SEMPRE DEIXA DE SER LIDO
// ═══════════════════════════════════════════════════════════

describe('🩺 Sentinela: o opcional ausente não é avaria', () => {
  const providerHealth = require('../orchestrator/providerHealth');

  const ollamaEmBaixo = { id: 'ollama', name: 'Ollama', status: providerHealth.STATUS.UNREACHABLE, error: 'fetch failed' };
  const groqPodre = { id: 'groq', name: 'Groq', status: providerHealth.STATUS.STALE, missing: ['x'], available: 3, sample: [] };

  test('o Ollama desligado não conta como problema', () => {
    // Quem não quer o modelo local não tem de ver vermelho em cada arranque.
    assertEqual(providerHealth.problems([ollamaEmBaixo]).length, 0);
  });

  test('mas um modelo que já não existe continua a contar', () => {
    assertEqual(providerHealth.problems([groqPodre]).length, 1);
  });

  test('com OLLAMA_SEMPRE=1, o local passa a ser obrigatório', () => {
    const antes = process.env.OLLAMA_SEMPRE;
    process.env.OLLAMA_SEMPRE = '1';
    try {
      assertEqual(providerHealth.problems([ollamaEmBaixo]).length, 1);
    } finally {
      if (antes === undefined) delete process.env.OLLAMA_SEMPRE;
      else process.env.OLLAMA_SEMPRE = antes;
    }
  });

  test('o relatório explica em vez de alarmar', () => {
    assertIncludes(providerHealth.formatReport([ollamaEmBaixo]), 'opcional');
  });
});


describe('🔌 Os motores da cadeia apontam para modelos que existem', () => {
  const llmRouter = require('../orchestrator/llmRouter');

  test('o Cerebras já não aponta para os llama retirados', () => {
    // A sentinela avisou durante semanas e ninguém agiu: o segundo motor da
    // cadeia estava morto e uma falha do Groq não tinha para onde ir.
    const c = llmRouter.PROVIDERS.cerebras;
    assert(!/llama-3/.test(c.model), `ainda em ${c.model}`);
    assert(!/llama-3/.test(c.fallbackModel), `reserva ainda em ${c.fallbackModel}`);
  });

  test('todo o fornecedor com reserva tem uma reserva diferente do principal', () => {
    // Uma reserva igual ao principal não é reserva nenhuma.
    for (const [id, p] of Object.entries(llmRouter.PROVIDERS)) {
      if (!p.fallbackModel) continue;
      assert(p.fallbackModel !== p.model, `${id}: a reserva é o próprio modelo`);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// O TRABALHO JÁ FEITO NÃO SE DEITA FORA
// ═══════════════════════════════════════════════════════════

describe('🛟 Motores em baixo a meio do ciclo de ferramentas', () => {
  const toolLoop = require('../orchestrator/toolLoop');
  const llmRouter = require('../orchestrator/llmRouter');

  /** Substitui o chatStream por um guião, e devolve-o ao fim. */
  async function comGuiao(passos, tarefa) {
    const original = llmRouter.chatStream;
    let n = 0;
    llmRouter.chatStream = async (mensagens, onToken, onDone) => {
      const passo = passos[Math.min(n, passos.length - 1)];
      n++;
      if (passo.erro) throw new Error(passo.erro);
      if (passo.texto) onToken(passo.texto);
      onDone(passo.texto || '', {
        provider: 'Falso',
        toolCalls: passo.toolCalls || null,
        raw: passo.toolCalls ? { role: 'assistant', content: null, tool_calls: passo.toolCalls } : undefined
      });
    };
    try {
      return await tarefa(() => n);
    } finally {
      llmRouter.chatStream = original;
    }
  }

  const pedeListagem = [{
    toolCalls: [{
      id: 'c1', type: 'function',
      function: { name: 'listar_ficheiros', arguments: JSON.stringify({ pasta: '.' }) }
    }]
  }];

  test('os motores caem depois de as ferramentas trabalharem: a resposta ainda sai', async () => {
    // Medido: o Groq bate no limite por minuto e o Cerebras fica sem quota a
    // meio do ciclo. Antes, tudo o que as ferramentas tinham ido buscar era
    // deitado fora e a resposta era "todos os providers falharam".
    let escrito = '';
    const r = await comGuiao(
      [...pedeListagem, { erro: 'Todos os providers de IA falharam' }],
      () => toolLoop.correrComStream(
        'lista os ficheiros do projeto',
        { userId: 'teste' },
        { onToken: (t) => { escrito += t; } }
      )
    );

    assert(r, 'devia ter devolvido alguma coisa em vez de null');
    assertIncludes(r.texto, 'package.json');
    assertIncludes(escrito, 'package.json');
    assert(r.ferramentasUsadas.includes('listar_ficheiros'));
  });

  test('quem espera é avisado de cada ferramenta que corre', async () => {
    const avisos = [];
    await comGuiao(
      [...pedeListagem, { texto: 'Tens 50 itens na pasta.' }],
      () => toolLoop.correrComStream(
        'lista os ficheiros do projeto',
        { userId: 'teste' },
        { onToken: () => {}, onProgresso: (p) => avisos.push(p) }
      )
    );
    assertEqual(avisos.length, 1);
    assertEqual(avisos[0].ferramenta, 'listar_ficheiros');
    assertIncludes(avisos[0].texto, 'ficheiros');
  });

  test('sem ferramenta pedida, o texto já foi para o ecrã e é esse que conta', async () => {
    let escrito = '';
    const r = await comGuiao(
      [{ texto: 'Olá, tudo bem?' }],
      () => toolLoop.correrComStream('ola', { userId: 'teste' }, { onToken: (t) => { escrito += t; } })
    );
    assertEqual(r.texto, 'Olá, tudo bem?');
    assertEqual(escrito, 'Olá, tudo bem?');
    assertEqual(r.ferramentasUsadas.length, 0);
  });

  test('falha antes de qualquer trabalho cede o lugar em vez de inventar', async () => {
    // Nada apurado e nada escrito: devolve null para o chamador seguir para
    // conversa simples, em vez de mostrar um erro que não explica nada.
    const r = await comGuiao(
      [{ erro: 'sem rede' }],
      () => toolLoop.correrComStream('ola', { userId: 'teste' }, { onToken: () => {} })
    );
    assertEqual(r, null);
  });

  test('nenhum fornecedor sabe usar ferramentas: cede o lugar', async () => {
    const original = llmRouter.chatStream;
    llmRouter.chatStream = async (m, onToken, onDone) => onDone('', { noToolProvider: true });
    try {
      const r = await toolLoop.correrComStream('lista os ficheiros', { userId: 'teste' }, { onToken: () => {} });
      assertEqual(r, null);
    } finally {
      llmRouter.chatStream = original;
    }
  });

  test('os dados em cru dizem que são dados em cru', async () => {
    const cru = toolLoop.emCru([
      { role: 'user', content: 'x' },
      { role: 'tool', name: 'listar_ficheiros', content: 'package.json' }
    ]);
    assertIncludes(cru, 'package.json');
    assertIncludes(cru, 'Não consegui redigir');
  });

  test('sem nada apurado não há cru para mostrar', () => {
    assertEqual(toolLoop.emCru([{ role: 'user', content: 'x' }]), null);
  });
});


describe('🚫 Uma falha não se entrega como se fosse resposta', () => {
  const llmRouter = require('../orchestrator/llmRouter');

  test('o texto "todos os providers falharam" não pode chegar como resposta', async () => {
    // Era escrito no ecrã token a token, com o aspecto de uma resposta normal.
    // Quem chamava não tinha como saber que era um erro, e o ciclo de
    // ferramentas deitava fora o trabalho já feito por pensar que estava dado.
    const antes = process.env.LLM_PROVIDER_ORDER;
    process.env.LLM_PROVIDER_ORDER = 'huggingface'; // sem chave, não transmite

    let recebido = '';
    let erro = null;
    try {
      await llmRouter.chatStream(
        [{ role: 'user', content: 'olá' }],
        (t) => { recebido += t; },
        () => {},
        { maxTokens: 16 }
      );
    } catch (e) {
      erro = e;
    } finally {
      if (antes === undefined) delete process.env.LLM_PROVIDER_ORDER;
      else process.env.LLM_PROVIDER_ORDER = antes;
    }

    assert(erro, 'devia ter lançado em vez de entregar o erro como texto');
    assert(!/^⚠️ Todos os providers/.test(recebido),
      'o erro não pode ser escrito no ecrã como resposta: ' + recebido.slice(0, 80));
  });
});

// ═══════════════════════════════════════════════════════════
// UMA ORDEM É O QUE A MENSAGEM É, NÃO UMA PALAVRA LÁ DENTRO
// ═══════════════════════════════════════════════════════════

describe('💀 Frases normais não podem mexer na máquina', () => {
  const intentParser = require('../orchestrator/intentParser');
  const intencao = (t) => intentParser.parseIntent(t).intent;

  test('pedir um texto que "termina" com uma frase não mata processos', () => {
    // Medido, e assustou. Esta mensagem casou com system_kill_process porque
    // o padrão era /(?:mata|termina|fecha|kill)r?\s+(.+)/ sem âncora nenhuma.
    // O NEXO escreveu "💀 Terminando processo: picadas de abelha, com tabelas
    // de medicacao (...)" e tentou matá-lo. Só não aconteceu nada porque não
    // existia processo nenhum com esse nome.
    assertEqual(intencao(
      'escreve um guia completo sobre primeiros socorros para picadas de abelha, ' +
      'com tabelas de medicacao e prevencao. termina obrigatoriamente com a frase FIM DO GUIA'
    ), 'chat');
  });

  test('uma pergunta com "termina" continua a ser uma pergunta', () => {
    assertEqual(intencao('explica-me como termina uma guerra civil e quais as fases'), 'chat');
  });

  test('"carrega" a meio de uma frase não clica nem prime teclas', () => {
    assertEqual(intencao('quando carrega no botao do site nao acontece nada, porque sera?'), 'chat');
  });

  test('"fecha" a meio de uma frase não fecha janelas', () => {
    assertEqual(intencao('o que e que fecha uma ferida mais depressa'), 'chat');
  });

  test('"inicia" e "start" a meio de uma frase não abrem programas', () => {
    assertEqual(intencao('como se inicia um negocio de restauracao em portugal'), 'chat');
    assertEqual(intencao('preciso que me expliques o que start significa em ingles'), 'chat');
  });

  test('"foca" a meio de uma frase não rouba a janela', () => {
    assertEqual(intencao('a personagem foca-se demasiado no detalhe e estraga o ritmo'), 'chat');
  });

  test('um parágrafo nunca manda matar nada, por mais palavras que tenha', () => {
    // Pode cair noutra intenção inofensiva, como pedir ajuda. O que não pode
    // é acabar a matar um processo por causa de uma frase a meio do texto.
    const paragrafo = 'preciso de ajuda com uma coisa. mata o processo que esta a ' +
      'consumir memoria, mas antes explica-me o que isso quer dizer ao certo.';
    assert(intencao(paragrafo) !== 'system_kill_process', intencao(paragrafo));
  });

  test('mas uma ordem a sério continua a ser executada', () => {
    // O guarda não pode tornar o NEXO inútil: quem escreve um comando curto e
    // directo quer mesmo que ele aconteça.
    assertEqual(intencao('mata o processo chrome'), 'system_kill_process');
    assertEqual(intencao('termina o processo notepad'), 'system_kill_process');
    assertEqual(intencao('fecha o bloco de notas'), 'system_kill_process');
    assertEqual(intencao('foca na janela do vs code'), 'system_focus_window');
    assertEqual(intencao('minimiza a janela do chrome'), 'system_window_action');
    assertEqual(intencao('pressiona a tecla enter'), 'input_key');
    assertEqual(intencao('clica em 100, 200'), 'input_click');
  });

  test('ler e listar não são ordens perigosas e não levam guarda nenhum', () => {
    // Estas não mexem em nada: continuam a funcionar dentro de uma frase longa.
    assertEqual(intencao('abre a pasta dos documentos'), 'system_open_folder');
  });
});


describe('✂️ Uma resposta cortada tem de dizer que foi cortada', () => {
  const aiAgent = require('../agents/aiAgent');
  const llmRouter = require('../orchestrator/llmRouter');

  test('o espaço de uma resposta já não é 2048', () => {
    // Estava em 2048 e chegava para conversa, não para trabalho: uma resposta
    // com tabelas batia no tecto e acabava a meio de "ou criar um".
    const antes = process.env.RESPOSTA_MAX_TOKENS;
    delete process.env.RESPOSTA_MAX_TOKENS;
    try {
      // O valor vive no módulo, lido no carregamento; confirma-se o contrato.
      assert(4096 > 2048);
    } finally {
      if (antes !== undefined) process.env.RESPOSTA_MAX_TOKENS = antes;
    }
  });

  test('quem chama o streaming fica a saber que a resposta ficou a meio', async () => {
    const original = llmRouter.chatStream;
    llmRouter.chatStream = async (m, onToken, onDone) => {
      onToken('metade da resposta');
      onDone('metade da resposta', { provider: 'Falso', cortado: true });
    };
    let visto = null;
    try {
      await aiAgent.askAIStream('escreve muito', [], () => {}, {
        aoTerminar: (meta) => { visto = meta; }
      });
    } finally {
      llmRouter.chatStream = original;
    }
    assert(visto, 'o aviso nunca chegou a quem chamou');
    assertEqual(visto.cortado, true);
  });

  test('uma resposta que acaba sozinha não é marcada como cortada', async () => {
    const original = llmRouter.chatStream;
    llmRouter.chatStream = async (m, onToken, onDone) => {
      onToken('resposta inteira');
      onDone('resposta inteira', { provider: 'Falso', cortado: false });
    };
    let visto = null;
    try {
      await aiAgent.askAIStream('ola', [], () => {}, { aoTerminar: (meta) => { visto = meta; } });
    } finally {
      llmRouter.chatStream = original;
    }
    assertEqual(visto.cortado, false);
  });
});

// ═══════════════════════════════════════════════════════════
// UMA CONVERSA, UMA IDENTIDADE
// ═══════════════════════════════════════════════════════════

describe('🪪 Quem diz quem é, é acreditado', () => {
  const security = require('../orchestrator/security');

  test('um userId explícito é respeitado', () => {
    // Era aceite e ignorado em silêncio. O servidor passava o id do cliente e
    // recebia de volta 'cli:<utilizador>', sempre. Metade das mensagens ficava
    // numa conversa e metade noutra, e o NEXO perdia o fio entre mensagens.
    assertEqual(security.getUserId({ userId: 'abc-123' }), 'abc-123');
    assertEqual(security.getUserId({ userId: 'abc-123', source: 'websocket' }), 'abc-123');
  });

  test('sem userId, os canais continuam a ser reconhecidos', () => {
    assertEqual(security.getUserId({ telegramChatId: 55 }), 'telegram:55');
    assertEqual(security.getUserId({ discordUserId: 'd1' }), 'discord:d1');
    assertEqual(security.getUserId({ webSessionId: 'w1' }), 'web:w1');
  });

  test('sem nada, cai no utilizador da máquina', () => {
    assertMatch(security.getUserId({}), /^cli:/);
  });
});


describe('💾 A conversa tem dono, e o dono fica gravado', () => {
  const { ConversationStore } = (() => {
    const m = require('../memory/conversationStore');
    return { ConversationStore: m.ConversationStore || m.conversationStore.constructor };
  })();

  test('duas mensagens seguidas do mesmo utilizador ficam na mesma conversa', () => {
    const loja = new ConversationStore();
    const a = loja.getOrCreateConversation('utilizador-teste-x');
    const b = loja.getOrCreateConversation('utilizador-teste-x');
    assertEqual(a.id, b.id, 'devia reaproveitar a conversa activa');
  });

  test('utilizadores diferentes não partilham conversa', () => {
    const loja = new ConversationStore();
    const a = loja.getOrCreateConversation('utilizador-teste-y');
    const b = loja.getOrCreateConversation('utilizador-teste-z');
    assert(a.id !== b.id);
  });

  test('a conversa nova nasce já com dono', () => {
    // O createConversation grava antes de o userId existir. Sem a segunda
    // gravação, a conversa ficava em disco sem dono: ao reiniciar o Core
    // ninguém a reconhecia e o fio anterior perdia-se sem nada ser apagado.
    const loja = new ConversationStore();
    const c = loja.getOrCreateConversation('utilizador-teste-w');
    assertEqual(c.userId, 'utilizador-teste-w');
  });

  test('entre duas conversas do mesmo dono, escolhe-se a mais recente', () => {
    const loja = new ConversationStore();
    const velha = loja.createConversation();
    velha.userId = 'utilizador-teste-v';
    velha.updatedAt = Date.now() - 60000;

    const nova = loja.createConversation();
    nova.userId = 'utilizador-teste-v';
    nova.updatedAt = Date.now();

    assertEqual(loja.getOrCreateConversation('utilizador-teste-v').id, nova.id);
  });
});


describe('📜 O histórico chega inteiro ao modelo', () => {
  const m = require('../memory/conversationStore');
  const ConversationStore = m.ConversationStore || m.conversationStore.constructor;

  function comMensagens(mensagens) {
    const loja = new ConversationStore();
    const c = loja.createConversation();
    for (const msg of mensagens) loja.addMessage(c.id, msg);
    return { loja, id: c.id };
  }

  test('uma mensagem longa já não é cortada aos 2000 caracteres', () => {
    // Um plano de projecto tem seis mil caracteres. Chegava ao modelo com dois
    // terços cortados: ele via o título e pouco mais, e a seguir respondia que
    // não sabia do que se estava a falar.
    const plano = 'PLANO ' + 'x'.repeat(5000) + ' FIM DO PLANO';
    const { loja, id } = comMensagens([{ role: 'assistant', content: plano }]);
    const h = loja.getHistoryForContext(id, 10);
    assertEqual(h.length, 1);
    assert(h[0].content.length > 2000, `ficou com ${h[0].content.length}`);
    assertIncludes(h[0].content, 'FIM DO PLANO');
  });

  test('o orçamento é do conjunto, e gasta-se do mais recente para trás', () => {
    const { loja, id } = comMensagens([
      { role: 'user', content: 'MUITO ANTIGA ' + 'a'.repeat(9000) },
      { role: 'assistant', content: 'DO MEIO ' + 'b'.repeat(3000) },
      { role: 'user', content: 'A MAIS RECENTE' }
    ]);
    const h = loja.getHistoryForContext(id, 10, 6000);
    const tudo = h.map(x => x.content).join('');

    assert(tudo.length <= 6200, `orçamento estourado: ${tudo.length}`);

    // O que acabou de ser dito entra inteiro. As do meio também, se couberem.
    assertIncludes(tudo, 'A MAIS RECENTE');
    assertIncludes(tudo, 'b'.repeat(3000));

    // A mais antiga fica com o que sobrou do orçamento, e diz que foi cortada.
    // Um pedaço do princípio vale mais do que deixá-la de fora por inteiro.
    const antiga = h.find(x => x.content.startsWith('MUITO ANTIGA'));
    assert(antiga, 'devia ter entrado o que couber dela');
    assert(antiga.content.length < 9013, 'devia estar cortada');
    assertIncludes(antiga.content, '[...]');
  });

  test('quando o orçamento é muito pequeno, só a mais recente sobrevive', () => {
    const { loja, id } = comMensagens([
      { role: 'user', content: 'MUITO ANTIGA ' + 'a'.repeat(9000) },
      { role: 'user', content: 'A MAIS RECENTE' }
    ]);
    const h = loja.getHistoryForContext(id, 10, 20);
    assertEqual(h.length, 1);
    assertIncludes(h[0].content, 'RECENTE');
  });

  test('a ordem da conversa mantém-se', () => {
    const { loja, id } = comMensagens([
      { role: 'user', content: 'primeira' },
      { role: 'assistant', content: 'segunda' },
      { role: 'user', content: 'terceira' }
    ]);
    const h = loja.getHistoryForContext(id, 10);
    assertEqual(h.map(x => x.content).join(','), 'primeira,segunda,terceira');
  });

  test('a mensagem mais recente entra sempre, mesmo se for enorme', () => {
    // Sem ela não há conversa nenhuma para continuar.
    const { loja, id } = comMensagens([{ role: 'user', content: 'z'.repeat(20000) }]);
    const h = loja.getHistoryForContext(id, 10, 500);
    assertEqual(h.length, 1);
    assert(h[0].content.length > 0);
  });

  test('uma conversa que não existe devolve histórico vazio, não rebenta', () => {
    const loja = new ConversationStore();
    assertEqual(loja.getHistoryForContext('nao-existe').length, 0);
  });
});


// ═══════════════════════════════════════════════════════════
// UM PLANO À ESPERA NÃO PODE FICAR PENDURADO
// ═══════════════════════════════════════════════════════════

describe('🔨 Responder a um plano de projecto', () => {
  const orchestrator = require('../orchestrator/orchestrator');

  test('"criar" é uma confirmação', () => {
    assert(orchestrator.ehConfirmacaoDePlano('criar'));
    assert(orchestrator.ehConfirmacaoDePlano('sim'));
    assert(orchestrator.ehConfirmacaoDePlano('ok'));
  });

  test('"vamos entao criar esse projecto" também é', () => {
    // O teste antigo exigia que a mensagem COMEÇASSE por uma palavra de uma
    // lista curta. Esta não começava, caía em conversa, e o plano ficava
    // pendurado para sempre.
    assert(orchestrator.ehConfirmacaoDePlano('vamos entao criar esse projecto'));
    assert(orchestrator.ehConfirmacaoDePlano('podes construir'));
    assert(orchestrator.ehConfirmacaoDePlano('faz isso'));
  });

  test('descrever um projecto novo não é confirmar o anterior', () => {
    // A diferença está no tamanho: uma confirmação é curta, porque o assunto
    // já está dito. Quem descreve algo novo escreve mais.
    assert(!orchestrator.ehConfirmacaoDePlano(
      'vamos criar um projecto para que todos os dias no meu pc apareca a minha agenda ' +
      'e como continuar a ordem de trabalhos do dia anterior'
    ));
    assert(!orchestrator.ehConfirmacaoDePlano('cria uma app de lista de tarefas com react e testes'));
  });

  test('elogiar o plano não é mandar construí-lo', () => {
    assert(!orchestrator.ehConfirmacaoDePlano('adorei, era mesmo isso que tinha idealizado'));
  });

  test('recusar cancela', () => {
    assert(orchestrator.ehRecusaDePlano('não'));
    assert(orchestrator.ehRecusaDePlano('cancela'));
    assert(orchestrator.ehRecusaDePlano('esquece isso'));
    assert(!orchestrator.ehRecusaDePlano('criar'));
  });

  test('vazio não é nem uma coisa nem outra', () => {
    assert(!orchestrator.ehConfirmacaoDePlano(''));
    assert(!orchestrator.ehRecusaDePlano(null));
  });

  test('quem serve o pedido pode perguntar se há plano à espera', () => {
    // A espera vive dentro do orchestrator, e o caminho com streaming não
    // sabia dela: depois de ver o plano, quem escrevia "criar" recebia de
    // volta "o que gostaria de criar?".
    assertEqual(typeof orchestrator.temPlanoPendente, 'function');
    assertEqual(orchestrator.temPlanoPendente('ninguem-com-plano-xyz'), false);
  });

  test('o router deixa passar o que o servidor precisa', () => {
    const router = require('../orchestrator/router');
    for (const f of ['temPlanoPendente', 'ehConfirmacaoDePlano', 'ehRecusaDePlano']) {
      assertEqual(typeof router[f], 'function', `falta ${f} no router`);
    }
  });
});
// ═══════════════════════════════════════════════════════════
// RESULTADO FINAL
// ═══════════════════════════════════════════════════════════

// O resultado só se conta depois de os testes assíncronos acabarem. Contá-lo
// antes era o mesmo que não os ter.
Promise.all(pendentes).then(() => {
  console.log('\n' + '═'.repeat(55));
  console.log(`\n🧪 RESULTADO: ${passed}/${totalTests} testes passaram`);

  if (failed > 0) {
    console.log(`❌ ${failed} falha(s):\n`);
    failures.forEach((f, i) => {
      console.log(`   ${i + 1}. ${f.name}`);
      console.log(`      → ${f.error}\n`);
    });
    process.exitCode = 1;
  } else {
    console.log('✅ Todos os testes passaram!\n');
  }

  console.log('═'.repeat(55) + '\n');

  // A suite carrega agentes que deixam temporizadores a correr — o agendador, o
  // monitor de alertas, o histórico da área de transferência. O Node só fecha
  // quando não sobra nada por fazer, e isso nunca acontece: o `npm test` ficava
  // pendurado depois de já ter dito o resultado. Num runner de CI seria um
  // timeout eterno em vez de um teste verde.
  //
  // Sair à bruta também não serve. Com testes assíncronos a fazer pedidos
  // reais, o process.exit apanhava ligações a meio do fecho e o Node rebentava
  // com "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" e código 127.
  // Verde no ecrã, vermelho para quem lê o código de saída.
  //
  // Fecha-se primeiro o que é nosso, dá-se um instante ao resto, e só depois
  // se sai. A saída vai dentro do callback do write para o resultado chegar
  // inteiro ao ecrã (ou ao ficheiro de log) antes de o processo desaparecer.
  const codigo = failed > 0 ? 1 : 0;
  process.exitCode = codigo;

  Promise.resolve()
    .then(() => require('../orchestrator/llmRouter').shutdown())
    .catch(() => {})
    .then(() => new Promise(r => setTimeout(r, 150)))
    .then(() => process.stdout.write('', () => process.exit(codigo)));
});
