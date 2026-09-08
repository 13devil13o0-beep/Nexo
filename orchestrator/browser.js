/**
 * 🌐 Abrir o Browser do Sistema
 *
 * Um único sítio para esta lógica. Nasceu duplicada entre arranque.js (perfis
 * leve/consola) e o api-server.js (npm run core), e duas cópias do mesmo
 * comando por plataforma é exactamente o tipo de coisa que diverge sem
 * ninguém notar.
 */

const { spawn } = require('child_process');

/**
 * Abre uma URL no browser por omissão do sistema. Nunca lança: sem browser à
 * mão, o endereço fica impresso na consola e a vida segue.
 */
function abrirBrowser(url, plataforma = process.platform) {
  const comandos = {
    win32: ['cmd', ['/c', 'start', '', url]],
    darwin: ['open', [url]],
    linux: ['xdg-open', [url]]
  };

  const [comando, argumentos] = comandos[plataforma] || comandos.linux;

  try {
    const p = spawn(comando, argumentos, { detached: true, stdio: 'ignore' });
    p.on('error', () => { /* sem browser à mão: o endereço fica impresso na consola */ });
    p.unref();
  } catch (e) {
    /* idem */
  }
}

module.exports = { abrirBrowser };
