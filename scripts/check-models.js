#!/usr/bin/env node
/**
 * Relatório da sentinela de modelos.
 *   npm run check:models
 *
 * Sai com código 1 quando algum fornecedor configurado aponta para um modelo
 * que já não existe, para poder correr em integração contínua.
 */

const providerHealth = require('../orchestrator/providerHealth');
const llmRouter = require('../orchestrator/llmRouter');

(async () => {
  const results = await providerHealth.checkAll();
  console.log(providerHealth.formatReport(results));

  // exitCode em vez de process.exit(): deixa as ligações fecharem em paz.
  process.exitCode = providerHealth.problems(results).length ? 1 : 0;
  await llmRouter.shutdown();
})();
