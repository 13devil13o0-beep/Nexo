/**
 * 👁️ Vision Agent — Captura de Ecrã & Análise por IA
 * 
 * Funcionalidades:
 *   - Captura de ecrã (screenshot) via PowerShell/nativa
 *   - Análise de imagem com Gemini Vision (ou outro LLM com vision)
 *   - OCR de texto visível no ecrã
 *   - Descrição do estado atual do ecrã
 *   - Análise de erros visíveis
 * 
 * Exemplos:
 *   "o que está no meu ecrã?"
 *   "lê o erro que aparece"
 *   "screenshot" / "captura de ecrã"
 *   "analisa esta imagem"
 */

const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const https = require('https');
const powershell = require('./powershell');

// ═══════════════════════════════════════════════════════════
//  CONSTANTES
// ═══════════════════════════════════════════════════════════

/**
 * Alias em vez de um numero fixo, de proposito.
 *
 * Estava aqui "gemini-2.0-flash" e o Google descontinuou-o: a chave era
 * valida, a imagem era valida, e o pedido morria a dizer que o modelo ja nao
 * existe. Um alias -latest nao caduca. O modelo pode mudar por baixo, mas um
 * modelo diferente e muito melhor do que um modelo que nao existe.
 */
const MODELO_GEMINI = process.env.GEMINI_VISION_MODEL || 'gemini-flash-latest';

const TEMP_DIR = path.join(__dirname, '..', 'temp');
const SCREENSHOTS_DIR = path.join(TEMP_DIR, 'screenshots');

// ═══════════════════════════════════════════════════════════
//  CAPTURA DE ECRÃ
// ═══════════════════════════════════════════════════════════

/**
 * Captura screenshot do ecrã completo
 * @returns {{ success: boolean, path?: string, error?: string }}
 */
function captureScreen() {
  ensureDir(SCREENSHOTS_DIR);

  const filename = `screenshot_${Date.now()}.png`;
  const filepath = path.join(SCREENSHOTS_DIR, filename);

  try {
    if (process.platform === 'win32') {
      return captureWindows(filepath);
    } else if (process.platform === 'linux') {
      return captureLinux(filepath);
    } else if (process.platform === 'darwin') {
      return captureMac(filepath);
    } else {
      return { success: false, error: `SO não suportado: ${process.platform}` };
    }
  } catch (err) {
    return { success: false, error: `Erro na captura: ${err.message}` };
  }
}

function captureWindows(filepath) {
  // As quebras de linha têm de sobreviver. Com o script todo numa linha, os
  // tipos do Add-Type ainda não existem quando são usados e o PowerShell
  // responde "Unable to find type [System.Drawing.Point]". Ver
  // agents/powershell.js para a explicação inteira.
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save(${powershell.comPlicas(filepath)}, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`;

  try {
    powershell.correrSync(script, { timeout: 15000 });

    if (fs.existsSync(filepath)) {
      return { success: true, path: filepath, size: fs.statSync(filepath).size };
    }
    return { success: false, error: 'Screenshot gerado mas ficheiro não encontrado' };
  } catch (e) {
    return { success: false, error: `PowerShell error: ${e.message}` };
  }
}

function captureLinux(filepath) {
  try {
    // Tentar com diferentes ferramentas
    const tools = [
      `gnome-screenshot -f "${filepath}"`,
      `scrot "${filepath}"`,
      `import -window root "${filepath}"` // ImageMagick
    ];

    for (const cmd of tools) {
      try {
        execSync(cmd, { timeout: 10000 });
        if (fs.existsSync(filepath)) {
          return { success: true, path: filepath, size: fs.statSync(filepath).size };
        }
      } catch {}
    }

    return { success: false, error: 'Nenhuma ferramenta de screenshot encontrada (instala gnome-screenshot ou scrot)' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function captureMac(filepath) {
  try {
    execSync(`screencapture -x "${filepath}"`, { timeout: 10000 });
    if (fs.existsSync(filepath)) {
      return { success: true, path: filepath, size: fs.statSync(filepath).size };
    }
    return { success: false, error: 'Captura falhou' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
//  ANÁLISE DE IMAGEM COM IA
// ═══════════════════════════════════════════════════════════

/**
 * Analisa uma imagem usando Gemini Vision
 * @param {string} imagePath - Caminho para a imagem
 * @param {string} prompt - O que perguntar sobre a imagem
 * @returns {Promise<{success: boolean, analysis?: string, error?: string}>}
 */
/**
 * Fornecedores que sabem ver imagens, por ordem de preferência.
 *
 * Isto era só o Gemini, e a consequência era concreta: quem tivesse o Claude
 * ou o GPT configurados — ambos com visão — ouvia o NEXO responder que não
 * conseguia ver imagens. Uma capacidade que existia, recusada por causa da
 * chave errada.
 */
const FORNECEDORES_COM_VISAO = [
  { id: 'gemini', env: 'GEMINI_API_KEY', nome: 'Gemini' },
  { id: 'anthropic', env: 'ANTHROPIC_API_KEY', nome: 'Claude' },
  { id: 'openai', env: 'OPENAI_API_KEY', nome: 'GPT' }
];

/** O primeiro fornecedor com visão que esteja configurado. */
function fornecedorDeVisao(env = process.env) {
  return FORNECEDORES_COM_VISAO.find(f => {
    const v = env[f.env];
    return v && v.length > 8;
  }) || null;
}

async function analyzeImage(imagePath, prompt = 'Descreve detalhadamente o que vês nesta imagem.') {
  const fornecedor = fornecedorDeVisao();

  if (!fornecedor) {
    return {
      success: false,
      error: '⚠️ Para ver imagens é preciso um motor de IA com visão.\n' +
        'Serve qualquer um destes: Gemini (grátis, aistudio.google.com/apikey), ' +
        'Claude ou GPT. Configura com: npm run instalar'
    };
  }

  if (!fs.existsSync(imagePath)) {
    return { success: false, error: `Ficheiro não encontrado: ${imagePath}` };
  }

  if (!fs.existsSync(imagePath)) {
    return { success: false, error: `Ficheiro não encontrado: ${imagePath}` };
  }

  const base64Image = fs.readFileSync(imagePath).toString('base64');
  const mimeType = getMimeType(imagePath);

  // Tenta cada fornecedor com visão até um responder — a mesma cadeia de
  // recurso que o llmRouter já usa para texto. Nasceu de um caso real: o
  // Gemini respondeu "este modelo está com muita procura, tenta mais tarde",
  // e não faz sentido desistir quando há outro motor configurado ao lado.
  const candidatos = FORNECEDORES_COM_VISAO.filter(f => {
    const v = process.env[f.env];
    return v && v.length > 8;
  });

  let primeiroErro = null;

  for (const f of candidatos) {
    try {
      const chave = process.env[f.env];
      let response;

      if (f.id === 'gemini') {
        response = await callGeminiVision(chave, base64Image, mimeType, prompt);
      } else if (f.id === 'anthropic') {
        response = await callAnthropicVision(chave, base64Image, mimeType, prompt);
      } else {
        response = await callOpenAIVision(chave, base64Image, mimeType, prompt);
      }

      return { success: true, analysis: response, imagePath, fornecedor: f.nome };
    } catch (err) {
      if (!primeiroErro) primeiroErro = `${f.nome}: ${err.message}`;
      if (candidatos.length > 1) console.warn(`  ⚠️ Visão por ${f.nome} falhou: ${err.message}`);
    }
  }

  return { success: false, error: `Erro na análise — ${primeiroErro}` };
}

/**
 * Claude vê imagens como blocos de conteúdo dentro da mensagem, não como um
 * campo à parte — é a diferença principal em relação ao Gemini.
 */
async function callAnthropicVision(apiKey, base64Image, mimeType, prompt) {
  const resposta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } },
          { type: 'text', text: prompt }
        ]
      }]
    })
  });

  if (!resposta.ok) {
    throw new Error(`Anthropic ${resposta.status}: ${(await resposta.text()).slice(0, 200)}`);
  }

  const dados = await resposta.json();
  const texto = (dados.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (!texto) throw new Error('resposta vazia');
  return texto;
}

/** O GPT recebe a imagem como uma data URL dentro do conteúdo. */
async function callOpenAIVision(apiKey, base64Image, mimeType, prompt) {
  const resposta = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
        ]
      }]
    })
  });

  if (!resposta.ok) {
    throw new Error(`OpenAI ${resposta.status}: ${(await resposta.text()).slice(0, 200)}`);
  }

  const dados = await resposta.json();
  const texto = dados.choices?.[0]?.message?.content;
  if (!texto) throw new Error('resposta vazia');
  return texto;
}

/**
 * Captura ecrã e analisa com IA em um passo
 */
async function captureAndAnalyze(prompt = 'Descreve o que vês no ecrã. Se houver erros ou avisos, destaca-os.') {
  const capture = captureScreen();

  if (!capture.success) {
    return { success: false, error: `📸 Erro na captura: ${capture.error}` };
  }

  console.log(`[VisionAgent] 📸 Screenshot capturado: ${capture.path} (${formatSize(capture.size)})`);

  const analysis = await analyzeImage(capture.path, prompt);

  // Limpar screenshot temporário após análise
  try { fs.unlinkSync(capture.path); } catch {}

  if (!analysis.success) {
    return analysis;
  }

  return {
    success: true,
    message: `📸 **Análise do Ecrã:**\n\n${analysis.analysis}`
  };
}

/**
 * Analisa imagem fornecida pelo utilizador (upload)
 */
async function analyzeUploadedImage(filePath, question = '') {
  const prompt = question || 'Descreve detalhadamente o que vês nesta imagem. Identifica texto, elementos visuais e contexto.';
  return analyzeImage(filePath, prompt);
}

// ═══════════════════════════════════════════════════════════
//  GEMINI VISION API
// ═══════════════════════════════════════════════════════════

function callGeminiVision(apiKey, base64Image, mimeType, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Image
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.4,
        topP: 0.8,
        maxOutputTokens: 2048
      }
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: `/v1beta/models/${MODELO_GEMINI}:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);

          if (json.error) {
            return reject(new Error(json.error.message || 'Gemini API error'));
          }

          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            resolve(text);
          } else {
            reject(new Error('Resposta vazia do Gemini'));
          }
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════
//  OCR SIMPLIFICADO (extrair texto do ecrã)
// ═══════════════════════════════════════════════════════════

/**
 * Captura ecrã e extrai todo o texto visível
 */
async function extractTextFromScreen() {
  const capture = captureScreen();

  if (!capture.success) {
    return { success: false, error: capture.error };
  }

  const prompt = 'Extrai TODO o texto visível nesta imagem, mantendo a formatação original. ' +
    'Não adiciones nenhuma interpretação, apenas transcreve o texto tal como está.';

  const analysis = await analyzeImage(capture.path, prompt);

  try { fs.unlinkSync(capture.path); } catch {}

  return analysis.success
    ? { success: true, text: analysis.analysis }
    : analysis;
}

/**
 * Captura ecrã e identifica erros
 */
async function findScreenErrors() {
  const capture = captureScreen();

  if (!capture.success) {
    return { success: false, error: capture.error };
  }

  const prompt = 'Analisa esta imagem de ecrã e identifica:\n' +
    '1. Erros ou mensagens de erro (em vermelho, popups, etc)\n' +
    '2. Avisos ou warnings\n' +
    '3. Problemas visuais\n\n' +
    'Para cada erro, indica:\n- O texto exato do erro\n- Possível causa\n- Sugestão de solução\n\n' +
    'Se não houver erros visíveis, diz "Nenhum erro visível."';

  const analysis = await analyzeImage(capture.path, prompt);

  try { fs.unlinkSync(capture.path); } catch {}

  return analysis;
}

// ═══════════════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════════════

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getMimeType(filepath) {
  const ext = path.extname(filepath).toLowerCase();
  const types = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp'
  };
  return types[ext] || 'image/png';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function isAvailable() {
  return !!fornecedorDeVisao();
}

function getStats() {
  // Contar screenshots na pasta
  let screenshotCount = 0;
  try {
    if (fs.existsSync(SCREENSHOTS_DIR)) {
      screenshotCount = fs.readdirSync(SCREENSHOTS_DIR).length;
    }
  } catch {}

  return {
    available: isAvailable(),
    provider: 'Gemini Vision',
    screenshotCount,
    platform: process.platform
  };
}

// ═══════════════════════════════════════════════════════════
//  EXPORTS
// ═══════════════════════════════════════════════════════════

module.exports = {
  captureScreen,
  analyzeImage,
  captureAndAnalyze,
  analyzeUploadedImage,
  fornecedorDeVisao,
  FORNECEDORES_COM_VISAO,
  extractTextFromScreen,
  findScreenErrors,
  isAvailable,
  getStats
};
