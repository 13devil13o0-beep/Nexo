/**
 * 🟠 Adaptador Anthropic (Claude)
 *
 * O ciclo de ferramentas do NEXO fala uma só língua, herdada do formato da
 * OpenAI, porque foi com o Groq que começou. Este adaptador traduz nos dois
 * sentidos, para que o núcleo continue sem saber com quem está a falar.
 *
 * O que muda entre os dois formatos, e que este ficheiro resolve:
 *
 *   1. As ferramentas são { name, description, input_schema }, sem o embrulho
 *      "function" e com input_schema em vez de parameters.
 *   2. O prompt de sistema é um parâmetro de topo, não uma mensagem com papel
 *      'system'.
 *   3. A chamada de ferramenta vem como bloco { type: 'tool_use', id, name,
 *      input } dentro do conteúdo, não como tool_calls.
 *   4. O resultado volta como bloco tool_result dentro de uma mensagem de
 *      UTILIZADOR, e todos os resultados do mesmo turno têm de vir juntos.
 *   5. max_tokens é obrigatório.
 *
 * Devolvemos sempre a resposta na forma comum do NEXO. Assim o histórico
 * guardado é neutro e uma conversa pode até mudar de fornecedor a meio.
 */

const VERSAO_API = '2023-06-01';

/** Esforço de raciocínio por omissão. Igual à filosofia do resto: o mínimo
 *  que resolve. Sobe para 'high' em tarefas difíceis, via opções. */
const ESFORCO_PADRAO = process.env.ANTHROPIC_EFFORT || 'low';

// ═══════════════════════════════════════════════════════════
// TRADUÇÃO: NEXO → ANTHROPIC
// ═══════════════════════════════════════════════════════════

/** [{type:'function', function:{name, description, parameters}}] → Anthropic */
function ferramentasParaAnthropic(ferramentas) {
  if (!Array.isArray(ferramentas)) return undefined;
  return ferramentas.map(f => {
    const fn = f.function || f;
    return {
      name: fn.name,
      description: fn.description,
      input_schema: fn.parameters || fn.input_schema || { type: 'object', properties: {} }
    };
  });
}

/**
 * Converte o histórico comum para o formato da Anthropic.
 *
 * Devolve { system, mensagens }. As mensagens com papel 'tool' consecutivas
 * são agrupadas numa única mensagem de utilizador, como a API exige.
 */
function mensagensParaAnthropic(mensagens) {
  const partesSistema = [];
  const saida = [];

  for (const m of mensagens || []) {
    if (!m) continue;

    if (m.role === 'system') {
      if (m.content) partesSistema.push(String(m.content));
      continue;
    }

    if (m.role === 'tool') {
      const bloco = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id,
        content: String(m.content ?? '')
      };
      // Juntar ao turno de resultados anterior, se for o caso.
      const ultimo = saida[saida.length - 1];
      const eTurnoDeResultados = ultimo
        && ultimo.role === 'user'
        && Array.isArray(ultimo.content)
        && ultimo.content.every(b => b.type === 'tool_result');

      if (eTurnoDeResultados) ultimo.content.push(bloco);
      else saida.push({ role: 'user', content: [bloco] });
      continue;
    }

    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const blocos = [];
      if (m.content) blocos.push({ type: 'text', text: String(m.content) });
      for (const c of m.tool_calls) {
        blocos.push({
          type: 'tool_use',
          id: c.id,
          name: c.function?.name,
          input: lerArgumentos(c.function?.arguments)
        });
      }
      saida.push({ role: 'assistant', content: blocos });
      continue;
    }

    // Mensagem normal.
    if (m.content) {
      saida.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) });
    }
  }

  return {
    system: partesSistema.length ? partesSistema.join('\n\n') : undefined,
    mensagens: saida
  };
}

/** Os argumentos viajam como texto JSON no formato comum. */
function lerArgumentos(bruto) {
  if (!bruto) return {};
  if (typeof bruto === 'object') return bruto;
  try { return JSON.parse(bruto); } catch (e) { return {}; }
}

// ═══════════════════════════════════════════════════════════
// TRADUÇÃO: ANTHROPIC → NEXO
// ═══════════════════════════════════════════════════════════

/**
 * Reduz a resposta da Anthropic à forma comum.
 * Blocos de raciocínio são ignorados: não são para mostrar nem para reenviar
 * a outro fornecedor.
 */
function respostaParaNexo(data, modelo) {
  const blocos = Array.isArray(data.content) ? data.content : [];

  const texto = blocos
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();

  const chamadas = blocos
    .filter(b => b.type === 'tool_use')
    .map(b => ({
      id: b.id,
      type: 'function',
      function: { name: b.name, arguments: JSON.stringify(b.input || {}) }
    }));

  return {
    success: true,
    text: texto,
    toolCalls: chamadas.length ? chamadas : null,
    // Turno do assistente na forma comum, para o histórico ficar neutro.
    raw: chamadas.length
      ? { role: 'assistant', content: texto || null, tool_calls: chamadas }
      : undefined,
    provider: 'Anthropic',
    model: data.model || modelo,
    tokens: data.usage || {},
    stopReason: data.stop_reason || null
  };
}

// ═══════════════════════════════════════════════════════════
// CHAMADA
// ═══════════════════════════════════════════════════════════

/**
 * Fala com a API de mensagens da Anthropic.
 * @param {Object} provider  entrada do llmRouter (baseUrl, model, maxTokens)
 * @param {string} apiKey
 * @param {Array}  mensagens histórico na forma comum
 * @param {Object} opts      { model, maxTokens, temperature, tools, effort }
 */
async function conversar(provider, apiKey, mensagens, opts = {}) {
  const { system, mensagens: convertidas } = mensagensParaAnthropic(mensagens);

  const corpo = {
    model: opts.model || provider.model,
    // Obrigatório na Anthropic, ao contrário dos outros.
    max_tokens: opts.maxTokens || provider.maxTokens || 4096,
    messages: convertidas,
    // Controla a profundidade do raciocínio, que no Opus 5 está ligado por
    // omissão. Não o desligamos: com raciocínio desligado o modelo às vezes
    // escreve a chamada de ferramenta em texto em vez de a fazer.
    output_config: { effort: opts.effort || ESFORCO_PADRAO }
  };

  if (system) {
    corpo.system = system;
    // Coloca automaticamente a marca de cache no último bloco estável. O
    // prefixo de um agente com ferramentas repete-se em todos os pedidos.
    corpo.cache_control = { type: 'ephemeral' };
  }

  const ferramentas = ferramentasParaAnthropic(opts.tools);
  if (ferramentas && ferramentas.length) corpo.tools = ferramentas;

  const resposta = await fetch(`${provider.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': VERSAO_API
    },
    body: JSON.stringify(corpo)
  });

  if (!resposta.ok) {
    const texto = await resposta.text();
    throw new Error(`Anthropic ${resposta.status}: ${texto.substring(0, 200)}`);
  }

  const data = await resposta.json();

  // Uma recusa por política chega com HTTP 200. Verificar antes de ler.
  if (data.stop_reason === 'refusal') {
    throw new Error('Anthropic: pedido recusado por política de segurança');
  }

  const normalizada = respostaParaNexo(data, corpo.model);
  if (!normalizada.text && !normalizada.toolCalls) {
    throw new Error('Anthropic: resposta vazia');
  }
  return normalizada;
}

module.exports = {
  conversar,
  ferramentasParaAnthropic,
  mensagensParaAnthropic,
  respostaParaNexo,
  VERSAO_API
};
