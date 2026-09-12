/**
 * 🖥️ System Agent - Controlo de Ficheiros e Sistema (Nível 1)
 * 
 * Funcionalidades:
 * - Criar/ler/editar ficheiros
 * - Executar comandos controlados
 * - Abrir pastas
 * - Correr scripts
 * 
 * SEGURANÇA:
 * - Whitelist de comandos
 * - Paths restritos
 * - Confirmação para ações destrutivas
 * - Logs de todas as operações
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const os = require('os');

// ═══════════════════════════════════════════════════════════
// CONFIGURAÇÃO DE SEGURANÇA
// ═══════════════════════════════════════════════════════════

const ENABLED = process.env.SYSTEM_CONTROLLER_ENABLED !== 'false';
const REQUIRE_CONFIRMATION = process.env.REQUIRE_CONFIRMATION !== 'false';

// Pastas permitidas (expandir ~ para home)
const HOME = os.homedir();
const DEFAULT_ALLOWED_PATHS = [
  path.join(HOME, 'Documents'),
  path.join(HOME, 'Downloads'),
  path.join(HOME, 'Desktop'),
  path.join(HOME, '.mybot'),
  process.cwd(),                        // Directório do projecto
  path.join(process.cwd(), 'user_data'),
  path.join(process.cwd(), 'outputs')
];

const ALLOWED_PATHS = process.env.ALLOWED_PATHS 
  ? process.env.ALLOWED_PATHS.split(',').map(p => p.trim())
  : DEFAULT_ALLOWED_PATHS;

// Comandos permitidos (whitelist)
const DEFAULT_ALLOWED_COMMANDS = [
  // Informativos (seguros)
  'dir', 'ls', 'type', 'cat', 'echo', 'pwd', 'cd',
  'ipconfig', 'ifconfig', 'ping', 'hostname', 'whoami',
  'date', 'time', 'systeminfo', 'ver',
  // Node/NPM
  'node', 'npm', 'npx',
  // Git
  'git',
  // PowerShell info
  'Get-Date', 'Get-Location', 'Get-ChildItem', 'Get-Process', 'Get-Service'
];

const ALLOWED_COMMANDS = process.env.ALLOWED_COMMANDS
  ? process.env.ALLOWED_COMMANDS.split(',').map(c => c.trim().toLowerCase())
  : DEFAULT_ALLOWED_COMMANDS.map(c => c.toLowerCase());

// Comandos bloqueados (sempre)
const BLOCKED_COMMANDS = [
  'rm', 'del', 'rmdir', 'format', 'fdisk',
  'shutdown', 'reboot', 'restart',
  'reg', 'regedit',
  'net user', 'net localgroup',
  'takeown', 'icacls',
  'powershell -enc', 'cmd /c',
  'curl', 'wget', 'invoke-webrequest'  // Evitar downloads não autorizados
];

// Log de operações
const LOG_FILE = path.join(process.cwd(), 'logs', 'system-agent.log');

// ═══════════════════════════════════════════════════════════
// UTILITÁRIOS
// ═══════════════════════════════════════════════════════════

/**
 * Verifica se o agente está ativo
 */
function isEnabled() {
  return ENABLED;
}

/**
 * Log de operação
 */
function logOperation(operation, details, success = true) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${success ? '✅' : '❌'} ${operation}: ${JSON.stringify(details)}\n`;
  
  // Garantir que pasta logs existe
  const logsDir = path.dirname(LOG_FILE);
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  
  fs.appendFileSync(LOG_FILE, logEntry);
  console.log(`[System] ${operation}:`, details);
}

/**
 * Verifica se path está dentro das pastas permitidas
 */
function isPathAllowed(targetPath) {
  const resolved = path.resolve(targetPath);

  return ALLOWED_PATHS.some(allowed => {
    const raiz = path.resolve(allowed);

    // A própria pasta permitida conta.
    if (resolved === raiz) return true;

    // O separador no fim é o que impede a fuga por prefixo. Um simples
    // startsWith(raiz) deixava passar "Documents_privado" por começar por
    // "Documents" — pasta diferente, sem relação nenhuma, mas aceite.
    return resolved.startsWith(raiz + path.sep);
  });
}

/**
 * Verifica se comando está na whitelist
 */
function isCommandAllowed(command) {
  const cmd = command.toLowerCase().trim();
  
  // Verificar comandos bloqueados
  for (const blocked of BLOCKED_COMMANDS) {
    if (cmd.includes(blocked.toLowerCase())) {
      return { allowed: false, reason: `Comando bloqueado: ${blocked}` };
    }
  }
  
  // Verificar whitelist
  const firstWord = cmd.split(/\s+/)[0];
  if (ALLOWED_COMMANDS.includes(firstWord)) {
    return { allowed: true };
  }
  
  return { allowed: false, reason: `Comando não permitido: ${firstWord}` };
}

/**
 * Expande path relativo ou com ~
 *
 * Ler e escrever não querem o mesmo sítio por omissão.
 *
 * Escrever num caminho relativo vai para user_data, e isso está certo: o que
 * o NEXO cria fica arrumado num canto só. Mas ler seguia a mesma regra, e
 * "lê o package.json do projeto" ia procurar user_data/package.json e
 * respondia "ficheiro não encontrado" com o ficheiro mesmo ali ao lado.
 *
 * Para leitura, procura-se onde a pessoa quis dizer: primeiro na pasta do
 * projecto, depois em user_data. Quem decide o que é permitido continua a ser
 * isPathAllowed: isto só escolhe entre caminhos que já estavam autorizados.
 */
function expandPath(inputPath, opcoes = {}) {
  let expanded = String(inputPath ?? '');

  // Expandir ~
  if (expanded.startsWith('~')) {
    expanded = expanded.replace('~', HOME);
  }

  // Se for apenas "." ou vazio, usar o directório do projecto
  if (expanded === '.' || expanded === '') {
    return path.resolve(process.cwd());
  }

  if (!path.isAbsolute(expanded)) {
    const noProjecto = path.resolve(process.cwd(), expanded);
    const userDataDir = path.join(process.cwd(), 'user_data');
    const emUserData = path.resolve(userDataDir, expanded);

    if (opcoes.paraLeitura) {
      if (fs.existsSync(noProjecto)) return noProjecto;
      if (fs.existsSync(emUserData)) return emUserData;
      // Nenhum existe: devolve-se o do projecto, que é o que se quis dizer,
      // para a mensagem de erro apontar ao sítio certo.
      return noProjecto;
    }

    // Escrita: criar user_data se não existir.
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
    return emUserData;
  }

  return path.resolve(expanded);
}

// ═══════════════════════════════════════════════════════════
// OPERAÇÕES DE FICHEIROS
// ═══════════════════════════════════════════════════════════

/**
 * Cria um ficheiro
 */
function createFile(filePath, content = '') {
  if (!ENABLED) return { success: false, error: 'System Controller desativado' };
  
  const fullPath = expandPath(filePath);
  
  // Verificar permissão de path
  if (!isPathAllowed(fullPath)) {
    logOperation('CREATE_FILE', { path: fullPath }, false);
    return { 
      success: false, 
      error: `Path não permitido. Paths permitidos:\n${ALLOWED_PATHS.join('\n')}` 
    };
  }
  
  try {
    // Criar diretório se não existir
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(fullPath, content, 'utf8');
    logOperation('CREATE_FILE', { path: fullPath, size: content.length });
    
    return { 
      success: true, 
      path: fullPath,
      size: content.length,
      message: `📄 Ficheiro criado: ${fullPath}`
    };
  } catch (error) {
    logOperation('CREATE_FILE', { path: fullPath, error: error.message }, false);
    return { success: false, error: error.message };
  }
}

/**
 * Lê conteúdo de um ficheiro
 */
function readFile(filePath) {
  if (!ENABLED) return { success: false, error: 'System Controller desativado' };
  
  const fullPath = expandPath(filePath, { paraLeitura: true });
  
  if (!isPathAllowed(fullPath)) {
    return { success: false, error: 'Path não permitido' };
  }
  
  try {
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `Ficheiro não encontrado: ${fullPath}` };
    }
    
    const stats = fs.statSync(fullPath);
    
    // Limite de tamanho (1MB)
    if (stats.size > 1024 * 1024) {
      return { success: false, error: 'Ficheiro muito grande (max 1MB)' };
    }
    
    const content = fs.readFileSync(fullPath, 'utf8');
    logOperation('READ_FILE', { path: fullPath, size: stats.size });
    
    return { 
      success: true, 
      path: fullPath,
      content: content,
      size: stats.size,
      message: `📖 Conteúdo de ${path.basename(fullPath)}:\n\n${content}`
    };
  } catch (error) {
    logOperation('READ_FILE', { path: fullPath, error: error.message }, false);
    return { success: false, error: error.message };
  }
}

/**
 * Edita/adiciona conteúdo a um ficheiro
 */
function editFile(filePath, content, mode = 'append') {
  if (!ENABLED) return { success: false, error: 'System Controller desativado' };
  
  const fullPath = expandPath(filePath);
  
  if (!isPathAllowed(fullPath)) {
    return { success: false, error: 'Path não permitido' };
  }
  
  try {
    if (mode === 'append') {
      fs.appendFileSync(fullPath, '\n' + content, 'utf8');
    } else if (mode === 'replace') {
      fs.writeFileSync(fullPath, content, 'utf8');
    } else if (mode === 'prepend') {
      const existing = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
      fs.writeFileSync(fullPath, content + '\n' + existing, 'utf8');
    }
    
    logOperation('EDIT_FILE', { path: fullPath, mode, contentLength: content.length });
    
    return { 
      success: true, 
      path: fullPath,
      message: `✏️ Ficheiro editado (${mode}): ${fullPath}`
    };
  } catch (error) {
    logOperation('EDIT_FILE', { path: fullPath, error: error.message }, false);
    return { success: false, error: error.message };
  }
}

/**
 * Lista ficheiros numa pasta
 */
function listDirectory(dirPath = '.') {
  if (!ENABLED) return { success: false, error: 'System Controller desativado' };
  
  const fullPath = expandPath(dirPath, { paraLeitura: true });
  
  if (!isPathAllowed(fullPath)) {
    return { success: false, error: 'Path não permitido' };
  }
  
  try {
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `Pasta não encontrada: ${fullPath}` };
    }
    
    const items = fs.readdirSync(fullPath, { withFileTypes: true });
    const files = [];
    const folders = [];
    
    items.forEach(item => {
      if (item.isDirectory()) {
        folders.push(`📁 ${item.name}/`);
      } else {
        const stats = fs.statSync(path.join(fullPath, item.name));
        const size = formatSize(stats.size);
        files.push(`📄 ${item.name} (${size})`);
      }
    });
    
    logOperation('LIST_DIR', { path: fullPath, items: items.length });
    
    let output = `📂 Conteúdo de: ${fullPath}\n\n`;
    if (folders.length) output += folders.join('\n') + '\n';
    if (files.length) output += files.join('\n');
    if (!folders.length && !files.length) output += '(pasta vazia)';
    
    return { 
      success: true, 
      path: fullPath,
      folders,
      files,
      message: output
    };
  } catch (error) {
    logOperation('LIST_DIR', { path: fullPath, error: error.message }, false);
    return { success: false, error: error.message };
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ═══════════════════════════════════════════════════════════
// EXECUÇÃO DE COMANDOS
// ═══════════════════════════════════════════════════════════

/**
 * Executa comando do sistema (whitelist)
 */
function executeCommand(command, options = {}) {
  return new Promise((resolve) => {
    if (!ENABLED) {
      return resolve({ success: false, error: 'System Controller desativado' });
    }
    
    // Verificar se comando é permitido
    const check = isCommandAllowed(command);
    if (!check.allowed) {
      logOperation('EXEC_CMD', { command, blocked: true }, false);
      return resolve({ success: false, error: check.reason });
    }
    
    const timeout = options.timeout || 30000; // 30s default
    const cwd = options.cwd || process.cwd();
    
    logOperation('EXEC_CMD', { command, cwd });
    
    exec(command, { cwd, timeout, shell: true }, (error, stdout, stderr) => {
      if (error) {
        logOperation('EXEC_CMD_RESULT', { command, error: error.message }, false);
        return resolve({ 
          success: false, 
          error: error.message,
          stderr: stderr
        });
      }
      
      const output = stdout || stderr || '(sem output)';
      
      return resolve({ 
        success: true, 
        output: output.trim(),
        message: `⚡ Comando: ${command}\n\n${output.trim()}`
      });
    });
  });
}

/**
 * Abre pasta no explorador de ficheiros
 */
function openFolder(folderPath) {
  return new Promise((resolve) => {
    if (!ENABLED) {
      return resolve({ success: false, error: 'System Controller desativado' });
    }
    
    const fullPath = expandPath(folderPath, { paraLeitura: true });
    
    if (!isPathAllowed(fullPath)) {
      return resolve({ success: false, error: 'Path não permitido' });
    }
    
    if (!fs.existsSync(fullPath)) {
      return resolve({ success: false, error: `Pasta não encontrada: ${fullPath}` });
    }
    
    // Comando para abrir pasta no Windows/Mac/Linux
    let command;
    if (process.platform === 'win32') {
      command = `explorer "${fullPath}"`;
    } else if (process.platform === 'darwin') {
      command = `open "${fullPath}"`;
    } else {
      command = `xdg-open "${fullPath}"`;
    }
    
    logOperation('OPEN_FOLDER', { path: fullPath });
    
    exec(command, (error) => {
      if (error) {
        logOperation('OPEN_FOLDER', { path: fullPath, error: error.message }, false);
        return resolve({ success: false, error: error.message });
      }
      
      return resolve({ 
        success: true, 
        path: fullPath,
        message: `📂 Pasta aberta: ${fullPath}`
      });
    });
  });
}

/**
 * Executa script (ps1, bat, sh, js)
 */
function runScript(scriptPath, args = []) {
  return new Promise((resolve) => {
    if (!ENABLED) {
      return resolve({ success: false, error: 'System Controller desativado' });
    }
    
    const fullPath = expandPath(scriptPath, { paraLeitura: true });
    
    if (!isPathAllowed(fullPath)) {
      return resolve({ success: false, error: 'Path não permitido' });
    }
    
    if (!fs.existsSync(fullPath)) {
      return resolve({ success: false, error: `Script não encontrado: ${fullPath}` });
    }
    
    const ext = path.extname(fullPath).toLowerCase();
    let command;
    
    switch (ext) {
      case '.ps1':
        command = `powershell -ExecutionPolicy Bypass -File "${fullPath}" ${args.join(' ')}`;
        break;
      case '.bat':
      case '.cmd':
        command = `"${fullPath}" ${args.join(' ')}`;
        break;
      case '.sh':
        command = `bash "${fullPath}" ${args.join(' ')}`;
        break;
      case '.js':
        command = `node "${fullPath}" ${args.join(' ')}`;
        break;
      default:
        return resolve({ success: false, error: `Tipo de script não suportado: ${ext}` });
    }
    
    logOperation('RUN_SCRIPT', { path: fullPath, args });
    
    exec(command, { timeout: 60000, cwd: path.dirname(fullPath) }, (error, stdout, stderr) => {
      if (error) {
        logOperation('RUN_SCRIPT_RESULT', { path: fullPath, error: error.message }, false);
        return resolve({ 
          success: false, 
          error: error.message,
          stderr
        });
      }
      
      return resolve({ 
        success: true, 
        output: stdout || stderr || '(script executado)',
        message: `🚀 Script executado: ${path.basename(fullPath)}\n\n${(stdout || stderr || '').trim()}`
      });
    });
  });
}

// ═══════════════════════════════════════════════════════════
// OPERAÇÕES DE SISTEMA
// ═══════════════════════════════════════════════════════════

/**
 * Informação do sistema
 */
function getSystemInfo() {
  return {
    success: true,
    info: {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      user: os.userInfo().username,
      home: HOME,
      cwd: process.cwd(),
      uptime: formatUptime(os.uptime()),
      memory: {
        total: formatSize(os.totalmem()),
        free: formatSize(os.freemem()),
        used: formatSize(os.totalmem() - os.freemem())
      },
      cpu: os.cpus()[0]?.model || 'Unknown'
    },
    message: `🖥️ **Informação do Sistema**

📍 **Sistema**: ${os.platform()} (${os.arch()})
👤 **Utilizador**: ${os.userInfo().username}
🏠 **Home**: ${HOME}
📂 **Pasta Atual**: ${process.cwd()}

💾 **Memória**:
   Total: ${formatSize(os.totalmem())}
   Usada: ${formatSize(os.totalmem() - os.freemem())}
   Livre: ${formatSize(os.freemem())}

⏱️ **Uptime**: ${formatUptime(os.uptime())}
🔧 **CPU**: ${os.cpus()[0]?.model || 'Unknown'}`
  };
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Retorna paths permitidos
 */
function getAllowedPaths() {
  return ALLOWED_PATHS;
}

/**
 * Retorna comandos permitidos
 */
function getAllowedCommands() {
  return ALLOWED_COMMANDS;
}

// ═══════════════════════════════════════════════════════════
// LEVEL 2 - APLICAÇÕES E PROCESSOS
// ═══════════════════════════════════════════════════════════

// Aplicações comuns e seus executáveis
const APP_ALIASES = {
  // Editores
  'notepad': 'notepad.exe',
  'bloco de notas': 'notepad.exe',
  'vscode': 'code',
  'code': 'code',
  'visual studio code': 'code',
  'sublime': 'subl',
  'notepad++': 'notepad++.exe',
  
  // Browsers
  'chrome': 'chrome',
  'google chrome': 'chrome',
  'firefox': 'firefox',
  'edge': 'msedge',
  'microsoft edge': 'msedge',
  'brave': 'brave',
  
  // Terminais
  'terminal': 'wt',
  'windows terminal': 'wt',
  'powershell': 'powershell',
  'cmd': 'cmd',
  'prompt': 'cmd',
  
  // Office
  'word': 'winword',
  'excel': 'excel',
  'powerpoint': 'powerpnt',
  'outlook': 'outlook',
  
  // Utilidades
  'calculadora': 'calc',
  'calculator': 'calc',
  'calc': 'calc',
  'explorer': 'explorer',
  'explorador': 'explorer',
  'paint': 'mspaint',
  'snipping': 'snippingtool',
  'task manager': 'taskmgr',
  'gestor de tarefas': 'taskmgr',
  
  // Dev
  'git bash': 'git-bash',
  'postman': 'postman',
  'docker': 'docker',
  'spotify': 'spotify',
  'discord': 'discord',
  'slack': 'slack',
  'teams': 'teams',
  'zoom': 'zoom'
};

/**
 * Abre uma aplicação
 */
async function openApp(appName, args = '') {
  if (!ENABLED) return { success: false, error: 'System Controller desativado' };
  
  const appLower = appName.toLowerCase().trim();
  const executable = APP_ALIASES[appLower] || appName;
  
  try {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    // Windows: usar start para abrir aplicações
    const command = args 
      ? `start "" "${executable}" ${args}`
      : `start "" "${executable}"`;
    
    await execPromise(command, { shell: 'cmd.exe' });
    
    logOperation('OPEN_APP', { app: appName, executable, args });
    
    return {
      success: true,
      app: appName,
      executable,
      message: `Aplicação "${appName}" aberta`
    };
  } catch (error) {
    logOperation('OPEN_APP', { app: appName, error: error.message }, false);
    return { success: false, error: `Não foi possível abrir "${appName}": ${error.message}` };
  }
}

/**
 * Abre URL no browser padrão
 */
async function openUrl(url) {
  if (!ENABLED) return { success: false, error: 'System Controller desativado' };
  
  // Adicionar https:// se não tiver protocolo
  let fullUrl = url;
  if (!url.match(/^https?:\/\//i)) {
    fullUrl = 'https://' + url;
  }
  
  try {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    // Windows: usar start para abrir URL
    await execPromise(`start "" "${fullUrl}"`, { shell: 'cmd.exe' });
    
    logOperation('OPEN_URL', { url: fullUrl });
    
    return {
      success: true,
      url: fullUrl,
      message: `URL aberto no browser`
    };
  } catch (error) {
    logOperation('OPEN_URL', { url, error: error.message }, false);
    return { success: false, error: `Não foi possível abrir URL: ${error.message}` };
  }
}

/**
 * Lista processos em execução
 */
async function listProcesses(filter = '') {
  if (!ENABLED) return { success: false, error: 'System Controller desativado' };
  
  try {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    // PowerShell para obter lista de processos formatada
    const psCommand = `Get-Process | Select-Object Id, ProcessName, CPU, @{N='Memory(MB)';E={[math]::Round($_.WorkingSet64/1MB,1)}} | Sort-Object -Property 'Memory(MB)' -Descending | Select-Object -First 30 | ConvertTo-Json`;
    
    const { stdout } = await execPromise(`powershell -Command "${psCommand}"`, { 
      maxBuffer: 1024 * 1024 
    });
    
    let processes = JSON.parse(stdout);
    if (!Array.isArray(processes)) processes = [processes];
    
    // Filtrar se especificado
    if (filter) {
      const filterLower = filter.toLowerCase();
      processes = processes.filter(p => 
        p.ProcessName.toLowerCase().includes(filterLower)
      );
    }
    
    logOperation('LIST_PROCESSES', { count: processes.length, filter: filter || 'none' });
    
    return {
      success: true,
      processes: processes.map(p => ({
        pid: p.Id,
        name: p.ProcessName,
        cpu: p.CPU ? p.CPU.toFixed(1) : '0',
        memory: p['Memory(MB)'] + ' MB'
      })),
      count: processes.length
    };
  } catch (error) {
    logOperation('LIST_PROCESSES', { error: error.message }, false);
    return { success: false, error: `Erro ao listar processos: ${error.message}` };
  }
}

/**
 * Termina um processo
 */
async function killProcess(identifier) {
  if (!ENABLED) return { success: false, error: 'System Controller desativado' };
  
  // Processos protegidos que não devem ser terminados
  const PROTECTED = ['explorer', 'csrss', 'winlogon', 'services', 'lsass', 'svchost', 'system', 'smss', 'wininit'];
  
  const identLower = identifier.toLowerCase();
  if (PROTECTED.some(p => identLower.includes(p))) {
    return { success: false, error: `Processo "${identifier}" é protegido e não pode ser terminado` };
  }
  
  try {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    // Verificar se é PID ou nome
    const isPid = /^\d+$/.test(identifier);
    
    let command;
    if (isPid) {
      command = `taskkill /PID ${identifier} /F`;
    } else {
      command = `taskkill /IM "${identifier}*" /F`;
    }
    
    const { stdout, stderr } = await execPromise(command);
    
    logOperation('KILL_PROCESS', { identifier, isPid });
    
    return {
      success: true,
      identifier,
      message: stdout || `Processo "${identifier}" terminado`
    };
  } catch (error) {
    // taskkill retorna erro se processo não existe, mas pode ter funcionado
    if (error.message.includes('not found') || error.message.includes('não encontrado')) {
      return { success: false, error: `Processo "${identifier}" não encontrado` };
    }
    logOperation('KILL_PROCESS', { identifier, error: error.message }, false);
    return { success: false, error: `Erro ao terminar processo: ${error.message}` };
  }
}

/**
 * Foca numa janela pelo nome
 */
async function focusWindow(windowName) {
  if (!ENABLED) return { success: false, error: 'System Controller desativado' };
  
  try {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    // PowerShell script para focar janela
    const psScript = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32 {
          [DllImport("user32.dll")]
          public static extern bool SetForegroundWindow(IntPtr hWnd);
        }
"@
      $process = Get-Process | Where-Object { $_.MainWindowTitle -like "*${windowName}*" } | Select-Object -First 1
      if ($process) {
        [Win32]::SetForegroundWindow($process.MainWindowHandle)
        Write-Output "Focado: $($process.MainWindowTitle)"
      } else {
        Write-Output "NOT_FOUND"
      }
    `;
    
    const { stdout } = await execPromise(`powershell -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      maxBuffer: 1024 * 1024
    });
    
    if (stdout.includes('NOT_FOUND')) {
      return { success: false, error: `Janela contendo "${windowName}" não encontrada` };
    }
    
    logOperation('FOCUS_WINDOW', { windowName, result: stdout.trim() });
    
    return {
      success: true,
      window: stdout.trim(),
      message: `Janela focada`
    };
  } catch (error) {
    logOperation('FOCUS_WINDOW', { windowName, error: error.message }, false);
    return { success: false, error: `Erro ao focar janela: ${error.message}` };
  }
}

/**
 * Minimiza/maximiza janela
 */
async function windowAction(windowName, action = 'minimize') {
  if (!ENABLED) return { success: false, error: 'System Controller desativado' };
  
  const validActions = ['minimize', 'maximize', 'restore', 'close'];
  if (!validActions.includes(action.toLowerCase())) {
    return { success: false, error: `Ação inválida. Use: ${validActions.join(', ')}` };
  }
  
  try {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    const actionCode = {
      'minimize': 6,
      'maximize': 3,
      'restore': 9,
      'close': -1 // handled differently
    };
    
    let psScript;
    if (action === 'close') {
      psScript = `
        $process = Get-Process | Where-Object { $_.MainWindowTitle -like "*${windowName}*" } | Select-Object -First 1
        if ($process) {
          $process.CloseMainWindow()
          Write-Output "Fechado: $($process.MainWindowTitle)"
        } else {
          Write-Output "NOT_FOUND"
        }
      `;
    } else {
      psScript = `
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          public class Win32 {
            [DllImport("user32.dll")]
            public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
          }
"@
        $process = Get-Process | Where-Object { $_.MainWindowTitle -like "*${windowName}*" } | Select-Object -First 1
        if ($process) {
          [Win32]::ShowWindow($process.MainWindowHandle, ${actionCode[action]})
          Write-Output "${action}: $($process.MainWindowTitle)"
        } else {
          Write-Output "NOT_FOUND"
        }
      `;
    }
    
    const { stdout } = await execPromise(`powershell -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      maxBuffer: 1024 * 1024
    });
    
    if (stdout.includes('NOT_FOUND')) {
      return { success: false, error: `Janela contendo "${windowName}" não encontrada` };
    }
    
    logOperation('WINDOW_ACTION', { windowName, action, result: stdout.trim() });
    
    return {
      success: true,
      action,
      window: stdout.trim(),
      message: `Janela ${action === 'close' ? 'fechada' : action === 'minimize' ? 'minimizada' : action === 'maximize' ? 'maximizada' : 'restaurada'}`
    };
  } catch (error) {
    logOperation('WINDOW_ACTION', { windowName, action, error: error.message }, false);
    return { success: false, error: `Erro: ${error.message}` };
  }
}

/**
 * Lista janelas abertas
 */
async function listWindows() {
  if (!ENABLED) return { success: false, error: 'System Controller desativado' };
  
  try {
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    const psCommand = `Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json`;
    
    const { stdout } = await execPromise(`powershell -Command "${psCommand}"`, {
      maxBuffer: 1024 * 1024
    });
    
    let windows = JSON.parse(stdout);
    if (!Array.isArray(windows)) windows = [windows];
    
    logOperation('LIST_WINDOWS', { count: windows.length });
    
    return {
      success: true,
      windows: windows.map(w => ({
        pid: w.Id,
        process: w.ProcessName,
        title: w.MainWindowTitle
      })),
      count: windows.length
    };
  } catch (error) {
    logOperation('LIST_WINDOWS', { error: error.message }, false);
    return { success: false, error: `Erro ao listar janelas: ${error.message}` };
  }
}

// ═══════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// PROCURAR DENTRO DOS FICHEIROS
// ═══════════════════════════════════════════════════════════

/**
 * Faltava isto, e era o que fazia o NEXO responder "cola-me o código".
 *
 * Listar uma pasta diz os nomes. Ler um ficheiro serve para quem já sabe qual.
 * Para "vê no código do NEXO onde é que isto acontece" era preciso procurar
 * dentro da árvore, e não havia maneira nenhuma de o fazer. Sem isto, ele só
 * podia pedir ao utilizador que lhe colasse o que ele tinha ao lado.
 *
 * É uma busca de leitura, sem regex do utilizador: texto simples, sem
 * maiúsculas nem minúsculas, com tecto de ficheiros e de resultados para não
 * varrer um disco inteiro à procura de uma palavra comum.
 */
const PASTAS_A_SALTAR = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage',
  '__pycache__', '.venv', 'venv', '.cache', 'logs', 'temp'
]);

const EXTENSOES_DE_TEXTO = /\.(js|mjs|cjs|ts|tsx|jsx|json|md|txt|css|html|yml|yaml|py|sh|env|example|vbs|bat|ps1|ini|cfg|toml)$/i;

const MAX_FICHEIROS_VISTOS = 4000;
const MAX_RESULTADOS = 40;
const MAX_TAMANHO_FICHEIRO = 512 * 1024;

function procurarEmFicheiros(termo, pasta = '.', opcoes = {}) {
  if (!ENABLED) return { success: false, error: 'System Controller desativado' };

  const procurado = String(termo || '').trim();
  if (procurado.length < 2) {
    return { success: false, error: 'Diz-me o que procurar: pelo menos duas letras.' };
  }

  const raiz = expandPath(pasta || '.', { paraLeitura: true });
  if (!isPathAllowed(raiz)) {
    return { success: false, error: `Path não permitido: ${raiz}` };
  }
  if (!fs.existsSync(raiz)) {
    return { success: false, error: `Pasta não encontrada: ${raiz}` };
  }

  const alvo = procurado.toLowerCase();
  const maxResultados = Math.min(opcoes.max || MAX_RESULTADOS, MAX_RESULTADOS);
  const achados = [];
  let vistos = 0;
  let truncado = false;

  const descer = (dir) => {
    if (achados.length >= maxResultados || vistos >= MAX_FICHEIROS_VISTOS) return;

    let entradas;
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // Uma pasta sem permissão não pára a busca toda.
    }

    for (const entrada of entradas) {
      if (achados.length >= maxResultados || vistos >= MAX_FICHEIROS_VISTOS) return;

      const caminho = path.join(dir, entrada.name);

      if (entrada.isDirectory()) {
        if (PASTAS_A_SALTAR.has(entrada.name) || entrada.name.startsWith('.')) continue;
        descer(caminho);
        continue;
      }

      if (!EXTENSOES_DE_TEXTO.test(entrada.name)) continue;
      vistos++;

      let conteudo;
      try {
        if (fs.statSync(caminho).size > MAX_TAMANHO_FICHEIRO) continue;
        conteudo = fs.readFileSync(caminho, 'utf8');
      } catch {
        continue;
      }

      if (!conteudo.toLowerCase().includes(alvo)) continue;

      const linhas = conteudo.split(/\r?\n/);
      for (let i = 0; i < linhas.length && achados.length < maxResultados; i++) {
        if (!linhas[i].toLowerCase().includes(alvo)) continue;
        achados.push({
          ficheiro: path.relative(raiz, caminho) || entrada.name,
          linha: i + 1,
          texto: linhas[i].trim().slice(0, 200)
        });
      }
    }
  };

  descer(raiz);
  truncado = achados.length >= maxResultados || vistos >= MAX_FICHEIROS_VISTOS;

  logOperation('SEARCH_FILES', { path: raiz, termo: procurado, achados: achados.length });

  if (!achados.length) {
    return {
      success: true, path: raiz, resultados: [],
      message: `Não encontrei "${procurado}" em ${raiz} (${vistos} ficheiros vistos).`
    };
  }

  const linhas = achados.map(a => `${a.ficheiro}:${a.linha}: ${a.texto}`);
  return {
    success: true,
    path: raiz,
    resultados: achados,
    message: `🔎 "${procurado}" em ${raiz} — ${achados.length} ocorrência(s)` +
      `${truncado ? ' (mostro só as primeiras)' : ''}:\n\n${linhas.join('\n')}`
  };
}

module.exports = {
  // Estado
  isEnabled,

  // Level 1 - Ficheiros
  createFile,
  readFile,
  editFile,
  listDirectory,
  procurarEmFicheiros,
  
  // Level 1 - Comandos
  executeCommand,
  openFolder,
  runScript,
  
  // Level 1 - Sistema
  getSystemInfo,
  getAllowedPaths,
  getAllowedCommands,
  
  // Level 2 - Aplicações
  openApp,
  openUrl,
  
  // Level 2 - Processos
  listProcesses,
  killProcess,
  
  // Level 2 - Janelas
  focusWindow,
  windowAction,
  listWindows,
  
  // Utilitários
  isPathAllowed,
  isCommandAllowed,
  expandPath
};
