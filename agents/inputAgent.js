/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🎮 INPUT AGENT - Level 3: Teclado, Rato, Screenshots, Clipboard
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Funcionalidades:
 * - Automação de teclado (digitar, atalhos)
 * - Automação de rato (click, scroll, move)
 * - Screenshots com proteção de dados sensíveis
 * - Clipboard (copiar/colar)
 * 
 * Protecções:
 * - Blacklist de sites/apps sensíveis (bancos, crypto, pagamentos)
 * - Detecção de contexto sensível (password, checkout)
 * - Rate limiting (máx. ações por minuto)
 * - Sistema de pré-aprovação para ações críticas
 * - Logging completo
 */

const { exec, execSync, spawn } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs');
const path = require('path');
const powershell = require('./powershell');

// ═══════════════════════════════════════════════════════════
// CONFIGURAÇÃO
// ═══════════════════════════════════════════════════════════

const ENABLED = process.env.INPUT_AGENT_ENABLED !== 'false';
const REQUIRE_APPROVAL = process.env.INPUT_REQUIRE_APPROVAL !== 'false';
const MAX_ACTIONS_PER_MINUTE = parseInt(process.env.INPUT_RATE_LIMIT) || 30;

// Contador de rate limiting
let actionCount = 0;
let lastResetTime = Date.now();

// Log file
const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'input-actions.log');

// Criar diretório de logs
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// ═══════════════════════════════════════════════════════════
// BLACKLIST - Sites e Apps onde NÃO funciona
// ═══════════════════════════════════════════════════════════

const BLACKLISTED_WINDOWS = [
  // Bancos Portugueses
  'cgd', 'caixadirecta', 'bpi', 'millenniumbcp', 'santander', 'novobanco',
  'bankinter', 'montepio', 'credito agricola', 'eurobic', 'activobank',
  // Bancos Internacionais
  'revolut', 'n26', 'wise', 'transferwise', 'paypal',
  // Crypto
  'binance', 'coinbase', 'kraken', 'metamask', 'ledger', 'trezor',
  'crypto.com', 'kucoin', 'bybit', 'okx', 'gate.io',
  // Pagamentos
  'mbway', 'stripe', 'checkout', 'payment', 'pagamento',
  'cartão', 'cartao', 'credit card', 'debit card',
  // Autenticação
  'password', 'palavra-passe', 'palavra passe', 'iniciar sessão',
  'login', 'sign in', 'signin', 'autenticação', '2fa', 'authenticator',
  // Outros sensíveis
  'private key', 'seed phrase', 'recovery phrase', 'mnemonic',
  'social security', 'nif', 'número fiscal'
];

const BLACKLISTED_URLS = [
  // Bancos
  'cgd.pt', 'bpi.pt', 'millenniumbcp.pt', 'santander.pt', 'novobanco.pt',
  'bankinter.pt', 'montepio.pt', 'creditoagricola.pt',
  'revolut.com', 'n26.com', 'wise.com',
  // Crypto
  'binance.com', 'coinbase.com', 'kraken.com', 'crypto.com',
  // Pagamentos
  'paypal.com', 'stripe.com', 'checkout.'
];

// ═══════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════

/**
 * Executa script PowerShell via ficheiro temporário (resolve problemas de here-strings)
 */
async function runPowerShellScript(script) {
  const tempScript = path.join(process.env.TEMP || 'C:\\Temp', `ps_${Date.now()}.ps1`);
  try {
    fs.writeFileSync(tempScript, script, 'utf8');
    const { stdout, stderr } = await execPromise(`powershell -ExecutionPolicy Bypass -File "${tempScript}"`);
    return { success: true, stdout: stdout.trim(), stderr };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    try { fs.unlinkSync(tempScript); } catch(e) {}
  }
}

/**
 * Log de operação
 */
function logAction(action, details, success = true) {
  const timestamp = new Date().toISOString();
  const status = success ? 'SUCCESS' : 'FAILED';
  const logEntry = `[${timestamp}] [${status}] ${action}: ${JSON.stringify(details)}\n`;
  
  fs.appendFileSync(LOG_FILE, logEntry);
  console.log(`[Input] ${action}:`, details);
}

/**
 * Verifica rate limiting
 */
function checkRateLimit() {
  const now = Date.now();
  
  // Reset contador a cada minuto
  if (now - lastResetTime > 60000) {
    actionCount = 0;
    lastResetTime = now;
  }
  
  if (actionCount >= MAX_ACTIONS_PER_MINUTE) {
    return { allowed: false, error: `Rate limit atingido (${MAX_ACTIONS_PER_MINUTE} ações/min). Aguarda ${Math.ceil((60000 - (now - lastResetTime)) / 1000)}s` };
  }
  
  actionCount++;
  return { allowed: true };
}

/**
 * Obtém título da janela ativa
 */
async function getActiveWindowTitle() {
  try {
    const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@
\$hwnd = [Win32]::GetForegroundWindow()
\$sb = New-Object System.Text.StringBuilder 256
[Win32]::GetWindowText(\$hwnd, \$sb, \$sb.Capacity)
Write-Output \$sb.ToString()
`;
    
    const result = await runPowerShellScript(psScript);
    return result.success ? result.stdout : '';
  } catch {
    return '';
  }
}

/**
 * Verifica se contexto é sensível
 */
async function isContextSensitive() {
  const windowTitle = await getActiveWindowTitle();
  const titleLower = windowTitle.toLowerCase();
  
  // Verificar blacklist de janelas
  for (const blocked of BLACKLISTED_WINDOWS) {
    if (titleLower.includes(blocked.toLowerCase())) {
      return { 
        sensitive: true, 
        reason: `Janela "${windowTitle}" contém termo bloqueado: "${blocked}"`,
        window: windowTitle
      };
    }
  }
  
  // Verificar se browser está em site blacklisted
  if (titleLower.includes('chrome') || titleLower.includes('firefox') || 
      titleLower.includes('edge') || titleLower.includes('brave')) {
    for (const url of BLACKLISTED_URLS) {
      if (titleLower.includes(url.toLowerCase().replace('.', ''))) {
        return { 
          sensitive: true, 
          reason: `Browser em site bloqueado: ${url}`,
          window: windowTitle
        };
      }
    }
  }
  
  return { sensitive: false, window: windowTitle };
}

/**
 * Gera plano de ação para pré-aprovação
 */
function generateActionPlan(actions) {
  let plan = '📋 **Plano de Ação Proposto:**\n\n';
  
  actions.forEach((action, i) => {
    const icon = {
      'type': '⌨️',
      'click': '🖱️',
      'scroll': '📜',
      'move': '➡️',
      'shortcut': '⚡',
      'screenshot': '📸',
      'copy': '📋',
      'paste': '📄'
    }[action.type] || '▶️';
    
    plan += `${i + 1}. ${icon} **${action.type.toUpperCase()}**: ${action.description}\n`;
  });
  
  plan += '\n⚠️ *Estas ações serão executadas automaticamente após aprovação.*';
  plan += '\n\nResponde **"sim"** ou **"aprovar"** para executar, ou **"não"** para cancelar.';
  
  return plan;
}

// ═══════════════════════════════════════════════════════════
// TECLADO
// ═══════════════════════════════════════════════════════════

/**
 * Simula digitação de texto
 */
async function typeText(text, options = {}) {
  if (!ENABLED) return { success: false, error: 'Input Agent desativado' };
  
  // Verificar rate limit
  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) return { success: false, error: rateCheck.error };
  
  // Verificar contexto sensível
  const context = await isContextSensitive();
  if (context.sensitive) {
    logAction('TYPE_TEXT', { text: '[BLOQUEADO]', reason: context.reason }, false);
    return { success: false, error: `🛡️ Bloqueado: ${context.reason}` };
  }
  
  try {
    // Usar PowerShell SendKeys
    const escapedText = text
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "''")
      .replace(/\{/g, '{{')
      .replace(/\}/g, '}}')
      .replace(/\+/g, '{+}')
      .replace(/\^/g, '{^}')
      .replace(/~/g, '{~}')
      .replace(/%/g, '{%}');
    
    const delay = options.delay || 50;
    
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      Start-Sleep -Milliseconds 100
      [System.Windows.Forms.SendKeys]::SendWait('${escapedText}')
    `;
    
      await runPowerShellScript(psScript);
    
    logAction('TYPE_TEXT', { chars: text.length, window: context.window });
    
    return {
      success: true,
      typed: text.length,
      window: context.window,
      message: `Digitado ${text.length} caracteres`
    };
  } catch (error) {
    logAction('TYPE_TEXT', { error: error.message }, false);
    return { success: false, error: `Erro ao digitar: ${error.message}` };
  }
}

/**
 * Executa atalho de teclado
 */
async function pressShortcut(keys) {
  if (!ENABLED) return { success: false, error: 'Input Agent desativado' };
  
  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) return { success: false, error: rateCheck.error };
  
  // Mapear teclas comuns
  const keyMap = {
    'ctrl': '^',
    'alt': '%',
    'shift': '+',
    'win': '^{ESC}',
    'enter': '{ENTER}',
    'tab': '{TAB}',
    'escape': '{ESC}',
    'esc': '{ESC}',
    'backspace': '{BACKSPACE}',
    'delete': '{DELETE}',
    'home': '{HOME}',
    'end': '{END}',
    'pageup': '{PGUP}',
    'pagedown': '{PGDN}',
    'up': '{UP}',
    'down': '{DOWN}',
    'left': '{LEFT}',
    'right': '{RIGHT}',
    'f1': '{F1}', 'f2': '{F2}', 'f3': '{F3}', 'f4': '{F4}',
    'f5': '{F5}', 'f6': '{F6}', 'f7': '{F7}', 'f8': '{F8}',
    'f9': '{F9}', 'f10': '{F10}', 'f11': '{F11}', 'f12': '{F12}'
  };
  
  // Atalhos comuns predefinidos
  const shortcuts = {
    'copy': '^c',
    'paste': '^v',
    'cut': '^x',
    'undo': '^z',
    'redo': '^y',
    'save': '^s',
    'selectall': '^a',
    'find': '^f',
    'new': '^n',
    'open': '^o',
    'print': '^p',
    'close': '^w',
    'alttab': '%{TAB}',
    'refresh': '{F5}',
    'fullscreen': '{F11}'
  };
  
  // Verificar se é atalho predefinido
  const keysLower = keys.toLowerCase().replace(/\s+/g, '');
  let sendKeys = shortcuts[keysLower];
  
  if (!sendKeys) {
    // Construir a partir das teclas individuais
    sendKeys = keys.toLowerCase().split('+').map(k => {
      const trimmed = k.trim();
      return keyMap[trimmed] || trimmed;
    }).join('');
  }
  
  // Bloquear atalhos perigosos em contexto sensível
  const dangerousShortcuts = ['^v', '^{ENTER}', '{ENTER}'];
  const context = await isContextSensitive();
  
  if (context.sensitive && dangerousShortcuts.includes(sendKeys)) {
    logAction('SHORTCUT', { keys, blocked: true, reason: context.reason }, false);
    return { success: false, error: `🛡️ Atalho bloqueado em contexto sensível: ${context.reason}` };
  }
  
  try {
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      Start-Sleep -Milliseconds 50
      [System.Windows.Forms.SendKeys]::SendWait('${sendKeys}')
    `;
    
      await runPowerShellScript(psScript);
    
    logAction('SHORTCUT', { keys, sendKeys, window: context.window });
    
    return {
      success: true,
      shortcut: keys,
      window: context.window,
      message: `Atalho ${keys} executado`
    };
  } catch (error) {
    logAction('SHORTCUT', { keys, error: error.message }, false);
    return { success: false, error: `Erro ao executar atalho: ${error.message}` };
  }
}

/**
 * Pressiona tecla específica
 */
async function pressKey(key, times = 1) {
  if (!ENABLED) return { success: false, error: 'Input Agent desativado' };
  
  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) return { success: false, error: rateCheck.error };
  
  const keyMap = {
    'enter': '{ENTER}',
    'tab': '{TAB}',
    'escape': '{ESC}',
    'esc': '{ESC}',
    'backspace': '{BACKSPACE}',
    'delete': '{DELETE}',
    'space': ' ',
    'up': '{UP}',
    'down': '{DOWN}',
    'left': '{LEFT}',
    'right': '{RIGHT}'
  };
  
  const sendKey = keyMap[key.toLowerCase()] || key;
  
  try {
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      for ($i = 0; $i -lt ${times}; $i++) {
        [System.Windows.Forms.SendKeys]::SendWait('${sendKey}')
        Start-Sleep -Milliseconds 50
      }
    `;
    
      await runPowerShellScript(psScript);
    
    logAction('PRESS_KEY', { key, times });
    
    return {
      success: true,
      key,
      times,
      message: `Tecla ${key} pressionada ${times}x`
    };
  } catch (error) {
    logAction('PRESS_KEY', { key, error: error.message }, false);
    return { success: false, error: `Erro: ${error.message}` };
  }
}

// ═══════════════════════════════════════════════════════════
// RATO
// ═══════════════════════════════════════════════════════════

/**
 * Move o cursor para posição
 */
async function moveMouse(x, y) {
  if (!ENABLED) return { success: false, error: 'Input Agent desativado' };
  
  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) return { success: false, error: rateCheck.error };
  
  try {
    const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Mouse {
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);
}
"@
[Mouse]::SetCursorPos(${x}, ${y})
`;
    
    await runPowerShellScript(psScript);
    
    logAction('MOVE_MOUSE', { x, y });
    
    return {
      success: true,
      position: { x, y },
      message: `Cursor movido para (${x}, ${y})`
    };
  } catch (error) {
    logAction('MOVE_MOUSE', { x, y, error: error.message }, false);
    return { success: false, error: `Erro: ${error.message}` };
  }
}

/**
 * Click do rato
 */
async function mouseClick(button = 'left', x = null, y = null) {
  if (!ENABLED) return { success: false, error: 'Input Agent desativado' };
  
  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) return { success: false, error: rateCheck.error };
  
  // Verificar contexto
  const context = await isContextSensitive();
  if (context.sensitive) {
    logAction('MOUSE_CLICK', { button, x, y, blocked: true, reason: context.reason }, false);
    return { success: false, error: `🛡️ Click bloqueado: ${context.reason}` };
  }
  
  try {
    // Mover cursor se posição especificada
    if (x !== null && y !== null) {
      await moveMouse(x, y);
      await new Promise(r => setTimeout(r, 50));
    }
    
    const buttonCode = button === 'right' ? 2 : (button === 'middle' ? 4 : 1);
    
    const downFlag = buttonCode === 1 ? '0x0002' : buttonCode === 2 ? '0x0008' : '0x0020';
    const upFlag = buttonCode === 1 ? '0x0004' : buttonCode === 2 ? '0x0010' : '0x0040';
    
    const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MouseClick {
  [DllImport("user32.dll")]
  public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
}
"@
[MouseClick]::mouse_event(${downFlag}, 0, 0, 0, 0)
Start-Sleep -Milliseconds 50
[MouseClick]::mouse_event(${upFlag}, 0, 0, 0, 0)
`;
    
    await runPowerShellScript(psScript);
    
    logAction('MOUSE_CLICK', { button, x, y, window: context.window });
    
    return {
      success: true,
      button,
      position: { x, y },
      window: context.window,
      message: `Click ${button} em (${x || 'atual'}, ${y || 'atual'})`
    };
  } catch (error) {
    logAction('MOUSE_CLICK', { button, x, y, error: error.message }, false);
    return { success: false, error: `Erro: ${error.message}` };
  }
}

/**
 * Double click
 */
async function doubleClick(x = null, y = null) {
  const result1 = await mouseClick('left', x, y);
  if (!result1.success) return result1;
  
  await new Promise(r => setTimeout(r, 100));
  return mouseClick('left');
}

/**
 * Scroll do rato
 */
async function mouseScroll(direction = 'down', amount = 3) {
  if (!ENABLED) return { success: false, error: 'Input Agent desativado' };
  
  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) return { success: false, error: rateCheck.error };
  
  try {
    const scrollAmount = direction === 'up' ? 120 * amount : -120 * amount;
    
    const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MouseScroll {
  [DllImport("user32.dll")]
  public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
}
"@
[MouseScroll]::mouse_event(0x0800, 0, 0, ${scrollAmount}, 0)
`;
    
    await runPowerShellScript(psScript);
    
    logAction('MOUSE_SCROLL', { direction, amount });
    
    return {
      success: true,
      direction,
      amount,
      message: `Scroll ${direction} ${amount}x`
    };
  } catch (error) {
    logAction('MOUSE_SCROLL', { direction, amount, error: error.message }, false);
    return { success: false, error: `Erro: ${error.message}` };
  }
}

/**
 * Obtém posição atual do cursor
 */
async function getMousePosition() {
  try {
    const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct POINT { public int X; public int Y; }
public class Cursor {
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT lpPoint);
}
"@
$point = New-Object POINT
[Cursor]::GetCursorPos([ref]$point)
Write-Output "$($point.X),$($point.Y)"
`;
    
    const result = await runPowerShellScript(psScript);
    if (!result.success) return { success: false, error: result.error };
    
    // Extrair a última linha não vazia e garantir parsing robusto
    const lines = result.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const last = lines[lines.length - 1] || '';
    const [xStr, yStr] = last.split(',').map(s => s.trim());
    const x = Number(xStr), y = Number(yStr);
    if (isNaN(x) || isNaN(y)) {
      return { success: false, error: `Output inválido: "${result.stdout}"` };
    }
    return { success: true, x, y };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════
// SCREENSHOTS
// ═══════════════════════════════════════════════════════════

/**
 * Captura screenshot
 */
async function takeScreenshot(options = {}) {
  if (!ENABLED) return { success: false, error: 'Input Agent desativado' };
  
  // Verificar contexto - não capturar em sites sensíveis
  const context = await isContextSensitive();
  if (context.sensitive && !options.force) {
    logAction('SCREENSHOT', { blocked: true, reason: context.reason }, false);
    return { 
      success: false, 
      error: `🛡️ Screenshot bloqueado: ${context.reason}. Muda de janela antes de capturar.` 
    };
  }
  
  try {
    const screenshotDir = path.join(process.cwd(), 'screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    
    const filename = options.filename || `screenshot_${Date.now()}.png`;
    const filepath = path.join(screenshotDir, filename);
    
    // O script vai codificado, com as linhas intactas. Colá-lo dentro de
    // `powershell -Command "..."` perdia as aspas do caminho e juntava tudo
    // numa linha só, e a captura falhava sempre. Ver agents/powershell.js.
    await powershell.correr(`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$bitmap.Save(${powershell.comPlicas(filepath)}, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
Write-Output 'OK'
`);

    if (!fs.existsSync(filepath)) {
      throw new Error('o PowerShell não deu erro mas o ficheiro não apareceu');
    }
    
    logAction('SCREENSHOT', { file: filename, window: context.window });
    
    return {
      success: true,
      path: filepath,
      filename,
      message: `Screenshot guardado: ${filename}`
    };
  } catch (error) {
    logAction('SCREENSHOT', { error: error.message }, false);
    return { success: false, error: `Erro ao capturar: ${error.message}` };
  }
}

// ═══════════════════════════════════════════════════════════
// CLIPBOARD
// ═══════════════════════════════════════════════════════════

/**
 * Copia texto para clipboard
 */
async function copyToClipboard(text) {
  if (!ENABLED) return { success: false, error: 'Input Agent desativado' };
  
  // Não copiar dados sensíveis
  const sensitivePatterns = [
    /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Cartão de crédito
    /\b\d{9}\b/, // NIF PT
    /\bpassword\s*[:=]\s*\S+/i,
    /\bseed\s+phrase\b/i,
    /\bprivate\s+key\b/i
  ];
  
  for (const pattern of sensitivePatterns) {
    if (pattern.test(text)) {
      logAction('COPY_CLIPBOARD', { blocked: true, reason: 'Dados sensíveis detectados' }, false);
      return { success: false, error: '🛡️ Não é possível copiar: dados sensíveis detectados' };
    }
  }
  
  try {
    // Escapar para PowerShell
    const escaped = text.replace(/'/g, "''");
    
    await execPromise(`powershell -Command "Set-Clipboard -Value '${escaped}'"`);
    
    logAction('COPY_CLIPBOARD', { chars: text.length });
    
    return {
      success: true,
      chars: text.length,
      message: `Copiado ${text.length} caracteres`
    };
  } catch (error) {
    logAction('COPY_CLIPBOARD', { error: error.message }, false);
    return { success: false, error: `Erro: ${error.message}` };
  }
}

/**
 * Obtém texto do clipboard
 */
async function getClipboard() {
  if (!ENABLED) return { success: false, error: 'Input Agent desativado' };
  
  try {
    const { stdout } = await execPromise('powershell -Command "Get-Clipboard"');
    
    logAction('GET_CLIPBOARD', { chars: stdout.length });
    
    return {
      success: true,
      text: stdout.trim(),
      message: 'Clipboard obtido'
    };
  } catch (error) {
    return { success: false, error: `Erro: ${error.message}` };
  }
}

/**
 * Cola do clipboard
 */
async function pasteFromClipboard() {
  // Verificar contexto
  const context = await isContextSensitive();
  if (context.sensitive) {
    logAction('PASTE_CLIPBOARD', { blocked: true, reason: context.reason }, false);
    return { success: false, error: `🛡️ Paste bloqueado: ${context.reason}` };
  }
  
  return pressShortcut('paste');
}

// ═══════════════════════════════════════════════════════════
// SISTEMA DE PRÉ-APROVAÇÃO
// ═══════════════════════════════════════════════════════════

// Fila de ações pendentes
const pendingActions = new Map();

/**
 * Cria um plano de ação para aprovação
 */
function createActionPlan(planId, actions) {
  const plan = {
    id: planId,
    actions: actions,
    created: Date.now(),
    status: 'pending',
    plan: generateActionPlan(actions)
  };
  
  pendingActions.set(planId, plan);
  
  return plan;
}

/**
 * Aprova e executa um plano de ação
 */
async function executeApprovedPlan(planId) {
  const plan = pendingActions.get(planId);
  
  if (!plan) {
    return { success: false, error: 'Plano não encontrado ou expirado' };
  }
  
  if (plan.status !== 'pending') {
    return { success: false, error: `Plano já foi ${plan.status}` };
  }
  
  plan.status = 'executing';
  const results = [];
  
  for (const action of plan.actions) {
    let result;
    
    switch (action.type) {
      case 'type':
        result = await typeText(action.text, action.options);
        break;
      case 'shortcut':
        result = await pressShortcut(action.keys);
        break;
      case 'key':
        result = await pressKey(action.key, action.times);
        break;
      case 'click':
        result = await mouseClick(action.button, action.x, action.y);
        break;
      case 'doubleclick':
        result = await doubleClick(action.x, action.y);
        break;
      case 'scroll':
        result = await mouseScroll(action.direction, action.amount);
        break;
      case 'move':
        result = await moveMouse(action.x, action.y);
        break;
      case 'screenshot':
        result = await takeScreenshot(action.options);
        break;
      case 'copy':
        result = await copyToClipboard(action.text);
        break;
      case 'paste':
        result = await pasteFromClipboard();
        break;
      default:
        result = { success: false, error: `Ação desconhecida: ${action.type}` };
    }
    
    results.push({ action: action.type, result });
    
    // Pausa entre ações
    if (action.delay) {
      await new Promise(r => setTimeout(r, action.delay));
    } else {
      await new Promise(r => setTimeout(r, 100));
    }
    
    // Parar se falhar e não for para continuar
    if (!result.success && !action.continueOnError) {
      plan.status = 'failed';
      break;
    }
  }
  
  plan.status = results.every(r => r.result.success) ? 'completed' : 'partial';
  plan.results = results;
  
  // Limpar plano após 5 minutos
  setTimeout(() => pendingActions.delete(planId), 5 * 60 * 1000);
  
  return {
    success: plan.status !== 'failed',
    status: plan.status,
    results,
    message: `Plano executado: ${results.filter(r => r.result.success).length}/${results.length} ações com sucesso`
  };
}

/**
 * Cancela um plano de ação
 */
function cancelPlan(planId) {
  const plan = pendingActions.get(planId);
  
  if (!plan) {
    return { success: false, error: 'Plano não encontrado' };
  }
  
  plan.status = 'cancelled';
  pendingActions.delete(planId);
  
  return { success: true, message: 'Plano cancelado' };
}

/**
 * Obtém plano pendente
 */
function getPendingPlan(planId) {
  return pendingActions.get(planId);
}

// ═══════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════

module.exports = {
  // Estado
  isEnabled: () => ENABLED,
  isContextSensitive,
  getActiveWindowTitle,
  
  // Teclado
  typeText,
  pressShortcut,
  pressKey,
  
  // Rato
  moveMouse,
  mouseClick,
  doubleClick,
  mouseScroll,
  getMousePosition,
  
  // Screenshot
  takeScreenshot,
  
  // Clipboard
  copyToClipboard,
  getClipboard,
  pasteFromClipboard,
  
  // Pré-aprovação
  createActionPlan,
  executeApprovedPlan,
  cancelPlan,
  getPendingPlan,
  generateActionPlan,
  
  // Utilitários
  checkRateLimit,
  BLACKLISTED_WINDOWS,
  BLACKLISTED_URLS
};
