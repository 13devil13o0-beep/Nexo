#!/usr/bin/env node
/**
 * Cria, repõe ou remove o ícone de arranque do NEXO na área de trabalho.
 *
 *   npm run atalho                cria (ou repõe, se tiver desaparecido)
 *   npm run atalho -- --remover   apaga e deixa de o querer
 *
 * O `--remover` não apaga só o ficheiro: guarda também que já não o queres.
 * Sem isso, o `npm start` voltaria a repô-lo, por estar a honrar uma vontade
 * que já não é a tua.
 */

const atalho = require('../orchestrator/atalho');
const definicoes = require('../orchestrator/definicoes');

const remover = process.argv.includes('--remover');

if (!atalho.sistemaSuportado()) {
  console.log(`\n  Sistema não suportado para atalho automático: ${process.platform}\n`);
  process.exit(1);
}

console.log('');

if (remover) {
  const apagados = atalho.remover();
  definicoes.definir('quereAtalho', false);

  if (apagados.length) {
    console.log('  🗑️  Atalho removido.');
    apagados.forEach(c => console.log(`     ${c}`));
  } else {
    console.log('  Não havia nenhum atalho para remover.');
  }
  console.log('');
  console.log('  Também ficou registado que já não o queres, por isso o');
  console.log('  "npm start" não o vai repor. Para o ter de volta: npm run atalho');
  console.log('');
  process.exit(0);
}

const jaExistia = atalho.existe();
const resultado = atalho.criar();

if (resultado.ok) {
  console.log(jaExistia ? '  ✅ Atalho actualizado.' : '  ✅ Atalho criado.');
  if (resultado.caminho) console.log(`     ${resultado.caminho}`);
  if (resultado.caminhos) resultado.caminhos.forEach(c => console.log(`     ${c}`));
  if (resultado.iconeIncluido === false) {
    console.log('     (sem assets/icon.icns — o ícone aparece genérico por agora)');
  }
  definicoes.definir('quereAtalho', true);
} else {
  console.log(`  ❌ Não consegui criar o atalho: ${resultado.motivo || 'razão desconhecida'}`);
  process.exitCode = 1;
}

console.log('');
