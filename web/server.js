/**
 * 🌐 NEXO Web — Redirecionamento
 * 
 * ⚠️  O servidor web foi UNIFICADO com o API server.
 * Tudo funciona numa única porta (PORT, default: 7777).
 * 
 * Este ficheiro existe apenas por compatibilidade.
 * Para iniciar o bot, usa:  npm start  ou  npm run core
 */

const PORT = process.env.PORT || 7777;

console.log('');
console.log('==========================================================');
console.log('  O servidor web foi UNIFICADO com o servidor API');
console.log('----------------------------------------------------------');
console.log('  Usa em vez disto:');
console.log('    npm start       (desktop + servidor)');
console.log('    npm run core    (so servidor)');
console.log('');
console.log(`  Tudo em: http://localhost:${PORT}`);
console.log('==========================================================');
console.log('');
console.log('A iniciar servidor unificado...');
console.log('');

// Iniciar o servidor unificado
require('../orchestrator/api-server');
