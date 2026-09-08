#!/usr/bin/env node
/**
 * Relatório dos fornecedores de IA conhecidos pelo NEXO.
 *   npm run providers
 *
 * Mostra os dois catálogos históricos na mesma forma, com capacidades, custo
 * e privacidade lado a lado. Serve para responder de relance a perguntas como
 * "quem sabe usar ferramentas?" ou "o que corre sem sair da máquina?".
 */

const providers = require('../nexo/providers');
const llmRouter = require('../orchestrator/llmRouter');

(async () => {
  const lista = providers.listar();
  console.log(providers.formatarRelatorio(lista));

  const comFerramentas = lista.filter(p => p.configurado && p.capacidades.ferramentas);
  const locais = lista.filter(p => p.configurado && p.privacidade === 'local');
  const semPreco = lista.filter(p => !p.custo.conhecido);

  console.log(`   Configurados            ${lista.filter(p => p.configurado).length}/${lista.length}`);
  console.log(`   Sabem usar ferramentas  ${comFerramentas.map(p => p.id).join(', ') || 'nenhum'}`);
  console.log(`   Correm sem sair daqui   ${locais.map(p => p.id).join(', ') || 'nenhum'}`);
  console.log(`   Sem preço conhecido     ${semPreco.length} (custo aparece como "?")`);
  console.log('');

  await llmRouter.shutdown();
})();
