/**
 * ✋ Acções à espera de confirmação
 *
 * Tudo o que muda o PC do utilizador passa por aqui: fechar um programa,
 * limpar temporários, mexer no arranque do Windows.
 *
 * PORQUE NÃO BASTA DIZER AO MODELO "PERGUNTA ANTES"
 *
 * Um modelo pode ser instruído a perguntar e, uma vez em cada tantas, não
 * perguntar. Para acções que mudam o computador de alguém isso não serve. A
 * ferramenta que o modelo chama só PREPARA: descreve o que se faria e deixa
 * aqui guardado. Quem a executa é o servidor, e só quando a mensagem seguinte
 * do utilizador é uma confirmação. O modelo não tem forma nenhuma de a correr.
 *
 * UMA DE CADA VEZ
 *
 * Foi o combinado: uma confirmação por acção, e não uma aprovação para um
 * plano inteiro. Enquanto houver uma à espera, não se prepara outra. Assim um
 * "sim" nunca aprova mais do que aquilo que o utilizador acabou de ler.
 */

/** Uma acção preparada e esquecida não pode ser confirmada horas depois. */
const VALIDADE_MS = 10 * 60 * 1000;

const pendentes = new Map(); // userId → { titulo, descricao, executar, criada }

function obter(userId, agora = Date.now()) {
  const accao = pendentes.get(userId);
  if (!accao) return null;
  if (agora - accao.criada > VALIDADE_MS) {
    pendentes.delete(userId);
    return null;
  }
  return accao;
}

function tem(userId) {
  return !!obter(userId);
}

/**
 * Guarda uma acção à espera de confirmação.
 *
 * @returns {Object} { ok, texto } — o texto é para o modelo, e diz-lhe o que
 *   fazer a seguir: explicar e perguntar, sem dar a acção por feita.
 */
function propor(userId, { titulo, descricao, executar }) {
  const existente = obter(userId);
  if (existente) {
    return {
      ok: false,
      texto: `JÁ HÁ UMA ACÇÃO À ESPERA DE RESPOSTA: "${existente.titulo}". ` +
        'Não preparei outra. Pergunta primeiro ao utilizador se confirma essa. ' +
        'Uma de cada vez, para cada "sim" aprovar só o que ele acabou de ler.'
    };
  }

  pendentes.set(userId, { titulo, descricao, executar, criada: Date.now() });
  return {
    ok: true,
    texto: `ACÇÃO PREPARADA, AINDA NÃO FEITA: ${descricao}\n\n` +
      'Explica isto ao utilizador em linguagem simples e pergunta se confirma. ' +
      'Ele responde "sim" para avançar ou "não" para cancelar. ' +
      'Não digas que já foi feito, e não prepares outra acção antes de ele responder.'
  };
}

/** Corre a acção à espera. Só é chamado quando o utilizador confirmou. */
async function confirmar(userId) {
  const accao = obter(userId);
  if (!accao) return null;
  pendentes.delete(userId);

  try {
    const r = await accao.executar();
    const texto = r?.message || (r?.success ? '✅ Feito.' : '❌ Não consegui fazer isso.');
    return `${texto}\n\n_Se quiseres, continuo com a próxima sugestão da revisão._`;
  } catch (e) {
    return `❌ ${accao.titulo} falhou: ${e.message}. Não ficou nada a meio: podes pedir outra vez.`;
  }
}

function cancelar(userId) {
  const accao = obter(userId);
  if (!accao) return null;
  pendentes.delete(userId);
  return `Não fiz nada: "${accao.titulo}" ficou cancelado.`;
}

/** Só para os testes. */
function limparTudo() {
  pendentes.clear();
}

module.exports = { propor, confirmar, cancelar, tem, obter, limparTudo, VALIDADE_MS };
