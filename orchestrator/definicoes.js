/**
 * ⚙️ Definições do Utilizador
 *
 * O que o utilizador escolheu e o NEXO tem de respeitar entre arranques.
 * Vive ao lado do memory/permissions.json, com o mesmo padrão: ficheiro JSON
 * simples, leitura preguiçosa, escrita que nunca rebenta o programa.
 *
 * Só entra aqui o que sobrevive a reiniciar o NEXO. Estado de sessão não.
 *
 *   modo               'auto' | 'completo' | 'leve' | 'consola' | 'servico'
 *   arrancarEscondido  no perfil completo, começa só na bandeja
 *   perfilPagina       'auto' | 'completo' | 'leve'  (peso da interface web)
 *   quereAtalho        o utilizador QUER um ícone na área de trabalho
 *   interfacePreferida 'janela' | 'browser' — onde a interface aparece
 *                      quando há ecrã. Não é o mesmo que `modo`: o modo diz
 *                      o que a MÁQUINA aguenta, isto diz o que a PESSOA
 *                      prefere. Nunca abrem os dois ao mesmo tempo.
 *
 * Nota sobre o quereAtalho: guarda uma vontade, não um facto. Chamava-se
 * atalhoCriado e queria dizer "já criei", o que passou a ser mentira no
 * momento em que alguém apagou o ícone — e o instalador, a confiar nisso,
 * deixou de o oferecer a quem tinha ficado sem ele. Se o ficheiro existe ou
 * não pergunta-se ao disco (orchestrator/atalho.js), nunca aqui.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FICHEIRO = path.join(PROJECT_ROOT, 'memory', 'definicoes.json');

const PADRAO = Object.freeze({
  modo: 'auto',
  arrancarEscondido: false,
  perfilPagina: 'auto',
  quereAtalho: false,
  interfacePreferida: 'janela'
});

let cache = null;

/** Lê do disco à primeira vez; depois serve de memória. */
function ler() {
  if (cache) return cache;

  try {
    const guardado = JSON.parse(fs.readFileSync(FICHEIRO, 'utf8'));

    // Quem já tinha o nome antigo não perde a escolha que fez.
    if (guardado.atalhoCriado !== undefined && guardado.quereAtalho === undefined) {
      guardado.quereAtalho = guardado.atalhoCriado;
    }
    delete guardado.atalhoCriado;

    cache = { ...PADRAO, ...guardado };
  } catch (e) {
    // Sem ficheiro, ficheiro corrompido ou sem permissões: os valores por
    // omissão servem, e o NEXO arranca à mesma.
    cache = { ...PADRAO };
  }

  return cache;
}

function gravar() {
  try {
    fs.mkdirSync(path.dirname(FICHEIRO), { recursive: true });
    fs.writeFileSync(FICHEIRO, JSON.stringify(cache, null, 2));
    return true;
  } catch (e) {
    console.warn('⚠️ Não consegui gravar as definições:', e.message);
    return false;
  }
}

function obter(chave) {
  const d = ler();
  return chave ? d[chave] : { ...d };
}

/** Grava uma definição. Devolve o conjunto completo já actualizado. */
function definir(chave, valor) {
  const d = ler();
  d[chave] = valor;
  gravar();
  return { ...d };
}

/** Volta tudo ao estado de origem. Usado pelos testes e pelo "repor". */
function repor() {
  cache = { ...PADRAO };
  gravar();
  return { ...cache };
}

module.exports = {
  PADRAO,
  FICHEIRO,
  ler,
  obter,
  definir,
  repor
};
