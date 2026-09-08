/**
 * 🔁 Ciclo de Ferramentas
 *
 * O segundo nível da cascata. Entra quando o parser de regras não reconheceu
 * o pedido, ou seja, exactamente onde o bot antes desistia e respondia com
 * conversa genérica.
 *
 * O modelo recebe um punhado de ferramentas escolhidas pelo pré-filtro, decide
 * se precisa de alguma, e nós executamo-la e devolvemos-lhe o resultado. Repete
 * até ele responder em texto ou até esgotar os passos.
 *
 * PORQUE HÁ UM TECTO DE PASSOS
 * Um modelo pode entrar em ciclo, pedindo a mesma ferramenta sem fim. Cada
 * passo é um pedido pago em tempo e tokens, por isso o tecto é baixo e o
 * fracasso é explícito em vez de silencioso.
 */

const llmRouter = require('./llmRouter');
const tools = require('./tools');

const MAX_PASSOS = parseInt(process.env.TOOLS_MAX_STEPS) || 4;
const ACTIVO = process.env.TOOLS_ENABLED !== '0';

const SISTEMA = `És o NEXO, um assistente pessoal que corre no computador do utilizador.

Tens ferramentas. Usa-as quando a resposta depender de algo que só a máquina
ou a internet sabem: ficheiros do utilizador, estado do sistema, factos
recentes, cálculos exactos, o que está no ecrã.

Não uses ferramentas para conhecimento geral que já tens. Responde directamente.

Depois de receberes o resultado de uma ferramenta, responde ao utilizador em
português europeu, de forma directa e curta. Não descrevas os passos que deste
nem menciones nomes de ferramentas.`;

/**
 * O modelo devolve os argumentos como texto JSON. Um modelo pequeno erra isto
 * de vez em quando, e a conversa não pode morrer por causa disso.
 */
function lerArgumentos(bruto) {
  if (!bruto) return {};
  if (typeof bruto === 'object') return bruto;
  try {
    return JSON.parse(bruto);
  } catch (e) {
    return { __erroDeFormato: String(bruto).slice(0, 200) };
  }
}

/**
 * Corre o ciclo para uma mensagem do utilizador.
 *
 * @param {string} mensagem
 * @param {Object} contexto  { userId, historico }
 * @returns {Promise<Object|null>} { texto, ferramentasUsadas, passos } ou
 *   null quando este nível não se aplica e o chamador deve seguir para chat.
 */
async function correr(mensagem, contexto = {}) {
  if (!ACTIVO) return null;

  const seleccionadas = tools.seleccionar(mensagem);
  if (!seleccionadas.length) return null;

  const esquemas = tools.paraFormatoOpenAI(seleccionadas);

  const mensagens = [{ role: 'system', content: SISTEMA }];
  if (Array.isArray(contexto.historico)) {
    for (const m of contexto.historico.slice(-6)) {
      mensagens.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
    }
  }
  mensagens.push({ role: 'user', content: mensagem });

  const usadas = [];

  for (let passo = 1; passo <= MAX_PASSOS; passo++) {
    const resposta = await llmRouter.chat(mensagens, {
      tools: esquemas,
      maxTokens: 1024,
      temperature: 0.3,
      userId: contexto.userId
    });

    // Nenhum fornecedor sabe usar ferramentas: este nível não se aplica.
    if (resposta.noToolProvider) return null;
    if (resposta.success === false) return null;

    const chamadas = resposta.toolCalls;

    // Sem chamadas, o modelo respondeu directamente. Fim.
    if (!chamadas || !chamadas.length) {
      const texto = (resposta.text || '').trim();
      if (!texto) return null;
      return { texto, ferramentasUsadas: usadas, passos: passo, provider: resposta.provider };
    }

    // Guardar o turno do assistente tal como veio, senão o modelo perde o fio.
    mensagens.push(resposta.raw || { role: 'assistant', content: null, tool_calls: chamadas });

    for (const chamada of chamadas) {
      const nome = chamada.function?.name;
      const argumentos = lerArgumentos(chamada.function?.arguments);

      console.log(`  🔧 ${nome}(${JSON.stringify(argumentos).slice(0, 80)})`);

      const resultado = argumentos.__erroDeFormato
        ? `❌ Argumentos inválidos. Envia JSON válido para ${nome}.`
        : await tools.executar(nome, argumentos, contexto);

      usadas.push(nome);

      mensagens.push({
        role: 'tool',
        tool_call_id: chamada.id,
        name: nome,
        content: String(resultado).slice(0, 4000)
      });
    }
  }

  // Esgotou os passos. Devolver o que se conseguiu apurar em vez de silêncio.
  const ultimo = mensagens.filter(m => m.role === 'tool').pop();
  return {
    texto: ultimo
      ? `${ultimo.content}\n\n_(parei ao fim de ${MAX_PASSOS} passos)_`
      : null,
    ferramentasUsadas: usadas,
    passos: MAX_PASSOS,
    esgotou: true
  };
}

module.exports = { correr, MAX_PASSOS, ACTIVO, SISTEMA };
