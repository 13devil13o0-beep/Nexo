#!/usr/bin/env node
/**
 * Estado da instalação do NEXO.
 *   npm run diagnostico
 *
 * Não muda nada: diz o que está bem, o que falta e como se resolve. Serve para
 * quando alguma coisa deixou de funcionar e não é óbvio porquê — e é o que se
 * pede a quem reportar um problema.
 */

require('dotenv').config();

const diagnostico = require('../orchestrator/diagnostico');
const dispositivo = require('../orchestrator/dispositivo');
const definicoes = require('../orchestrator/definicoes');

(async () => {
  const decisao = dispositivo.resolver({ definicoes: definicoes.ler() });
  const estado = await diagnostico.diagnosticarCompleto({ perfil: decisao.perfil });

  console.log(diagnostico.formatarDiagnostico(estado));

  console.log(`   Perfil de arranque: ${decisao.perfil} — ${decisao.motivo}`);
  console.log('');

  // Um código de saída diferente de zero deixa isto usável em scripts.
  process.exit(estado.pronto ? 0 : 1);
})();
