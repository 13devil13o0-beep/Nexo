/**
 * 🔌 Plugin System — Extensões hot-loadable para o NEXO
 * 
 * Permite adicionar funcionalidades sem tocar no core.
 * Basta criar um ficheiro .js na pasta plugins/ que exporte:
 * 
 *   module.exports = {
 *     name: 'meu-plugin',
 *     description: 'O que faz',
 *     version: '1.0.0',
 *     intents: {
 *       'minha_acao': {
 *         patterns: [/faz algo/i, /do something/i],
 *         extract: (text) => ({ param: text }),
 *         handler: async (entities, context) => {
 *           return { success: true, response: 'Feito!' };
 *         }
 *       }
 *     },
 *     // Opcional: lifecycle hooks
 *     onLoad: () => console.log('Plugin carregado!'),
 *     onUnload: () => console.log('Plugin descarregado!')
 *   };
 */

const fs = require('fs');
const path = require('path');

const PLUGINS_DIR = path.join(process.cwd(), 'plugins');
const loadedPlugins = new Map();

// ═══════════════════════════════════════════════════════════
// CORE
// ═══════════════════════════════════════════════════════════

/**
 * Carrega todos os plugins da pasta plugins/
 */
function loadAll() {
  // Criar pasta se não existir
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  }

  const files = fs.readdirSync(PLUGINS_DIR)
    .filter(f => f.endsWith('.js') && !f.startsWith('_'));

  let loaded = 0;
  let failed = 0;

  for (const file of files) {
    try {
      loadPlugin(path.join(PLUGINS_DIR, file));
      loaded++;
    } catch (error) {
      console.error(`  ❌ Plugin ${file}: ${error.message}`);
      failed++;
    }
  }

  if (loaded > 0 || failed > 0) {
    console.log(`🔌 Plugins: ${loaded} carregados, ${failed} falharam`);
  }
  
  return { loaded, failed, total: files.length };
}

/**
 * Carrega um plugin individual
 */
function loadPlugin(filePath) {
  const name = path.basename(filePath, '.js');
  
  // Limpar cache (permite hot-reload)
  delete require.cache[require.resolve(filePath)];
  
  const plugin = require(filePath);
  
  // Validar estrutura
  if (!plugin.name) plugin.name = name;
  if (!plugin.intents || typeof plugin.intents !== 'object') {
    throw new Error('Plugin deve exportar "intents" com handlers');
  }

  // Validar cada intent
  for (const [intentName, config] of Object.entries(plugin.intents)) {
    if (!config.patterns || !Array.isArray(config.patterns)) {
      throw new Error(`Intent "${intentName}" precisa de array "patterns"`);
    }
    if (typeof config.handler !== 'function') {
      throw new Error(`Intent "${intentName}" precisa de "handler" function`);
    }
    if (!config.extract) {
      config.extract = (text) => ({ text });
    }
  }

  // Registar
  loadedPlugins.set(plugin.name, {
    ...plugin,
    filePath,
    loadedAt: new Date()
  });

  // Lifecycle hook
  if (typeof plugin.onLoad === 'function') {
    plugin.onLoad();
  }

  console.log(`  ✅ Plugin: ${plugin.name} (${Object.keys(plugin.intents).length} intents)`);
  return plugin;
}

/**
 * Descarrega um plugin
 */
function unloadPlugin(name) {
  const plugin = loadedPlugins.get(name);
  if (!plugin) return false;

  if (typeof plugin.onUnload === 'function') {
    plugin.onUnload();
  }

  // Limpar cache
  if (plugin.filePath) {
    delete require.cache[require.resolve(plugin.filePath)];
  }

  loadedPlugins.delete(name);
  console.log(`🔌 Plugin descarregado: ${name}`);
  return true;
}

/**
 * Recarrega um plugin (hot-reload)
 */
function reloadPlugin(name) {
  const plugin = loadedPlugins.get(name);
  if (!plugin || !plugin.filePath) return false;

  const filePath = plugin.filePath;
  unloadPlugin(name);
  loadPlugin(filePath);
  return true;
}

/**
 * Recarrega todos os plugins
 */
function reloadAll() {
  // Descarregar todos
  for (const [name] of loadedPlugins) {
    unloadPlugin(name);
  }
  // Recarregar
  return loadAll();
}

// ═══════════════════════════════════════════════════════════
// INTENT MATCHING — Integração com o intentParser
// ═══════════════════════════════════════════════════════════

/**
 * Tenta fazer match de uma mensagem com intents de plugins
 * Retorna null se nenhum plugin reconhecer
 */
function matchIntent(message) {
  if (!message) return null;
  const text = message.trim();

  for (const [pluginName, plugin] of loadedPlugins) {
    for (const [intentName, config] of Object.entries(plugin.intents)) {
      for (const pattern of config.patterns) {
        if (pattern.test(text)) {
          return {
            intent: `plugin:${pluginName}:${intentName}`,
            entities: config.extract(text),
            confidence: 0.85,
            plugin: pluginName,
            handler: config.handler,
            method: 'plugin'
          };
        }
      }
    }
  }

  return null;
}

/**
 * Executa o handler de um plugin
 */
async function executeHandler(matchResult, context = {}) {
  if (!matchResult || typeof matchResult.handler !== 'function') {
    return { success: false, error: '❌ Handler não encontrado.' };
  }

  try {
    const result = await matchResult.handler(matchResult.entities, context);
    return result;
  } catch (error) {
    console.error(`❌ Plugin error (${matchResult.plugin}):`, error.message);
    return { success: false, error: `❌ Erro no plugin "${matchResult.plugin}": ${error.message}` };
  }
}

// ═══════════════════════════════════════════════════════════
// INFO & LISTAGEM
// ═══════════════════════════════════════════════════════════

/**
 * Lista plugins carregados
 */
function listPlugins() {
  const plugins = [];
  for (const [name, plugin] of loadedPlugins) {
    plugins.push({
      name,
      description: plugin.description || '',
      version: plugin.version || '0.0.0',
      intents: Object.keys(plugin.intents),
      loadedAt: plugin.loadedAt
    });
  }
  return plugins;
}

/**
 * Formata lista de plugins para mostrar ao utilizador
 */
function formatPluginList() {
  const plugins = listPlugins();
  
  if (plugins.length === 0) {
    return `🔌 **Nenhum plugin instalado.**\n\n💡 Cria ficheiros .js na pasta \`plugins/\` para extender o NEXO.\nVê \`plugins/_example.js\` para um modelo.`;
  }

  let output = `🔌 **Plugins Instalados (${plugins.length}):**\n\n`;
  plugins.forEach(p => {
    output += `📦 **${p.name}** v${p.version}\n`;
    output += `   ${p.description}\n`;
    output += `   Intents: ${p.intents.join(', ')}\n\n`;
  });

  return output;
}

module.exports = {
  loadAll,
  loadPlugin,
  unloadPlugin,
  reloadPlugin,
  reloadAll,
  matchIntent,
  executeHandler,
  listPlugins,
  formatPluginList,
  PLUGINS_DIR
};
