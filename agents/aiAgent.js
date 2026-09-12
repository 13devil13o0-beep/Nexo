/**
 * 🧠 AI Agent - Integração Multi-Provider via LLM Router
 * 
 * Usa o llmRouter para suportar Groq, Gemini, Cerebras, HuggingFace e Ollama
 * com fallback automático e streaming de respostas.
 */

require('dotenv').config();
const llmRouter = require('../orchestrator/llmRouter');

// Fonte única de verdade: os modelos vivem no llmRouter (orchestrator/llmRouter.js).
// Reexportados aqui apenas para retrocompatibilidade (system info, testes).
const GROQ_MODEL = llmRouter.PROVIDERS.groq.model;
const FALLBACK_MODEL = llmRouter.PROVIDERS.groq.fallbackModel;

/**
 * Quanto espaço tem uma resposta.
 *
 * Estava em 2048 e chegava para conversa, não para trabalho. Uma resposta com
 * tabelas e vários pontos batia no tecto e era cortada a meio de uma frase,
 * sem aviso: no ecrã parecia acabada, e acabava no meio de "criar um".
 */
const MAX_TOKENS_RESPOSTA = parseInt(process.env.RESPOSTA_MAX_TOKENS) || 4096;

/**
 * O texto de sistema tem de dizer a verdade sobre o que ele consegue fazer.
 *
 * A lista anterior dizia "executar tarefas" e "criar documentos" sem dizer
 * como, e o resultado media-se nas conversas: o NEXO prometia analisar o
 * projecto e a seguir pedia ao utilizador que lhe colasse o código, porque
 * neste caminho não tem ferramenta nenhuma na mão. Prometer o que não se pode
 * cumprir é pior do que dizer que não se sabe.
 */
const DEFAULT_SYSTEM = `És o NEXO, um assistente IA pessoal que corre no computador do utilizador.

PERSONALIDADE:
- Profissional mas amigável
- Proativo: antecipas necessidades
- Respostas claras e concisas
- Português europeu nativo

NESTE MOMENTO ESTÁS A RESPONDER SEM FERRAMENTAS.
Não consegues, nesta resposta, ler ficheiros, ver pastas, pesquisar na
internet nem olhar para o ecrã. Não prometas fazê-lo nem digas que vais
verificar seja o que for.

Se o pedido precisar mesmo de uma dessas coisas, diz numa linha que precisas
de ir buscar essa informação e pede ao utilizador que repita o pedido a dizer
o que quer em concreto, por exemplo o nome do ficheiro ou da pasta. Não lhe
peças para colar ficheiros que estão nesta máquina.

Para tudo o resto — explicar, escrever, rever, gerar código, dar ideias —
responde já e responde bem.`;

/**
 * Verifica se pelo menos um provider de IA está disponível
 */
function isAvailable() {
  return llmRouter.isAvailable();
}

/**
 * Faz pergunta à IA (síncrono — retorna resposta completa)
 * @param {string} prompt - Mensagem do utilizador
 * @param {Array} history - Histórico de mensagens [{role, content}]
 * @param {Object} options - Opções adicionais
 */
async function askAI(prompt, history = [], options = {}) {
  if (!isAvailable()) {
    return '⚠️ IA não configurada. Adiciona pelo menos GROQ_API_KEY ao .env';
  }

  const maxTokens = options.maxTokens || MAX_TOKENS_RESPOSTA;
  const temperature = options.temperature || 0.7;
  const systemPrompt = options.system || DEFAULT_SYSTEM;

  // Construir mensagens
  const messages = [{ role: 'system', content: systemPrompt }];
  
  if (Array.isArray(history) && history.length > 0) {
    messages.push(...history.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    })));
  }
  
  messages.push({ role: 'user', content: prompt });

  try {
    const result = await llmRouter.chat(messages, {
      maxTokens,
      temperature,
      provider: options.provider,
      userId: options.userId,
      // true = pede o nível pago à frente (tarefas que exigem qualidade)
      escalate: options.escalate
    });

    if (result.provider) {
      console.log(`  🧠 Resposta via ${result.provider} (${result.model || ''})`);
    }

    return result.text;
  } catch (err) {
    console.error('❌ Erro AI:', err.message);
    return `⚠️ Erro ao processar: ${err.message}`;
  }
}

/**
 * Faz pergunta à IA com streaming de tokens
 * @param {string} prompt - Mensagem do utilizador
 * @param {Array} history - Histórico [{role, content}]
 * @param {Function} onToken - Callback para cada token: (token) => void
 * @param {Object} options - Opções adicionais
 * @returns {Promise<string>} Texto completo da resposta
 */
async function askAIStream(prompt, history = [], onToken, options = {}) {
  if (!isAvailable()) {
    const msg = '⚠️ IA não configurada. Adiciona pelo menos GROQ_API_KEY ao .env';
    onToken(msg);
    return msg;
  }

  const maxTokens = options.maxTokens || MAX_TOKENS_RESPOSTA;
  const temperature = options.temperature || 0.7;
  const systemPrompt = options.system || DEFAULT_SYSTEM;

  const messages = [{ role: 'system', content: systemPrompt }];
  
  if (Array.isArray(history) && history.length > 0) {
    messages.push(...history.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    })));
  }
  
  messages.push({ role: 'user', content: prompt });

  return new Promise((resolve, reject) => {
    llmRouter.chatStream(
      messages,
      onToken,
      (fullText, metadata) => {
        if (metadata?.provider) {
          console.log(`  🧠 Stream via ${metadata.provider} (${metadata.model || ''})`);
        }
        // Quem chamou precisa de saber se a resposta foi cortada por falta de
        // espaço. Sem isto chega ao ecrã com o aspecto de estar completa.
        if (typeof options.aoTerminar === 'function') {
          try { options.aoTerminar(metadata || {}); } catch {}
        }
        resolve(fullText);
      },
      { maxTokens, temperature, provider: options.provider, userId: options.userId, escalate: options.escalate }
    ).catch(reject);
  });
}

/**
 * Gera conteúdo específico (para PDFs, documentos, etc.)
 */
async function generateContent(topic, type = 'documento') {
  const systemPrompt = `És um escritor profissional. Gera conteúdo de alta qualidade em português.
Formato: Texto estruturado com parágrafos claros.
Tipo de conteúdo: ${type}`;

  const prompt = `Cria um ${type} completo e detalhado sobre: ${topic}

Inclui:
- Introdução
- Desenvolvimento com múltiplas secções
- Conclusão

Escreve de forma profissional e informativa.`;

  return askAI(prompt, [], { 
    system: systemPrompt, 
    maxTokens: 4096,
    temperature: 0.8
  });
}

/**
 * Analisa intenção de uma mensagem
 */
async function analyzeIntent(message) {
  const prompt = `Analisa esta mensagem e identifica a intenção principal.

Mensagem: "${message}"

Responde APENAS com uma destas categorias:
- chat: Conversa geral ou pergunta
- create_pdf: Criar documento PDF
- create_note: Criar nota de texto
- run_code: Executar código JavaScript
- list_files: Listar ficheiros
- system_info: Informação do sistema
- help: Pedido de ajuda

Categoria:`;

  // O 2.º argumento de askAI é o histórico, não as opções.
  const response = await askAI(prompt, [], { maxTokens: 50, temperature: 0.1 });
  return response.trim().toLowerCase().replace(':', '');
}

module.exports = {
  askAI,
  askAIStream,
  generateContent,
  analyzeIntent,
  isAvailable,
  GROQ_MODEL,
  FALLBACK_MODEL
};
