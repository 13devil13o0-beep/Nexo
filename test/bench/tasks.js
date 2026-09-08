/**
 * 🎯 Banco de Ensaios — 30 tarefas em português
 *
 * Estas tarefas são a linha de base do bot. Correm sempre iguais, para que
 * qualquer alteração ao router, ao parser ou aos agentes possa ser julgada
 * por números e não por impressão.
 *
 * REGRA: nenhuma tarefa tem efeitos secundários. Nada abre aplicações, nada
 * escreve ficheiros, nada mexe no teclado ou no rato. O banco tem de poder
 * correr cem vezes seguidas sem deixar rasto na máquina.
 *
 * Cada tarefa declara:
 *   id       — identificador estável, usado para comparar execuções
 *   grupo    — para agregar resultados
 *   prompt   — o que se envia ao bot
 *   espera   — nível pretendido: 'deterministico' resolve-se sem modelo
 *   verifica — recebe o texto da resposta em minúsculas e sem acentos
 */

/** Compara sem depender de acentos nem de maiúsculas. */
function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * O executor de código acrescenta um rodapé com o contador de execuções, que
 * tem dígitos. Sem o cortar, procurar "4" numa resposta casava com
 * "restantes: 4/5" e dava tarefas por passadas sem o serem.
 */
const semRodape = (t) => t.split('execucoes restantes')[0].split('rate limit')[0];

/** Resultado exacto do executor de código. */
const resultadoCodigo = (valor) => (t) => semRodape(t).includes(`resultado: ${normalizar(valor)}`);

/** Passa se qualquer um dos termos aparecer. */
const contemAlgum = (...termos) => (t) => termos.some(x => t.includes(normalizar(x)));

/** Passa se houver resposta com substância e sem marca de erro. */
const respondeSemErro = () => (t) =>
  t.trim().length > 2 && !t.includes('erro ao processar') && !t.includes('undefined');

const TAREFAS = [
  // ───────────────────────────────────────────────────────────
  // DETERMINÍSTICOS — deviam resolver-se sem chamar modelo nenhum
  // ───────────────────────────────────────────────────────────
  { id: 'det-ajuda',      grupo: 'deterministico', espera: 'deterministico',
    prompt: 'ajuda',                    verifica: contemAlgum('comando', 'ajuda', 'posso') },

  { id: 'det-help-en',    grupo: 'deterministico', espera: 'deterministico',
    prompt: 'help',                     verifica: contemAlgum('comando', 'ajuda', 'posso', 'command') },

  { id: 'det-hora',       grupo: 'deterministico', espera: 'deterministico',
    prompt: 'que horas sao?',           verifica: (t) => /\d{1,2}[:h]\d{2}/.test(t) },

  { id: 'det-data',       grupo: 'deterministico', espera: 'deterministico',
    prompt: 'que dia e hoje?',          verifica: (t) => /\d{1,2}/.test(t) && respondeSemErro()(t) },

  { id: 'det-status',     grupo: 'deterministico', espera: 'deterministico',
    prompt: 'status',                   verifica: contemAlgum('sistema', 'memoria', 'cpu', 'uptime', 'plataforma') },

  { id: 'det-agentes',    grupo: 'deterministico', espera: 'deterministico',
    // "pdf" sozinho dava falso positivo: uma listagem de ficheiros contém
    // nomes com .pdf. Exige dois agentes nomeados.
    prompt: 'lista os agentes',
    verifica: (t) => ['ai agent', 'web search', 'pdf agent', 'code runner', 'file agent', 'system agent']
      .filter(nome => t.includes(nome)).length >= 2 },

  { id: 'det-ficheiros',  grupo: 'deterministico', espera: 'deterministico',
    prompt: 'listar ficheiros',         verifica: respondeSemErro() },

  { id: 'det-idiomas',    grupo: 'deterministico', espera: 'deterministico',
    prompt: 'idiomas disponiveis',      verifica: contemAlgum('portugu', 'english', 'espa', 'fran') },

  { id: 'det-skills',     grupo: 'deterministico', espera: 'deterministico',
    prompt: 'lista skills',             verifica: respondeSemErro() },

  { id: 'det-workflows',  grupo: 'deterministico', espera: 'deterministico',
    prompt: 'lista workflows',          verifica: respondeSemErro() },

  { id: 'det-rag',        grupo: 'deterministico', espera: 'deterministico',
    prompt: 'estatisticas rag',         verifica: respondeSemErro() },

  { id: 'det-tarefas',    grupo: 'deterministico', espera: 'deterministico',
    prompt: 'lista tarefas agendadas',  verifica: respondeSemErro() },

  // ───────────────────────────────────────────────────────────
  // CÓDIGO — sandbox, resultado exacto e verificável
  // ───────────────────────────────────────────────────────────
  { id: 'cod-soma',       grupo: 'codigo', espera: 'deterministico',
    prompt: 'executar: 2 + 2',                            verifica: resultadoCodigo('4') },

  { id: 'cod-map',        grupo: 'codigo', espera: 'deterministico',
    // Este é o exemplo de cabeçalho do README. Esteve avariado: o executor
    // embrulhava o código numa função sem return e devolvia "sem output".
    prompt: 'executar: [1,2,3].map(x => x * 10)',         verifica: resultadoCodigo('[10,20,30]') },

  { id: 'cod-max',        grupo: 'codigo', espera: 'deterministico',
    prompt: 'executar: Math.max(5, 9, 2)',                verifica: resultadoCodigo('9') },

  { id: 'cod-length',     grupo: 'codigo', espera: 'deterministico',
    prompt: "executar: 'NEXO'.length",                    verifica: resultadoCodigo('4') },

  { id: 'cod-reduce',     grupo: 'codigo', espera: 'deterministico',
    prompt: 'executar: [1,2,3].reduce((a,b) => a+b, 0)',  verifica: resultadoCodigo('6') },

  { id: 'cod-bloqueio',   grupo: 'codigo', espera: 'deterministico',
    prompt: "executar: require('fs')",
    verifica: contemAlgum('bloque', 'nao permitid', 'proibid', 'erro', 'seguranca') },

  // ───────────────────────────────────────────────────────────
  // CONVERSA — exigem modelo, mas a resposta é verificável
  // ───────────────────────────────────────────────────────────
  { id: 'ia-capital',     grupo: 'conversa', espera: 'modelo',
    prompt: 'Qual e a capital de Portugal? Responde apenas com o nome.',
    verifica: contemAlgum('lisboa') },

  { id: 'ia-conta',       grupo: 'conversa', espera: 'modelo',
    prompt: 'Quanto e 15 vezes 4? Responde apenas com o numero.',
    verifica: contemAlgum('60') },

  { id: 'ia-traducao',    grupo: 'conversa', espera: 'modelo',
    prompt: 'Traduz para ingles, apenas a traducao: bom dia',
    verifica: contemAlgum('good morning', 'good day') },

  { id: 'ia-planeta',     grupo: 'conversa', espera: 'modelo',
    prompt: 'Em que planeta vivemos? Responde apenas com o nome.',
    verifica: contemAlgum('terra', 'earth') },

  { id: 'ia-semana',      grupo: 'conversa', espera: 'modelo',
    prompt: 'Quantos dias tem uma semana? Responde apenas com o numero.',
    verifica: contemAlgum('7', 'sete') },

  { id: 'ia-oceano',      grupo: 'conversa', espera: 'modelo',
    prompt: 'Que oceano separa Portugal dos Estados Unidos? Responde apenas com o nome.',
    verifica: contemAlgum('atlantico', 'atlantic') },

  { id: 'ia-redigir',     grupo: 'conversa', espera: 'modelo',
    // Regressão real: qualquer frase começada por "escreve" era enviada para
    // o teclado e digitada na janela com foco, em vez de ser respondida.
    // Esta tarefa chegou a escrever no editor de código durante um ensaio.
    prompt: 'Escreve uma frase curta sobre o mar.',
    verifica: (t) => t.trim().length > 12
                  && !t.includes('digitado')
                  && !t.includes('caracteres na janela') },

  { id: 'ia-continente',  grupo: 'conversa', espera: 'modelo',
    prompt: 'Em que continente fica o Egipto? Responde apenas com o nome.',
    verifica: contemAlgum('africa') },

  { id: 'ia-portugues',   grupo: 'conversa', espera: 'modelo',
    prompt: 'Responde em portugues europeu: como se chama o objecto onde se guarda roupa num quarto?',
    verifica: contemAlgum('armario', 'roupeiro', 'guarda-fato', 'guarda fato') },

  // ───────────────────────────────────────────────────────────
  // ROBUSTEZ — entradas difíceis não podem partir o bot
  // ───────────────────────────────────────────────────────────
  { id: 'rob-vazio',      grupo: 'robustez', espera: 'qualquer',
    prompt: '   ',
    verifica: (t) => typeof t === 'string' && !t.includes('undefined') },

  { id: 'rob-simbolos',   grupo: 'robustez', espera: 'qualquer',
    prompt: '?!?! <script>alert(1)</script> ;;;',
    verifica: (t) => typeof t === 'string' && !t.includes('undefined') },

  { id: 'rob-longo',      grupo: 'robustez', espera: 'qualquer',
    prompt: 'Resume numa frase: ' + 'Este e um texto longo de teste para verificar o comportamento com contexto grande. '.repeat(30),
    verifica: respondeSemErro() },

  { id: 'rob-ambiguo',    grupo: 'robustez', espera: 'qualquer',
    prompt: 'isso',
    verifica: (t) => typeof t === 'string' && !t.includes('undefined') }
];

module.exports = { TAREFAS, normalizar };
