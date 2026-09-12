/**
 * 🔐 Security Module - Segurança e controlo de acessos
 * 
 * - Logging de todas as ações
 * - Identificação de utilizadores
 * - Rate limiting
 * - Validação de caminhos
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const LOGS_DIR = path.join(PROJECT_ROOT, 'memory');
const LOG_FILE = path.join(LOGS_DIR, 'actions.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB — rotação automática

// Garantir pasta de logs
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// ═══════════════════════════════════════════════════════════
// Rate Limiting por IP
// ═══════════════════════════════════════════════════════════

const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minuto
const RATE_LIMIT_MAX = 30; // 30 requests/minuto

/**
 * Verifica rate limit por IP
 * @returns {{ allowed: boolean, remaining: number, retryAfter?: number }}
 */
function checkRateLimit(ip) {
  const now = Date.now();
  const key = ip || 'unknown';
  
  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }
  
  const entry = rateLimitStore.get(key);
  
  // Reset window se expirou
  if (now - entry.windowStart > RATE_LIMIT_WINDOW) {
    entry.count = 1;
    entry.windowStart = now;
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }
  
  entry.count++;
  
  if (entry.count > RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW - (now - entry.windowStart)) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }
  
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}

// Limpar entries expirados a cada 5 minutos
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW * 2) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

// ═══════════════════════════════════════════════════════════
// API Key Authentication
// ═══════════════════════════════════════════════════════════

/**
 * Gera API key se não existir
 */
function getOrCreateApiKey() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  
  // Verificar se já existe no .env
  if (process.env.API_KEY) {
    return process.env.API_KEY;
  }
  
  // Gerar nova API key
  const apiKey = 'mybot_' + crypto.randomBytes(24).toString('hex');
  
  // Tentar adicionar ao .env
  try {
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8');
    }
    
    if (!envContent.includes('API_KEY=')) {
      envContent += `\n# ── API Authentication ──\nAPI_KEY=${apiKey}\n`;
      fs.writeFileSync(envPath, envContent);
      process.env.API_KEY = apiKey;
      console.log('🔑 API_KEY gerada automaticamente no .env');
    }
  } catch (e) {
    console.warn('⚠️ Não foi possível guardar API_KEY no .env');
  }
  
  return apiKey;
}

/**
 * Middleware Express para autenticação da API
 * Aceita: Authorization: Bearer <key> ou query ?apiKey=<key> 
 * Localhost (127.0.0.1) e app desktop são isentos
 */
function authMiddleware(req, res, next) {
  // Isentar localhost e IPs locais (desktop app, CLI)
  const ip = req.ip || req.connection?.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.startsWith('::ffff:192.168.') || ip.startsWith('192.168.');
  
  if (isLocal) {
    return next();
  }
  
  // Verificar API_KEY
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    // Sem API_KEY configurada — permitir tudo (modo desenvolvimento)
    return next();
  }
  
  // Extrair key do header ou query
  const authHeader = req.headers.authorization;
  const queryKey = req.query.apiKey;
  
  let providedKey = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    providedKey = authHeader.slice(7);
  } else if (queryKey) {
    providedKey = queryKey;
  }
  
  if (!providedKey || providedKey !== apiKey) {
    return res.status(401).json({ 
      error: 'Autenticação necessária',
      message: 'Envia o header Authorization: Bearer <API_KEY> ou query ?apiKey=<key>'
    });
  }
  
  next();
}

/**
 * Middleware Express para rate limiting
 */
function rateLimitMiddleware(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const result = checkRateLimit(ip);
  
  res.set('X-RateLimit-Limit', RATE_LIMIT_MAX.toString());
  res.set('X-RateLimit-Remaining', result.remaining.toString());
  
  if (!result.allowed) {
    res.set('Retry-After', result.retryAfter.toString());
    return res.status(429).json({ 
      error: 'Rate limit excedido',
      message: `Máximo ${RATE_LIMIT_MAX} pedidos por minuto`,
      retryAfter: result.retryAfter
    });
  }
  
  next();
}

/**
 * Gera ID único para utilizador baseado no contexto
 */
function getUserId(context = {}) {
  // Quem chama e diz quem é, é acreditado.
  //
  // Isto faltava, e o parâmetro era aceite e ignorado em silêncio. O servidor
  // passava { userId: <id do cliente> } e recebia de volta 'cli:<utilizador>',
  // sempre. Consequência: metade das mensagens era guardada numa conversa e
  // metade noutra, e o NEXO perdia o fio entre uma mensagem e a seguinte.
  if (context.userId) {
    return String(context.userId);
  }

  if (context.telegramChatId) {
    return `telegram:${context.telegramChatId}`;
  }
  if (context.discordUserId) {
    return `discord:${context.discordUserId}`;
  }
  if (context.whatsappFrom) {
    return `whatsapp:${context.whatsappFrom}`;
  }
  if (context.webSessionId) {
    return `web:${context.webSessionId}`;
  }
  if (context.desktopId) {
    return `desktop:${context.desktopId}`;
  }
  
  // CLI - usar username do sistema
  return `cli:${process.env.USERNAME || process.env.USER || 'local'}`;
}

/**
 * Regista ação no log (com rotação automática)
 */
function logAction(userId, action, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    userId,
    action,
    details: typeof details === 'object' ? details : { info: details }
  };
  
  const logLine = JSON.stringify(entry) + '\n';
  
  try {
    // Verificar tamanho do log e rodar se necessário
    if (fs.existsSync(LOG_FILE)) {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size > MAX_LOG_SIZE) {
        // Renomear log atual para .old (manter apenas 1 backup)
        const oldLog = LOG_FILE + '.old';
        try { fs.unlinkSync(oldLog); } catch {}
        fs.renameSync(LOG_FILE, oldLog);
      }
    }
    
    fs.appendFileSync(LOG_FILE, logLine);
  } catch (err) {
    console.warn('⚠️ Erro ao gravar log:', err.message);
  }
  
  // Debug em desenvolvimento
  if (process.env.NODE_ENV === 'development') {
    console.log(`[LOG] ${userId} → ${action}`);
  }
}

/**
 * Lê últimas N entradas do log
 */
function getRecentLogs(limit = 50) {
  if (!fs.existsSync(LOG_FILE)) {
    return [];
  }
  
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    
    return lines
      .slice(-limit)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  } catch {
    return [];
  }
}

/**
 * Gera código de segurança para confirmações críticas
 */
function generateSecurityCode() {
  return crypto.randomBytes(2).toString('hex').toUpperCase();
}

/**
 * Verifica se ação requer confirmação
 */
function requiresConfirmation(action, details = {}) {
  const confirmRequired = process.env.CONFIRM_SENSITIVE_ACTIONS !== 'false';
  
  if (!confirmRequired) {
    return false;
  }
  
  const sensitiveActions = [
    'run_code',
    'delete_file',
    'execute_command',
    'send_email',
    'api_call_external'
  ];
  
  return sensitiveActions.includes(action);
}

/**
 * Formata mensagem de confirmação
 */
function getConfirmationMessage(action, details = {}) {
  const code = generateSecurityCode();
  
  return {
    message: `⚠️ **Confirmação Necessária**

Ação: ${action}
${details.description || ''}

Para confirmar, responde com o código: **${code}**
Para cancelar, ignora ou escreve "cancelar".`,
    code,
    expiresIn: 60000 // 1 minuto
  };
}

/**
 * Estatísticas de uso
 */
function getStats() {
  const logs = getRecentLogs(1000);
  
  const stats = {
    totalActions: logs.length,
    byUser: {},
    byAction: {},
    last24h: 0
  };
  
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  
  for (const log of logs) {
    // Por utilizador
    stats.byUser[log.userId] = (stats.byUser[log.userId] || 0) + 1;
    
    // Por ação
    stats.byAction[log.action] = (stats.byAction[log.action] || 0) + 1;
    
    // Últimas 24h
    if (new Date(log.timestamp).getTime() > dayAgo) {
      stats.last24h++;
    }
  }
  
  return stats;
}

module.exports = {
  getUserId,
  logAction,
  getRecentLogs,
  generateSecurityCode,
  requiresConfirmation,
  getConfirmationMessage,
  getStats,
  checkRateLimit,
  getOrCreateApiKey,
  authMiddleware,
  rateLimitMiddleware,
  LOG_FILE,
  LOGS_DIR
};
