/**
 * 🔍 Web Search Agent - Pesquisa Inteligente na Internet
 * 
 * Escolha automática de motor:
 * - DuckDuckGo: Conceitos, definições, pessoas (grátis ilimitado)
 * - Serper.dev: Notícias, preços, atualidade (2500/mês grátis - Google real)
 */

require('dotenv').config();
const prazo = require('../orchestrator/prazo');

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const USER_AGENT = 'NEXO/2.0 (Personal Assistant)';

// ═══════════════════════════════════════════════════════════
// CLASSIFICADOR DE QUERY
// ═══════════════════════════════════════════════════════════

/**
 * Classifica o tipo de pesquisa para escolher o motor adequado
 * @param {string} query - Termo de pesquisa
 * @returns {'realtime'|'knowledge'} Tipo de pesquisa
 */
function classifyQuery(query) {
  const lower = query.toLowerCase();
  
  // Padrões que precisam de dados em tempo real (usar Serper/Google)
  const realtimePatterns = [
    /preço|cotação|valor/i,
    /notícias|news|última hora/i,
    /resultado|score|placar/i,
    /tempo em|previsão|meteorologia/i,
    /hoje|agora|atual|2024|2025|2026/i,
    /comprar|loja|onde encontrar/i,
    /horário|aberto|funciona/i,
    /evento|concerto|festival/i,
    /download|baixar|instalar/i,
    /review|opinião|avaliação/i,
    /como fazer|tutorial|passo a passo/i,
    /melhor|top\s+\d+|ranking/i,
    /vs\s+|versus|comparar/i,
    /erro|problema|bug|fix/i,
    /código|programação|javascript|python/i
  ];
  
  // Padrões de conhecimento geral (usar DuckDuckGo)
  const knowledgePatterns = [
    /^o que é|what is/i,
    /^quem é|quem foi|who is/i,
    /^quando foi|when was/i,
    /^onde fica|where is/i,
    /definição|significado|meaning/i,
    /história de|history of/i,
    /biografia|nasceu|morreu/i,
    /capital de|população de/i,
    /fórmula|equação|teoria/i
  ];
  
  // Verificar padrões de tempo real primeiro (prioridade)
  for (const pattern of realtimePatterns) {
    if (pattern.test(lower)) {
      return 'realtime';
    }
  }
  
  // Verificar padrões de conhecimento
  for (const pattern of knowledgePatterns) {
    if (pattern.test(lower)) {
      return 'knowledge';
    }
  }
  
  // Default: conhecimento (DuckDuckGo é grátis ilimitado)
  return 'knowledge';
}

// ═══════════════════════════════════════════════════════════
// DUCKDUCKGO (GRÁTIS ILIMITADO)
// ═══════════════════════════════════════════════════════════

/**
 * Pesquisa usando DuckDuckGo Instant Answer API
 * Bom para: definições, conceitos, pessoas famosas, Wikipedia
 */
async function searchDuckDuckGo(query) {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`;
    
    // Uma pesquisa sem prazo foi o que deixou o NEXO mudo: o pedido ficou
    // pendurado, o WebSocket nunca respondeu e no ecrã ficou um cursor a
    // piscar sem fim. Ou a pesquisa é rápida, ou não serve para responder.
    const cronometro = prazo.relogio(prazo.PRAZO_PESQUISA_MS, 'O DuckDuckGo');
    let data;
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: cronometro.signal
      });

      if (!response.ok) {
        throw new Error(`DDG Error: ${response.status}`);
      }

      data = await response.json();
    } catch (err) {
      throw prazo.traduzirErro(err, cronometro, 'O DuckDuckGo');
    } finally {
      cronometro.parar();
    }
    
    const results = {
      source: 'DuckDuckGo',
      query: query,
      queryType: 'knowledge',
      answer: null,
      abstract: null,
      results: [],
      relatedTopics: []
    };
    
    // Resposta instantânea
    if (data.Answer) {
      results.answer = data.Answer;
    }
    
    // Abstract (Wikipedia, etc.)
    if (data.Abstract) {
      results.abstract = {
        text: data.Abstract,
        source: data.AbstractSource,
        url: data.AbstractURL
      };
    }
    
    // Tópicos relacionados
    if (data.RelatedTopics?.length > 0) {
      results.relatedTopics = data.RelatedTopics
        .filter(t => t.Text)
        .slice(0, 5)
        .map(t => ({
          text: t.Text,
          url: t.FirstURL
        }));
    }
    
    return results;
    
  } catch (error) {
    console.error('❌ Erro DuckDuckGo:', error.message);
    return { error: error.message, source: 'DuckDuckGo' };
  }
}

// ═══════════════════════════════════════════════════════════
// SERPER.DEV (GOOGLE REAL - 2500/MÊS GRÁTIS)
// ═══════════════════════════════════════════════════════════

/**
 * Pesquisa usando Serper.dev (Google Search API)
 * Bom para: notícias, preços, atualidade, tutoriais
 * Registo grátis: https://serper.dev
 */
async function searchSerper(query, options = {}) {
  if (!SERPER_API_KEY) {
    console.warn('⚠️ SERPER_API_KEY não configurada, usando DuckDuckGo');
    return searchDuckDuckGo(query);
  }
  
  try {
    const type = options.type || 'search'; // search, news, images
    const num = options.count || 5;
    
    const cronometro = prazo.relogio(prazo.PRAZO_PESQUISA_MS, 'O Serper');
    let data;
    try {
      const response = await fetch('https://google.serper.dev/' + type, {
        method: 'POST',
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          q: query,
          num: num,
          gl: 'pt',  // Portugal
          hl: 'pt'   // Português
        }),
        signal: cronometro.signal
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Serper Error: ${response.status} - ${error}`);
      }

      data = await response.json();
    } catch (err) {
      throw prazo.traduzirErro(err, cronometro, 'O Serper');
    } finally {
      cronometro.parar();
    }
    
    const results = {
      source: 'Google (via Serper)',
      query: query,
      queryType: 'realtime',
      answer: null,
      results: [],
      news: [],
      knowledgeGraph: null
    };
    
    // Answer Box (resposta direta do Google)
    if (data.answerBox) {
      results.answer = data.answerBox.answer || data.answerBox.snippet;
    }
    
    // Knowledge Graph (info lateral do Google)
    if (data.knowledgeGraph) {
      results.knowledgeGraph = {
        title: data.knowledgeGraph.title,
        type: data.knowledgeGraph.type,
        description: data.knowledgeGraph.description,
        url: data.knowledgeGraph.website
      };
    }
    
    // Resultados orgânicos
    if (data.organic?.length > 0) {
      results.results = data.organic.slice(0, num).map(r => ({
        title: r.title,
        url: r.link,
        description: r.snippet,
        date: r.date
      }));
    }
    
    // Notícias (se pesquisa de news)
    if (data.news?.length > 0) {
      results.news = data.news.slice(0, 3).map(n => ({
        title: n.title,
        url: n.link,
        source: n.source,
        date: n.date
      }));
    }
    
    return results;
    
  } catch (error) {
    console.error('❌ Erro Serper:', error.message);
    // Fallback para DuckDuckGo
    console.warn('⚠️ Fallback para DuckDuckGo...');
    return searchDuckDuckGo(query);
  }
}

// ═══════════════════════════════════════════════════════════
// PESQUISA INTELIGENTE
// ═══════════════════════════════════════════════════════════

/**
 * Pesquisa inteligente - escolhe automaticamente o melhor motor
 * @param {string} query - Termo de pesquisa
 * @param {Object} options - Opções
 */
/**
 * Um motor de pesquisa recebe termos, não um desabafo.
 *
 * O que chegava aqui era a mensagem inteira do utilizador, porque o parser de
 * intenções manda o prompt todo quando não consegue extrair os termos. Um
 * parágrafo de duzentas palavras dentro de um endereço faz o motor engasgar-se
 * ou devolver nada. Corta-se pela primeira frase e com um tecto.
 */
const MAX_TERMOS = 200;

function limparConsulta(query) {
  const texto = String(query || '').replace(/\s+/g, ' ').trim();
  if (texto.length <= MAX_TERMOS) return texto;

  const primeiraFrase = texto.split(/[.!?;]/)[0].trim();
  if (primeiraFrase.length >= 10 && primeiraFrase.length <= MAX_TERMOS) return primeiraFrase;

  return texto.slice(0, MAX_TERMOS).trim();
}

async function search(query, options = {}) {
  query = limparConsulta(query);
  if (!query) {
    return { source: 'nenhum', query: '', results: [], error: 'Sem termos para pesquisar' };
  }

  const queryType = classifyQuery(query);

  console.log(`🔍 Pesquisa: "${query}" [Tipo: ${queryType}]`);

  // Forçar motor específico se pedido
  if (options.forceEngine === 'serper') {
    return searchSerper(query, options);
  }
  if (options.forceEngine === 'duckduckgo') {
    return searchDuckDuckGo(query);
  }
  
  // Escolha automática baseada no tipo de query
  if (queryType === 'realtime' && SERPER_API_KEY) {
    // Notícias, preços, atualidade → Google (Serper)
    return searchSerper(query, options);
  } else {
    // Conceitos, definições, pessoas → DuckDuckGo
    return searchDuckDuckGo(query);
  }
}

// ═══════════════════════════════════════════════════════════
// FORMATAÇÃO DE RESULTADOS
// ═══════════════════════════════════════════════════════════

/**
 * Formata resultados para exibição
 */
function formatResults(results) {
  if (results.error) {
    return `❌ Erro na pesquisa: ${results.error}`;
  }
  
  let output = `🔍 **Pesquisa Web** (${results.source})\n`;
  output += `📝 Query: "${results.query}"\n`;
  output += `🏷️ Tipo: ${results.queryType === 'realtime' ? '⚡ Tempo Real' : '📚 Conhecimento'}\n\n`;
  
  // Resposta direta
  if (results.answer) {
    output += `💡 **Resposta:** ${results.answer}\n\n`;
  }
  
  // Knowledge Graph (Google)
  if (results.knowledgeGraph) {
    const kg = results.knowledgeGraph;
    output += `📌 **${kg.title}** (${kg.type || 'Info'})\n`;
    if (kg.description) output += `${kg.description}\n`;
    if (kg.url) output += `🔗 ${kg.url}\n`;
    output += '\n';
  }
  
  // Abstract (DuckDuckGo/Wikipedia)
  if (results.abstract?.text) {
    output += `📚 **${results.abstract.source || 'Resumo'}:**\n`;
    output += `${results.abstract.text}\n`;
    if (results.abstract.url) output += `🔗 ${results.abstract.url}\n`;
    output += '\n';
  }
  
  // Notícias
  if (results.news?.length > 0) {
    output += `📰 **Notícias Recentes:**\n`;
    results.news.forEach((n, i) => {
      output += `${i + 1}. ${n.title}\n`;
      output += `   📅 ${n.date || 'Recente'} | 📰 ${n.source}\n`;
      output += `   🔗 ${n.url}\n\n`;
    });
  }
  
  // Resultados web
  if (results.results?.length > 0) {
    output += `📋 **Resultados:**\n`;
    results.results.forEach((r, i) => {
      output += `\n${i + 1}. **${r.title}**\n`;
      if (r.description) {
        const desc = r.description.substring(0, 150);
        output += `   ${desc}${r.description.length > 150 ? '...' : ''}\n`;
      }
      if (r.date) output += `   📅 ${r.date}\n`;
      output += `   🔗 ${r.url}\n`;
    });
  }
  
  // Tópicos relacionados
  if (results.relatedTopics?.length > 0) {
    output += `\n📎 **Tópicos Relacionados:**\n`;
    results.relatedTopics.forEach((t, i) => {
      output += `${i + 1}. ${t.text}\n`;
    });
  }
  
  // Sem resultados
  if (!results.answer && !results.abstract && !results.results?.length && 
      !results.relatedTopics?.length && !results.knowledgeGraph) {
    output += `⚠️ Nenhum resultado encontrado para "${results.query}"`;
  }
  
  return output;
}

/**
 * Pesquisa e formata numa única chamada
 */
async function searchAndFormat(query, options = {}) {
  const results = await search(query, options);
  return formatResults(results);
}

// ═══════════════════════════════════════════════════════════
// UTILITÁRIOS
// ═══════════════════════════════════════════════════════════

/**
 * Extrai query de uma mensagem
 */
function extractSearchQuery(message) {
  const lower = message.toLowerCase();
  
  const prefixes = [
    /^pesquisa(r)?\s+(?:na\s+internet|web|online)?\s*(?:sobre|por)?\s*/i,
    /^procura(r)?\s+(?:na\s+internet|online)?\s*(?:sobre|por)?\s*/i,
    /^busca(r)?\s+(?:na\s+internet|online)?\s*(?:sobre|por)?\s*/i,
    /^search\s+(?:for)?\s*/i,
    /^o\s+que\s+(?:é|são|foi|foram)\s+/i,
    /^quem\s+(?:é|foi|são)\s+/i,
    /^quando\s+(?:foi|é|será)\s+/i,
    /^onde\s+(?:fica|é|está)\s+/i
  ];
  
  let query = message;
  for (const prefix of prefixes) {
    query = query.replace(prefix, '');
  }
  
  return query.replace(/[?!.]+$/, '').trim() || message;
}

/**
 * Verifica se pesquisa está disponível
 */
function isAvailable() {
  return true; // DuckDuckGo sempre disponível
}

/**
 * Verifica qual motor está configurado
 */
function getConfiguredEngines() {
  const engines = ['DuckDuckGo (grátis)'];
  if (SERPER_API_KEY) engines.push('Serper/Google (2500/mês)');
  return engines;
}

/**
 * Verifica se Serper está configurado
 */
function hasSerper() {
  return !!SERPER_API_KEY;
}

// Manter compatibilidade com código antigo
function hasBraveSearch() {
  return hasSerper();
}

module.exports = {
  search,
  searchDuckDuckGo,
  searchSerper,
  formatResults,
  searchAndFormat,
  classifyQuery,
  limparConsulta,
  extractSearchQuery,
  isAvailable,
  hasSerper,
  hasBraveSearch,
  getConfiguredEngines
};
