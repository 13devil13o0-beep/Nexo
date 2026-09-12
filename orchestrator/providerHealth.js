/**
 * 🩺 Provider Health — Sentinela de Modelos
 *
 * Os fornecedores retiram modelos sem aviso. Em Agosto de 2026 o Groq
 * desligou toda a família LLaMA e o bot ficou semanas a servir apenas pelo
 * Ollama local, em silêncio, porque a cadeia de fallback esconde a falha.
 *
 * Este módulo pergunta a cada fornecedor que modelos tem realmente vivos e
 * compara com o que está configurado no llmRouter. Não corrige nada: avisa.
 *
 * Uso:
 *   npm run check:models          — relatório na consola
 *   require(...).checkAll()       — array de resultados
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PROVIDERS } = require('./llmRouter');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const TIMEOUT_MS = parseInt(process.env.MODEL_HEALTHCHECK_TIMEOUT) || 8000;

// ═══════════════════════════════════════════════════════════
// ESTADOS
// ═══════════════════════════════════════════════════════════

const STATUS = {
  OK: 'ok',                   // modelo configurado existe
  STALE: 'stale',             // o fornecedor responde mas não tem o modelo
  UNREACHABLE: 'unreachable', // sem resposta, chave inválida, rede em baixo
  NO_KEY: 'no-key',           // não configurado, portanto não é usado
  UNSUPPORTED: 'unsupported'  // fornecedor sem endpoint de listagem
};

// ═══════════════════════════════════════════════════════════
// LISTAGEM POR FORMATO
// ═══════════════════════════════════════════════════════════

async function fetchJson(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body.substring(0, 120)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Devolve os ids dos modelos vivos de um fornecedor.
 * @returns {Promise<string[]|null>} null = fornecedor sem listagem
 */
async function listModels(provider, apiKey) {
  switch (provider.format) {
    case 'openai': {
      const data = await fetchJson(`${provider.baseUrl}/models`, {
        'Authorization': `Bearer ${apiKey}`
      });
      return (data.data || []).map(m => m.id);
    }

    case 'gemini': {
      const data = await fetchJson(`${provider.baseUrl}/models?key=${apiKey}`);
      return (data.models || []).map(m => String(m.name).replace(/^models\//, ''));
    }

    case 'anthropic': {
      const data = await fetchJson(`${provider.baseUrl}/models`, {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      });
      return (data.data || []).map(m => m.id);
    }

    case 'ollama': {
      const data = await fetchJson(`${provider.baseUrl}/api/tags`);
      return (data.models || []).map(m => m.name);
    }

    // A inference API do HuggingFace não expõe uma lista utilizável.
    case 'huggingface':
    default:
      return null;
  }
}

/**
 * O Ollama identifica modelos com tag (ex.: "llama3:latest").
 * Uma configuração sem tag deve dar match com a tag :latest.
 */
function modelIsPresent(configured, available, format) {
  if (!configured) return true;
  if (available.includes(configured)) return true;
  if (format === 'ollama' && !configured.includes(':')) {
    return available.includes(`${configured}:latest`);
  }
  return false;
}

// ═══════════════════════════════════════════════════════════
// VERIFICAÇÃO
// ═══════════════════════════════════════════════════════════

/**
 * Verifica um fornecedor do llmRouter.
 * @returns {Promise<Object>} { id, name, status, missing, available, error }
 */
async function checkProvider(id) {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`Provider desconhecido: ${id}`);

  const base = { id, name: provider.name, missing: [], available: 0, error: null };
  const apiKey = provider.keyEnv ? process.env[provider.keyEnv] : null;

  if (provider.keyEnv && !apiKey) {
    return { ...base, status: STATUS.NO_KEY };
  }

  let available;
  try {
    available = await listModels(provider, apiKey);
  } catch (err) {
    return { ...base, status: STATUS.UNREACHABLE, error: err.message };
  }

  if (available === null) {
    return { ...base, status: STATUS.UNSUPPORTED };
  }

  const missing = [provider.model, provider.fallbackModel]
    .filter(Boolean)
    .filter(m => !modelIsPresent(m, available, provider.format));

  return {
    ...base,
    status: missing.length ? STATUS.STALE : STATUS.OK,
    missing,
    available: available.length,
    sample: available.slice(0, 8)
  };
}

/**
 * Verifica todos os fornecedores em paralelo.
 * @param {string[]} [ids] — por omissão, todos os do llmRouter
 */
async function checkAll(ids) {
  const targets = ids && ids.length ? ids : Object.keys(PROVIDERS);
  return Promise.all(targets.map(id =>
    checkProvider(id).catch(err => ({
      id, name: id, status: STATUS.UNREACHABLE, missing: [], available: 0, error: err.message
    }))
  ));
}

/**
 * Só os problemas que exigem acção: fornecedor configurado cujo modelo morreu.
 */
/**
 * O modelo local é opcional, e um opcional ausente não é um problema.
 *
 * O Ollama só corre se o utilizador o arrancar num terminal e o deixar aberto.
 * Quem não o quer não tem de ver um aviso vermelho em cada arranque por causa
 * de um serviço que nunca pediu. Um aviso que aparece sempre deixa de ser
 * lido, e quando aparecer um a sério passa despercebido.
 */
function opcionalEAusente(r) {
  const id = String(r.id || r.name || '').toLowerCase();
  return id === 'ollama' && r.status === STATUS.UNREACHABLE && process.env.OLLAMA_SEMPRE !== '1';
}

function problems(results) {
  return results
    .filter(r => r.status === STATUS.STALE || r.status === STATUS.UNREACHABLE)
    .filter(r => !opcionalEAusente(r));
}


// ═══════════════════════════════════════════════════════════
// VARIÁVEIS SOMBREADAS
// ═══════════════════════════════════════════════════════════

/**
 * O dotenv NUNCA substitui uma variável já definida no ambiente do sistema.
 *
 * Consequência silenciosa: se houver uma ANTHROPIC_API_KEY antiga definida no
 * Windows, podes editar o .env as vezes que quiseres que o programa continua
 * a usar a antiga. Aconteceu neste projecto e custou duas rondas de
 * diagnóstico, com a API a responder "API key is invalid" enquanto a chave no
 * ficheiro estava boa.
 *
 * Esta verificação compara o que está no .env com o que ficou em process.env
 * e avisa quando diferem. Nunca imprime valores.
 */
function detectarVariaveisSombreadas(caminhoEnv) {
  const ficheiro = caminhoEnv || path.join(PROJECT_ROOT, '.env');
  const sombreadas = [];

  let bruto;
  try {
    bruto = fs.readFileSync(ficheiro, 'utf8');
  } catch (e) {
    return sombreadas; // sem .env não há nada a comparar
  }

  for (const linha of bruto.split('\n')) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) continue;

    const igual = limpa.indexOf('=');
    if (igual < 1) continue;

    const nome = limpa.slice(0, igual).trim();
    const valorFicheiro = limpa.slice(igual + 1).trim().replace(/^["']|["']$/g, '');
    if (!valorFicheiro) continue;

    const valorActivo = process.env[nome];
    if (valorActivo !== undefined && valorActivo !== valorFicheiro) {
      sombreadas.push({
        nome,
        // Só os extremos, para se poder comparar sem expor o segredo.
        noFicheiro: `...${valorFicheiro.slice(-6)}`,
        emUso: `...${String(valorActivo).slice(-6)}`
      });
    }
  }

  return sombreadas;
}

// ═══════════════════════════════════════════════════════════
// RELATÓRIO
// ═══════════════════════════════════════════════════════════

const ICON = {
  [STATUS.OK]: '✅',
  [STATUS.STALE]: '🔴',
  [STATUS.UNREACHABLE]: '⚠️ ',
  [STATUS.NO_KEY]: '⚪',
  [STATUS.UNSUPPORTED]: '➖'
};

const LABEL = {
  [STATUS.OK]: 'modelos vivos',
  [STATUS.STALE]: 'MODELO DESCONTINUADO',
  [STATUS.UNREACHABLE]: 'sem resposta',
  [STATUS.NO_KEY]: 'sem chave (não é usado)',
  [STATUS.UNSUPPORTED]: 'sem lista de modelos'
};

function formatReport(results) {
  const lines = ['', '🩺 Sentinela de modelos', ''];

  for (const r of results) {
    // O local ausente não é uma avaria: é um opcional que ninguém arrancou.
    if (opcionalEAusente(r)) {
      lines.push(`⚪ ${r.name.padEnd(14)} desligado (opcional — corre "ollama serve" se o quiseres)`);
      continue;
    }

    lines.push(`${ICON[r.status]} ${r.name.padEnd(14)} ${LABEL[r.status]}`);

    if (r.status === STATUS.STALE) {
      lines.push(`     configurado mas inexistente: ${r.missing.join(', ')}`);
      lines.push(`     ${r.available} modelos disponíveis: ${r.sample.join(', ')}`);
    }
    if (r.error) {
      lines.push(`     ${r.error}`);
    }
  }

  const sombreadas = detectarVariaveisSombreadas();
  if (sombreadas.length) {
    lines.push('');
    lines.push('⚠️  Variáveis do .env ignoradas por já existirem no ambiente do sistema:');
    for (const s of sombreadas) {
      lines.push(`     ${s.nome}: o ficheiro tem ${s.noFicheiro} mas está a ser usada ${s.emUso}`);
    }
    lines.push('     O dotenv não substitui variáveis já definidas. Remove-as do sistema.');
  }

  const bad = problems(results);
  lines.push('');
  lines.push(bad.length
    ? `🔴 ${bad.length} fornecedor(es) a precisar de atenção. Corrige os modelos em orchestrator/llmRouter.js`
    : '✅ Todos os fornecedores configurados apontam para modelos vivos.');
  lines.push('');

  return lines.join('\n');
}

/**
 * Verificação de arranque, não bloqueante e silenciosa quando está tudo bem.
 * Desliga-se com MODEL_HEALTHCHECK=0.
 */
function checkOnStartup() {
  if (process.env.MODEL_HEALTHCHECK === '0') return;

  // O dotenv não substitui variáveis já definidas no sistema. Avisar cedo.
  const sombreadas = detectarVariaveisSombreadas();
  if (sombreadas.length) {
    console.warn('');
    console.warn('⚠️  Variáveis do .env ignoradas (já definidas no ambiente do sistema):');
    for (const s of sombreadas) {
      console.warn(`   ${s.nome}: o ficheiro tem ${s.noFicheiro}, mas está em uso ${s.emUso}`);
    }
    console.warn('   Remove-as do sistema ou o .env continuará a ser ignorado.');
    console.warn('');
  }

  setTimeout(() => {
    checkAll()
      .then(results => {
        const bad = problems(results);
        if (!bad.length) return;
        console.warn('\n🩺 Sentinela de modelos detectou problemas:');
        for (const r of bad) {
          console.warn(r.status === STATUS.STALE
            ? `   🔴 ${r.name}: ${r.missing.join(', ')} já não existe(m) neste fornecedor`
            : `   ⚠️  ${r.name}: ${r.error}`);
        }
        console.warn('   Corre "npm run check:models" para o relatório completo.\n');
      })
      .catch(() => { /* a sentinela nunca derruba o arranque */ });
  }, 2000).unref?.();
}

module.exports = {
  checkProvider,
  checkAll,
  problems,
  formatReport,
  checkOnStartup,
  detectarVariaveisSombreadas,
  listModels,
  modelIsPresent,
  STATUS
};
