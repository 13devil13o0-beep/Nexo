#!/usr/bin/env node
/**
 * 🎯 Executor do Banco de Ensaios
 *
 *   npm run bench                 corre as 30 tarefas e compara com a linha de base
 *   npm run bench -- --baseline   grava o resultado como nova linha de base
 *   npm run bench -- --grupo codigo   corre só um grupo
 *
 * Existe para uma coisa: poder afirmar que uma alteração melhorou o bot em
 * vez de achar que melhorou. Guarda cada execução em memory/bench/ e mostra
 * a diferença face à linha de base, tarefa a tarefa.
 *
 * Sai com código 1 se a taxa de sucesso descer abaixo do mínimo, para poder
 * correr em integração contínua.
 */

require('dotenv').config();

// O executor de código limita as execuções por minuto, e o banco tem seis
// tarefas de código seguidas. Sem isto o banco media o seu próprio limite em
// vez de medir o bot. Tem de vir antes dos require, que lêem o valor uma vez.
process.env.MAX_EXEC_PER_MIN = process.env.BENCH_MAX_EXEC || '60';

const fs = require('fs');
const path = require('path');

const { TAREFAS, normalizar } = require('./tasks');
const router = require('../../orchestrator/router');
const llmRouter = require('../../orchestrator/llmRouter');
const metrics = require('../../orchestrator/metrics');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const BENCH_DIR = path.join(PROJECT_ROOT, 'memory', 'bench');
const BASELINE = path.join(BENCH_DIR, 'baseline.json');

const TIMEOUT_MS = parseInt(process.env.BENCH_TIMEOUT) || 180000;
const MIN_SUCCESS = parseFloat(process.env.BENCH_MIN_SUCCESS) || 0.8;

/**
 * Pausa entre tarefas que chamam um modelo.
 *
 * A camada gratuita do Groq limita os tokens por minuto. Sem pausa, o banco
 * esgotava esse limite a meio e as últimas tarefas caíam para o modelo local,
 * registando setenta segundos onde o normal é um. Uma linha de base com esse
 * ruído não serve para comparar nada.
 *
 * Só se aplica depois de tarefas que gastaram modelo: as determinísticas
 * correm à velocidade máxima.
 */
const PAUSA_MS = parseInt(process.env.BENCH_PAUSE_MS ?? '6000');
const pausar = ms => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════
// ARGUMENTOS
// ═══════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const gravarBaseline = args.includes('--baseline');
const grupoFiltro = args.includes('--grupo') ? args[args.indexOf('--grupo') + 1] : null;

// ═══════════════════════════════════════════════════════════
// EXECUÇÃO
// ═══════════════════════════════════════════════════════════

/** Uma tarefa não pode pendurar o banco todo. */
function comLimiteDeTempo(promessa, ms, id) {
  let temporizador;
  const limite = new Promise((_, rejeitar) => {
    temporizador = setTimeout(() => rejeitar(new Error(`tempo esgotado (${ms} ms)`)), ms);
  });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(temporizador));
}

/** handlePrompt devolve string nuns caminhos e objecto noutros. */
function extrairTexto(resultado) {
  if (typeof resultado === 'string') return resultado;
  if (resultado && typeof resultado === 'object') {
    return resultado.text || resultado.response || '';
  }
  return '';
}

async function correrTarefa(tarefa) {
  const inicio = Date.now();

  try {
    const resultado = await comLimiteDeTempo(
      router.handlePrompt(tarefa.prompt, { source: 'bench', userId: 'bench:local', confirmed: true }),
      TIMEOUT_MS,
      tarefa.id
    );

    const texto = extrairTexto(resultado);
    const passou = !!tarefa.verifica(normalizar(texto));

    return {
      id: tarefa.id,
      grupo: tarefa.grupo,
      passou,
      ms: Date.now() - inicio,
      resposta: texto.replace(/\s+/g, ' ').slice(0, 100),
      erro: null
    };
  } catch (err) {
    return {
      id: tarefa.id,
      grupo: tarefa.grupo,
      passou: false,
      ms: Date.now() - inicio,
      resposta: '',
      erro: err.message
    };
  }
}

// ═══════════════════════════════════════════════════════════
// APRESENTAÇÃO
// ═══════════════════════════════════════════════════════════

const ms = n => `${String(n).padStart(6)} ms`;

function compararComBaseline(resultados, baseline) {
  if (!baseline) return new Map();

  const antes = new Map(baseline.resultados.map(r => [r.id, r]));
  const diffs = new Map();

  for (const r of resultados) {
    const a = antes.get(r.id);
    if (!a) { diffs.set(r.id, { estado: 'novo' }); continue; }

    const estado = a.passou === r.passou
      ? (r.passou ? 'igual' : 'igual')
      : (r.passou ? 'corrigido' : 'REGRESSAO');

    diffs.set(r.id, { estado, deltaMs: r.ms - a.ms });
  }
  return diffs;
}

function marcaDiff(diff) {
  if (!diff) return '';
  if (diff.estado === 'REGRESSAO') return '  ⛔ REGRESSÃO';
  if (diff.estado === 'corrigido') return '  🎉 corrigido';
  if (diff.estado === 'novo') return '  ✨ nova';
  if (Math.abs(diff.deltaMs) < 300) return '';
  const sinal = diff.deltaMs > 0 ? '+' : '';
  return `  ${diff.deltaMs > 0 ? '🐢' : '⚡'} ${sinal}${(diff.deltaMs / 1000).toFixed(1)}s`;
}

// ═══════════════════════════════════════════════════════════
// PRINCIPAL
// ═══════════════════════════════════════════════════════════

(async () => {
  const tarefas = grupoFiltro ? TAREFAS.filter(t => t.grupo === grupoFiltro) : TAREFAS;

  if (!tarefas.length) {
    console.error(`Nenhuma tarefa no grupo "${grupoFiltro}".`);
    process.exitCode = 1;
    return;
  }

  const baseline = fs.existsSync(BASELINE)
    ? JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
    : null;

  console.log('');
  console.log(`🎯 Banco de ensaios — ${tarefas.length} tarefas`);
  console.log(baseline
    ? `   linha de base de ${baseline.quando.slice(0, 16).replace('T', ' ')}`
    : '   sem linha de base ainda (corre com --baseline para criar uma)');
  console.log('');

  // Marca o ponto do registo de métricas, para só agregar esta execução.
  const metricasAntes = metrics.readAll().length;
  const comecou = new Date().toISOString();

  const resultados = [];
  let grupoActual = null;

  for (const tarefa of tarefas) {
    if (tarefa.grupo !== grupoActual) {
      grupoActual = tarefa.grupo;
      console.log(`── ${grupoActual} ${'─'.repeat(Math.max(0, 44 - grupoActual.length))}`);
    }

    const chamadasAntes = metrics.readAll().length;
    const r = await correrTarefa(tarefa);
    resultados.push(r);
    const usouModelo = metrics.readAll().length > chamadasAntes;

    const icone = r.passou ? '✅' : '❌';
    const diff = compararComBaseline([r], baseline).get(r.id);
    console.log(`  ${icone} ${r.id.padEnd(16)} ${ms(r.ms)}${marcaDiff(diff)}`);
    if (!r.passou) {
      console.log(`       ${r.erro ? 'erro: ' + r.erro : 'resposta: ' + JSON.stringify(r.resposta)}`);
    }

    if (usouModelo && PAUSA_MS > 0) await pausar(PAUSA_MS);
  }

  // ── Resumo ────────────────────────────────────────────────
  const passaram = resultados.filter(r => r.passou).length;
  const taxa = passaram / resultados.length;
  const tempos = resultados.map(r => r.ms).sort((a, b) => a - b);
  const p50 = tempos[Math.floor(tempos.length * 0.5)];
  const p95 = tempos[Math.min(tempos.length - 1, Math.ceil(tempos.length * 0.95) - 1)];

  const diffs = compararComBaseline(resultados, baseline);
  const regressoes = [...diffs.values()].filter(d => d.estado === 'REGRESSAO').length;
  const corrigidos = [...diffs.values()].filter(d => d.estado === 'corrigido').length;

  console.log('');
  console.log('── Resultado ────────────────────────────────────────');
  console.log(`  Tarefas passadas     ${passaram}/${resultados.length}  (${(taxa * 100).toFixed(1)}%)`);
  console.log(`  Latência p50 / p95   ${p50} ms / ${p95} ms`);
  if (baseline) {
    console.log(`  Face à linha de base ${corrigidos} corrigidas, ${regressoes} regressões`);
  }

  // ── Custo desta execução ──────────────────────────────────
  const novas = metrics.readAll().slice(metricasAntes);
  if (novas.length) {
    const resumo = metrics.summary(novas);
    console.log('');
    console.log('── Custo desta execução ─────────────────────────────');
    console.log(`  Chamadas a modelos   ${resumo.total}`);
    console.log(`  Tokens por chamada   ${resumo.tokensPerRequest.toFixed(0)}`);
    console.log(`  Custo por 100        ${resumo.costPer100 == null ? '—' : '$' + resumo.costPer100.toFixed(4)}`);
    const niveis = Object.entries(resumo.byTier).map(([k, v]) => `${k} ${v}`).join(' · ');
    console.log(`  Níveis               ${niveis}`);
  } else {
    console.log('');
    console.log('  (nenhuma chamada a modelo: tudo resolvido sem IA)');
  }

  // ── Gravação ──────────────────────────────────────────────
  const execucao = {
    quando: comecou,
    tarefas: resultados.length,
    passaram,
    taxa,
    p50,
    p95,
    resultados: resultados.map(({ id, grupo, passou, ms }) => ({ id, grupo, passou, ms }))
  };

  fs.mkdirSync(BENCH_DIR, { recursive: true });
  const ficheiro = path.join(BENCH_DIR, `${comecou.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(ficheiro, JSON.stringify(execucao, null, 2));

  if (gravarBaseline) {
    fs.writeFileSync(BASELINE, JSON.stringify(execucao, null, 2));
    console.log('');
    console.log('  📌 Gravado como nova linha de base.');
  }

  console.log('');

  await llmRouter.shutdown();

  if (regressoes > 0) {
    console.log(`⛔ ${regressoes} regressão(ões) face à linha de base.`);
    process.exitCode = 1;
  } else if (taxa < MIN_SUCCESS) {
    console.log(`⛔ Taxa de sucesso abaixo do mínimo (${(MIN_SUCCESS * 100).toFixed(0)}%).`);
    process.exitCode = 1;
  }
})();
