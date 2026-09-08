/**
 * 🔔 Alert Agent — Monitor Inteligente & Alertas Proativos
 * 
 * O bot não só responde — antecipa e avisa:
 *   - Monitorizção de URLs (uptime de sites/servidores)
 *   - RSS feeds (notícias, blogs)
 *   - Alertas por condição (preço, keyword, etc)
 *   - Lembretes inteligentes
 * 
 * Exemplos:
 *   "avisa-me se o site example.com cair"
 *   "monitoriza o servidor 192.168.1.10 a cada 5 minutos"
 *   "segue o feed https://blog.com/rss"
 *   "lembra-me em 2 horas de ligar ao cliente"
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ═══════════════════════════════════════════════════════════
//  CONSTANTES
// ═══════════════════════════════════════════════════════════

const DATA_DIR = path.join(__dirname, '..', 'user_data');
const MONITORS_FILE = path.join(DATA_DIR, 'monitors.json');
const ALERTS_LOG = path.join(DATA_DIR, 'alerts_history.json');
const CHECK_INTERVAL_MS = 60 * 1000; // 1 minuto

// ═══════════════════════════════════════════════════════════
//  ESTADO
// ═══════════════════════════════════════════════════════════

let monitors = [];
let alertHistory = [];
let checkTimer = null;
let notifyCallback = null; // Callback para enviar notificações

// ═══════════════════════════════════════════════════════════
//  INICIALIZAÇÃO
// ═══════════════════════════════════════════════════════════

function init(onNotify) {
  notifyCallback = onNotify;
  load();
  startMonitoring();
  console.log(`[AlertAgent] 🔔 Iniciado com ${monitors.length} monitores ativos`);
}

function load() {
  try {
    if (fs.existsSync(MONITORS_FILE)) {
      monitors = JSON.parse(fs.readFileSync(MONITORS_FILE, 'utf8'));
    }
    if (fs.existsSync(ALERTS_LOG)) {
      alertHistory = JSON.parse(fs.readFileSync(ALERTS_LOG, 'utf8'));
    }
  } catch (e) {
    console.error('[AlertAgent] Erro ao carregar:', e.message);
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(MONITORS_FILE, JSON.stringify(monitors, null, 2), 'utf8');
  } catch (e) {
    console.error('[AlertAgent] Erro ao guardar monitores:', e.message);
  }
}

function saveAlertHistory() {
  try {
    if (alertHistory.length > 200) alertHistory = alertHistory.slice(-200);
    fs.writeFileSync(ALERTS_LOG, JSON.stringify(alertHistory, null, 2), 'utf8');
  } catch (e) {}
}

// ═══════════════════════════════════════════════════════════
//  PARSING NATURAL
// ═══════════════════════════════════════════════════════════

/**
 * Interpreta pedido de monitorização em linguagem natural
 */
function parseMonitorRequest(text) {
  const lower = text.toLowerCase();

  // ── URL Monitor: "monitoriza/avisa se o site X cair" ──
  const urlMatch = text.match(/(?:monitori[sz]a|vigiar?|watch|avisa.*(?:se|quando|if)|verifica)\s+(?:o\s+)?(?:site|servidor|server|url|página|page)?\s*(?:de\s+)?(\S*https?:\/\/\S+|\S+\.\S+)/i);
  if (urlMatch) {
    let url = urlMatch[1];
    if (!url.startsWith('http')) url = 'https://' + url;

    // Extrair intervalo
    const intervalMs = extractInterval(lower) || 5 * 60 * 1000; // 5 min default

    return {
      type: 'url',
      url,
      intervalMs,
      condition: 'down' // Alertar quando ficar em baixo
    };
  }

  // ── Lembrete: "lembra-me em X de Y" ──
  const reminderMatch = text.match(/lembr(?:a|e)[- ]me\s+(?:em|daqui\s+a)\s+(\d+)\s*(minuto|hora|min|hr|h)\w*\s+(?:de\s+|para\s+|que\s+)?(.+)/i)
    || text.match(/remind\s+me\s+in\s+(\d+)\s*(minute|hour|min|hr)s?\s+(?:to\s+|about\s+)?(.+)/i);

  if (reminderMatch) {
    const n = parseInt(reminderMatch[1]);
    const unit = reminderMatch[2];
    let ms = n * 60 * 1000;
    if (/^(hora|hour|hr|h$)/i.test(unit)) ms = n * 60 * 60 * 1000;

    return {
      type: 'reminder',
      message: reminderMatch[3].trim(),
      triggerAt: Date.now() + ms,
      intervalMs: ms
    };
  }

  // ── RSS Feed: "segue o feed X" ──
  const rssMatch = text.match(/(?:segue|follow|subscreve|subscribe|monitor)\s+(?:o\s+)?(?:feed|rss|blog|canal)\s+(\S+)/i);
  if (rssMatch) {
    let url = rssMatch[1];
    if (!url.startsWith('http')) url = 'https://' + url;
    return {
      type: 'rss',
      url,
      intervalMs: 30 * 60 * 1000 // 30 min
    };
  }

  // ── Keyword Monitor: "avisa-me quando X aparecer em Y" ──
  const keywordMatch = text.match(/avis[ae].*quando\s+['"]?(.+?)['"]?\s+(?:aparecer|existir|surgir)\s+(?:em|no|na)\s+(\S+)/i);
  if (keywordMatch) {
    let url = keywordMatch[2];
    if (!url.startsWith('http')) url = 'https://' + url;
    return {
      type: 'keyword',
      keyword: keywordMatch[1],
      url,
      intervalMs: 15 * 60 * 1000 // 15 min
    };
  }

  return null;
}

function extractInterval(text) {
  const match = text.match(/(?:a\s+)?cada\s+(\d+)\s*(minuto|hora|segundo|min|seg|hr|h)\w*/i);
  if (match) {
    const n = parseInt(match[1]);
    const unit = match[2];
    if (/^(minuto|min)/i.test(unit)) return n * 60 * 1000;
    if (/^(hora|hr|h)/i.test(unit)) return n * 60 * 60 * 1000;
    if (/^(segundo|seg)/i.test(unit)) return n * 1000;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
//  CRUD DE MONITORES
// ═══════════════════════════════════════════════════════════

/**
 * Cria novo monitor
 */
function createMonitor(text, userId = 'default') {
  const parsed = parseMonitorRequest(text);

  if (!parsed) {
    return {
      success: false,
      error: '❌ Não consegui interpretar o monitor. Exemplos:\n' +
        '• "monitoriza o site https://example.com a cada 5 minutos"\n' +
        '• "lembra-me em 2 horas de ligar ao cliente"\n' +
        '• "segue o feed https://blog.com/rss"\n' +
        '• "avisa-me quando \'promoção\' aparecer em example.com"'
    };
  }

  const monitor = {
    id: `mon_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    type: parsed.type,
    userId,
    enabled: true,
    ...parsed,
    createdAt: Date.now(),
    lastCheck: null,
    lastStatus: null,
    checkCount: 0,
    alertCount: 0
  };

  monitors.push(monitor);
  save();

  const intervalDesc = formatInterval(monitor.intervalMs);
  let msg = `🔔 **Monitor criado!**\n\n`;

  switch (monitor.type) {
    case 'url':
      msg += `🌐 **URL:** ${monitor.url}\n⏱️ **Intervalo:** ${intervalDesc}\n📡 **Alerta se:** ficar offline`;
      break;
    case 'reminder':
      msg += `💡 **Lembrete:** ${monitor.message}\n⏰ **Quando:** ${new Date(monitor.triggerAt).toLocaleString('pt-PT')}`;
      break;
    case 'rss':
      msg += `📰 **Feed RSS:** ${monitor.url}\n⏱️ **Verificar:** ${intervalDesc}`;
      break;
    case 'keyword':
      msg += `🔍 **Keyword:** "${monitor.keyword}"\n🌐 **URL:** ${monitor.url}\n⏱️ **Verificar:** ${intervalDesc}`;
      break;
  }

  return { success: true, message: msg, monitor };
}

/**
 * Lista monitores ativos
 */
function listMonitors(userId = null) {
  const filtered = userId ? monitors.filter(m => m.userId === userId) : monitors;

  if (filtered.length === 0) {
    return '📭 **Nenhum monitor ativo.**\n\nUsa: "monitoriza o site X" ou "lembra-me em 1 hora de Y"';
  }

  let msg = `🔔 **Monitores Ativos (${filtered.length}):**\n\n`;
  filtered.forEach((m, i) => {
    const status = m.enabled ? '🟢' : '🔴';
    const icon = { url: '🌐', reminder: '💡', rss: '📰', keyword: '🔍' }[m.type] || '📡';
    const lastStatus = m.lastStatus || 'N/A';

    msg += `${status} **${i + 1}.** ${icon} `;

    switch (m.type) {
      case 'url': msg += `${m.url} → ${lastStatus}`; break;
      case 'reminder': msg += `Lembrete: ${m.message}`; break;
      case 'rss': msg += `Feed: ${m.url}`; break;
      case 'keyword': msg += `"${m.keyword}" em ${m.url}`; break;
    }

    msg += `\n   ⏱️ ${formatInterval(m.intervalMs)} | Checks: ${m.checkCount} | Alertas: ${m.alertCount}\n\n`;
  });

  return msg;
}

/**
 * Remove monitor
 */
function deleteMonitor(identifier, userId = 'default') {
  const idx = monitors.findIndex(m =>
    (m.id === identifier || (m.url && m.url.includes(identifier)) ||
      (m.message && m.message.includes(identifier))) &&
    m.userId === userId
  );

  if (idx === -1) {
    const num = parseInt(identifier);
    const userMonitors = monitors.filter(m => m.userId === userId);
    if (num >= 1 && num <= userMonitors.length) {
      const target = userMonitors[num - 1];
      const mainIdx = monitors.indexOf(target);
      if (mainIdx >= 0) {
        monitors.splice(mainIdx, 1);
        save();
        return { success: true, message: `✅ Monitor removido.` };
      }
    }
    return { success: false, error: '❌ Monitor não encontrado.' };
  }

  monitors.splice(idx, 1);
  save();
  return { success: true, message: '✅ Monitor removido.' };
}

// ═══════════════════════════════════════════════════════════
//  MOTOR DE MONITORIZAÇÃO
// ═══════════════════════════════════════════════════════════

function startMonitoring() {
  if (checkTimer) clearInterval(checkTimer);
  checkTimer = setInterval(runChecks, CHECK_INTERVAL_MS);
}

function stopMonitoring() {
  if (checkTimer) { clearInterval(checkTimer); checkTimer = null; }
}

async function runChecks() {
  const now = Date.now();

  for (const monitor of monitors) {
    if (!monitor.enabled) continue;

    // Verificar se é hora de checar
    const timeSinceLastCheck = now - (monitor.lastCheck || 0);
    if (timeSinceLastCheck < monitor.intervalMs) continue;

    try {
      switch (monitor.type) {
        case 'url': await checkUrl(monitor); break;
        case 'reminder': checkReminder(monitor); break;
        case 'rss': await checkRss(monitor); break;
        case 'keyword': await checkKeyword(monitor); break;
      }

      monitor.lastCheck = now;
      monitor.checkCount++;
    } catch (err) {
      console.error(`[AlertAgent] Erro no monitor ${monitor.id}:`, err.message);
    }
  }

  save();
}

// ── URL CHECK ──
async function checkUrl(monitor) {
  try {
    const result = await httpGet(monitor.url, 10000);
    const wasDown = monitor.lastStatus === 'DOWN';
    const isUp = result.ok;

    monitor.lastStatus = isUp ? 'UP' : 'DOWN';

    if (!isUp && !wasDown) {
      // Acabou de cair — alertar
      triggerAlert(monitor, `🔴 **ALERTA: Site em baixo!**\n\n🌐 ${monitor.url}\n⏰ ${new Date().toLocaleString('pt-PT')}\n📊 Status: ${result.status}`);
    } else if (isUp && wasDown) {
      // Voltou ao normal
      triggerAlert(monitor, `🟢 **Site de volta online!**\n\n🌐 ${monitor.url}\n⏰ ${new Date().toLocaleString('pt-PT')}\n⏱️ Latência: ${result.latency}ms`);
    }
  } catch (err) {
    if (monitor.lastStatus !== 'DOWN') {
      monitor.lastStatus = 'DOWN';
      triggerAlert(monitor, `🔴 **Site inacessível!**\n\n🌐 ${monitor.url}\n❌ ${err.message}`);
    }
  }
}

// ── REMINDER CHECK ──
function checkReminder(monitor) {
  if (Date.now() >= monitor.triggerAt) {
    triggerAlert(monitor, `💡 **Lembrete!**\n\n📝 ${monitor.message}\n⏰ ${new Date().toLocaleString('pt-PT')}`);
    monitor.enabled = false; // Lembrete único
  }
}

// ── RSS CHECK ──
async function checkRss(monitor) {
  try {
    const result = await httpGet(monitor.url, 15000);
    if (!result.ok) return;

    // Parse simples de RSS/Atom
    const items = parseRssFeed(result.body);

    if (!monitor._lastItems) {
      monitor._lastItems = items.slice(0, 5).map(i => i.title);
      return; // Primeira verificação — guardar sem alertar
    }

    // Novos itens
    const newItems = items.filter(i => !monitor._lastItems.includes(i.title));

    if (newItems.length > 0) {
      let msg = `📰 **Novos artigos (${monitor.url}):**\n\n`;
      newItems.slice(0, 5).forEach(item => {
        msg += `• **${item.title}**\n  🔗 ${item.link}\n\n`;
      });
      triggerAlert(monitor, msg);
      monitor._lastItems = items.slice(0, 10).map(i => i.title);
    }
  } catch (err) {
    console.error(`[AlertAgent] RSS error (${monitor.url}):`, err.message);
  }
}

// ── KEYWORD CHECK ──
async function checkKeyword(monitor) {
  try {
    const result = await httpGet(monitor.url, 15000);
    if (!result.ok) return;

    const found = result.body.toLowerCase().includes(monitor.keyword.toLowerCase());
    const wasMissing = !monitor._keywordPresent;

    monitor._keywordPresent = found;

    if (found && wasMissing) {
      triggerAlert(monitor, `🔍 **Keyword encontrada!**\n\n📝 "${monitor.keyword}"\n🌐 ${monitor.url}\n⏰ ${new Date().toLocaleString('pt-PT')}`);
    }
  } catch (err) {
    console.error(`[AlertAgent] Keyword check error:`, err.message);
  }
}

// ═══════════════════════════════════════════════════════════
//  NOTIFICAÇÕES
// ═══════════════════════════════════════════════════════════

function triggerAlert(monitor, message) {
  console.log(`[AlertAgent] 🔔 Alerta: ${message.substring(0, 80)}`);
  monitor.alertCount++;

  // Guardar no histórico
  alertHistory.push({
    monitorId: monitor.id,
    type: monitor.type,
    message,
    timestamp: Date.now()
  });
  saveAlertHistory();

  // Notificar via callback
  if (notifyCallback) {
    try {
      notifyCallback(monitor.userId, message);
    } catch (err) {
      console.error('[AlertAgent] Notify callback error:', err.message);
    }
  }
}

/**
 * Obter alertas recentes
 */
function getAlertHistory(limit = 20) {
  const recent = alertHistory.slice(-limit).reverse();

  if (recent.length === 0) {
    return '📭 Nenhum alerta registado.';
  }

  let msg = `🔔 **Alertas Recentes (${recent.length}):**\n\n`;
  recent.forEach(a => {
    const date = new Date(a.timestamp).toLocaleString('pt-PT');
    const icon = { url: '🌐', reminder: '💡', rss: '📰', keyword: '🔍' }[a.type] || '📡';
    msg += `${icon} ${date}\n${a.message.substring(0, 100)}\n\n`;
  });

  return msg;
}

// ═══════════════════════════════════════════════════════════
//  HTTP HELPER
// ═══════════════════════════════════════════════════════════

function httpGet(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const client = url.startsWith('https') ? https : http;

    const req = client.get(url, { timeout, headers: { 'User-Agent': 'NEXO/2.0' } }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 400,
          status: res.statusCode,
          body,
          latency: Date.now() - start
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ═══════════════════════════════════════════════════════════
//  RSS PARSER (simplificado)
// ═══════════════════════════════════════════════════════════

function parseRssFeed(xml) {
  const items = [];

  // RSS 2.0
  const rssItems = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];
  for (const item of rssItems) {
    const title = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i);
    const link = item.match(/<link>(.*?)<\/link>/i);
    if (title) {
      items.push({
        title: title[1].trim(),
        link: link ? link[1].trim() : ''
      });
    }
  }

  // Atom
  if (items.length === 0) {
    const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/gi) || [];
    for (const entry of entries) {
      const title = entry.match(/<title[^>]*>(.*?)<\/title>/i);
      const link = entry.match(/<link[^>]*href="([^"]+)"/i);
      if (title) {
        items.push({
          title: title[1].trim(),
          link: link ? link[1].trim() : ''
        });
      }
    }
  }

  return items;
}

// ═══════════════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════════════

function formatInterval(ms) {
  if (ms < 60 * 1000) return `${Math.round(ms / 1000)}s`;
  if (ms < 60 * 60 * 1000) return `${Math.round(ms / 60000)}min`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

function getStats() {
  return {
    total: monitors.length,
    active: monitors.filter(m => m.enabled).length,
    byType: {
      url: monitors.filter(m => m.type === 'url').length,
      reminder: monitors.filter(m => m.type === 'reminder').length,
      rss: monitors.filter(m => m.type === 'rss').length,
      keyword: monitors.filter(m => m.type === 'keyword').length
    },
    totalAlerts: alertHistory.length
  };
}

// ═══════════════════════════════════════════════════════════
//  EXPORTS
// ═══════════════════════════════════════════════════════════

module.exports = {
  init,
  createMonitor,
  listMonitors,
  deleteMonitor,
  getAlertHistory,
  getStats,
  parseMonitorRequest,
  startMonitoring,
  stopMonitoring
};
