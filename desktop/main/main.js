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

// Prevenir múltiplas instâncias — tem de ser a primeira coisa a acontecer.
// Antes estava no fim do ficheiro, depois de app.whenReady() já registado: se
// o bloqueio falhasse (outra instância presa em segundo plano, por exemplo de
// um arranque anterior que não fechou bem), o app.quit() disparava em
// silêncio, sem janela, sem Core, sem uma linha na consola a dizer porquê —
// e quem estivesse a arrancar via `npm start` via só o terminal a voltar ao
// prompt sem explicação nenhuma.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.error('[Main] Já há outra instância do NEXO a correr — a fechar esta.');
  console.error('       Se não vires nenhuma janela, procura "Electron" ou "NEXO" no Gestor de Tarefas e termina-a.');
  app.quit();
  process.exit(0);
}

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
app.commandLine.appendSwitch('enable-usermedia-screen-capturing');

// NOTA: não estão aqui os interruptores use-fake-ui-for-media-stream nem
// auto-accept-camera-and-microphone-capture. Ambos aceitam microfone e câmara
// ao nível do Chromium, ANTES de a decisão chegar ao nosso handler — o que
// tornaria inútil restringir as permissões à origem do Core (ver
// configurarPermissoes). Quem autoriza é o handler, e só para localhost.

// Configuração
const isDev = process.argv.includes('--dev');
const CORE_PORT = process.env.PORT || 7777;
const CORE_URL = `http://localhost:${CORE_PORT}`;
const CORE_CHECK_INTERVAL = 3000;

/** Quanto se espera pelo Core antes de assumir que não vem. */
const CORE_ARRANQUE_MAX_MS = 30000;

/**
 * Arranque só na bandeja, sem mostrar a janela.
 *
 * Duas portas de entrada: o argumento (usado pelo arranque.js, que lê as
 * definições e passa --oculto) e a definição em si, para quem chama o Electron
 * directamente com `npm run desktop`. Sem esta segunda, a opção da bandeja
 * ficava guardada mas sem efeito nesse caminho.
 */
const arrancarOculto =
  process.argv.includes('--oculto') ||
  definicoes.obter('arrancarEscondido') === true;

// Estado
let mainWindow = null;
let tray = null;
let coreProcess = null;
let isQuitting = false;
let coreOnline = false;

// ═══════════════════════════════════════════════════════════
// CORE MANAGEMENT
// ═══════════════════════════════════════════════════════════

/**
 * Já há um motor a responder nesta porta?
 *
 * É a ÚNICA forma de testar o Core em todo o ficheiro. Antes havia duas — esta
 * e um fetch sem timeout dentro do checkCoreStatus — e a segunda podia ficar
 * pendurada num pedido que nunca fechava.
 */
async function coreResponde(timeoutMs = 800) {
  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), timeoutMs);
  try {
    const resposta = await fetch(`${CORE_URL}/api/status`, { signal: controlador.signal });
    return resposta.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(relogio);
  }
}

/** Espera que o Core comece a responder, com tecto. */
async function esperarPeloCore(maxMs = CORE_ARRANQUE_MAX_MS) {
  const limite = Date.now() + maxMs;

  while (Date.now() < limite) {
    if (await coreResponde()) return true;
    await new Promise(r => setTimeout(r, 400));
  }

  return false;
}

/**
 * Põe o Core de pé e espera que responda.
 * @returns {Promise<boolean>} o Core está a responder?
 */
async function startCore() {
  if (isDev) {
    console.log('[Main] Modo dev: Core deve ser iniciado manualmente (npm run core)');
    return await esperarPeloCore(5000);
  }

  // Reaproveitar um motor já de pé. Sem esta verificação, abrir o NEXO com um
  // `npm run core` a correr punha um segundo servidor a morrer com EADDRINUSE
  // e a janela ficava a apontar para o primeiro sem ninguém perceber porquê.
  if (await coreResponde()) {
    console.log('[Main] Já há um Core a responder na porta', CORE_PORT, '— a usar esse.');
    coreOnline = true;
    updateTrayMenu();
    return true;
  }

  const corePath = path.join(__dirname, '../../orchestrator/api-server.js');

  if (!fs.existsSync(corePath)) {
    console.error('[Main] Core não encontrado:', corePath);
    return false;
  }

  console.log('[Main] A iniciar Core...');

  // process.execPath + ELECTRON_RUN_AS_NODE em vez de 'node': num .exe
  // distribuído, a máquina de quem o recebe pode não ter Node instalado
  // nenhum. Assim usa-se o runtime que vem dentro do próprio Electron, que
  // está sempre lá. Em desenvolvimento dá no mesmo — o binário é o do
  // node_modules e comporta-se como Node com esta variável ligada.
  coreProcess = spawn(process.execPath, [corePath], {
    env: { ...process.env, NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '1' },
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

  const subiu = await esperarPeloCore();
  coreOnline = subiu;
  updateTrayMenu();

  if (!subiu) console.error('[Main] O Core não respondeu dentro do tempo previsto.');
  return subiu;
}

async function checkCoreStatus() {
  coreOnline = await coreResponde();

  updateTrayMenu();

  // Notificar renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
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

/**
 * Página local mostrada enquanto o Core arranca, e quando ele não vem.
 *
 * Vai numa data URL em vez de num ficheiro para não haver um segundo sítio
 * onde a interface vive — o desktop/renderer/ foi apagado exactamente por
 * isso, e não vale a pena trazê-lo de volta por causa de dez linhas.
 */
function ecraDeArranque(erro = null) {
  const html = `<!doctype html><html lang="pt"><meta charset="utf-8"><style>
    html,body{height:100%;margin:0;font-family:'Segoe UI',system-ui,sans-serif;
      background:#0f0f23;color:#e0e0e0;display:flex;align-items:center;
      justify-content:center;-webkit-app-region:drag;border-radius:12px}
    .c{text-align:center;padding:24px}
    .i{font-size:44px;margin-bottom:14px}
    h1{font-size:17px;font-weight:600;margin:0 0 8px}
    p{font-size:13px;color:#8a8aa0;margin:0;line-height:1.6;max-width:34ch}
    .p{margin-top:18px;height:2px;width:150px;background:#22223a;border-radius:2px;overflow:hidden}
    .p i{display:block;height:100%;width:40%;background:#6c63ff;border-radius:2px;
      animation:s 1.1s ease-in-out infinite}
    @keyframes s{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
    @media (prefers-reduced-motion:reduce){.p i{animation:none;width:100%}}
    code{color:#a89dff;font-size:12px}
  </style><div class="c">
    <div class="i">${erro ? '⚠️' : '🤖'}</div>
    <h1>${erro ? 'O NEXO não conseguiu arrancar' : 'A arrancar o NEXO'}</h1>
    <p>${erro
      ? 'O motor não respondeu. Abre um terminal na pasta do projecto e corre <code>npm run diagnostico</code> para saber o que falta.'
      : 'A preparar os agentes e a memória. Demora uns segundos da primeira vez.'}</p>
    ${erro ? '' : '<div class="p"><i></i></div>'}
  </div></html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/** Troca o ecrã de arranque pela interface servida pelo Core. */
function mostrarInterface(coreSubiu) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.loadURL(coreSubiu ? CORE_URL : ecraDeArranque(true));
}

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
  
  // Ecrã de arranque enquanto o Core sobe.
  //
  // Antes carregava-se logo o CORE_URL, com o servidor ainda por levantar: a
  // primeira tentativa falhava sempre, de propósito, e recuperava-se pelo
  // did-fail-load. Funcionava, mas o utilizador via uma janela vazia e nós
  // provocávamos um erro para depois o apanhar. Agora há resposta visual
  // imediata e o CORE_URL só é carregado quando há alguém do outro lado.
  mainWindow.loadURL(ecraDeArranque());

  // Rede de segurança: se o Core cair depois de ter subido, a página perde-se.
  // Aqui não se provoca o erro — só se recupera dele.
  mainWindow.webContents.on('did-fail-load', (_event, code, description, urlFalhado) => {
    if (mainWindow.isDestroyed()) return;
    if (!String(urlFalhado || '').startsWith(CORE_URL)) return;

    console.warn(`[UI] Falha a carregar a interface (${code}: ${description}), a repetir...`);
    setTimeout(() => {
      if (!mainWindow.isDestroyed()) mainWindow.loadURL(CORE_URL);
    }, 800);
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
/**
 * Abrir no browser do sistema — só http e https.
 *
 * shell.openExternal entrega o endereço ao sistema operativo, que o encaminha
 * para quem estiver registado para aquele protocolo. Sem esta verificação, um
 * `file:`, um `mailto:` ou um esquema de aplicação qualquer que chegasse à
 * interface saía daqui como pedido legítimo ao sistema.
 */
ipcMain.handle('open-external', async (_, url) => {
  try {
    const endereco = new URL(String(url));

    if (!['http:', 'https:'].includes(endereco.protocol)) {
      throw new Error(`protocolo não permitido: ${endereco.protocol}`);
    }

    await shell.openExternal(endereco.toString());
    return true;
  } catch (err) {
    console.warn('[IPC] Endereço externo recusado:', url, '—', err.message);
    return false;
  }
});

ipcMain.handle('copy-to-clipboard', (_, text) => {
  const { clipboard } = require('electron');
  clipboard.writeText(text);
  return true;
});

// ═══════════════════════════════════════════════════════════
// APP LIFECYCLE
// ═══════════════════════════════════════════════════════════

/**
 * Microfone e afins: só para a interface do próprio NEXO.
 *
 * Antes concedia-se a qualquer origem. A janela só carrega o Core, mas uma
 * autorização que não olha a quem a pede é uma porta aberta à espera de
 * alguém — e este ficheiro vai ganhar mais poderes, não menos.
 */
function configurarPermissoes() {
  const PERMITIDAS = ['media', 'microphone', 'audioCapture'];

  const daNossaInterface = (webContents) => {
    try {
      const url = webContents?.getURL?.() || '';
      return url.startsWith(CORE_URL);
    } catch (e) {
      return false;
    }
  };

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(PERMITIDAS.includes(permission) && daNossaInterface(webContents));
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission, origem) => {
    if (!PERMITIDAS.includes(permission)) return false;
    // Neste handler a origem chega como argumento e é mais fiável do que o
    // URL do webContents, que pode ainda estar a meio de uma navegação.
    return origem ? origem.startsWith(CORE_URL) : daNossaInterface(webContents);
  });
}

app.whenReady().then(async () => {
  console.log('[NEXO Desktop] A iniciar...');

  configurarPermissoes();

  // A ordem importa: a bandeja primeiro, para haver sempre onde carregar
  // mesmo que o resto demore; a janela a seguir, com o ecrã de arranque, para
  // o clique no ícone ter resposta imediata; e só depois o Core, esperado até
  // responder, antes de se mostrar a interface.
  createTray();
  registerShortcuts();
  createWindow();

  const coreSubiu = await startCore();
  mostrarInterface(coreSubiu);

  // Verificar core periodicamente
  setInterval(checkCoreStatus, CORE_CHECK_INTERVAL);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      mostrarInterface(coreOnline);
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

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});
