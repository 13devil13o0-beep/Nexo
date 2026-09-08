/**
 * 🔀 LLM Router — Multi-Provider com Fallback Automático e Streaming
 * 
 * Abstrai múltiplos providers de IA (Groq, Gemini, Cerebras, HuggingFace, Ollama)
 * com fallback automático em cadeia. Se um provider falha → tenta o seguinte.
 * 
 * Suporta streaming (SSE/callback) e chamada síncrona.
 * 
 * Cadeia de prioridade:
 *   1. Groq     (gpt-oss-120b)       — rápido, grátis, 30 req/min
 *   2. Cerebras (LLaMA 3.3 70B)      — ultra-rápido, grátis
 *   3. Gemini   (Gemini 2.0 Flash)   — grátis, suporta visão
 *   4. HuggingFace (Mistral/Zephyr)  — grátis, rate limitado
 *   5. Ollama   (local)              — offline, sem limites
 */

require('dotenv').config();
const customProvider = require('../agents/customProvider');
const metrics = require('./metrics');
const anthropicAdapter = require('../nexo/adapters/anthropic');

// ═══════════════════════════════════════════════════════════
// CONFIGURAÇÃO DOS PROVIDERS
// ═══════════════════════════════════════════════════════════

const PROVIDERS = {
  groq: {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    model: 'openai/gpt-oss-120b',
    fallbackModel: 'openai/gpt-oss-20b',
    maxTokens: 4096,
    supportsStreaming: true,
    supportsVision: false,
    // Os gpt-oss são modelos de raciocínio: gastam tokens de completion a
    // "pensar" antes de escrever. Sem isto, um maxTokens pequeno devolve
    // content vazio. 'low' corta o raciocínio ao mínimo (~7 tokens).
    reasoning: true,
    reasoningEffort: 'low',
    supportsTools: true,
    format: 'openai' // OpenAI-compatible API
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    fallbackModel: 'gpt-4o-mini',
    maxTokens: 4096,
    supportsStreaming: true,
    supportsVision: true,
    supportsTools: true,
    format: 'openai',
    // Como o Anthropic: so entra na cadeia via LLM_PROVIDER_ORDER, porque e
    // pago e ninguem deve comecar a gastar dinheiro sem ter pedido.
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    keyEnv: 'ANTHROPIC_API_KEY',
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
    fallbackModel: 'claude-sonnet-5',
    maxTokens: 4096,
    supportsStreaming: false, // streaming fica para depois; o ciclo usa chat
    supportsVision: true,
    supportsTools: true,
    reasoning: true,
    format: 'anthropic',
    // Nao entra na cadeia sem estar em LLM_PROVIDER_ORDER: e opcional.
  },
  cerebras: {
    name: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    keyEnv: 'CEREBRAS_API_KEY',
    model: 'llama-3.3-70b',
    supportsTools: true,
    fallbackModel: 'llama-3.1-8b',
    maxTokens: 4096,
    supportsStreaming: true,
    supportsVision: false,
    format: 'openai'
  },
  gemini: {
    name: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyEnv: 'GEMINI_API_KEY',
    model: 'gemini-2.0-flash',
    fallbackModel: 'gemini-1.5-flash',
    maxTokens: 4096,
    supportsStreaming: true,
    supportsVision: true,
    format: 'gemini'
  },
  huggingface: {
    name: 'HuggingFace',
    baseUrl: 'https://api-inference.huggingface.co/models',
    keyEnv: 'HF_API_KEY',
    model: 'mistralai/Mistral-7B-Instruct-v0.3',
    fallbackModel: 'HuggingFaceH4/zephyr-7b-beta',
    maxTokens: 2048,
    supportsStreaming: false,
    supportsVision: false,
    format: 'huggingface'
  },
  ollama: {
    name: 'Ollama',
    baseUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    keyEnv: null, // local, sem key
    model: process.env.OLLAMA_MODEL || 'llama3.1',
    // O modelo de reserva tem de estar instalado localmente ("ollama pull").
    // Verifica com "npm run check:models".
    fallbackModel: process.env.OLLAMA_FALLBACK_MODEL || 'mistral',
    maxTokens: 4096,
    supportsStreaming: true,
    supportsVision: false,
    // Quanto tempo o modelo fica residente em memória depois de responder.
    // Medido nesta máquina: a frio 105 s, quente 1,4 s. O custo é RAM.
    // '-1' mantém sempre carregado, '0' descarrega logo.
    keepAlive: process.env.OLLAMA_KEEP_ALIVE || '30m',
    format: 'ollama'
  }
};

// Keep-alive para performance
let dispatcher;
try {
  const { Agent } = require('undici');
  dispatcher = new Agent({
    keepAliveTimeout: 30000,
    keepAliveMaxTimeout: 60000,
    connections: 10
  });
} catch (e) {
  dispatcher = undefined;
}

// ═══════════════════════════════════════════════════════════
// ESTADO DO ROUTER
// ═══════════════════════════════════════════════════════════

// Providers que falharam recentemente (cooldown de 60s)
const providerCooldowns = new Map();
const COOLDOWN_MS = 60000;

/**
 * Retorna a lista ordenada de providers disponíveis (com API key configurada)
 */
function getAvailableProviders() {
  const order = (process.env.LLM_PROVIDER_ORDER || 'groq,cerebras,gemini,huggingface,ollama').split(',').map(s => s.trim());
  
  return order.filter(name => {
    const provider = PROVIDERS[name];
    if (!provider) return false;
    
    // Ollama não precisa de key
    if (name === 'ollama') return true;
    
    // Verificar se tem key configurada
    return !!process.env[provider.keyEnv];
  }).map(name => ({ id: name, ...PROVIDERS[name] }));
}

/**
 * Verifica se um provider está em cooldown
 */
function isInCooldown(providerId) {
  const cooldownEnd = providerCooldowns.get(providerId);
  if (!cooldownEnd) return false;
  if (Date.now() > cooldownEnd) {
    providerCooldowns.delete(providerId);
    return false;
  }
  return true;
}

/**
 * Marca um provider como em cooldown
 */
function setCooldown(providerId) {
  providerCooldowns.set(providerId, Date.now() + COOLDOWN_MS);
}

// ═══════════════════════════════════════════════════════════
// CHAMADA PRINCIPAL (SEM STREAMING)
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// ENCAMINHAMENTO POR TAMANHO DO PROMPT
// ═══════════════════════════════════════════════════════════

/**
 * O modelo local é gratuito e privado, mas processa o prompt no processador.
 * Medido nesta máquina: 2,3 s de custo fixo mais 49 ms por token de entrada.
 *
 *    100 tokens →  7 s        400 tokens → 22 s
 *    150 tokens → 10 s        900 tokens → 46 s
 *
 * Um serviço remoto responde a qualquer destes em menos de meio segundo.
 * Por isso os pedidos curtos ficam em casa, de graça e sem sair da máquina,
 * e só os longos saem. Não é encaminhamento por dificuldade: é por tamanho,
 * que se mede sem gastar nada. A dificuldade fica para a cascata com
 * ferramentas.
 *
 * Ajusta o limiar com LOCAL_MAX_PROMPT_TOKENS. Se a tua máquina tiver placa
 * gráfica, sobe-o. Mede primeiro com "npm run metrics".
 */
const LOCAL_PROVIDER_IDS = new Set(['ollama']);
const LOCAL_MAX_PROMPT_TOKENS = parseInt(process.env.LOCAL_MAX_PROMPT_TOKENS) || 150;

/**
 * Estimativa de tokens sem contactar ninguém. Quatro caracteres por token é
 * a aproximação habitual e chega para decidir grande contra pequeno.
 */
function estimatePromptTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  const chars = messages.reduce((n, m) => n + String(m?.content ?? '').length, 0);
  return Math.ceil(chars / 4);
}

/**
 * Reordena a cadeia conforme o tamanho, respeitando a ordem que o utilizador
 * definiu dentro de cada grupo. Nada é removido: se o preferido falhar, o
 * outro continua a ser tentado a seguir.
 */
function orderProvidersByPromptSize(providers, messages) {
  const local = providers.filter(p => LOCAL_PROVIDER_IDS.has(p.id));
  const remote = providers.filter(p => !LOCAL_PROVIDER_IDS.has(p.id));

  // Só há um grupo: não há decisão a tomar.
  if (!local.length || !remote.length) return providers;

  const tokens = estimatePromptTokens(messages);
  const keepLocal = tokens <= LOCAL_MAX_PROMPT_TOKENS;

  console.log(`  🧭 ~${tokens} tokens → ${keepLocal ? 'local' : 'remoto'} primeiro`);
  return keepLocal ? [...local, ...remote] : [...remote, ...local];
}

// ═══════════════════════════════════════════════════════════
// POLÍTICA DO NÍVEL PAGO
// ═══════════════════════════════════════════════════════════

/**
 * O provider pago do utilizador é um NÍVEL da cascata, não um interruptor.
 *
 *   escalate (por omissão) — entra como último recurso, ou quando quem chama
 *                            pede qualidade com options.escalate = true.
 *                            Perguntar as horas não custa dinheiro.
 *   always                 — comportamento antigo: intercepta tudo.
 *
 * Define CUSTOM_PROVIDER_MODE=always no .env para voltar atrás.
 */
function customProviderMode() {
  return String(process.env.CUSTOM_PROVIDER_MODE || 'escalate').toLowerCase() === 'always'
    ? 'always'
    : 'escalate';
}

/** O utilizador tem um provider pago configurado e activo? */
function hasCustomTier(options) {
  return !!(options.userId && customProvider.hasCustomProvider(options.userId));
}

/** O nível pago deve ser tentado antes da cadeia gratuita? */
function customGoesFirst(options) {
  if (!hasCustomTier(options)) return false;
  return options.escalate === true || customProviderMode() === 'always';
}

/** Chama o provider pago. Devolve o resultado ou null se falhar. */
async function tryCustomProvider(messages, options) {
  try {
    const result = await customProvider.callCustomProvider(options.userId, messages, options);
    if (result.success) {
      console.log(`  🔑 Resposta via provider personalizado: ${result.provider} (${result.model})`);
      // paid: marca o nível para o registo de métricas.
      return { ...result, paid: true };
    }
  } catch (e) {
    console.warn(`  ⚠️ Provider personalizado erro: ${e.message}`);
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// INSTRUMENTAÇÃO
// ═══════════════════════════════════════════════════════════

// Nome legível → id interno, para o registo saber a que nível pertence.
const PROVIDER_ID_BY_NAME = Object.fromEntries(
  Object.entries(PROVIDERS).map(([id, p]) => [p.name.toLowerCase(), id])
);

function providerIdOf(name) {
  return PROVIDER_ID_BY_NAME[String(name || '').toLowerCase()] || null;
}

/**
 * Envia mensagem para LLM com fallback automático entre providers.
 * Regista tokens, custo e latência de cada pedido em memory/metrics.jsonl.
 * @param {Array} messages - [{role: 'system'|'user'|'assistant', content: string}]
 * @param {Object} options - {maxTokens, temperature, model, provider, userId, escalate}
 * @returns {Object} {text, provider, model, tokens}
 */
async function chat(messages, options = {}) {
  const started = Date.now();
  try {
    const result = await chatInternal(messages, options);
    metrics.record({
      provider: result.provider,
      providerId: providerIdOf(result.provider),
      model: result.model,
      usage: result.tokens,
      // A estimativa que decidiu o encaminhamento, para afinar o limiar.
      estimatedPromptTokens: estimatePromptTokens(messages),
      ms: Date.now() - started,
      ok: result.success !== false && !!result.provider,
      paid: result.paid === true,
      error: result.provider ? null : result.text
    });
    return result;
  } catch (err) {
    metrics.record({ ms: Date.now() - started, ok: false, error: err.message });
    throw err;
  }
}

async function chatInternal(messages, options = {}) {
  const customFirst = customGoesFirst(options);

  // Com ferramentas em jogo, o fornecedor pessoal só entra se as souber usar.
  // Sem esta verificação, quem tinha um fornecedor pessoal sem suporte perdia
  // a cascata inteira: as ferramentas eram enviadas, ignoradas em silêncio, e
  // a resposta vinha em texto como se nada faltasse.
  const querFerramentas = Array.isArray(options.tools) && options.tools.length > 0;
  const customServe = !querFerramentas || customProvider.supportsTools(options.userId);

  if (querFerramentas && customFirst && !customServe) {
    console.log('  ↪️ O fornecedor pessoal não sabe usar ferramentas: a usar a cadeia interna.');
  }

  // ══ NÍVEL PAGO À FRENTE — só quando a política ou quem chama o pedem ══
  if (customFirst && customServe) {
    const paid = await tryCustomProvider(messages, options);
    if (paid) return paid;
    console.warn('  ⚠️ Provider personalizado falhou, a usar a cadeia gratuita...');
  }

  let providers = orderProvidersByPromptSize(getAvailableProviders(), messages);

  // Com ferramentas em jogo, só interessam os fornecedores que as suportam.
  // O modelo local não suporta, e mandar-lhe ferramentas fá-lo-ia ignorá-las
  // em silêncio e responder texto solto.
  if (Array.isArray(options.tools) && options.tools.length) {
    const capazes = providers.filter(p => p.supportsTools);
    if (!capazes.length) {
      return { text: '', provider: null, success: false, noToolProvider: true };
    }
    providers = capazes;
  }

  // Se forçou provider específico
  if (options.provider && PROVIDERS[options.provider]) {
    const result = await callProvider(options.provider, messages, options);
    if (result.success) return result;
    // Se falhou, continua para fallback
  }

  // Tentar cada provider na ordem (Groq → Cerebras → Gemini → ...)
  for (const provider of providers) {
    if (isInCooldown(provider.id)) {
      console.log(`  ⏳ ${provider.name} em cooldown, a saltar...`);
      continue;
    }

    try {
      const result = await callProvider(provider.id, messages, options);
      if (result.success) return result;
    } catch (error) {
      console.error(`  ❌ ${provider.name} falhou: ${error.message}`);
      setCooldown(provider.id);
    }
  }

  // ══ ÚLTIMO RECURSO: escalar para o nível pago ══
  if (!customFirst && customServe && hasCustomTier(options)) {
    console.warn('  💳 Cadeia gratuita esgotada, a escalar para o provider pago...');
    const paid = await tryCustomProvider(messages, options);
    if (paid) return paid;
  }

  if (providers.length === 0 && !hasCustomTier(options)) {
    return { text: '⚠️ Nenhum provider de IA configurado. Adiciona pelo menos GROQ_API_KEY ao .env', provider: null };
  }

  return { text: '⚠️ Todos os providers de IA falharam. Tenta novamente em 1 minuto.', provider: null, success: false };
}

/**
 * Chama um provider específico
 */
async function callProvider(providerId, messages, options = {}) {
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`Provider desconhecido: ${providerId}`);

  const apiKey = provider.keyEnv ? process.env[provider.keyEnv] : null;
  if (provider.keyEnv && !apiKey) throw new Error(`${provider.name}: API key não configurada`);

  const model = options.model || provider.model;
  const maxTokens = options.maxTokens || provider.maxTokens;
  const temperature = options.temperature ?? 0.7;

  switch (provider.format) {
    case 'openai':
      return await callOpenAICompatible(provider, apiKey, messages, {
        model, maxTokens, temperature,
        tools: options.tools, toolChoice: options.toolChoice
      });
    case 'anthropic':
      return await anthropicAdapter.conversar(provider, apiKey, messages, {
        model, maxTokens, temperature,
        tools: options.tools, effort: options.effort
      });
    case 'gemini':
      return await callGemini(provider, apiKey, messages, { model, maxTokens, temperature });
    case 'huggingface':
      return await callHuggingFace(provider, apiKey, messages, { model, maxTokens, temperature });
    case 'ollama':
      return await callOllama(provider, messages, { model, maxTokens, temperature });
    default:
      throw new Error(`Formato desconhecido: ${provider.format}`);
  }
}

// ═══════════════════════════════════════════════════════════
// STREAMING
// ═══════════════════════════════════════════════════════════

/**
 * Envia mensagem com streaming de tokens
 * @param {Array} messages - [{role, content}]
 * @param {Function} onToken - Callback chamado para cada token: (token: string) => void
 * @param {Function} onDone - Callback quando termina: (fullText: string, metadata: Object) => void
 * @param {Object} options - {maxTokens, temperature, provider, userId}
 */
/**
 * Streaming com fallback. Regista latência até ao primeiro token, que é a
 * métrica que o utilizador sente, e não a latência total.
 */
async function chatStream(messages, onToken, onDone, options = {}) {
  const started = Date.now();
  let firstTokenAt = null;
  let recorded = false;

  const trackedToken = (token) => {
    if (firstTokenAt === null) firstTokenAt = Date.now();
    onToken(token);
  };

  const trackedDone = (fullText, meta = {}) => {
    // _recorded: veio do fallback síncrono, que já passou por chat().
    if (!recorded && !meta._recorded) {
      recorded = true;
      metrics.record({
        provider: meta.provider,
        providerId: providerIdOf(meta.provider),
        model: meta.model,
        usage: meta.tokens,
        estimatedPromptTokens: estimatePromptTokens(messages),
        ms: Date.now() - started,
        msToFirstToken: firstTokenAt ? firstTokenAt - started : null,
        ok: !!meta.provider,
        paid: meta.paid === true
      });
    }
    onDone(fullText, meta);
  };

  return chatStreamInternal(messages, trackedToken, trackedDone, options);
}

async function chatStreamInternal(messages, onToken, onDone, options = {}) {
  const customFirst = customGoesFirst(options);

  // ══ NÍVEL PAGO À FRENTE — mesma política do chat() ══
  if (customFirst && await tryCustomStream(messages, onToken, onDone, options)) {
    return;
  }

  const providers = orderProvidersByPromptSize(
    getAvailableProviders().filter(p => p.supportsStreaming),
    messages
  );
  
  if (providers.length === 0) {
    const fallback = await chat(messages, options);
    onToken(fallback.text);
    onDone(fallback.text, { ...fallback, _recorded: true });
    return;
  }

  // Se forçou provider
  if (options.provider && PROVIDERS[options.provider]?.supportsStreaming) {
    try {
      return await streamFromProvider(options.provider, messages, onToken, onDone, options);
    } catch (e) {
      console.error(`  ❌ Stream ${options.provider} falhou: ${e.message}`);
    }
  }

  // Tentar cada provider
  for (const provider of providers) {
    if (isInCooldown(provider.id)) continue;
    
    try {
      return await streamFromProvider(provider.id, messages, onToken, onDone, options);
    } catch (error) {
      console.error(`  ❌ Stream ${provider.name} falhou: ${error.message}`);
      setCooldown(provider.id);
    }
  }

  // ══ ÚLTIMO RECURSO: escalar para o nível pago ══
  if (!customFirst && hasCustomTier(options)) {
    console.warn('  💳 Streaming gratuito esgotado, a escalar para o provider pago...');
    if (await tryCustomStream(messages, onToken, onDone, options)) return;
  }

  // Nenhum streaming disponível — fallback síncrono
  const fallback = await chat(messages, options);
  onToken(fallback.text);
  onDone(fallback.text, { ...fallback, _recorded: true });
}

/**
 * Stream pelo provider pago. Devolve true se serviu o pedido.
 */
async function tryCustomStream(messages, onToken, onDone, options) {
  try {
    const config = customProvider.getUserProvider(options.userId);
    if (!config || !config.supportsStreaming) return false;
    console.log(`  🔑 Streaming via provider personalizado: ${config.providerName}`);
    // paid: marca o nível para o registo de métricas.
    const done = (text, meta = {}) => onDone(text, { ...meta, paid: true });
    await customProvider.streamCustomProvider(options.userId, messages, onToken, done, options);
    return true;
  } catch (e) {
    console.warn(`  ⚠️ Custom stream falhou: ${e.message}`);
    return false;
  }
}

/**
 * Stream de um provider específico
 */
async function streamFromProvider(providerId, messages, onToken, onDone, options = {}) {
  const provider = PROVIDERS[providerId];
  const apiKey = provider.keyEnv ? process.env[provider.keyEnv] : null;
  const model = options.model || provider.model;
  const maxTokens = options.maxTokens || provider.maxTokens;
  const temperature = options.temperature ?? 0.7;

  switch (provider.format) {
    case 'openai':
      return await streamOpenAICompatible(provider, providerId, apiKey, messages, onToken, onDone, { model, maxTokens, temperature });
    case 'gemini':
      return await streamGemini(provider, providerId, apiKey, messages, onToken, onDone, { model, maxTokens, temperature });
    case 'ollama':
      return await streamOllama(provider, providerId, messages, onToken, onDone, { model, maxTokens, temperature });
    default:
      throw new Error(`Streaming não suportado: ${provider.format}`);
  }
}

// ═══════════════════════════════════════════════════════════
// IMPLEMENTAÇÃO POR FORMATO — SYNC
// ═══════════════════════════════════════════════════════════

/**
 * Modelos de raciocínio consomem tokens de completion antes de escrever.
 * Um teto demasiado baixo esgota o orçamento no raciocínio e devolve vazio.
 */
const REASONING_MIN_TOKENS = 512;

function buildOpenAIBody(provider, messages, opts, extra = {}) {
  const body = {
    model: opts.model,
    messages,
    max_tokens: provider.reasoning
      ? Math.max(opts.maxTokens || 0, REASONING_MIN_TOKENS)
      : opts.maxTokens,
    temperature: opts.temperature,
    ...extra
  };
  if (provider.reasoningEffort) body.reasoning_effort = provider.reasoningEffort;

  // Ferramentas: só para quem as suporta e só quando vêm pedidas.
  if (provider.supportsTools && Array.isArray(opts.tools) && opts.tools.length) {
    body.tools = opts.tools;
    body.tool_choice = opts.toolChoice || 'auto';
  }
  return body;
}

async function callOpenAICompatible(provider, apiKey, messages, opts) {
  const fetchOpts = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Connection': 'keep-alive'
    },
    body: JSON.stringify(buildOpenAIBody(provider, messages, opts, { top_p: 0.9 }))
  };
  if (dispatcher) fetchOpts.dispatcher = dispatcher;

  const response = await fetch(`${provider.baseUrl}/chat/completions`, fetchOpts);
  
  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 429) {
      // Rate limit — tentar fallback model
      if (opts.model !== provider.fallbackModel) {
        console.warn(`  ⚠️ ${provider.name} rate limit, tentando ${provider.fallbackModel}...`);
        return callOpenAICompatible(provider, apiKey, messages, { ...opts, model: provider.fallbackModel });
      }
      setCooldown(provider.id);
    }
    throw new Error(`${provider.name} ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  const mensagem = data.choices?.[0]?.message || {};
  const text = mensagem.content;
  const toolCalls = mensagem.tool_calls || null;

  // Quando o modelo escolhe uma ferramenta, o conteúdo vem vazio de propósito.
  // Tratar isso como "resposta vazia" fazia o router saltar para o fornecedor
  // seguinte e perder a chamada.
  if (!text && !toolCalls) throw new Error(`${provider.name}: resposta vazia`);

  return {
    success: true,
    text: text || '',
    toolCalls,
    raw: toolCalls ? mensagem : undefined,
    provider: provider.name,
    model: opts.model,
    tokens: data.usage || {}
  };
}

async function callGemini(provider, apiKey, messages, opts) {
  // Converter formato OpenAI → Gemini
  const systemInstruction = messages.find(m => m.role === 'system')?.content;
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

  const body = {
    contents,
    generationConfig: {
      maxOutputTokens: opts.maxTokens,
      temperature: opts.temperature,
      topP: 0.9
    }
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const url = `${provider.baseUrl}/models/${opts.model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 429 && opts.model !== provider.fallbackModel) {
      return callGemini(provider, apiKey, messages, { ...opts, model: provider.fallbackModel });
    }
    throw new Error(`Gemini ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini: resposta vazia');

  return {
    success: true,
    text,
    provider: 'Gemini',
    model: opts.model,
    tokens: data.usageMetadata || {}
  };
}

async function callHuggingFace(provider, apiKey, messages, opts) {
  // Converter para formato text-generation
  const prompt = messages.map(m => {
    if (m.role === 'system') return `<|system|>\n${m.content}</s>`;
    if (m.role === 'user') return `<|user|>\n${m.content}</s>`;
    return `<|assistant|>\n${m.content}</s>`;
  }).join('\n') + '\n<|assistant|>\n';

  const url = `${provider.baseUrl}/${opts.model}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        max_new_tokens: opts.maxTokens,
        temperature: opts.temperature,
        return_full_text: false
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 429 && opts.model !== provider.fallbackModel) {
      return callHuggingFace(provider, apiKey, messages, { ...opts, model: provider.fallbackModel });
    }
    throw new Error(`HuggingFace ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  const text = Array.isArray(data) ? data[0]?.generated_text : data?.generated_text;
  if (!text) throw new Error('HuggingFace: resposta vazia');

  return { success: true, text: text.trim(), provider: 'HuggingFace', model: opts.model, tokens: {} };
}

async function callOllama(provider, messages, opts) {
  const url = `${provider.baseUrl}/api/chat`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      messages,
      stream: false,

      // Mantem o modelo residente: evita o arranque a frio de 105 s.

      keep_alive: provider.keepAlive,
      options: {
        num_predict: opts.maxTokens,
        temperature: opts.temperature
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    if (opts.model !== provider.fallbackModel) {
      return callOllama(provider, messages, { ...opts, model: provider.fallbackModel });
    }
    throw new Error(`Ollama ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  const text = data.message?.content;
  if (!text) throw new Error('Ollama: resposta vazia');

  // O Ollama devolve as contagens ao lado da mensagem — aproveitá-las
  // é o que permite comparar custo local com custo remoto.
  return {
    success: true,
    text,
    provider: 'Ollama',
    model: opts.model,
    tokens: {
      prompt_eval_count: data.prompt_eval_count,
      eval_count: data.eval_count
    }
  };
}

// ═══════════════════════════════════════════════════════════
// IMPLEMENTAÇÃO POR FORMATO — STREAMING
// ═══════════════════════════════════════════════════════════

async function streamOpenAICompatible(provider, providerId, apiKey, messages, onToken, onDone, opts) {
  const fetchOpts = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Connection': 'keep-alive'
    },
    body: JSON.stringify(buildOpenAIBody(provider, messages, opts, {
      stream: true,
      // Sem isto o streaming não devolve contagens e o custo fica invisível.
      stream_options: { include_usage: true }
    }))
  };
  if (dispatcher) fetchOpts.dispatcher = dispatcher;

  const response = await fetch(`${provider.baseUrl}/chat/completions`, fetchOpts);
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`${provider.name} stream ${response.status}: ${errText.substring(0, 200)}`);
  }

  let fullText = '';
  let usage = null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const payload = trimmed.slice(6);
      if (payload === '[DONE]') continue;

      try {
        const json = JSON.parse(payload);
        // Com stream_options.include_usage, o último chunk traz as contagens.
        if (json.usage) usage = json.usage;
        const token = json.choices?.[0]?.delta?.content;
        if (token) {
          fullText += token;
          onToken(token);
        }
      } catch {}
    }
  }

  onDone(fullText, { provider: provider.name, model: opts.model, tokens: usage });
}

async function streamGemini(provider, providerId, apiKey, messages, onToken, onDone, opts) {
  const systemInstruction = messages.find(m => m.role === 'system')?.content;
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

  const body = {
    contents,
    generationConfig: {
      maxOutputTokens: opts.maxTokens,
      temperature: opts.temperature
    }
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const url = `${provider.baseUrl}/models/${opts.model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini stream ${response.status}: ${errText.substring(0, 200)}`);
  }

  let fullText = '';
  let usage = null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      
      try {
        const json = JSON.parse(trimmed.slice(6));
        // O Gemini repete usageMetadata em cada chunk; o último é o total.
        if (json.usageMetadata) usage = json.usageMetadata;
        const token = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (token) {
          fullText += token;
          onToken(token);
        }
      } catch {}
    }
  }

  onDone(fullText, { provider: 'Gemini', model: opts.model, tokens: usage });
}

async function streamOllama(provider, providerId, messages, onToken, onDone, opts) {
  const url = `${provider.baseUrl}/api/chat`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      messages,
      stream: true,

      // Mantem o modelo residente: evita o arranque a frio de 105 s.

      keep_alive: provider.keepAlive,
      options: {
        num_predict: opts.maxTokens,
        temperature: opts.temperature
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama stream ${response.status}: ${errText.substring(0, 200)}`);
  }

  let fullText = '';
  let usage = null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        // O chunk final do Ollama (done: true) traz as contagens.
        if (json.done && (json.prompt_eval_count != null || json.eval_count != null)) {
          usage = { prompt_eval_count: json.prompt_eval_count, eval_count: json.eval_count };
        }
        const token = json.message?.content;
        if (token) {
          fullText += token;
          onToken(token);
        }
      } catch {}
    }
  }

  onDone(fullText, { provider: 'Ollama', model: opts.model, tokens: usage });
}

// ═══════════════════════════════════════════════════════════
// UTILITÁRIOS
// ═══════════════════════════════════════════════════════════

/**
 * Lista o estado de todos os providers
 */
function getProvidersStatus() {
  return Object.entries(PROVIDERS).map(([id, p]) => {
    const hasKey = p.keyEnv ? !!process.env[p.keyEnv] : true;
    const inCooldown = isInCooldown(id);
    return {
      id,
      name: p.name,
      configured: hasKey,
      available: hasKey && !inCooldown,
      inCooldown,
      model: p.model,
      streaming: p.supportsStreaming,
      vision: p.supportsVision
    };
  });
}

/**
 * Provider principal ativo
 */
function getActiveProvider() {
  const available = getAvailableProviders();
  return available.find(p => !isInCooldown(p.id)) || available[0] || null;
}

/**
 * Verifica se pelo menos um provider está disponível
 */
function isAvailable() {
  return getAvailableProviders().length > 0;
}

/**
 * Carrega o modelo local para memória no arranque.
 *
 * Sem isto, a primeira mensagem do dia paga o arranque a frio, que nesta
 * máquina foi medido em 105 segundos contra 1,4 já quente. Enviar uma
 * mensagem vazia ao Ollama carrega o modelo sem gerar nada.
 *
 * Não bloqueia, não fala quando corre bem, e desliga-se com OLLAMA_WARMUP=0.
 */
function warmupLocal() {
  if (process.env.OLLAMA_WARMUP === '0') return;

  const provider = PROVIDERS.ollama;
  const order = process.env.LLM_PROVIDER_ORDER || '';
  if (order && !order.includes('ollama')) return;

  const started = Date.now();
  fetch(`${provider.baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: provider.model,
      messages: [],
      keep_alive: provider.keepAlive
    })
  })
    .then(res => {
      if (!res.ok) return;
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`  🔥 Modelo local pronto: ${provider.model} (${secs}s, residente ${provider.keepAlive})`);
    })
    .catch(() => { /* Ollama pode não estar a correr; a cadeia trata disso */ });
}

/**
 * Fecha o pool de ligações keep-alive.
 *
 * O dispatcher da undici mantém sockets abertos, o que segura o event loop e
 * impede scripts e suites de teste de terminarem sozinhos. Chama isto no fim
 * de qualquer processo de vida curta.
 */
async function shutdown() {
  if (!dispatcher) return;
  try {
    await dispatcher.close();
  } catch (e) {
    try { await dispatcher.destroy(); } catch (_) { /* já fechado */ }
  }
}

module.exports = {
  chat,
  chatStream,
  warmupLocal,
  shutdown,
  getProvidersStatus,
  getActiveProvider,
  getAvailableProviders,
  isAvailable,
  customProviderMode,
  hasCustomTier,
  PROVIDERS
};
