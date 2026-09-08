/**
 * 🌍 i18n — Sistema de Internacionalização do NEXO
 * 
 * Auto-deteta a língua do sistema e permite preferência por utilizador.
 * Fallback chain: Preferência do user → Locale do SO → Português (default)
 * 
 * Idiomas suportados: pt, en, es, fr
 */

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════
// CONFIGURAÇÃO
// ═══════════════════════════════════════════════════════════

const SUPPORTED_LANGUAGES = ['pt', 'en', 'es', 'fr'];
const DEFAULT_LANGUAGE = 'pt';
const LOCALES_DIR = path.join(__dirname, '..', 'locales');
const USER_PREFS_FILE = path.join(__dirname, '..', 'user_data', 'i18n_prefs.json');

// Cache de traduções carregadas
const locales = {};

// Preferências de língua por utilizador
let userPrefs = {};

// Língua detetada do sistema
let systemLanguage = DEFAULT_LANGUAGE;

// ═══════════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ═══════════════════════════════════════════════════════════

/**
 * Inicializa o sistema i18n
 * - Carrega todos os ficheiros de locale
 * - Deteta a língua do sistema operativo
 * - Carrega preferências de utilizadores
 */
function init() {
  // 1. Detetar língua do SO
  systemLanguage = detectSystemLanguage();
  console.log(`[i18n] 🌍 Língua do sistema: ${systemLanguage}`);

  // 2. Carregar ficheiros de locale
  let loaded = 0;
  for (const lang of SUPPORTED_LANGUAGES) {
    const filePath = path.join(LOCALES_DIR, `${lang}.json`);
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        locales[lang] = JSON.parse(raw);
        loaded++;
      } else {
        console.warn(`[i18n] ⚠️ Ficheiro de locale não encontrado: ${lang}.json`);
        locales[lang] = {};
      }
    } catch (err) {
      console.error(`[i18n] ❌ Erro ao carregar ${lang}.json:`, err.message);
      locales[lang] = {};
    }
  }
  console.log(`[i18n] 📦 ${loaded}/${SUPPORTED_LANGUAGES.length} locales carregados`);

  // 3. Carregar preferências de utilizadores
  loadUserPrefs();

  return { systemLanguage, loaded, supported: SUPPORTED_LANGUAGES };
}

/**
 * Deteta a língua do sistema operativo
 */
function detectSystemLanguage() {
  try {
    // Tentar via Intl
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (locale) {
      const lang = locale.split('-')[0].toLowerCase();
      if (SUPPORTED_LANGUAGES.includes(lang)) {
        return lang;
      }
    }
  } catch {}

  // Tentar variáveis de ambiente
  const envLang = process.env.LANG || process.env.LANGUAGE || process.env.LC_ALL || process.env.LC_MESSAGES || '';
  if (envLang) {
    const lang = envLang.split(/[_.-]/)[0].toLowerCase();
    if (SUPPORTED_LANGUAGES.includes(lang)) {
      return lang;
    }
  }

  return DEFAULT_LANGUAGE;
}

// ═══════════════════════════════════════════════════════════
// PREFERÊNCIAS POR UTILIZADOR
// ═══════════════════════════════════════════════════════════

function loadUserPrefs() {
  try {
    if (fs.existsSync(USER_PREFS_FILE)) {
      userPrefs = JSON.parse(fs.readFileSync(USER_PREFS_FILE, 'utf-8'));
    }
  } catch {
    userPrefs = {};
  }
}

function saveUserPrefs() {
  try {
    const dir = path.dirname(USER_PREFS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(USER_PREFS_FILE, JSON.stringify(userPrefs, null, 2), 'utf-8');
  } catch (err) {
    console.error('[i18n] ❌ Erro ao guardar preferências:', err.message);
  }
}

/**
 * Define a língua preferida de um utilizador
 * @param {string} userId 
 * @param {string} lang - código da língua (pt, en, es, fr)
 * @returns {{ success: boolean, language?: string, error?: string }}
 */
function setUserLanguage(userId, lang) {
  const normalized = normalizeLangCode(lang);
  if (!normalized) {
    return {
      success: false,
      error: `Língua "${lang}" não suportada. Disponíveis: ${SUPPORTED_LANGUAGES.join(', ')}`
    };
  }
  userPrefs[userId] = { language: normalized, updatedAt: new Date().toISOString() };
  saveUserPrefs();
  return { success: true, language: normalized };
}

/**
 * Obtém a língua de um utilizador
 * @param {string} userId 
 * @returns {string} código da língua
 */
function getUserLanguage(userId) {
  if (userId && userPrefs[userId]?.language) {
    return userPrefs[userId].language;
  }
  return systemLanguage;
}

/**
 * Remove a preferência de língua de um utilizador (volta ao default do SO)
 */
function resetUserLanguage(userId) {
  if (userPrefs[userId]) {
    delete userPrefs[userId];
    saveUserPrefs();
  }
  return { success: true, language: systemLanguage };
}

/**
 * Normaliza código de língua a partir de texto natural
 * "português" → "pt", "english" → "en", etc.
 */
function normalizeLangCode(input) {
  if (!input) return null;
  const lower = input.toLowerCase().trim();
  
  // Código direto
  if (SUPPORTED_LANGUAGES.includes(lower)) return lower;
  
  // Nomes de língua em vários idiomas
  const langMap = {
    // Português
    'pt': 'pt', 'português': 'pt', 'portugues': 'pt', 'portuguese': 'pt',
    'pt-br': 'pt', 'pt-pt': 'pt', 'brasil': 'pt', 'brazil': 'pt',
    'portugais': 'pt', 'portugués': 'pt',
    // English
    'en': 'en', 'english': 'en', 'inglês': 'en', 'ingles': 'en',
    'en-us': 'en', 'en-gb': 'en', 'anglais': 'en', 'inglés': 'en',
    // Español
    'es': 'es', 'español': 'es', 'espanhol': 'es', 'spanish': 'es',
    'espanol': 'es', 'espagnol': 'es', 'castelhano': 'es', 'castellano': 'es',
    // Français
    'fr': 'fr', 'français': 'fr', 'frances': 'fr', 'french': 'fr',
    'francês': 'fr', 'francais': 'fr'
  };
  
  return langMap[lower] || null;
}

// ═══════════════════════════════════════════════════════════
// FUNÇÃO PRINCIPAL DE TRADUÇÃO
// ═══════════════════════════════════════════════════════════

/**
 * Traduz uma chave para a língua do utilizador
 * 
 * @param {string} key - chave de tradução (ex: "pdf.created")
 * @param {Object} [vars] - variáveis para interpolação (ex: { path: "/docs/file.pdf" })
 * @param {string} [userId] - ID do utilizador (para resolver a língua correta)
 * @returns {string} texto traduzido
 * 
 * @example
 * t('pdf.created', { path: '/docs/file.pdf' }, 'user123')
 * // → "📄 PDF criado com sucesso!\n📁 Localização: /docs/file.pdf"
 * 
 * t('code.remaining', { remaining: 8, max: 10 })
 * // → "⚡ Remaining executions: 8/10 per minute" (se user for EN)
 */
function t(key, vars = {}, userId = null) {
  const lang = getUserLanguage(userId);
  
  // Tentar a língua do utilizador
  let value = resolveKey(locales[lang], key);
  
  // Fallback para português (default)
  if (value === undefined && lang !== DEFAULT_LANGUAGE) {
    value = resolveKey(locales[DEFAULT_LANGUAGE], key);
  }
  
  // Se não encontrar, retornar a chave como está
  if (value === undefined) {
    return key;
  }
  
  // Interpolar variáveis {{var}}
  return interpolate(value, vars);
}

/**
 * Resolve uma chave com dot notation num objeto
 * "pdf.created" → obj.pdf.created
 */
function resolveKey(obj, key) {
  if (!obj || !key) return undefined;
  
  const parts = key.split('.');
  let current = obj;
  
  for (const part of parts) {
    if (current === undefined || current === null || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }
  
  return current;
}

/**
 * Interpola variáveis {{name}} no texto
 * Suporta: {{var}}, {var}, e ${var}
 */
function interpolate(text, vars) {
  if (!vars || typeof text !== 'string') return text;
  
  return text.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (match, p1, p2) => {
    const varName = p1 || p2;
    return vars[varName] !== undefined ? vars[varName] : match;
  });
}

// ═══════════════════════════════════════════════════════════
// UTILITÁRIOS
// ═══════════════════════════════════════════════════════════

/**
 * Retorna informação sobre as línguas disponíveis
 */
function getLanguageInfo() {
  const langNames = {
    pt: { native: 'Português', flag: '🇵🇹' },
    en: { native: 'English', flag: '🇬🇧' },
    es: { native: 'Español', flag: '🇪🇸' },
    fr: { native: 'Français', flag: '🇫🇷' }
  };
  
  return SUPPORTED_LANGUAGES.map(lang => ({
    code: lang,
    name: langNames[lang]?.native || lang,
    flag: langNames[lang]?.flag || '🏳️',
    loaded: Object.keys(locales[lang] || {}).length > 0
  }));
}

/**
 * Retorna o nome da língua no próprio idioma
 */
function getLanguageName(langCode) {
  const names = {
    pt: 'Português',
    en: 'English',
    es: 'Español',
    fr: 'Français'
  };
  return names[langCode] || langCode;
}

/**
 * Retorna a flag emoji da língua
 */
function getLanguageFlag(langCode) {
  const flags = { pt: '🇵🇹', en: '🇬🇧', es: '🇪🇸', fr: '🇫🇷' };
  return flags[langCode] || '🏳️';
}

/**
 * Verifica se uma língua é suportada
 */
function isSupported(lang) {
  return SUPPORTED_LANGUAGES.includes(normalizeLangCode(lang));
}

/**
 * Retorna estatísticas de tradução
 */
function getStats() {
  const stats = {};
  for (const lang of SUPPORTED_LANGUAGES) {
    stats[lang] = {
      keys: countKeys(locales[lang] || {}),
      loaded: Object.keys(locales[lang] || {}).length > 0
    };
  }
  return {
    systemLanguage,
    defaultLanguage: DEFAULT_LANGUAGE,
    supported: SUPPORTED_LANGUAGES,
    users: Object.keys(userPrefs).length,
    locales: stats
  };
}

/**
 * Conta chaves recursivamente num objeto
 */
function countKeys(obj, prefix = '') {
  let count = 0;
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      count += countKeys(obj[key], `${prefix}${key}.`);
    } else {
      count++;
    }
  }
  return count;
}

/**
 * Recarrega os ficheiros de locale (hot reload)
 */
function reload() {
  for (const lang of SUPPORTED_LANGUAGES) {
    const filePath = path.join(LOCALES_DIR, `${lang}.json`);
    try {
      if (fs.existsSync(filePath)) {
        // Limpar cache do require
        delete require.cache[require.resolve(filePath)];
        locales[lang] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch (err) {
      console.error(`[i18n] ❌ Erro ao recarregar ${lang}.json:`, err.message);
    }
  }
  console.log('[i18n] 🔄 Locales recarregados');
}

// ═══════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════

module.exports = {
  init,
  t,
  setUserLanguage,
  getUserLanguage,
  resetUserLanguage,
  getLanguageInfo,
  getLanguageName,
  getLanguageFlag,
  normalizeLangCode,
  isSupported,
  getStats,
  reload,
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE
};
