/**
 * 🔗 NEXO - Webhook Server
 * Servidor de webhooks para integração com serviços externos
 * - Stripe (pagamentos)
 * - GitHub (CI/CD, issues)
 * - Telegram updates
 * - Discord events
 */

require('dotenv').config();
const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.WEBHOOK_PORT || 3002;

// Raw body para verificação de assinaturas
app.use('/webhook/stripe', express.raw({ type: 'application/json' }));
app.use(express.json());

// ═══════════════════════════════════════════════════════════
// MIDDLEWARE - Logging
// ═══════════════════════════════════════════════════════════

app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// ═══════════════════════════════════════════════════════════
// STRIPE WEBHOOK
// ═══════════════════════════════════════════════════════════

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

app.post('/webhook/stripe', (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  if (STRIPE_WEBHOOK_SECRET && sig) {
    // Verificar assinatura
    try {
      const payload = req.body.toString();
      const timestamp = sig.split(',')[0].split('=')[1];
      const signatures = sig.split(',')[1].split('=')[1];
      
      const signedPayload = `${timestamp}.${payload}`;
      const expectedSig = crypto
        .createHmac('sha256', STRIPE_WEBHOOK_SECRET)
        .update(signedPayload)
        .digest('hex');
      
      if (signatures !== expectedSig) {
        console.log('⚠️  Stripe: Assinatura inválida');
        return res.status(400).send('Invalid signature');
      }
    } catch (e) {
      console.log('⚠️  Stripe: Erro ao verificar assinatura');
    }
  }
  
  const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  
  console.log(`💳 Stripe Event: ${event.type}`);
  
  switch (event.type) {
    case 'checkout.session.completed':
      handleCheckoutComplete(event.data.object);
      break;
    
    case 'payment_intent.succeeded':
      handlePaymentSuccess(event.data.object);
      break;
    
    case 'payment_intent.payment_failed':
      handlePaymentFailed(event.data.object);
      break;
    
    case 'customer.subscription.created':
      handleSubscriptionCreated(event.data.object);
      break;
    
    case 'customer.subscription.deleted':
      handleSubscriptionCancelled(event.data.object);
      break;
    
    default:
      console.log(`  Evento não tratado: ${event.type}`);
  }
  
  res.json({ received: true });
});

function handleCheckoutComplete(session) {
  const amount = (session.amount_total / 100).toFixed(2);
  const email = session.customer_email || 'anónimo';
  const name = session.customer_details?.name || email;
  
  console.log('✅ Doação recebida:', {
    id: session.id,
    donor: name,
    email: email,
    amount: `€${amount}`
  });
  
  // Registar doação em ficheiro local
  const fs = require('fs');
  const path = require('path');
  const donationsFile = path.join(__dirname, '..', 'user_data', 'donations.json');
  
  try {
    let donations = [];
    if (fs.existsSync(donationsFile)) {
      donations = JSON.parse(fs.readFileSync(donationsFile, 'utf8'));
    }
    
    donations.push({
      id: session.id,
      amount: parseFloat(amount),
      currency: session.currency || 'eur',
      donor: name,
      email: email,
      date: new Date().toISOString()
    });
    
    fs.writeFileSync(donationsFile, JSON.stringify(donations, null, 2));
    console.log(`  💾 Doação registada (total: ${donations.length} doações)`);
  } catch (e) {
    console.log('  ⚠️ Erro ao guardar doação:', e.message);
  }
  
  console.log(`  🙏 Obrigado ${name} pela doação de €${amount}!`);
}

function handlePaymentSuccess(payment) {
  const amount = payment.amount ? (payment.amount / 100).toFixed(2) : '?';
  console.log(`✅ Pagamento bem-sucedido: ${payment.id} — €${amount}`);
}

function handlePaymentFailed(payment) {
  console.log('❌ Pagamento falhou:', payment.id, payment.last_payment_error?.message || '');
}

function handleSubscriptionCreated(subscription) {
  console.log('🔔 Nova subscrição:', subscription.id);
}

function handleSubscriptionCancelled(subscription) {
  console.log('⏹️  Subscrição cancelada:', subscription.id);
}

// ═══════════════════════════════════════════════════════════
// GITHUB WEBHOOK
// ═══════════════════════════════════════════════════════════

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';

app.post('/webhook/github', (req, res) => {
  const sig = req.headers['x-hub-signature-256'];
  
  if (GITHUB_WEBHOOK_SECRET && sig) {
    const hmac = crypto.createHmac('sha256', GITHUB_WEBHOOK_SECRET);
    const digest = 'sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex');
    
    if (sig !== digest) {
      console.log('⚠️  GitHub: Assinatura inválida');
      return res.status(401).send('Invalid signature');
    }
  }
  
  const event = req.headers['x-github-event'];
  const payload = req.body;
  
  console.log(`🐙 GitHub Event: ${event}`);
  
  switch (event) {
    case 'push':
      handleGitPush(payload);
      break;
    
    case 'pull_request':
      handlePullRequest(payload);
      break;
    
    case 'issues':
      handleIssue(payload);
      break;
    
    case 'workflow_run':
      handleWorkflowRun(payload);
      break;
    
    case 'ping':
      console.log('  Ping recebido de:', payload.repository?.full_name);
      break;
    
    default:
      console.log(`  Evento não tratado: ${event}`);
  }
  
  res.json({ received: true });
});

function handleGitPush(payload) {
  const branch = payload.ref?.replace('refs/heads/', '');
  const commits = payload.commits?.length || 0;
  const pusher = payload.pusher?.name;
  
  console.log(`📤 Push: ${commits} commit(s) para ${branch} por ${pusher}`);
  
  // Auto-deploy se for main/master
  if (branch === 'main' || branch === 'master') {
    console.log('🚀 Trigger auto-deploy...');
    // triggerDeploy();
  }
}

function handlePullRequest(payload) {
  const action = payload.action;
  const pr = payload.pull_request;
  
  console.log(`🔀 PR #${pr.number} ${action}: ${pr.title}`);
  
  if (action === 'opened') {
    // Notificar equipa
    console.log(`  Por: ${pr.user.login}`);
  }
}

function handleIssue(payload) {
  const action = payload.action;
  const issue = payload.issue;
  
  console.log(`📋 Issue #${issue.number} ${action}: ${issue.title}`);
}

function handleWorkflowRun(payload) {
  const workflow = payload.workflow_run;
  console.log(`⚙️  Workflow: ${workflow.name} - ${workflow.conclusion || workflow.status}`);
}

// ═══════════════════════════════════════════════════════════
// TELEGRAM WEBHOOK (alternativa a polling)
// ═══════════════════════════════════════════════════════════

app.post('/webhook/telegram', async (req, res) => {
  const update = req.body;
  
  console.log('📱 Telegram Update:', update.update_id);
  
  // Processar via orquestrador
  try {
    const { orchestrate } = require('../orchestrator/orchestrator');
    
    if (update.message?.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text;
      const user = update.message.from;
      
      console.log(`  [${user.first_name}] ${text}`);
      
      const response = await orchestrate(text, {
        userId: chatId.toString(),
        platform: 'telegram',
        userName: user.first_name
      });
      
      // Enviar resposta via API
      await sendTelegramMessage(chatId, response);
    }
  } catch (e) {
    console.error('Erro Telegram:', e.message);
  }
  
  res.json({ ok: true });
});

async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
      })
    });
  } catch (e) {
    console.error('Erro ao enviar mensagem Telegram:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// DISCORD WEBHOOK (interações)
// ═══════════════════════════════════════════════════════════

app.post('/webhook/discord', (req, res) => {
  const interaction = req.body;
  
  // Verificação de ping do Discord
  if (interaction.type === 1) {
    return res.json({ type: 1 });
  }
  
  console.log('🎮 Discord Interaction:', interaction.type);
  
  // TODO: Processar interações
  
  res.json({ type: 4, data: { content: 'Processando...' } });
});

// ═══════════════════════════════════════════════════════════
// WEBHOOK GENÉRICO (desenvolvimento)
// ═══════════════════════════════════════════════════════════

app.post('/webhook/dev', (req, res) => {
  console.log('🔧 Dev Webhook recebido:');
  console.log('  Headers:', req.headers);
  console.log('  Body:', JSON.stringify(req.body, null, 2));
  
  res.json({
    received: true,
    timestamp: new Date().toISOString(),
    body: req.body
  });
});

// ═══════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'NEXO Webhook Server',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>NEXO Webhooks</title></head>
      <body style="font-family: sans-serif; padding: 40px; background: #1a1a2e; color: #fff;">
        <h1>🔗 NEXO Webhook Server</h1>
        <p>Servidor de webhooks activo na porta ${PORT}</p>
        <h3>Endpoints disponíveis:</h3>
        <ul>
          <li><code>POST /webhook/stripe</code> - Pagamentos Stripe</li>
          <li><code>POST /webhook/github</code> - Eventos GitHub</li>
          <li><code>POST /webhook/telegram</code> - Updates Telegram</li>
          <li><code>POST /webhook/discord</code> - Interações Discord</li>
          <li><code>POST /webhook/dev</code> - Debug/Desenvolvimento</li>
          <li><code>GET /health</code> - Health check</li>
        </ul>
        <p style="color: #00d9ff;">Status: ✅ Online</p>
      </body>
    </html>
  `);
});

// ═══════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🔗 NEXO Webhook Server                                 ║
║                                                           ║
║   Porta: ${PORT}                                            ║
║   URL Local: http://localhost:${PORT}                       ║
║                                                           ║
║   Endpoints:                                              ║
║   • /webhook/stripe   - Pagamentos                        ║
║   • /webhook/github   - CI/CD                             ║
║   • /webhook/telegram - Bot updates                       ║
║   • /webhook/discord  - Bot interactions                  ║
║   • /webhook/dev      - Debug                             ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
