/**
 * 📁 File Agent - Gestão segura de ficheiros
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

// Pastas permitidas para leitura
const ALLOWED_READ = [
  path.join(PROJECT_ROOT, 'Documentos'),
  path.join(PROJECT_ROOT, 'outputs'),
  path.join(PROJECT_ROOT, 'temp')
];

// Pastas permitidas para escrita
const ALLOWED_WRITE = [
  path.join(PROJECT_ROOT, 'Documentos'),
  path.join(PROJECT_ROOT, 'outputs'),
  path.join(PROJECT_ROOT, 'temp')
];

/**
 * Verifica se caminho é permitido
 */
function isAllowedPath(targetPath, mode = 'read') {
  if (!targetPath || typeof targetPath !== 'string') {
    return false;
  }
  
  const absPath = path.resolve(targetPath);
  const list = mode === 'read' ? ALLOWED_READ : ALLOWED_WRITE;
  
  return list.some(allowedDir => {
    return absPath.startsWith(allowedDir + path.sep) || absPath === allowedDir;
  });
}

/**
 * Lista ficheiros de um diretório
 */
function listFiles(dirPath = null) {
  const targetDir = dirPath || path.join(PROJECT_ROOT, 'Documentos');
  
  if (!isAllowedPath(targetDir, 'read')) {
    return { error: '❌ Acesso negado: Pasta não autorizada' };
  }
  
  if (!fs.existsSync(targetDir)) {
    return { error: '❌ Pasta não encontrada' };
  }
  
  try {
    const files = fs.readdirSync(targetDir).map(name => {
      const filePath = path.join(targetDir, name);
      const stats = fs.statSync(filePath);
      
      return {
        name,
        isDirectory: stats.isDirectory(),
        size: stats.size,
        modified: stats.mtime
      };
    });
    
    return { success: true, files, path: targetDir };
  } catch (err) {
    return { error: `❌ Erro ao listar: ${err.message}` };
  }
}

/**
 * Lê conteúdo de ficheiro
 */
function readFile(filePath) {
  if (!isAllowedPath(filePath, 'read')) {
    return { error: '❌ Acesso negado: Ficheiro não autorizado' };
  }
  
  if (!fs.existsSync(filePath)) {
    return { error: '❌ Ficheiro não encontrado' };
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, content, path: filePath };
  } catch (err) {
    return { error: `❌ Erro ao ler: ${err.message}` };
  }
}

/**
 * Escreve ficheiro (notas, etc.)
 */
function writeFile(filePath, content) {
  if (!isAllowedPath(filePath, 'write')) {
    return { error: '❌ Acesso negado: Localização não autorizada' };
  }
  
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true, path: filePath };
  } catch (err) {
    return { error: `❌ Erro ao escrever: ${err.message}` };
  }
}

/**
 * Cria nota de texto
 */
function createNote(title, content) {
  const sanitizedTitle = title.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim();
  const fileName = `nota_${sanitizedTitle}_${Date.now()}.txt`;
  const filePath = path.join(PROJECT_ROOT, 'Documentos', fileName);
  
  const noteContent = `═══════════════════════════════════════
📝 ${title.toUpperCase()}
═══════════════════════════════════════
Data: ${new Date().toLocaleString('pt-PT')}
───────────────────────────────────────

${content}

───────────────────────────────────────
Criado por NEXO
`;

  return writeFile(filePath, noteContent);
}

/**
 * Lista todos os ficheiros das pastas permitidas
 */
function listAllFiles() {
  let result = '📂 **Ficheiros Disponíveis:**\n\n';
  
  for (const dir of ALLOWED_READ) {
    const dirName = path.basename(dir);
    if (fs.existsSync(dir)) {
      result += `📁 ${dirName}/\n`;
      
      const files = fs.readdirSync(dir).slice(0, 10);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);
        const icon = stats.isDirectory() ? '📁' : '📄';
        const size = stats.isDirectory() ? '' : ` (${formatSize(stats.size)})`;
        result += `   ${icon} ${file}${size}\n`;
      }
      
      const total = fs.readdirSync(dir).length;
      if (total > 10) {
        result += `   ... e mais ${total - 10} ficheiros\n`;
      }
      result += '\n';
    }
  }
  
  return result || '📂 Nenhum ficheiro encontrado';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

module.exports = {
  listFiles,
  readFile,
  writeFile,
  createNote,
  listAllFiles,
  isAllowedPath,
  ALLOWED_READ,
  ALLOWED_WRITE
};
