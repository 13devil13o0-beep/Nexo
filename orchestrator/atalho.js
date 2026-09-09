/**
 * 🖱️ Atalho de Arranque
 *
 * Um ícone na área de trabalho, com o que cada sistema operativo já sabe
 * fazer sozinho. Nunca um instalador de terceiros, nunca fora da conta do
 * utilizador actual — a mesma disciplina do instalar.js.
 *
 * O ALVO É SEMPRE O MESMO
 * `node arranque.js`, em qualquer sistema. É a mesma porta de entrada do
 * `npm start`, por isso o clique respeita o perfil detectado ou guardado —
 * não há uma segunda lógica de arranque a poder divergir da primeira.
 *
 * ─────────────────────────────────────────────────────────────
 * MECANISMOS, UM POR SISTEMA
 * ─────────────────────────────────────────────────────────────
 *   win32   .lnk via WScript.Shell (COM), chamado por um script PowerShell
 *           temporário — nada além do que o Windows já sabe fazer.
 *   darwin  um pacote .app mínimo: pasta com Info.plist e um script de
 *           arranque. Sem Xcode, sem assinatura.
 *   linux   um ficheiro .desktop (freedesktop.org), no ambiente de trabalho
 *           e no menu de aplicações.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const CAMINHO_ARRANQUE = path.join(RAIZ, 'arranque.js');

/** O node que está a correr este processo — evita depender do PATH. */
const NODE = process.execPath;

function caminhoDesktop() {
  return path.join(os.homedir(), 'Desktop');
}

function existeDesktop() {
  try {
    return fs.statSync(caminhoDesktop()).isDirectory();
  } catch (e) {
    return false;
  }
}

function sistemaSuportado(plataforma = process.platform) {
  return ['win32', 'darwin', 'linux'].includes(plataforma);
}

/** Onde o atalho fica, em cada sistema. */
function caminhoDoAtalho(plataforma = process.platform) {
  if (plataforma === 'win32') return path.join(caminhoDesktop(), 'NEXO.lnk');
  if (plataforma === 'darwin') return path.join(caminhoDesktop(), 'NEXO.app');
  if (plataforma === 'linux') return path.join(caminhoDesktop(), 'nexo.desktop');
  return null;
}

/**
 * O atalho existe MESMO?
 *
 * Isto tem de ser perguntado ao disco, nunca às definições. Havia um campo
 * `atalhoCriado` a dizer que sim enquanto o ficheiro já tinha sido apagado —
 * e o instalador, a confiar nele, deixava de oferecer o ícone a quem tinha
 * ficado sem ele. Um registo que diverge da realidade em silêncio é pior do
 * que não ter registo nenhum.
 */
function existe(plataforma = process.platform) {
  const caminho = caminhoDoAtalho(plataforma);
  if (!caminho) return false;

  try {
    fs.statSync(caminho);
    return true;
  } catch (e) {
    // No Linux o lançador pode existir só no menu de aplicações, sem estar na
    // área de trabalho. Continua a contar como existente.
    if (plataforma === 'linux') {
      try {
        fs.statSync(path.join(os.homedir(), '.local', 'share', 'applications', 'nexo.desktop'));
        return true;
      } catch (e2) { /* também não */ }
    }
    return false;
  }
}

/** Remove o atalho. Devolve o que foi apagado. */
function remover(plataforma = process.platform) {
  const apagados = [];

  const candidatos = [caminhoDoAtalho(plataforma)];
  if (plataforma === 'linux') {
    candidatos.push(path.join(os.homedir(), '.local', 'share', 'applications', 'nexo.desktop'));
  }

  for (const caminho of candidatos.filter(Boolean)) {
    try {
      fs.rmSync(caminho, { recursive: true, force: true });
      if (!fs.existsSync(caminho)) apagados.push(caminho);
    } catch (e) { /* já não estava lá */ }
  }

  return apagados;
}

// ═══════════════════════════════════════════════════════════
// WINDOWS
// ═══════════════════════════════════════════════════════════

/** PowerShell exige aspas simples duplicadas para escapar uma aspa simples. */
const aspasPs = (s) => String(s).replace(/'/g, "''");

function criarAtalhoWindows() {
  const alvo = path.join(caminhoDesktop(), 'NEXO.lnk');
  const icone = path.join(RAIZ, 'assets', 'icon.ico');

  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$WshShell = New-Object -ComObject WScript.Shell',
    `$Shortcut = $WshShell.CreateShortcut('${aspasPs(alvo)}')`,
    `$Shortcut.TargetPath = '${aspasPs(NODE)}'`,
    `$Shortcut.Arguments = '"${aspasPs(CAMINHO_ARRANQUE)}"'`,
    `$Shortcut.WorkingDirectory = '${aspasPs(RAIZ)}'`,
    `$Shortcut.IconLocation = '${aspasPs(icone)},0'`,
    "$Shortcut.Description = 'NEXO - Assistente IA pessoal'",
    '$Shortcut.Save()'
  ].join('\n');

  const tmp = path.join(os.tmpdir(), `nexo-atalho-${Date.now()}.ps1`);

  try {
    fs.writeFileSync(tmp, script, 'utf8');

    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmp],
      { encoding: 'utf8' }
    );

    if (r.error) return { ok: false, motivo: r.error.message };
    if (r.status !== 0) return { ok: false, motivo: (r.stderr || 'o PowerShell recusou').trim() };

    return { ok: true, caminho: alvo };
  } catch (e) {
    return { ok: false, motivo: e.message };
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* ficheiro temporário, sem problema deixá-lo */ }
  }
}

// ═══════════════════════════════════════════════════════════
// MACOS
// ═══════════════════════════════════════════════════════════

function plistNexo() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>NEXO</string>
  <key>CFBundleExecutable</key><string>nexo</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundleIdentifier</key><string>com.nexo.assistant</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>2.0.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;
}

function criarAtalhoMac() {
  const alvo = path.join(caminhoDesktop(), 'NEXO.app');
  const contents = path.join(alvo, 'Contents');
  const macos = path.join(contents, 'MacOS');
  const resources = path.join(contents, 'Resources');

  try {
    fs.mkdirSync(macos, { recursive: true });
    fs.mkdirSync(resources, { recursive: true });

    fs.writeFileSync(path.join(contents, 'Info.plist'), plistNexo(), 'utf8');

    const executavel = path.join(macos, 'nexo');
    const script = `#!/bin/bash\ncd "${RAIZ}"\nexec "${NODE}" arranque.js\n`;
    fs.writeFileSync(executavel, script, 'utf8');
    fs.chmodSync(executavel, 0o755);

    // Sem assets/icon.icns (precisa de png2icons, ver scripts/generate-icons.js),
    // o .app abre na mesma — só fica com o ícone genérico do sistema até essa
    // peça existir. Nunca é motivo para falhar o atalho.
    const iconeOrigem = path.join(RAIZ, 'assets', 'icon.icns');
    let iconeIncluido = false;
    if (fs.existsSync(iconeOrigem)) {
      fs.copyFileSync(iconeOrigem, path.join(resources, 'icon.icns'));
      iconeIncluido = true;
    }

    return { ok: true, caminho: alvo, iconeIncluido };
  } catch (e) {
    return { ok: false, motivo: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
// LINUX
// ═══════════════════════════════════════════════════════════

function conteudoDesktopEntry() {
  const icone = path.join(RAIZ, 'assets', 'icon.png');

  return `[Desktop Entry]
Type=Application
Name=NEXO
Comment=Assistente IA pessoal
Exec="${NODE}" "${CAMINHO_ARRANQUE}"
Icon=${icone}
Path=${RAIZ}
Terminal=false
Categories=Utility;
StartupWMClass=NEXO
`;
}

function criarAtalhoLinux() {
  const conteudo = conteudoDesktopEntry();
  const caminhos = [];

  // Menu de aplicações: sempre, mesmo sem pasta Desktop (comum em minimal DEs).
  try {
    const menuDir = path.join(os.homedir(), '.local', 'share', 'applications');
    fs.mkdirSync(menuDir, { recursive: true });
    const menuPath = path.join(menuDir, 'nexo.desktop');
    fs.writeFileSync(menuPath, conteudo, 'utf8');
    fs.chmodSync(menuPath, 0o755);
    caminhos.push(menuPath);
  } catch (e) {
    return { ok: false, motivo: e.message };
  }

  // Área de trabalho: só se existir.
  if (existeDesktop()) {
    try {
      const desktopPath = path.join(caminhoDesktop(), 'nexo.desktop');
      fs.writeFileSync(desktopPath, conteudo, 'utf8');
      fs.chmodSync(desktopPath, 0o755);
      caminhos.push(desktopPath);

      // O GNOME/Nautilus marca lançadores novos como "não fidedignos" até
      // alguém clicar em "Confiar e Iniciar". Poupa esse clique quando a
      // ferramenta existe; a sua ausência não é motivo para falhar.
      spawnSync('gio', ['set', desktopPath, 'metadata::trusted', 'true'], { stdio: 'ignore' });
    } catch (e) { /* o menu de aplicações já chega */ }
  }

  return { ok: true, caminhos };
}

// ═══════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════

/**
 * Cria o atalho para este sistema operativo.
 * @returns {{ok:boolean, caminho?:string, caminhos?:string[], motivo?:string}}
 */
function criar(plataforma = process.platform) {
  if (plataforma === 'win32') return criarAtalhoWindows();
  if (plataforma === 'darwin') return criarAtalhoMac();
  if (plataforma === 'linux') return criarAtalhoLinux();
  return { ok: false, motivo: `sistema não suportado para atalho automático: ${plataforma}` };
}

module.exports = {
  RAIZ,
  CAMINHO_ARRANQUE,
  NODE,
  caminhoDesktop,
  existeDesktop,
  sistemaSuportado,
  caminhoDoAtalho,
  existe,
  remover,
  conteudoDesktopEntry,
  plistNexo,
  criar,
  criarAtalhoWindows,
  criarAtalhoMac,
  criarAtalhoLinux
};
