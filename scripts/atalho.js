#!/usr/bin/env node
/**
 * Cria (ou recria) o ícone de arranque do NEXO na área de trabalho.
 *   npm run atalho
 *
 * Útil se o apagaste sem querer, ou se moveste a pasta do projecto — nesse
 * caso o atalho antigo aponta para um sítio que já não existe.
 */

const atalho = require('../orchestrator/atalho');
const definicoes = require('../orchestrator/definicoes');

if (!atalho.sistemaSuportado()) {
  console.log(`\n  Sistema não suportado para atalho automático: ${process.platform}\n`);
  process.exit(1);
}

const resultado = atalho.criar();

console.log('');
if (resultado.ok) {
  console.log('  ✅ Atalho criado.');
  if (resultado.caminho) console.log(`     ${resultado.caminho}`);
  if (resultado.caminhos) resultado.caminhos.forEach(c => console.log(`     ${c}`));
  if (resultado.iconeIncluido === false) {
    console.log('     (sem assets/icon.icns — o ícone aparece genérico por agora)');
  }
  definicoes.definir('atalhoCriado', true);
} else {
  console.log(`  ❌ Não consegui criar o atalho: ${resultado.motivo || 'razão desconhecida'}`);
  process.exitCode = 1;
}
console.log('');
