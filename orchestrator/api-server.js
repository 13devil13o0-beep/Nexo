/**
 * 🌐 NEXO - Servidor Unificado
 * 
 * Servidor único: API REST + WebSocket + Interface Web + Dashboard
 * Porta padrão: 7777
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = require('./router');
const security = require('./security');
const aiAgent = require('../agents/aiAgent');
const llmRouter = require('./llmRouter');
const ragEngine = require('./ragEngine');
const providerHealth = require('./providerHealth');
const codeRunner = require('../agents/codeRunner');
const dispositivo = require('./dispositivo');
const definicoes = require('./definicoes');

// Deploy helper (wizard AWS)
let deployHelper;
try {
  deployHelper = require('../deploy/deploy-helper');
} catch(e) {
  deployHelper = null;
}

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 7777;
const startTime = Date.now();

// Clientes WebSocket conectados
const clients = new Map();

// Conversas ativas
const conversations = new Map();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate limiting em todas as rotas API
app.use('/api', security.rateLimitMiddleware);

// Autenticação nas rotas API sensíveis (chat, comandos)
// Rotas de leitura (status, agents) ficam abertas; rotas de escrita requerem auth
app.use('/api/chat', security.authMiddleware);
app.use('/api/conversations', security.authMiddleware);
app.use('/api/preferences', security.authMiddleware);

// Servir interface web (ficheiros estáticos)
app.use(express.static(path.join(__dirname, '..', 'web', 'public')));

// ═══════════════════════════════════════════════════════════
// HTTP API
// ═══════════════════════════════════════════════════════════

// Lista de endpoints disponíveis
app.get('/api', (req, res) => {
  res.json({
    name: 'NEXO API',
    version: '2.0.0',
    endpoints: {
      'GET /api': 'Esta lista de endpoints',
      'GET /api/status': 'Estado do sistema',
      'POST /api/chat': 'Enviar mensagem ao bot',
      'POST /api/chat/stream': 'Chat com streaming (SSE)',
      'GET /api/providers': 'Estado dos providers LLM',
      'GET /api/conversations': 'Lista de conversas',
      'GET /api/conversations/:id': 'Obter conversa específica',
      'DELETE /api/conversations/:id': 'Eliminar conversa',
      'GET /api/agents': 'Lista de agentes disponíveis',
      'POST /api/upload': 'Upload de ficheiro',
      'GET /api/uploads': 'Lista de uploads',
      'GET /api/rag/stats': 'Estatísticas RAG',
      'GET /api/preferences': 'Preferências do utilizador',
      'PUT /api/preferences': 'Atualizar preferências',
      'GET /api/dashboard/stats': 'Stats para dashboard',
      'GET /api/dashboard/logs': 'Logs recentes',
      'GET /api/health': 'Health check do servidor',
      'POST /api/deploy/validate-keys': 'Validar API keys',
      'POST /api/deploy/test-key': 'Testar API key contra o serviço',
      'POST /api/deploy/generate-url': 'Gerar URL CloudFormation',
      'POST /api/deploy/generate-env': 'Gerar ficheiro .env',
      'POST /api/deploy/generate-script': 'Gerar script de instalação',
      'GET /setup': 'Wizard de setup AWS'
    },
    documentation: 'https://github.com/13devil13o0-beep/Nexo-'
  });
});

// Status do sistema
// Health check (sem auth, para monitoring)
app.get('/api/health', (req, res) => {
  const providers = llmRouter.getProvidersStatus().filter(p => p.configured);
  const healthy = aiAgent.isAvailable() && providers.length > 0;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: '2.0.0',
    ai: {
      available: aiAgent.isAvailable(),
      providers: providers.length,
      active: llmRouter.getActiveProvider()?.name || 'none'
    },
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
    },
    timestamp: new Date().toISOString()
  });
});

/**
 * O que o NEXO vê da máquina onde o motor corre, e que perfil de arranque isso
 * justifica. Serve para diagnóstico e para a interface poder mostrar o modo
 * actual nas definições.
 *
 * Atenção: isto descreve a máquina do MOTOR, não o aparelho de quem está a ver
 * a página. Quem abre o NEXO no telemóvel recebe aqui as características do PC.
 * O peso da página é decidido no browser, que é o único que sabe o seu ecrã.
 */
app.get('/api/dispositivo', (req, res) => {
  const decisao = dispositivo.resolver({ definicoes: definicoes.ler() });

  res.json({
    perfil: decisao.perfil,
    descricao: dispositivo.DESCRICAO[decisao.perfil] || null,
    motivo: decisao.motivo,
    origem: decisao.origem,
    sinais: decisao.sinais,
    definicoes: definicoes.obter(),
    perfis: dispositivo.PERFIS
  });
});

/** Guarda o modo de arranque escolhido pelo utilizador. */
app.post('/api/dispositivo/modo', security.authMiddleware, (req, res) => {
  const { modo, arrancarEscondido, perfilPagina } = req.body || {};

  if (modo !== undefined) {
    if (modo !== 'auto' && !dispositivo.perfilValido(modo)) {
      return res.status(400).json({
        error: 'Modo inválido',
        validos: ['auto', ...dispositivo.PERFIS]
      });
    }
    definicoes.definir('modo', modo);
  }

  if (arrancarEscondido !== undefined) {
    definicoes.definir('arrancarEscondido', !!arrancarEscondido);
  }

  if (perfilPagina !== undefined) {
    if (!['auto', 'completo', 'leve'].includes(perfilPagina)) {
      return res.status(400).json({ error: 'Perfil de página inválido', validos: ['auto', 'completo', 'leve'] });
    }
    definicoes.definir('perfilPagina', perfilPagina);
  }

  res.json({ ok: true, definicoes: definicoes.obter(), nota: 'Aplica-se ao próximo arranque.' });
});

app.get('/api/status', (req, res) => {
  res.json({
    online: true,
    version: '2.0.0',
    name: 'NEXO',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    memory: process.memoryUsage(),
    ai: {
      provider: llmRouter.getActiveProvider()?.name || 'none',
      available: aiAgent.isAvailable(),
      model: llmRouter.getActiveProvider()?.model || 'none',
      providers: llmRouter.getProvidersStatus().filter(p => p.configured).length
    },
    clients: clients.size,
    conversations: conversations.size,
    timestamp: new Date().toISOString()
  });
});

// Chat principal
app.post('/api/chat', async (req, res) => {
  try {
    const { message, conversationId, context = {} } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Mensagem obrigatória' });
    }
    
    // Enriquecer com contexto RAG (se houver documentos indexados)
    let ragContext = '';
    try {
      const stats = ragEngine.getStats();
      if (stats.totalChunks > 0) {
        ragContext = await ragEngine.getContext(message, { topK: 3, minScore: 0.1 });
      }
    } catch {}
    
    // Contexto para o orchestrator
    const enhancedContext = {
      ...context,
      source: 'api',
      conversationId,
      ragContext,
      timestamp: Date.now()
    };
    
    // Processar com orchestrator
    const result = await router.handlePrompt(message, enhancedContext);
    
    // Extrair resposta (pode ser string ou objeto com metadata)
    const response = typeof result === 'object' ? (result.text || result.response || JSON.stringify(result)) : result;
    const metadata = typeof result === 'object' ? result : {};
    
    res.json({
      success: true,
      response,
      conversationId: metadata.conversationId || conversationId,
      outputMode: metadata.outputMode || 'text',
      shouldSpeak: metadata.shouldSpeak || false,
      speakableText: metadata.speakableText || null,
      elapsed: metadata.elapsed,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[API] Erro no chat:', error);
    res.status(500).json({ 
      error: 'Erro ao processar mensagem',
      message: error.message
    });
  }
});

// Chat com Streaming (SSE - Server-Sent Events)
app.post('/api/chat/stream', security.authMiddleware, async (req, res) => {
  try {
    const { message, conversationId, context = {} } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Mensagem obrigatória' });
    }

    // IMPORTANTE: Verificar intent primeiro antes de streamer
    const intentParser = require('./intentParser');
    const intentData = intentParser.parseIntent(message);
    
    // Se é um intent específico (não 'chat'), usar o router normal
    if (intentData.intent !== 'chat') {
      console.log(`🎯 Intent detectado em SSE: ${intentData.intent}`);
      const userId = security.getUserId({ ...context, source: 'api' });
      const result = await router.handlePrompt(message, { 
        userId, 
        source: 'api-stream',
        conversationId 
      });
      
      // Devolver como JSON normal (não SSE)
      return res.json(result);
    }

    // É chat normal — continuar com SSE
    // Configurar SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    // Obter histórico de conversação
    let history = [];
    try {
      const { conversationStore } = require('../memory/conversationStore');
      const conversation = conversationStore.getOrCreateConversation(
        security.getUserId({ ...context, source: 'api' })
      );
      history = conversationStore.getHistoryForContext(conversation.id, 10);
    } catch {}

    // Enriquecer mensagem com contexto RAG
    let enrichedMessage = message;
    try {
      const stats = ragEngine.getStats();
      if (stats.totalChunks > 0) {
        const ragContext = await ragEngine.getContext(message, { topK: 3, minScore: 0.1 });
        if (ragContext) {
          enrichedMessage = `${ragContext}\n\nPergunta do utilizador: ${message}`;
        }
      }
    } catch {}

    // Stream tokens via SSE
    let fullResponse = '';
    
    await aiAgent.askAIStream(
      enrichedMessage,
      history,
      (token) => {
        fullResponse += token;
        res.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`);
      },
      { maxTokens: 2048, temperature: 0.7 }
    );

    // Enviar evento final com metadata
    res.write(`data: ${JSON.stringify({ 
      type: 'done', 
      response: fullResponse,
      conversationId
    })}\n\n`);
    
    res.end();

  } catch (error) {
    console.error('[API] Erro no stream:', error);
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
      res.end();
    } catch {
      res.status(500).json({ error: error.message });
    }
  }
});

// Estado dos providers LLM
app.get('/api/providers', (req, res) => {
  res.json({
    providers: llmRouter.getProvidersStatus(),
    active: llmRouter.getActiveProvider()
  });
});

// Obter conversas (usa memória persistente)
app.get('/api/conversations', (req, res) => {
  try {
    const { conversationStore } = require('../memory/conversationStore');
    const list = conversationStore.listConversations().map(c => ({
      id: c.id,
      title: c.title,
      messageCount: c.messages?.length || 0,
      updatedAt: c.updatedAt,
      createdAt: c.createdAt
    }));
    res.json(list);
  } catch (e) {
    // Fallback para Map local
    const list = Array.from(conversations.entries()).map(([id, data]) => ({
      id,
      title: data.title || `Conversa ${id.slice(0, 8)}`,
      messageCount: data.messages?.length || 0,
      updatedAt: data.updatedAt,
      createdAt: data.createdAt
    })).sort((a, b) => b.updatedAt - a.updatedAt);
    res.json(list);
  }
});

// Obter conversa específica
app.get('/api/conversations/:id', (req, res) => {
  try {
    const { conversationStore } = require('../memory/conversationStore');
    const conversation = conversationStore.getConversation(req.params.id);
    if (conversation) {
      return res.json(conversation);
    }
  } catch (e) {}
  
  const conversation = conversations.get(req.params.id);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversa não encontrada' });
  }
  res.json(conversation);
});

// Criar nova conversa
app.post('/api/conversations', (req, res) => {
  try {
    const { conversationStore } = require('../memory/conversationStore');
    const conversation = conversationStore.createConversation(req.body.title);
    return res.json(conversation);
  } catch (e) {}
  
  const id = uuidv4();
  const conversation = {
    id,
    title: req.body.title || 'Nova Conversa',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  conversations.set(id, conversation);
  res.json(conversation);
});

// Eliminar conversa
app.delete('/api/conversations/:id', (req, res) => {
  try {
    const { conversationStore } = require('../memory/conversationStore');
    const deleted = conversationStore.deleteConversation(req.params.id);
    if (deleted) return res.json({ success: true });
  } catch (e) {}
  
  const deleted = conversations.delete(req.params.id);
  res.json({ success: deleted });
});

// Estatísticas de memória
app.get('/api/stats', (req, res) => {
  try {
    const { conversationStore } = require('../memory/conversationStore');
    res.json(conversationStore.getStats());
  } catch (e) {
    res.json({
      totalConversations: conversations.size,
      totalMessages: 0,
      storageSize: 0
    });
  }
});

// Preferências do utilizador
app.get('/api/preferences', (req, res) => {
  try {
    const { conversationStore } = require('../memory/conversationStore');
    res.json(conversationStore.getPreferences());
  } catch (e) {
    res.json({});
  }
});

app.post('/api/preferences', (req, res) => {
  try {
    const { conversationStore } = require('../memory/conversationStore');
    conversationStore.savePreferences(req.body);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Listar agentes
app.get('/api/agents', (req, res) => {
  res.json([
    { 
      id: 'ai', 
      name: 'AI Agent', 
      description: 'Chat e geração de texto', 
      icon: '🧠', 
      status: aiAgent.isAvailable() ? 'online' : 'offline' 
    },
    { 
      id: 'pdf', 
      name: 'PDF Agent', 
      description: 'Criação de documentos PDF', 
      icon: '📄', 
      status: 'online' 
    },
    { 
      id: 'file', 
      name: 'File Agent', 
      description: 'Gestão de ficheiros', 
      icon: '📁', 
      status: 'online' 
    },
    { 
      id: 'code', 
      name: 'Code Runner', 
      description: 'Execução de código JavaScript', 
      icon: '⚡', 
      status: 'online' 
    }
  ]);
});

// Logs recentes
app.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(security.getRecentLogs(limit));
});

// ═══════════════════════════════════════════════════════════
// RAG - Retrieval Augmented Generation
// ═══════════════════════════════════════════════════════════

// Pesquisar documentos indexados
app.post('/api/rag/search', async (req, res) => {
  try {
    const { query, topK, minScore } = req.body;
    if (!query) return res.status(400).json({ error: 'Query obrigatoria' });
    
    const results = await ragEngine.search(query, { topK, minScore });
    res.json({ results, total: results.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Indexar diretório
app.post('/api/rag/index', async (req, res) => {
  try {
    const { directory, maxDepth } = req.body;
    const result = await ragEngine.indexDirectory(directory, { maxDepth });
    res.json({ success: true, ...result, stats: ragEngine.getStats() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Indexar texto livre
app.post('/api/rag/index-text', async (req, res) => {
  try {
    const { text, source, metadata } = req.body;
    if (!text) return res.status(400).json({ error: 'Texto obrigatorio' });
    
    await ragEngine.indexText(text, source, metadata);
    res.json({ success: true, stats: ragEngine.getStats() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Estatísticas do índice RAG
app.get('/api/rag/stats', async (req, res) => {
  try {
    await ragEngine.init();
    res.json(ragEngine.getStats());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Limpar índice RAG
app.delete('/api/rag/index', async (req, res) => {
  try {
    await ragEngine.clearIndex();
    res.json({ success: true, message: 'Indice limpo' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// FILE UPLOAD
// ═══════════════════════════════════════════════════════════

// Upload de ficheiros (multipart/form-data manual, sem multer)
app.post('/api/upload', async (req, res) => {
  try {
    const contentType = req.headers['content-type'] || '';
    
    // Accept base64 JSON upload
    if (contentType.includes('application/json')) {
      const { filename, data, indexForRAG } = req.body;
      if (!filename || !data) {
        return res.status(400).json({ error: 'filename e data obrigatorios' });
      }
      
      const fs = require('fs-extra');
      const uploadDir = path.join(__dirname, '..', 'temp', 'uploads');
      await fs.ensureDir(uploadDir);
      
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = path.join(uploadDir, `${Date.now()}_${safeName}`);
      
      // Decodificar base64
      const buffer = Buffer.from(data, 'base64');
      await fs.writeFile(filePath, buffer);
      
      let ragResult = null;
      if (indexForRAG) {
        await ragEngine.indexFile(filePath, { originalName: filename, uploadedAt: Date.now() });
        ragResult = ragEngine.getStats();
      }
      
      res.json({
        success: true,
        file: {
          name: safeName,
          path: filePath,
          size: buffer.length
        },
        rag: ragResult
      });
    } else {
      res.status(400).json({ error: 'Envia JSON com {filename, data (base64), indexForRAG}' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Listar ficheiros carregados
app.get('/api/uploads', async (req, res) => {
  try {
    const fs = require('fs-extra');
    const uploadDir = path.join(__dirname, '..', 'temp', 'uploads');
    await fs.ensureDir(uploadDir);
    
    const files = await fs.readdir(uploadDir);
    const fileInfos = [];
    
    for (const file of files) {
      const stats = await fs.stat(path.join(uploadDir, file));
      fileInfos.push({
        name: file,
        size: stats.size,
        created: stats.birthtime
      });
    }
    
    res.json({ files: fileInfos });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════

// Interface web principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'public', 'index.html'));
});

// Dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'public', 'dashboard.html'));
});

// Sponsor / Doação
app.get('/sponsor', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'public', 'sponsor.html'));
});

// Stats agregadas para dashboard (segurança/logs)
app.get('/api/dashboard/stats', (req, res) => {
  res.json(security.getStats());
});

// Logs formatados para o dashboard
app.get('/api/dashboard/logs', (req, res) => {
  res.json(security.getRecentLogs(50));
});

// ═══════════════════════════════════════════════════════════
// WEBSOCKET
// ═══════════════════════════════════════════════════════════

wss.on('connection', (ws) => {
  const clientId = uuidv4();
  
  clients.set(clientId, {
    ws,
    id: clientId,
    connectedAt: Date.now(),
    subscriptions: new Set()
  });
  
  console.log(`[WS] Cliente conectado: ${clientId}`);
  
  // Mensagem de boas-vindas
  ws.send(JSON.stringify({
    type: 'connected',
    data: { 
      clientId, 
      version: '2.0.0',
      message: 'Bem-vindo ao NEXO!' 
    }
  }));
  
  // Handler de mensagens
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      await handleWSMessage(clientId, message);
    } catch (error) {
      console.error('[WS] Erro ao processar:', error);
      ws.send(JSON.stringify({
        type: 'error',
        data: { message: 'Formato inválido' }
      }));
    }
  });
  
  ws.on('close', () => {
    clients.delete(clientId);
    console.log(`[WS] Cliente desconectado: ${clientId}`);
  });
  
  ws.on('error', (error) => {
    console.error(`[WS] Erro no cliente ${clientId}:`, error.message);
  });
});

/**
 * Handler de mensagens WebSocket
 */
async function handleWSMessage(clientId, message) {
  const client = clients.get(clientId);
  if (!client) return;
  
  const { type, data, requestId } = message;
  
  switch (type) {
    case 'chat':
      // Processar chat
      try {
        const context = {
          source: 'websocket',
          clientId,
          conversationId: data.conversationId
        };
        
        const result = await router.handlePrompt(data.message, context);
        
        // Extrair texto da resposta (pode ser string ou objeto com .text/.response)
        const responseText = typeof result === 'object' 
          ? (result.text || result.response || JSON.stringify(result))
          : result;
        const conversationId = (typeof result === 'object' && result.conversationId) || data.conversationId;
        
        client.ws.send(JSON.stringify({
          type: 'chat_response',
          requestId,
          data: { 
            response: responseText,
            conversationId,
            outputMode: result?.outputMode,
            shouldSpeak: result?.shouldSpeak,
            speakableText: result?.speakableText
          }
        }));
        
        // Notificar outros clientes na mesma conversa
        if (data.conversationId) {
          broadcastToConversation(data.conversationId, {
            type: 'new_message',
            data: { conversationId: data.conversationId }
          }, clientId);
        }
        
      } catch (error) {
        client.ws.send(JSON.stringify({
          type: 'error',
          requestId,
          data: { message: error.message }
        }));
      }
      break;

    case 'chat_stream':
      // Chat com streaming token-a-token via WebSocket
      // IMPORTANTE: Verificar intent primeiro antes de streamer
      try {
        // Verificar intent via regex (instantâneo)
        const intentParser = require('./intentParser');
        const intentData = intentParser.parseIntent(data.message);
        
        // Se é um intent específico (não 'chat'), usar o router normal
        if (intentData.intent !== 'chat') {
          console.log(`🎯 Intent detectado em stream: ${intentData.intent}`);
          const context = { 
            userId: clientId, 
            source: 'websocket-stream',
            conversationId: data.conversationId
          };
          
          const result = await router.handlePrompt(data.message, context);
          
          // Enviar resposta completa (não streaming)
          if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({
              type: 'chat_response',
              requestId,
              data: {
                response: result.text,
                speakableText: result.speakableText || result.text
              }
            }));
          }
          break;
        }
        
        // É chat normal - usar streaming
        let history = [];
        try {
          const { conversationStore } = require('../memory/conversationStore');
          const conv = conversationStore.getOrCreateConversation(clientId);
          history = conversationStore.getHistoryForContext(conv.id, 10);
        } catch {}
        
        await aiAgent.askAIStream(
          data.message,
          history,
          (token) => {
            if (client.ws.readyState === WebSocket.OPEN) {
              client.ws.send(JSON.stringify({
                type: 'stream_token',
                requestId,
                data: { token }
              }));
            }
          },
          { maxTokens: 2048, temperature: 0.7 }
        );
        
        // Signal stream done
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({
            type: 'stream_done',
            requestId,
            data: { conversationId: data.conversationId }
          }));
        }
      } catch (error) {
        client.ws.send(JSON.stringify({
          type: 'error',
          requestId,
          data: { message: error.message }
        }));
      }
      break;
      
    case 'subscribe':
      // Subscrever a conversa
      if (data.conversationId) {
        client.subscriptions.add(data.conversationId);
      }
      break;
      
    case 'unsubscribe':
      // Cancelar subscrição
      if (data.conversationId) {
        client.subscriptions.delete(data.conversationId);
      }
      break;
      
    case 'ping':
      client.ws.send(JSON.stringify({ type: 'pong' }));
      break;
      
    default:
      client.ws.send(JSON.stringify({
        type: 'error',
        data: { message: `Tipo desconhecido: ${type}` }
      }));
  }
}

/**
 * Broadcast para clientes numa conversa
 */
function broadcastToConversation(conversationId, message, excludeClientId = null) {
  for (const [id, client] of clients) {
    if (id !== excludeClientId && client.subscriptions.has(conversationId)) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(message));
      }
    }
  }
}

/**
 * Guarda mensagem numa conversa
 */
function saveMessage(conversationId, role, content) {
  if (!conversations.has(conversationId)) {
    conversations.set(conversationId, {
      id: conversationId,
      title: 'Conversa',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }
  
  const conversation = conversations.get(conversationId);
  conversation.messages.push({
    id: uuidv4(),
    role,
    content,
    timestamp: Date.now()
  });
  conversation.updatedAt = Date.now();
  
  // Atualizar título baseado na primeira mensagem do utilizador
  if (role === 'user' && conversation.messages.length === 1) {
    conversation.title = content.substring(0, 50) + (content.length > 50 ? '...' : '');
  }
}

// ═══════════════════════════════════════════════════════════
// DEPLOY / SETUP WIZARD API
// ═══════════════════════════════════════════════════════════

// Setup wizard page (sem auth)
app.get('/setup', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'public', 'setup.html'));
});

// Validar formato das API keys
app.post('/api/deploy/validate-keys', (req, res) => {
  if (!deployHelper) return res.status(501).json({ error: 'Deploy helper não disponível' });
  const results = deployHelper.validateKeys(req.body);
  res.json({ results });
});

// Testar API key contra o serviço real
app.post('/api/deploy/test-key', async (req, res) => {
  if (!deployHelper) return res.status(501).json({ error: 'Deploy helper não disponível' });
  const { provider, key } = req.body;
  if (!provider || !key) return res.status(400).json({ error: 'Provider e key obrigatórios' });
  
  try {
    const result = await deployHelper.testApiKey(provider, key);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Gerar URL de CloudFormation
app.post('/api/deploy/generate-url', (req, res) => {
  if (!deployHelper) return res.status(501).json({ error: 'Deploy helper não disponível' });
  const url = deployHelper.generateCloudFormationUrl(req.body);
  res.json({ url });
});

// Gerar conteúdo .env
app.post('/api/deploy/generate-env', (req, res) => {
  if (!deployHelper) return res.status(501).json({ error: 'Deploy helper não disponível' });
  const content = deployHelper.generateEnvContent(req.body);
  res.setHeader('Content-Type', 'text/plain');
  res.send(content);
});

// Gerar script de instalação
app.post('/api/deploy/generate-script', (req, res) => {
  if (!deployHelper) return res.status(501).json({ error: 'Deploy helper não disponível' });
  const script = deployHelper.generateInstallScript(req.body);
  res.setHeader('Content-Type', 'text/plain');
  res.send(script);
});

// Health check remoto (testar outra instância)
app.post('/api/deploy/health-check', async (req, res) => {
  if (!deployHelper) return res.status(501).json({ error: 'Deploy helper não disponível' });
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL obrigatório' });
  
  try {
    const result = await deployHelper.healthCheck(url);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// INICIAR SERVIDOR
// ═══════════════════════════════════════════════════════════

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('==========================================================');
  console.log('       NEXO - Servidor Unificado');
  console.log('----------------------------------------------------------');
  console.log(`  Web:       http://localhost:${PORT}`);
  console.log(`  API:       http://localhost:${PORT}/api`);
  console.log(`  WebSocket: ws://localhost:${PORT}`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`  Setup:     http://localhost:${PORT}/setup`);
  console.log('----------------------------------------------------------');
  console.log(`  IA Groq:   ${aiAgent.isAvailable() ? 'Configurada' : 'Nao configurada'}`);
  console.log('==========================================================');
  console.log('');
  
  security.logAction('system', 'server-started', { port: PORT });

  // Sentinela de modelos: avisa se algum fornecedor descontinuou o modelo
  // configurado. Não bloqueia o arranque e cala-se quando está tudo bem.
  providerHealth.checkOnStartup();

  // Carrega o modelo local para memória, para a 1.ª mensagem ser rápida.
  llmRouter.warmupLocal();
});

module.exports = { app, server, wss };
