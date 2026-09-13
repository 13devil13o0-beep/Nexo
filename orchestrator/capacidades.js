/**
 * 🧭 Capacidades escolhidas num botão
 *
 * Os seis botões da janela do NEXO mandavam frases feitas: "Cria um PDF sobre
 * inteligência artificial", "cria uma app de lista de tarefas". Carregar em
 * "Criar PDF" criava mesmo um PDF sobre inteligência artificial, sem ninguém o
 * ter pedido. Agora o botão só apresenta a função e pergunta. O que se faz é
 * decidido pela resposta do utilizador.
 *
 * PORQUE É QUE A ESCOLHA VIAJA ATÉ AQUI
 *
 * Seria mais simples a janela pôr um prefixo no texto ("Cria um PDF sobre: …")
 * e deixar o parser de regras tratar do resto. Medido, não serve: o parser
 * percorre as intenções por ordem e a primeira que casar ganha. "Cria um
 * projeto: uma agenda diária" caiu em schedule_task por causa da palavra
 * "diária", e "Cria um projeto: jogo do galo" caiu em conversa por causa dos
 * dois pontos. Quem carregou no botão já disse o que queria, e isso não pode
 * ficar à mercê de uma palavra que calha no meio do texto.
 */

const CAPACIDADES = {
  // Conversa normal: a escolha não muda nada no caminho.
  chat: { via: 'conversa' },

  // Estas têm um agente próprio no orchestrator e vão direitas a ele.
  pdf: { via: 'regra', intent: 'create_pdf', entidade: 'topic' },
  projeto: { via: 'regra', intent: 'project_create', entidade: 'description' },

  // Estas são ferramentas: o modelo decide os argumentos, mas a ferramenta
  // certa vai garantidamente na mão dele, à frente das outras.
  pesquisa: { via: 'ferramentas', preferidas: ['pesquisar_web'] },
  codigo: { via: 'ferramentas', preferidas: ['executar_codigo'] },
  ficheiros: {
    via: 'ferramentas',
    preferidas: ['listar_ficheiros', 'ler_ficheiro', 'procurar_em_ficheiros', 'criar_nota']
  }
};

/**
 * Traduz a capacidade escolhida para o que o servidor precisa de saber.
 *
 * @param {string} nome   a capacidade que veio da janela
 * @param {string} texto  o que o utilizador escreveu a seguir
 * @returns {Object|null} null quando não há escolha, ou ela não existe:
 *   nesse caso segue-se o caminho de sempre.
 */
function resolver(nome, texto) {
  const c = CAPACIDADES[nome];
  if (!c) return null;

  if (c.via === 'regra') {
    return {
      nome,
      via: 'regra',
      intencao: { intent: c.intent, entities: { [c.entidade]: String(texto || '').trim() } }
    };
  }

  if (c.via === 'ferramentas') {
    return { nome, via: 'ferramentas', preferidas: [...c.preferidas] };
  }

  return { nome, via: 'conversa' };
}

module.exports = { CAPACIDADES, resolver };
