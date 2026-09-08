/**
 * 🤖 NEXO — Deploy Helper
 * 
 * Utilitários para deployment na AWS:
 * - Gerar URLs de CloudFormation pré-configurados
 * - Validar API keys
 * - Gerar ficheiro .env
 * - Health check remoto
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════
//  CONSTANTES
// ═══════════════════════════════════════════════════════════

const CFN_TEMPLATE_URL = 'https://raw.githubusercontent.com/13devil13o0-beep/Nexo/main/deploy/aws-cloudformation.yaml';

const REGIONS = {
  'eu-west-1': 'EU (Ireland)',
  'eu-west-3': 'EU (Paris)',
  'eu-central-1': 'EU (Frankfurt)',
  'us-east-1': 'US East (Virginia)',
  'us-west-2': 'US West (Oregon)',
  'sa-east-1': 'South America (São Paulo)',
  'ap-southeast-1': 'Asia Pacific (Singapore)'
};

const PROVIDER_VALIDATORS = {
  groq: (key) => key && key.startsWith('gsk_') && key.length > 20,
  gemini: (key) => key && key.startsWith('AIza') && key.length > 20,
  cerebras: (key) => key && key.length > 10,
  serper: (key) => key && key.length > 10,
  telegram: (token) => token && /^\d+:[A-Za-z0-9_-]+$/.test(token),
  discord: (token) => token && token.length > 50,
  huggingface: (key) => key && key.startsWith('hf_') && key.length > 10
};

// ═══════════════════════════════════════════════════════════
//  GERAR URL CLOUDFORMATION
// ═══════════════════════════════════════════════════════════

/**
 * Gera URL para lançar CloudFormation stack com parâmetros pré-preenchidos
 * @param {Object} config - Configuração do deploy
 * @returns {string} URL de quick-create do CloudFormation
 */
function generateCloudFormationUrl(config = {}) {
  const region = config.region || 'eu-west-1';
  const stackName = config.stackName || 'NEXO';

  const params = new URLSearchParams();
  params.set('stackName', stackName);
  params.set('templateURL', CFN_TEMPLATE_URL);

  // Mapear config para parâmetros do CloudFormation
  const paramMap = {
    instanceType: 'InstanceType',
    port: 'BotPort',
    groqKey: 'GroqApiKey',
    geminiKey: 'GeminiApiKey',
    cerebrasKey: 'CerebrasApiKey',
    serperKey: 'SerperApiKey',
    telegramToken: 'TelegramBotToken',
    discordToken: 'DiscordBotToken'
  };

  for (const [cfgKey, cfnParam] of Object.entries(paramMap)) {
    if (config[cfgKey]) {
      params.set(`param_${cfnParam}`, config[cfgKey]);
    }
  }

  return `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/create/review?${params.toString()}`;
}

// ═══════════════════════════════════════════════════════════
//  VALIDAR API KEYS
// ═══════════════════════════════════════════════════════════

/**
 * Valida formato das API keys
 * @param {Object} keys - Objeto com as keys a validar
 * @returns {Object} Resultado por provider { provider: { valid, message } }
 */
function validateKeys(keys = {}) {
  const results = {};

  for (const [provider, validator] of Object.entries(PROVIDER_VALIDATORS)) {
    const key = keys[provider] || '';
    if (!key) {
      results[provider] = { valid: null, message: 'Não configurado' };
    } else if (validator(key)) {
      results[provider] = { valid: true, message: 'Formato válido' };
    } else {
      results[provider] = { valid: false, message: 'Formato inválido' };
    }
  }

  return results;
}

/**
 * Testa uma API key contactando o serviço
 * @param {string} provider - Nome do provider (groq, gemini, cerebras)
 * @param {string} key - API key
 * @returns {Promise<{valid: boolean, message: string, latency: number}>}
 */
async function testApiKey(provider, key) {
  const start = Date.now();

  const tests = {
    groq: () => testHttp('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` }
    }),
    gemini: () => testHttp(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`),
    cerebras: () => testHttp('https://api.cerebras.ai/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` }
    }),
    serper: () => testHttp('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: 'test', num: 1 })
    })
  };

  try {
    if (!tests[provider]) {
      return { valid: null, message: 'Teste não disponível', latency: 0 };
    }

    const result = await tests[provider]();
    const latency = Date.now() - start;

    return {
      valid: result.ok,
      message: result.ok ? 'Chave válida e funcional' : `Resposta ${result.status}: ${result.statusText}`,
      latency
    };
  } catch (err) {
    return {
      valid: false,
      message: `Erro: ${err.message}`,
      latency: Date.now() - start
    };
  }
}

function testHttp(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;

    const req = client.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, statusText: data.substring(0, 200) });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });

    if (options.body) req.write(options.body);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════
//  GERAR .ENV
// ═══════════════════════════════════════════════════════════

/**
 * Gera conteúdo do ficheiro .env
 * @param {Object} config - Configuração
 * @returns {string} Conteúdo do .env
 */
function generateEnvContent(config = {}) {
  const lines = [
    `# 🤖 NEXO — Configuração`,
    `# Gerado em: ${new Date().toISOString()}`,
    ``,
    `# ── Servidor ──`,
    `PORT=${config.port || 7777}`,
    ``,
    `# ── IA Providers ──`,
    `GROQ_API_KEY=${config.groqKey || ''}`,
    `GEMINI_API_KEY=${config.geminiKey || ''}`,
    `CEREBRAS_API_KEY=${config.cerebrasKey || ''}`,
    `HUGGINGFACE_API_KEY=${config.huggingfaceKey || ''}`,
    ``,
    `# ── Pesquisa Web ──`,
    `SERPER_API_KEY=${config.serperKey || ''}`,
    ``,
    `# ── Bots (opcional) ──`,
    `TELEGRAM_BOT_TOKEN=${config.telegramToken || ''}`,
    `DISCORD_BOT_TOKEN=${config.discordToken || ''}`,
    ``,
    `# ── Sistema ──`,
    `SYSTEM_CONTROLLER_ENABLED=true`,
    `INPUT_AGENT_ENABLED=false`,
    `NODE_ENV=production`,
    ``
  ];

  return lines.join('\n');
}

/**
 * Escreve o ficheiro .env no diretório dado
 * @param {string} dir - Diretório de destino
 * @param {Object} config - Configuração
 */
function writeEnvFile(dir, config = {}) {
  const envPath = path.join(dir, '.env');
  const content = generateEnvContent(config);

  // Backup se já existir
  if (fs.existsSync(envPath)) {
    const backupPath = envPath + `.backup.${Date.now()}`;
    fs.copyFileSync(envPath, backupPath);
    console.log(`📋 Backup criado: ${backupPath}`);
  }

  fs.writeFileSync(envPath, content, 'utf8');
  console.log(`✅ .env criado: ${envPath}`);
  return envPath;
}

// ═══════════════════════════════════════════════════════════
//  HEALTH CHECK
// ═══════════════════════════════════════════════════════════

/**
 * Verifica se um servidor NEXO remoto está operacional
 * @param {string} serverUrl - URL base do servidor (ex: http://1.2.3.4:7777)
 * @returns {Promise<Object>} Resultado do health check
 */
async function healthCheck(serverUrl) {
  const baseUrl = serverUrl.replace(/\/$/, '');
  const results = {
    url: baseUrl,
    timestamp: new Date().toISOString(),
    checks: {}
  };

  // 1. Servidor acessível
  try {
    const res = await testHttp(`${baseUrl}/api/status`);
    results.checks.server = {
      ok: res.ok,
      message: res.ok ? 'Online' : `Status ${res.status}`,
      details: res.ok ? JSON.parse(res.statusText || '{}') : null
    };
  } catch (err) {
    results.checks.server = { ok: false, message: err.message };
  }

  // 2. Health endpoint
  try {
    const res = await testHttp(`${baseUrl}/api/health`);
    if (res.ok) {
      const data = JSON.parse(res.statusText || '{}');
      results.checks.health = {
        ok: true,
        message: 'Healthy',
        details: data
      };
    } else {
      results.checks.health = { ok: false, message: `Status ${res.status}` };
    }
  } catch (err) {
    results.checks.health = { ok: false, message: err.message };
  }

  // 3. Chat funcional (quick test)
  try {
    const res = await testHttp(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'olá' })
    });
    results.checks.chat = {
      ok: res.ok,
      message: res.ok ? 'Funcional' : `Status ${res.status}`
    };
  } catch (err) {
    results.checks.chat = { ok: false, message: err.message };
  }

  // Overall status
  results.healthy = Object.values(results.checks).every(c => c.ok);
  results.partial = Object.values(results.checks).some(c => c.ok);

  return results;
}

// ═══════════════════════════════════════════════════════════
//  SCRIPT DE INSTALAÇÃO
// ═══════════════════════════════════════════════════════════

/**
 * Gera script bash de instalação remota
 * @param {Object} config - Configuração
 * @returns {string} Script bash completo
 */
function generateInstallScript(config = {}) {
  const envContent = generateEnvContent(config);

  return `#!/bin/bash
# ═══════════════════════════════════════════════════════════
# 🤖 NEXO — Script de Instalação
# Gerado em: ${new Date().toISOString()}
# ═══════════════════════════════════════════════════════════
set -euo pipefail

echo "═══════════════════════════════════════════"
echo "🤖 NEXO — Instalação Automática"
echo "═══════════════════════════════════════════"

# ── Atualizar sistema ──
echo "📦 A atualizar sistema..."
sudo apt-get update -y
sudo apt-get upgrade -y

# ── Instalar Node.js 20 ──
echo "📦 A instalar Node.js 20..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

node_version=$(node -v)
echo "✅ Node.js $node_version instalado"

# ── Instalar Git ──
sudo apt-get install -y git

# ── Clonar repositório ──
echo "📥 A clonar NEXO..."
INSTALL_DIR="\$HOME/nexo"

if [ -d "\$INSTALL_DIR" ]; then
  echo "📁 Diretório já existe, a atualizar..."
  cd "\$INSTALL_DIR"
  git pull origin main
else
  git clone https://github.com/13devil13o0-beep/Nexo.git "\$INSTALL_DIR"
  cd "\$INSTALL_DIR"
fi

# ── Instalar dependências ──
echo "📦 A instalar dependências..."
npm install --production

# ── Criar .env ──
echo "⚙️ A configurar ambiente..."
cat > .env << 'ENVEOF'
${envContent}
ENVEOF
echo "✅ .env configurado"

# ── Criar pastas necessárias ──
mkdir -p logs memory/rag_index Documentos outputs temp user_data

# ── Instalar PM2 ──
echo "📦 A instalar PM2..."
sudo npm install -g pm2

# ── Iniciar com PM2 ──
echo "🚀 A iniciar NEXO..."
pm2 delete nexo 2>/dev/null || true
pm2 start orchestrator/api-server.js --name nexo
pm2 save
sudo env PATH=\$PATH:/usr/bin pm2 startup systemd -u \$USER --hp \$HOME

# ── Resultado ──
PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || echo "IP_DESCONHECIDO")
PORT=${config.port || 7777}

echo ""
echo "═══════════════════════════════════════════"
echo "✅ NEXO instalado com sucesso!"
echo "═══════════════════════════════════════════"
echo "🌐 URL: http://\$PUBLIC_IP:\$PORT"
echo "📁 Dir: \$INSTALL_DIR"
echo "📋 Logs: pm2 logs nexo"
echo "🔄 Restart: pm2 restart nexo"
echo "⏹️  Stop: pm2 stop nexo"
echo "═══════════════════════════════════════════"
`;
}

// ═══════════════════════════════════════════════════════════
//  EXPORTS
// ═══════════════════════════════════════════════════════════

module.exports = {
  generateCloudFormationUrl,
  validateKeys,
  testApiKey,
  generateEnvContent,
  writeEnvFile,
  healthCheck,
  generateInstallScript,
  CFN_TEMPLATE_URL,
  REGIONS,
  PROVIDER_VALIDATORS
};
