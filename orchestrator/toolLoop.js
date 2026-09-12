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

/**
 * Quanto espaço tem uma resposta.
 *
 * Estava em 2048 e chegava para conversa, não para trabalho. Uma resposta com
 * tabelas e vários pontos batia no tecto e era cortada a meio de uma frase,
 * sem aviso nenhum: no ecrã parecia uma resposta acabada que não fazia
 * sentido no fim.
 *
 * 4096 é o dobro e continua dentro do que o plano grátis do Groq aguenta
 * (8000 tokens por minuto). Quem tiver plano pago pode subir isto.
 */
const MAX_TOKENS_RESPOSTA = parseInt(process.env.RESPOSTA_MAX_TOKENS) || 4096;

const SISTEMA = `És o NEXO, um assistente pessoal que corre no computador do utilizador.

Tens ferramentas e corres na máquina dele. Não peças ao utilizador que te cole
ficheiros nem que te descreva o que tens à mão: vai lá buscar. Usa-as sempre
que a resposta depender de algo que só a máquina ou a internet sabem, como
ficheiros e pastas do utilizador, o estado do sistema, factos recentes,
cálculos exactos ou o que está no ecrã.

Não uses ferramentas para conhecimento geral que já tens. Responde directamente.

Se uma ferramenta falhar ou não te der o que precisas, diz o que tentaste e o
que faltou. Não inventes o resultado nem finjas que não podias tentar.

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

// ═══════════════════════════════════════════════════════════
// O MESMO CICLO, MAS A ESCREVER À MEDIDA QUE PENSA
// ═══════════════════════════════════════════════════════════

/**
 * Era aqui que o NEXO deixava de ser assistente.
 *
 * No workspace, uma mensagem normal ia directa ao modelo, sem ferramentas
 * nenhumas, porque o ciclo acima só era chamado pelo caminho sem streaming.
 * Dava um chat que prometia ler ficheiros e depois pedia ao utilizador que
 * lhos colasse. Tinha as mãos atadas e não sabia.
 *
 * Agora as ferramentas seguem também no streaming. O modelo escreve enquanto
 * pensa, e se precisar de ir buscar alguma coisa pára, nós vamos buscá-la,
 * dizemos ao utilizador o que estamos a fazer, e ele continua a escrever.
 *
 * @param {string} mensagem
 * @param {Object} contexto  { userId, historico }
 * @param {Object} saidas    { onToken, onProgresso }
 * @returns {Promise<Object|null>} null quando este nível não se aplica e o
 *   chamador deve seguir para conversa simples.
 */
async function correrComStream(mensagem, contexto = {}, saidas = {}) {
  if (!ACTIVO) return null;

  const onToken = saidas.onToken || (() => {});
  const onProgresso = saidas.onProgresso || (() => {});

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
  let escrito = '';
  let fornecedor = null;

  for (let passo = 1; passo <= MAX_PASSOS; passo++) {
    const volta = await umaVolta(mensagens, esquemas, onToken, contexto);

    // Nenhum fornecedor sabe usar ferramentas: este nível não se aplica.
    // Só se pode desistir se ainda não foi nada para o ecrã.
    if (volta.noToolProvider) return escrito ? { texto: escrito, ferramentasUsadas: usadas, passos: passo } : null;
    if (volta.erro) {
      // O trabalho já feito não se deita fora.
      //
      // Os fornecedores que sabem usar ferramentas são poucos, e ficam sem
      // quota ou batem no limite por minuto a meio do ciclo. Quando isso
      // acontece depois de as ferramentas já terem ido buscar o que era
      // preciso, deitar tudo fora e dizer "todos os providers falharam" é
      // desperdiçar uma resposta que estava quase pronta. Passa-se o apurado
      // a quem não sabe usar ferramentas mas sabe escrever.
      const salvo = await responderComOApurado(mensagens, mensagem, onToken, contexto);
      if (salvo) {
        return { texto: escrito + salvo, ferramentasUsadas: usadas, passos: passo, provider: 'reserva' };
      }

      // Nem a reserva respondeu. Se as ferramentas já trouxeram algo, mostra-se
      // em cru: dados verdadeiros sem prosa valem mais do que um erro seco.
      const cru = emCru(mensagens);
      if (cru) {
        onToken(cru);
        return { texto: escrito + cru, ferramentasUsadas: usadas, passos: passo, semRedaccao: true };
      }

      if (!escrito) return null;
      const aviso = `\n\n_(${volta.erro})_`;
      onToken(aviso);
      return { texto: escrito + aviso, ferramentasUsadas: usadas, passos: passo, falhou: true };
    }

    escrito += volta.texto || '';
    if (volta.provider) fornecedor = volta.provider;

    const chamadas = volta.toolCalls;

    // Sem chamadas, o modelo respondeu e o texto já foi para o ecrã. Fim.
    if (!chamadas || !chamadas.length) {
      if (!escrito.trim()) return null;
      return {
        texto: escrito,
        ferramentasUsadas: usadas,
        passos: passo,
        provider: fornecedor,
        cortado: volta.cortado === true
      };
    }

    // Guardar o turno do assistente tal como veio, senão o modelo perde o fio.
    mensagens.push(volta.raw || { role: 'assistant', content: volta.texto || null, tool_calls: chamadas });

    for (const chamada of chamadas) {
      const nome = chamada.function?.name;
      const argumentos = lerArgumentos(chamada.function?.arguments);

      console.log(`  🔧 ${nome}(${JSON.stringify(argumentos).slice(0, 80)})`);
      // Quem está à espera tem direito a saber que alguém está a trabalhar.
      onProgresso({ ferramenta: nome, texto: tools.emCurso(nome) });

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

  // Esgotou os passos. Devolver o que se apurou em vez de silêncio.
  const ultimo = mensagens.filter(m => m.role === 'tool').pop();
  const cauda = ultimo
    ? `${escrito ? '\n\n' : ''}${ultimo.content}\n\n_(parei ao fim de ${MAX_PASSOS} passos)_`
    : '';
  if (cauda) onToken(cauda);

  return {
    texto: (escrito + cauda) || null,
    ferramentasUsadas: usadas,
    passos: MAX_PASSOS,
    provider: fornecedor,
    esgotou: true
  };
}

/**
 * Última tentativa quando os fornecedores com ferramentas se esgotam.
 *
 * Reescreve a conversa numa forma que qualquer modelo entende: a pergunta e,
 * a seguir, o que as ferramentas trouxeram, em texto. Sem chamadas de
 * ferramenta no meio, que só os fornecedores certos sabem ler.
 *
 * @returns {Promise<string|null>} o texto escrito, ou null se não houve nada
 *   apurado ou também esta falhou.
 */
function apuradoDasFerramentas(mensagens) {
  return mensagens
    .filter(m => m.role === 'tool')
    .map(m => `— ${m.name}:\n${m.content}`)
    .join('\n\n');
}

/**
 * O que as ferramentas trouxeram, sem ninguém o ter redigido.
 *
 * É a última coisa antes de desistir. O plano grátis do Groq tem limite por
 * minuto e o Cerebras pode estar sem quota: quando nenhum modelo consegue
 * escrever a resposta, os dados que já foram buscados continuam a ser
 * verdadeiros e continuam a servir a pessoa.
 */
function emCru(mensagens) {
  const apurado = apuradoDasFerramentas(mensagens);
  if (!apurado) return null;
  return `Não consegui redigir a resposta, mas fui buscar isto:\n\n${apurado}\n\n` +
    '_(os motores de IA estão sem resposta neste momento; tenta outra vez dentro de um minuto)_';
}

async function responderComOApurado(mensagens, pergunta, onToken, contexto) {
  const apurado = apuradoDasFerramentas(mensagens);

  if (!apurado) return null;

  const pedido = [
    { role: 'system', content: `${SISTEMA}\n\nJá foste buscar o que precisavas. Responde com base no que se segue, em português europeu, sem falar de ferramentas nem de como obtiveste a informação.` },
    { role: 'user', content: `Pergunta: ${pergunta}\n\nInformação recolhida na máquina do utilizador:\n\n${apurado}` }
  ];

  let salvo = '';
  try {
    await llmRouter.chatStream(
      pedido,
      (token) => { salvo += token; onToken(token); },
      () => {},
      { maxTokens: 1024, temperature: 0.3, userId: contexto.userId }
    );
  } catch (e) {
    console.warn(`  ⚠️ Nem a reserva respondeu: ${e.message}`);
    return null;
  }

  if (!salvo.trim()) return null;
  console.log('  🛟 Resposta feita com o que as ferramentas já tinham trazido.');
  return salvo;
}

/**
 * Uma passagem pelo modelo, em streaming, com as ferramentas na mão.
 *
 * O chatStream fala por chamadas de retorno; aqui espera-se pelo fim e
 * devolve-se tudo junto, para o ciclo acima se ler de cima a baixo.
 */
async function umaVolta(mensagens, esquemas, onToken, contexto) {
  let recolhido = { texto: '', toolCalls: null, raw: undefined, provider: null, cortado: false };

  try {
    await llmRouter.chatStream(
      mensagens,
      (token) => onToken(token),
      (textoTotal, meta = {}) => {
        recolhido = {
          texto: textoTotal || '',
          toolCalls: meta.toolCalls || null,
          raw: meta.raw,
          provider: meta.provider || null,
          cortado: meta.cortado === true,
          noToolProvider: meta.noToolProvider === true
        };
      },
      {
        tools: esquemas,
        maxTokens: MAX_TOKENS_RESPOSTA,
        temperature: 0.3,
        userId: contexto.userId
      }
    );
  } catch (err) {
    return { erro: err.message };
  }

  return recolhido;
}

module.exports = { correr, correrComStream, emCru, MAX_PASSOS, ACTIVO, SISTEMA };
