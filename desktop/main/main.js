/**
 * 🖥️ NEXO Desktop - Main Process (Electron)
 * 
 * Gere janela, system tray, atalhos globais
 */

const { 
  app, 
  BrowserWindow, 
  Tray, 
  Menu, 
  ipcMain, 
  globalShortcut,
  shell,
  nativeTheme,
  nativeImage,
  session
} = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const definicoes = require('../../orchestrator/definicoes');

// Fix Chromium GPU cache errors on Windows (permission denied)
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-gpu-cache');
// Suppress Chromium GPU stderr noise
app.commandLine.appendSwitch('log-level', '3');

// Enable Speech Recognition (uses Google Cloud Speech services)
app.commandLine.appendSwitch('enable-speech-dispatcher');
app.commandLine.appendSwitch('enable-features', 'AudioServiceOutOfProcess,WebSpeechAPI');
// Enable experimental web platform features for better media support
app.commandLine.appendSwitch('enable-experimental-web-platform-features');
// Enable audio input/output
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('enable-usermedia-screen-capturing');
app.commandLine.appendSwitch('auto-accept-camera-and-microphone-capture');

// Configuração
const isDev = process.argv.includes('--dev');
// Arranque só na bandeja, sem mostrar a janela. Quem põe o NEXO a iniciar com
// o sistema não quer uma janela a saltar à frente do que estava a fazer.
const arrancarOculto = process.argv.includes('--oculto');
const CORE_PORT = process.env.PORT || 7777;
const CORE_CHECK_INTERVAL = 3000;

// Estado
let mainWindow = null;
let tray = null;
let coreProcess = null;
let isQuitting = false;
let coreOnline = false;

// ═══════════════════════════════════════════════════════════
// CORE MANAGEMENT
// ═══════════════════════════════════════════════════════════

/** Já há um motor a responder nesta porta? */
async function coreResponde() {
  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), 800);
  try {
    const resposta = await fetch(`http://localhost:${CORE_PORT}/api/status`, { signal: controlador.signal });
    return resposta.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(relogio);
  }
}

async function startCore() {
  if (isDev) {
    console.log('[Main] Modo dev: Core deve ser iniciado manualmente (npm run core)');
    checkCoreStatus();
    return;
  }

  // Reaproveitar um motor já de pé. Sem esta verificação, abrir o NEXO com um
  // `npm run core` a correr punha um segundo servidor a morrer com EADDRINUSE
  // e a janela ficava a apontar para o primeiro sem ninguém perceber porquê.
  if (await coreResponde()) {
    console.log('[Main] Já há um Core a responder na porta', CORE_PORT, '— a usar esse.');
    coreOnline = true;
    updateTrayMenu();
    return;
  }

  const corePath = path.join(__dirname, '../../orchestrator/api-server.js');
  
  if (!fs.existsSync(corePath)) {
    console.error('[Main] Core não encontrado:', corePath);
    return;
  }
  
  console.log('[Main] A iniciar Core...');
  
  coreProcess = spawn('node', [corePath], {
    env: { ...process.env, NODE_ENV: 'production' },
    detached: false,
    windowsHide: true
  });
  
  coreProcess.stdout.on('data', (data) => {
    console.log('[Core]', data.toString().trim());
  });
  
  coreProcess.stderr.on('data', (data) => {
    console.error('[Core Error]', data.toString().trim());
  });
  
  coreProcess.on('close', (code) => {
    console.log('[Core] Processo terminado com código:', code);
    coreOnline = false;
    updateTrayMenu();
  });
  
  // Verificar status após iniciar
  setTimeout(checkCoreStatus, 2000);
}

async function checkCoreStatus() {
  try {
    const response = await fetch(`http://localhost:${CORE_PORT}/api/status`);
    coreOnline = response.ok;
  } catch {
    coreOnline = false;
  }
  
  updateTrayMenu();
  
  // Notificar renderer
  if (mainWindow) {
    mainWindow.webContents.send('core-status', { online: coreOnline });
  }
}

function stopCore() {
  if (coreProcess) {
    coreProcess.kill();
    coreProcess = null;
  }
}

// ═══════════════════════════════════════════════════════════
// JANELA PRINCIPAL
// ═══════════════════════════════════════════════════════════

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 500,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: false,
    // Com --oculto a janela existe mas nunca chega a aparecer: o NEXO fica na
    // bandeja à espera do atalho ou do clique.
    show: !arrancarOculto,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, '../../assets/icon.png')
  });
  
  // Interface única: carregamos a mesma página que o browser recebe, servida
  // pelo Core. Antes existia uma cópia em desktop/renderer que divergia da do
  // browser e recebia todas as melhorias que o browser nunca via.
  //
  // A janela é criada antes de startCore(), portanto as primeiras tentativas
  // falham por o servidor ainda não estar de pé. Repetimos até entrar, em vez
  // de deixar uma janela em branco.
  const CORE_URL = `http://localhost:${CORE_PORT}`;
  const RETRY_MS = 800;

  mainWindow.loadURL(CORE_URL);

  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    if (mainWindow.isDestroyed()) return;
    console.warn(`[UI] Core ainda não responde (${code}: ${description}), a repetir...`);
    setTimeout(() => {
      if (!mainWindow.isDestroyed()) mainWindow.loadURL(CORE_URL);
    }, RETRY_MS);
  });
  
  // Dev tools em desenvolvimento
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
  
  // Minimizar para tray ao fechar
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ═══════════════════════════════════════════════════════════
// SYSTEM TRAY
// ═══════════════════════════════════════════════════════════

function createTray() {
  const iconPath = path.join(__dirname, '../../assets/tray-icon.png');
  const fallbackPath = path.join(__dirname, '../../assets/icon.png');
  
  // Usar ícone existente ou criar ícone simples em memória
  let icon;
  if (fs.existsSync(iconPath)) {
    icon = iconPath;
  } else if (fs.existsSync(fallbackPath)) {
    icon = fallbackPath;
  } else {
    // Criar ícone azul 16x16 em memória (PNG base64)
    const iconBase64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAM0lEQVQ4T2NkYGD4z0ABYBw1YNQAOgYBAxQM/v//TxGGxGBk/A8FONQQawDdvECKAYMUBABk4w0RsMJN9AAAAABJRU5ErkJggg==';
    icon = nativeImage.createFromDataURL(`data:image/png;base64,${iconBase64}`);
  }
  
  try {
    tray = new Tray(icon);
    tray.setToolTip('NEXO - Assistente IA');
    
    updateTrayMenu();
    
    // Clique no tray abre/esconde janela
    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });
  } catch (err) {
    console.warn('⚠️ Não foi possível criar tray:', err.message);
    // Continuar sem tray
  }
}

/**
 * Submenu do modo de arranque.
 *
 * A escolha fica guardada em memory/definicoes.json e só vale ao próximo
 * arranque — trocar de casca com o NEXO aberto obrigava a fechar a janela por
 * baixo do utilizador, o que é pior do que esperar.
 */
function construirMenuDeModos() {
  const actual = definicoes.obter('modo') || 'auto';
  const escondido = definicoes.obter('arrancarEscondido') === true;

  const modo = (id, label) => ({
    label,
    type: 'radio',
    checked: actual === id,
    click: () => { definicoes.definir('modo', id); updateTrayMenu(); }
  });

  return [
    { label: 'Aplica-se ao próximo arranque', enabled: false },
    { type: 'separator' },
    modo('auto', 'Automático (conforme o aparelho)'),
    modo('completo', 'Interface completa'),
    modo('leve', 'Modo leve (browser)'),
    modo('consola', 'Consola (terminal)'),
    modo('servico', 'Em segundo plano (sem janela)'),
    { type: 'separator' },
    {
      label: 'Arrancar escondido na bandeja',
      type: 'checkbox',
      checked: escondido,
      click: () => { definicoes.definir('arrancarEscondido', !escondido); updateTrayMenu(); }
    }
  ];
}

function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '🤖 NEXO',
      enabled: false
    },
    { type: 'separator' },
    {
      label: coreOnline ? '✅ Core Online' : '❌ Core Offline',
      enabled: false
    },
    { type: 'separator' },
    {
      label: '📱 Mostrar/Esconder',
      click: () => {
        if (mainWindow) {
          mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
        }
      }
    },
    {
      label: '🌐 Abrir Web',
      click: () => {
        shell.openExternal(`http://localhost:${CORE_PORT}`);
      }
    },
    { type: 'separator' },
    {
      label: '🚦 Modo de arranque',
      submenu: construirMenuDeModos()
    },
    {
      label: '⚙️ Preferências',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.webContents.send('show-preferences');
        }
      }
    },
    { type: 'separator' },
    {
      label: '❌ Sair',
      click: () => {
        isQuitting = true;
        stopCore();
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
}

// ═══════════════════════════════════════════════════════════
// ATALHOS GLOBAIS
// ═══════════════════════════════════════════════════════════

function registerShortcuts() {
  // Ctrl+Space (ou Cmd+Space no Mac) para mostrar/esconder
  globalShortcut.register('CommandOrControl+Space', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
  
  // Ctrl+Shift+M para nova conversa
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.webContents.send('new-conversation');
    }
  });
}

// ═══════════════════════════════════════════════════════════
// IPC HANDLERS
// ═══════════════════════════════════════════════════════════

ipcMain.handle('get-core-status', () => ({ online: coreOnline }));
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('minimize-window', () => mainWindow?.minimize());
ipcMain.handle('hide-window', () => mainWindow?.hide());
ipcMain.handle('show-window', () => mainWindow?.show());
ipcMain.handle('quit-app', () => { isQuitting = true; app.quit(); });
ipcMain.handle('open-external', (_, url) => shell.openExternal(url));

ipcMain.handle('copy-to-clipboard', (_, text) => {
  const { clipboard } = require('electron');
  clipboard.writeText(text);
  return true;
});

// ═══════════════════════════════════════════════════════════
// APP LIFECYCLE
// ═══════════════════════════════════════════════════════════

app.whenReady().then(() => {
  console.log('[NEXO Desktop] A iniciar...');
  
  // Auto-grant media permissions (microphone for speech recognition)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'microphone', 'audioCapture'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });
  
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const allowedPermissions = ['media', 'microphone', 'audioCapture'];
    return allowedPermissions.includes(permission);
  });
  
  createWindow();
  createTray();
  registerShortcuts();
  startCore();
  
  // Verificar core periodicamente
  setInterval(checkCoreStatus, CORE_CHECK_INTERVAL);
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Não sair, manter no tray
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopCore();
  try { globalShortcut.unregisterAll(); } catch (e) { /* ignore if not ready */ }
});

// Prevenir múltiplas instâncias
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
