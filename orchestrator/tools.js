/**
 * 🔧 Registo de Ferramentas
 *
 * O parser de regras só resolve o que alguém escreveu à mão. Tudo o resto caía
 * em conversa genérica, mesmo quando havia um agente capaz de o fazer. Este
 * ficheiro descreve os agentes de forma que um modelo os possa escolher.
 *
 * DUAS REGRAS DE DESENHO
 *
 * 1. Cada ferramenta declara a sua classe de risco.
 *    O campo `risco` diz o que a ferramenta é capaz de fazer: 'ler', 'escrever'
 *    ou 'sistema'. A barreira em executar() consulta orchestrator/permissions.js
 *    antes de correr seja o que for, e as da classe 'sistema' ficam negadas até
 *    o utilizador as aprovar explicitamente.
 *
 *    Teclado, rato e execução de comandos ainda não estão neste catálogo. Com
 *    a barreira montada, podem passar a estar: entram como classe 'sistema' e
 *    nascem negados.
 *
 * 2. Nunca enviar o catálogo inteiro.
 *    Mandar as vinte descrições em cada pedido engorda o prompt e destrói a
 *    eficiência que fomos medir. O pré-filtro escolhe as plausíveis a partir
 *    das palavras da mensagem. Ver seleccionar().
 */

const webSearchAgent = require('../agents/webSearchAgent');
const pdfAgent = require('../agents/pdfAgent');
const fileAgent = require('../agents/fileAgent');
const codeRunner = require('../agents/codeRunner');
const systemAgent = require('../agents/systemAgent');
const clipboardAgent = require('../agents/clipboardAgent');
const visionAgent = require('../agents/visionAgent');
const smartMemory = require('../memory/smartMemory');
const ragEngine = require('./ragEngine');
const navegacaoPedidos = require('../nexo/navegacao/pedidos');
const permissions = require('./permissions');
const security = require('./security');

const MAX_FERRAMENTAS = parseInt(process.env.TOOLS_MAX_PER_REQUEST) || 6;

/** Normaliza para comparar sem acentos nem maiúsculas. */
function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Reduz qualquer retorno de agente a texto apresentável. */
function comoTexto(valor) {
  if (valor == null) return '(sem resultado)';
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'object') {
    if (valor.error) return `❌ ${valor.error}`;
    if (valor.output) return valor.output;
    if (valor.message) return valor.message;
    if (valor.text) return valor.text;
    return JSON.stringify(valor);
  }
  return String(valor);
}

// ═══════════════════════════════════════════════════════════
// CATÁLOGO
// ═══════════════════════════════════════════════════════════

const FERRAMENTAS = [
  {
    nome: 'pesquisar_web',
    risco: 'ler',
    palavras: ['pesquisa', 'procura', 'noticia', 'noticias', 'preco', 'cotacao', 'bitcoin',
               'quanto custa', 'ultimas', 'atual', 'atualmente', 'hoje', 'tempo', 'meteorologia'],
    descricao: 'Pesquisa informação actual na internet. Usa isto sempre que a resposta depender de factos recentes, preços, notícias ou eventos posteriores ao teu conhecimento.',
    parametros: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Termos de pesquisa, em linguagem natural.' }
      },
      required: ['consulta'],
      additionalProperties: false
    },
    executar: async ({ consulta }) => comoTexto(await webSearchAgent.searchAndFormat(consulta))
  },

  {
    nome: 'executar_codigo',
    risco: 'escrever',
    palavras: ['calcula', 'calcular', 'quanto e', 'executa', 'javascript', 'codigo', 'script',
               'resultado de', 'converte', 'soma', 'multiplica'],
    descricao: 'Executa JavaScript numa caixa de areia isolada e devolve o resultado. Serve para cálculos, transformações de dados e verificar lógica. Não tem acesso a ficheiros, rede nem processos.',
    parametros: {
      type: 'object',
      properties: {
        codigo: { type: 'string', description: 'Expressão ou bloco de JavaScript. Uma expressão devolve o seu valor.' }
      },
      required: ['codigo'],
      additionalProperties: false
    },
    executar: async ({ codigo }, ctx) => comoTexto(codeRunner.runCode(codigo, ctx.userId))
  },

  {
    nome: 'criar_pdf',
    risco: 'escrever',
    palavras: ['pdf', 'documento', 'relatorio', 'gera um documento', 'cria um documento'],
    descricao: 'Gera um documento PDF profissional sobre um tema, escrito por IA, e grava-o na pasta de saída do projecto.',
    parametros: {
      type: 'object',
      properties: {
        tema: { type: 'string', description: 'Assunto do documento a produzir.' }
      },
      required: ['tema'],
      additionalProperties: false
    },
    executar: async ({ tema }) => comoTexto(await pdfAgent.createPDF(tema))
  },

  {
    nome: 'criar_nota',
    risco: 'escrever',
    palavras: ['nota', 'apontamento', 'apontar', 'regista isto', 'guarda isto num ficheiro'],
    descricao: 'Grava uma nota de texto num ficheiro, na pasta de documentos do projecto.',
    parametros: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Título curto da nota.' },
        conteudo: { type: 'string', description: 'Corpo da nota.' }
      },
      required: ['titulo', 'conteudo'],
      additionalProperties: false
    },
    executar: async ({ titulo, conteudo }) => comoTexto(fileAgent.createNote(titulo, conteudo))
  },

  {
    nome: 'listar_ficheiros',
    risco: 'ler',
    palavras: ['ficheiros', 'documentos', 'que ficheiros', 'lista de ficheiros', 'pasta'],
    descricao: 'Lista os ficheiros das pastas que o utilizador autorizou.',
    parametros: {
      type: 'object',
      properties: {
        pasta: { type: 'string', description: 'Pasta a listar. Deixa vazio para a pasta de documentos.' }
      },
      required: [],
      additionalProperties: false
    },
    executar: async ({ pasta }) => comoTexto(fileAgent.listFiles(pasta || null))
  },

  {
    nome: 'ler_ficheiro',
    risco: 'ler',
    palavras: ['le o ficheiro', 'ler ficheiro', 'abre o ficheiro', 'conteudo do ficheiro', 'o que diz'],
    descricao: 'Lê o conteúdo de um ficheiro de texto, dentro das pastas autorizadas.',
    parametros: {
      type: 'object',
      properties: {
        caminho: { type: 'string', description: 'Caminho ou nome do ficheiro.' }
      },
      required: ['caminho'],
      additionalProperties: false
    },
    executar: async ({ caminho }) => comoTexto(fileAgent.readFile(caminho))
  },

  {
    nome: 'listar_pasta',
    risco: 'ler',
    palavras: ['diretorio', 'directorio', 'lista a pasta', 'conteudo da pasta'],
    descricao: 'Lista o conteúdo de uma directoria do sistema, dentro dos caminhos permitidos.',
    parametros: {
      type: 'object',
      properties: {
        caminho: { type: 'string', description: 'Caminho da directoria.' }
      },
      required: ['caminho'],
      additionalProperties: false
    },
    executar: async ({ caminho }) => comoTexto(systemAgent.listDirectory(caminho))
  },

  {
    nome: 'info_sistema',
    risco: 'ler',
    palavras: ['sistema', 'memoria ram', 'cpu', 'disco', 'computador', 'maquina', 'desempenho'],
    descricao: 'Devolve o estado da máquina: sistema operativo, processador, memória e tempo ligado.',
    parametros: { type: 'object', properties: {}, required: [], additionalProperties: false },
    executar: async () => comoTexto(systemAgent.getSystemInfo())
  },

  {
    nome: 'ver_area_transferencia',
    risco: 'ler',
    palavras: ['clipboard', 'area de transferencia', 'copiei', 'copiado'],
    descricao: 'Mostra o que está neste momento na área de transferência.',
    parametros: { type: 'object', properties: {}, required: [], additionalProperties: false },
    executar: async () => comoTexto(clipboardAgent.getCurrentClipboard())
  },

  {
    nome: 'analisar_ecra',
    risco: 'sistema',
    palavras: ['ecra', 'ecran', 'screenshot', 'captura', 'o que esta no ecra', 'que erro', 've isto'],
    descricao: 'Captura o ecrã e descreve o que lá está, incluindo erros e avisos visíveis.',
    parametros: {
      type: 'object',
      properties: {
        pergunta: { type: 'string', description: 'O que procurar na imagem. Deixa vazio para uma descrição geral.' }
      },
      required: [],
      additionalProperties: false
    },
    executar: async ({ pergunta }) => comoTexto(
      await visionAgent.captureAndAnalyze(pergunta || undefined)
    )
  },

  {
    nome: 'recordar',
    risco: 'ler',
    palavras: ['lembras', 'o que sabes sobre mim', 'as minhas preferencias', 'o que guardei', 'recorda'],
    descricao: 'Procura no que o utilizador pediu para ser memorizado no passado: preferências, factos pessoais, decisões.',
    parametros: {
      type: 'object',
      properties: {
        procura: { type: 'string', description: 'Assunto a recordar.' }
      },
      required: ['procura'],
      additionalProperties: false
    },
    executar: async ({ procura }, ctx) => comoTexto(smartMemory.recall(procura, ctx.userId))
  },

  {
    nome: 'pesquisar_documentos',
    risco: 'ler',
    palavras: ['nos meus documentos', 'no indice', 'documentacao', 'segundo o documento', 'rag'],
    descricao: 'Procura nos documentos que o utilizador indexou nesta máquina. Usa quando a pergunta for sobre material próprio dele e não sobre conhecimento geral.',
    parametros: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'O que procurar nos documentos indexados.' }
      },
      required: ['consulta'],
      additionalProperties: false
    },
    executar: async ({ consulta }) => comoTexto(await ragEngine.getContext(consulta, { topK: 4 }))
  },

  {
    nome: 'planear_rota',
    risco: 'ler',
    palavras: ['rota', 'trajecto', 'trajeto', 'percurso', 'voar', 'voo', 'drone',
               'navegar', 'coordenadas', 'planeia um caminho'],
    descricao: 'Planeia uma rota entre duas coordenadas, contornando zonas a evitar, e estima distância, tempo e bateria. Só calcula: não move nada.',
    parametros: {
      type: 'object',
      properties: {
        origem: { type: 'string', description: 'Ponto de partida em "latitude,longitude". Ex: "40.15,-8.65".' },
        destino: { type: 'string', description: 'Ponto de chegada em "latitude,longitude".' },
        evitar: { type: 'string', description: 'Zonas a evitar, separadas por ";", no formato "nome:lat,lng,raio_em_metros". Opcional.' },
        velocidadeMs: { type: 'number', description: 'Velocidade de cruzeiro em metros por segundo. Por omissão 12.' }
      },
      required: ['origem', 'destino'],
      additionalProperties: false
    },
    executar: async (args) => navegacaoPedidos.planearEmTexto(args)
  },

  {
    nome: 'simular_missao',
    risco: 'ler',
    palavras: ['simula', 'simular', 'missao', 'missão', 'e se o destino', 'plano b',
               'inspecionar', 'ensaio de voo'],
    descricao: 'Corre uma missão completa NUM APARELHO SIMULADO: planeia, segue a rota, reage a zonas proibidas e, se o destino ficar inacessível, escolhe um plano B que cumpra o mesmo propósito. Devolve o registo de decisões. Nunca comanda hardware real.',
    parametros: {
      type: 'object',
      properties: {
        origem: { type: 'string', description: 'Ponto de partida em "latitude,longitude".' },
        destino: { type: 'string', description: 'Destino pretendido em "latitude,longitude".' },
        proposito: { type: 'string', description: 'O que a missão quer alcançar, ex: "inspecionar". É o que valida um plano B.' },
        alternativas: { type: 'string', description: 'Planos B separados por ";", no formato "nome:lat,lng". Opcional.' },
        evitar: { type: 'string', description: 'Zonas proibidas separadas por ";", no formato "nome:lat,lng,raio". Opcional.' }
      },
      required: ['origem', 'destino'],
      additionalProperties: false
    },
    executar: async (args) => navegacaoPedidos.simularEmTexto(args)
  },

  {
    nome: 'data_e_hora',
    risco: 'ler',
    palavras: ['que horas', 'que dia', 'data de hoje', 'hoje e', 'agora'],
    descricao: 'Devolve a data e a hora actuais da máquina do utilizador.',
    parametros: { type: 'object', properties: {}, required: [], additionalProperties: false },
    executar: async () => new Date().toLocaleString('pt-PT', { dateStyle: 'full', timeStyle: 'short' })
  }
];

/** Conjunto usado quando nenhuma palavra da mensagem aponta para nada. */
const PADRAO = ['pesquisar_web', 'executar_codigo', 'data_e_hora', 'recordar', 'listar_ficheiros'];

// ═══════════════════════════════════════════════════════════
// PRÉ-FILTRO
// ═══════════════════════════════════════════════════════════

/**
 * Escolhe as ferramentas plausíveis para esta mensagem.
 *
 * É esta função que separa um agente eficiente de um caro. Cada descrição
 * enviada ocupa espaço no prompt em todos os pedidos, incluindo os triviais.
 *
 * @returns {Array} subconjunto do catálogo, no máximo MAX_FERRAMENTAS
 */
function seleccionar(mensagem, limite = MAX_FERRAMENTAS) {
  const texto = normalizar(mensagem);

  const pontuadas = FERRAMENTAS
    .map(f => ({
      ferramenta: f,
      pontos: f.palavras.reduce((n, p) => n + (texto.includes(normalizar(p)) ? 1 : 0), 0)
    }))
    .filter(x => x.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos);

  if (pontuadas.length) {
    return pontuadas.slice(0, limite).map(x => x.ferramenta);
  }

  return FERRAMENTAS.filter(f => PADRAO.includes(f.nome)).slice(0, limite);
}

// ═══════════════════════════════════════════════════════════
// FORMATOS
// ═══════════════════════════════════════════════════════════

/** Converte para o formato de ferramentas da OpenAI (Groq, Cerebras, ...). */
function paraFormatoOpenAI(ferramentas) {
  return ferramentas.map(f => ({
    type: 'function',
    function: {
      name: f.nome,
      description: f.descricao,
      parameters: f.parametros
    }
  }));
}

function porNome(nome) {
  return FERRAMENTAS.find(f => f.nome === nome) || null;
}

/**
 * Executa uma ferramenta pedida pelo modelo.
 *
 * Passa primeiro pela barreira de permissões: uma ferramenta da classe
 * 'sistema' que o utilizador não tenha aprovado não corre, e o modelo recebe
 * a explicação em texto em vez de a ferramenta ser executada às escondidas.
 *
 * Nunca lança: um erro tem de voltar ao modelo como texto, para ele poder
 * corrigir-se, em vez de rebentar a conversa toda.
 */
async function executar(nome, argumentos, contexto = {}) {
  const ferramenta = porNome(nome);
  if (!ferramenta) return `❌ Ferramenta desconhecida: ${nome}`;

  const veredicto = permissions.verificar(contexto.userId, nome, ferramenta.risco);
  if (!veredicto.permitido) {
    security.logAction(contexto.userId, 'permission-denied', { ferramenta: nome, risco: veredicto.risco });
    return `🔒 ${veredicto.motivo}`;
  }

  try {
    const resultado = await ferramenta.executar(argumentos || {}, contexto);
    return comoTexto(resultado);
  } catch (err) {
    return `❌ A ferramenta ${nome} falhou: ${err.message}`;
  }
}

module.exports = {
  FERRAMENTAS,
  seleccionar,
  paraFormatoOpenAI,
  executar,
  porNome,
  normalizar,
  MAX_FERRAMENTAS
};
