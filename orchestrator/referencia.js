/**
 * 📄 Referência "Como Abrir"
 *
 * Escreve COMO_ABRIR.md na raiz do projecto. A diferença entre isto e o que
 * o instalador imprime na consola: isto fica no disco. Três meses depois de
 * instalar, ninguém se lembra do que passou no ecrã — mas o ficheiro continua
 * ao lado do README.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const FICHEIRO = path.join(RAIZ, 'COMO_ABRIR.md');
const PORTA = process.env.PORT || 7777;

/** O primeiro endereço IPv4 que não seja loopback nem interno. */
function enderecoLocal(interfaces = os.networkInterfaces()) {
  for (const nome of Object.keys(interfaces)) {
    for (const info of interfaces[nome] || []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return null;
}

function gerar() {
  const ip = enderecoLocal();
  const linhaRede = ip
    ? `    http://${ip}:${PORTA}`
    : `    http://<o-ip-deste-computador>:${PORTA}   (corre "npm run dispositivo" para confirmar)`;

  return `# Como abrir o NEXO

O NEXO adapta-se ao aparelho onde corre, mas podes sempre escolher tu.

| Queres...                        | Comando |
|-----------------------------------|---------|
| A janela própria (se houver ecrã) | \`npm start\` |
| Só o browser, mais leve           | \`npm start -- --modo=leve\` |
| O terminal                        | \`npm start -- --modo=consola\` |
| Sem janela nenhuma (servidor)     | \`npm start -- --modo=servico\` |

A escolha fica guardada e aplica-se aos arranques seguintes.

## De outro dispositivo na mesma rede

Telemóvel, outro computador, tablet — abre o browser em:

${linhaRede}

## Diagnóstico e manutenção

    npm run diagnostico    # o que está bem, o que falta, como se resolve
    npm run atalho          # recriar o ícone na área de trabalho
    npm run dispositivo     # que perfil este aparelho escolheria

---
_Gerado por \`npm run instalar\` em ${new Date().toLocaleDateString('pt-PT')}._
`;
}

/** Nunca lança: um erro aqui não pode travar a instalação. */
function escrever() {
  try {
    fs.writeFileSync(FICHEIRO, gerar(), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { FICHEIRO, enderecoLocal, gerar, escrever };
