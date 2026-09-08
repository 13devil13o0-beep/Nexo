/**
 * 📊 Metrics — Contabilidade de Tokens, Custo e Latência
 *
 * Sem isto, "mais eficiente" é opinião. Cada chamada a um modelo escreve uma
 * linha em memory/metrics.jsonl com o que gastou e quanto demorou.
 *
 * Formato de cada linha (JSON, uma por pedido):
 *   ts, provider, model, tier, promptTokens, completionTokens, costUsd,
 *   ms, msToFirstToken, ok, error
 *
 * O "tier" é o nível da cascata que serviu o pedido:
 *   local  — Ollama, custo zero, sem rede
 *   free   — camada gratuita de um fornecedor remoto
 *   paid   — provider pago do utilizador
 *
 * Relatório:  npm run metrics
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const METRICS_DIR = path.join(PROJECT_ROOT, 'memory');
const METRICS_FILE = path.join(METRICS_DIR, 'metrics.jsonl');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB — rotação simples

const ENABLED = process.env.METRICS !== '0';

// ═══════════════════════════════════════════════════════════
// TABELA DE PREÇOS — USD por 1M tokens
// ═══════════════════════════════════════════════════════════

/**
 * Só entram aqui preços que conheço com confiança. Um modelo ausente
 * produz custo null, e o relatório diz quantos pedidos ficaram por avaliar.
 * Inventar um preço é pior do que admitir que não se sabe.
 */
const PRICING = {
  // Local: sem custo por token, corre na máquina do utilizador.
  'ollama': { in: 0, out: 0 },

  // Anthropic (preços de primeira parte)
  'claude-opus-5':    { in: 5,  out: 25 },
  'claude-sonnet-5':  { in: 2,  out: 10 },
  'claude-haiku-4-5': { in: 1,  out: 5 },
  'claude-fable-5-1': { in: 10, out: 50 }
};

/**
 * Camada gratuita: fornecedores que não cobram nos limites em que os usamos.
 * Se passares a um plano pago, acrescenta o modelo à tabela PRICING acima.
 */
const FREE_TIER_PROVIDERS = new Set(['groq', 'cerebras', 'gemini', 'huggingface']);

// ═══════════════════════════════════════════════════════════
// NORMALIZAÇÃO
// ═══════════════════════════════════════════════════════════

const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);

/**
 * Cada fornecedor conta tokens à sua maneira. Traduz tudo para o mesmo par.
 * @returns {{promptTokens:number, completionTokens:number, counted:boolean}}
 */
function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') {
    return { promptTokens: 0, completionTokens: 0, counted: false };
  }

  // OpenAI-compatible (Groq, Cerebras, OpenAI, DeepSeek, ...)
  if ('prompt_tokens' in raw || 'completion_tokens' in raw) {
    return {
      promptTokens: num(raw.prompt_tokens),
      completionTokens: num(raw.completion_tokens),
      counted: true
    };
  }

  // Gemini
  if ('promptTokenCount' in raw || 'candidatesTokenCount' in raw) {
    return {
      promptTokens: num(raw.promptTokenCount),
      completionTokens: num(raw.candidatesTokenCount),
      counted: true
    };
  }

  // Ollama
  if ('prompt_eval_count' in raw || 'eval_count' in raw) {
    return {
      promptTokens: num(raw.prompt_eval_count),
      completionTokens: num(raw.eval_count),
      counted: true
    };
  }

  // Anthropic
  if ('input_tokens' in raw || 'output_tokens' in raw) {
    return {
      promptTokens: num(raw.input_tokens),
      completionTokens: num(raw.output_tokens),
      counted: true
    };
  }

  return { promptTokens: 0, completionTokens: 0, counted: false };
}

/**
 * Custo em USD, ou null quando o preço do modelo é desconhecido.
 */
function estimateCost(model, providerId, usage) {
  if (providerId === 'ollama' || model === 'ollama') return 0;
  if (FREE_TIER_PROVIDERS.has(providerId)) return 0;

  const price = PRICING[model];
  if (!price) return null;

  return (usage.promptTokens / 1e6) * price.in
       + (usage.completionTokens / 1e6) * price.out;
}

/**
 * A que nível da cascata pertence este fornecedor.
 */
function tierOf(providerId, isPaid) {
  if (isPaid) return 'paid';
  if (providerId === 'ollama') return 'local';
  return 'free';
}

// ═══════════════════════════════════════════════════════════
// ESCRITA
// ═══════════════════════════════════════════════════════════

function rotateIfNeeded() {
  try {
    const stat = fs.statSync(METRICS_FILE);
    if (stat.size > MAX_FILE_SIZE) {
      fs.renameSync(METRICS_FILE, `${METRICS_FILE}.1`);
    }
  } catch (e) { /* ficheiro ainda não existe */ }
}

/**
 * Regista um pedido. Nunca lança: a contabilidade não pode partir o bot.
 * @param {Object} entry
 * @param {string} entry.provider    nome legível ("Groq")
 * @param {string} entry.providerId  id interno ("groq")
 * @param {string} entry.model
 * @param {Object} entry.usage       objecto de uso cru do fornecedor
 * @param {number} entry.ms          latência total
 * @param {number} [entry.msToFirstToken]
 * @param {boolean} entry.ok
 * @param {boolean} [entry.paid]     serviu pelo provider pago
 * @param {string} [entry.error]
 */
function record(entry) {
  if (!ENABLED) return null;

  try {
    const usage = normalizeUsage(entry.usage);
    const providerId = entry.providerId || String(entry.provider || '').toLowerCase();
    const cost = usage.counted ? estimateCost(entry.model, providerId, usage) : null;

    const line = {
      ts: new Date().toISOString(),
      provider: entry.provider || null,
      providerId: providerId || null,
      model: entry.model || null,
      tier: tierOf(providerId, entry.paid),
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      counted: usage.counted,
      estimatedPromptTokens: entry.estimatedPromptTokens ?? null,
      costUsd: cost,
      ms: Math.round(num(entry.ms)),
      msToFirstToken: entry.msToFirstToken != null ? Math.round(entry.msToFirstToken) : null,
      ok: entry.ok !== false,
      error: entry.error || null
    };

    if (!fs.existsSync(METRICS_DIR)) fs.mkdirSync(METRICS_DIR, { recursive: true });
    rotateIfNeeded();
    fs.appendFileSync(METRICS_FILE, JSON.stringify(line) + '\n');

    return line;
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// LEITURA E AGREGAÇÃO
// ═══════════════════════════════════════════════════════════

function readAll(file = METRICS_FILE) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
    .filter(Boolean);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

/**
 * As quatro métricas que decidem se a cascata está bem calibrada.
 */
function summary(entries = readAll()) {
  const total = entries.length;
  if (!total) return { total: 0 };

  const ok = entries.filter(e => e.ok);
  const latencies = entries.map(e => e.ms).filter(n => n > 0).sort((a, b) => a - b);
  const firstToken = entries.map(e => e.msToFirstToken).filter(n => n > 0).sort((a, b) => a - b);

  const byTier = {};
  for (const e of entries) {
    byTier[e.tier] = (byTier[e.tier] || 0) + 1;
  }

  const byProvider = {};
  for (const e of entries) {
    const k = e.provider || 'desconhecido';
    byProvider[k] = byProvider[k] || { n: 0, tokens: 0, costUsd: 0 };
    byProvider[k].n++;
    byProvider[k].tokens += e.promptTokens + e.completionTokens;
    if (e.costUsd != null) byProvider[k].costUsd += e.costUsd;
  }

  const priced = entries.filter(e => e.costUsd != null);
  const totalCost = priced.reduce((s, e) => s + e.costUsd, 0);
  const totalTokens = entries.reduce((s, e) => s + e.promptTokens + e.completionTokens, 0);

  return {
    total,
    successRate: ok.length / total,
    tokensPerRequest: totalTokens / total,
    costPer100: priced.length ? (totalCost / priced.length) * 100 : null,
    unpricedRequests: total - priced.length,
    uncountedRequests: entries.filter(e => !e.counted).length,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    firstTokenP95: percentile(firstToken, 95),
    byTier,
    byProvider,
    from: entries[0].ts,
    to: entries[total - 1].ts
  };
}

module.exports = {
  record,
  readAll,
  summary,
  normalizeUsage,
  estimateCost,
  tierOf,
  PRICING,
  METRICS_FILE
};
