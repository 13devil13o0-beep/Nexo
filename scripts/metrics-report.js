#!/usr/bin/env node
/**
 * Relatório de custo, latência e distribuição pelos níveis da cascata.
 *   npm run metrics
 */

const metrics = require('../orchestrator/metrics');

const pct = n => `${(n * 100).toFixed(1)}%`;
const ms = n => (n == null ? '—' : `${n} ms`);

function bar(fraction, width = 24) {
  const filled = Math.round(fraction * width);
  return '█'.repeat(filled) + '·'.repeat(width - filled);
}

const TIER_LABEL = {
  local: 'local  (Ollama, 0€)',
  free: 'grátis (Groq, Gemini…)',
  paid: 'pago   (Claude, GPT…)'
};

const entries = metrics.readAll();
const s = metrics.summary(entries);

console.log('');
console.log('📊 Métricas do NEXO');
console.log('');

if (!s.total) {
  console.log('Ainda não há pedidos registados.');
  console.log(`Usa o bot e volta aqui. O registo vive em ${metrics.METRICS_FILE}`);
  console.log('');
  process.exit(0);
}

console.log(`Período: ${s.from.slice(0, 16).replace('T', ' ')} → ${s.to.slice(0, 16).replace('T', ' ')}`);
console.log(`Pedidos: ${s.total}`);
console.log('');

console.log('── As quatro métricas ───────────────────────────────');
console.log(`  Tempo até à 1.ª resposta (p95)   ${ms(s.firstTokenP95)}`);
console.log(`  Latência total (p50 / p95)       ${ms(s.latencyP50)} / ${ms(s.latencyP95)}`);
console.log(`  Tokens por pedido (média)        ${s.tokensPerRequest.toFixed(0)}`);
console.log(`  Custo por 100 pedidos            ${s.costPer100 == null ? '—' : '$' + s.costPer100.toFixed(4)}`);
console.log(`  Taxa de sucesso                  ${pct(s.successRate)}`);
console.log('');

console.log('── Distribuição pela cascata ────────────────────────');
for (const tier of ['local', 'free', 'paid']) {
  const n = s.byTier[tier] || 0;
  const frac = n / s.total;
  console.log(`  ${(TIER_LABEL[tier]).padEnd(24)} ${bar(frac)} ${String(n).padStart(5)}  ${pct(frac)}`);
}
const outros = s.total - ['local', 'free', 'paid'].reduce((a, t) => a + (s.byTier[t] || 0), 0);
if (outros > 0) console.log(`  ${'sem nível'.padEnd(24)} ${bar(outros / s.total)} ${String(outros).padStart(5)}`);
console.log('');

console.log('── Por fornecedor ───────────────────────────────────');
const rows = Object.entries(s.byProvider).sort((a, b) => b[1].n - a[1].n);
for (const [name, v] of rows) {
  console.log(`  ${name.padEnd(22)} ${String(v.n).padStart(5)} pedidos  ${String(v.tokens).padStart(8)} tokens  $${v.costUsd.toFixed(4)}`);
}
console.log('');

if (s.uncountedRequests || s.unpricedRequests) {
  console.log('── Lacunas ──────────────────────────────────────────');
  if (s.uncountedRequests) {
    console.log(`  ${s.uncountedRequests} pedidos sem contagem de tokens (o fornecedor não a devolveu).`);
  }
  if (s.unpricedRequests) {
    console.log(`  ${s.unpricedRequests} pedidos sem preço conhecido.`);
    console.log('  Acrescenta o modelo à tabela PRICING em orchestrator/metrics.js.');
  }
  console.log('');
}
