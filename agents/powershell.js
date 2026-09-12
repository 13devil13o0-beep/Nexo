/**
 * 🪟 Correr PowerShell sem perder o script pelo caminho
 *
 * O projecto tinha o mesmo script de captura de ecrã em dois sítios, e os dois
 * partidos pela mesma razão: o script era colado dentro de `powershell -Command
 * "..."` com as quebras de linha trocadas por espaços.
 *
 * Isso estraga duas coisas ao mesmo tempo:
 *
 *   1. As aspas de dentro são comidas pelo shell. O caminho do ficheiro
 *      chegava sem aspas nenhumas e dava erro de sintaxe. Está em
 *      logs/input-actions.log desde Fevereiro, a falhar em cada tentativa.
 *
 *   2. Sem quebras de linha, o PowerShell lê tudo como um bloco só e os tipos
 *      do Add-Type ainda não existem quando são precisos:
 *      "Unable to find type [System.Drawing.Point]".
 *
 * O -EncodedCommand resolve os dois: o script vai em UTF-16 codificado em
 * base64, com as linhas intactas, e não passa por nenhum shell que lhe mexa
 * nas aspas.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const { execFileSync } = require('child_process');

const execFileAsync = promisify(execFile);

const TEMPO_MAXIMO_MS = 20000;

/** Codifica o script como o PowerShell o quer: UTF-16LE em base64. */
function codificar(script) {
  return Buffer.from(String(script), 'utf16le').toString('base64');
}

function argumentos(script) {
  return ['-NoProfile', '-NonInteractive', '-EncodedCommand', codificar(script)];
}

/** Escapa um valor para entrar numa string entre plicas do PowerShell. */
function comPlicas(valor) {
  return `'${String(valor).replace(/'/g, "''")}'`;
}

async function correr(script, opcoes = {}) {
  const { stdout } = await execFileAsync('powershell', argumentos(script), {
    timeout: opcoes.timeout || TEMPO_MAXIMO_MS,
    windowsHide: true,
    maxBuffer: opcoes.maxBuffer || 1024 * 1024
  });
  return stdout;
}

function correrSync(script, opcoes = {}) {
  return execFileSync('powershell', argumentos(script), {
    timeout: opcoes.timeout || TEMPO_MAXIMO_MS,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: opcoes.maxBuffer || 1024 * 1024
  });
}

module.exports = { correr, correrSync, comPlicas, codificar };
