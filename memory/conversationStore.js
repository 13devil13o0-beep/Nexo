/**
 * 💾 NEXO - Conversation Store
 * Gestão de memória e histórico de conversas
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class ConversationStore {
  constructor() {
    this.conversations = new Map();
    this.userPreferences = null;
    this.dataDir = this.getDataDirectory();
    this.maxHistoryDays = 30;
    
    // Criar diretório de dados
    fs.ensureDirSync(this.dataDir);
    
    // Carregar dados
    this.userPreferences = this.loadPreferences();
    this.loadConversations();
    
    // Limpar conversas antigas periodicamente (24h)
    setInterval(() => this.cleanupOldConversations(), 24 * 60 * 60 * 1000);
    
    console.log('[Memory] ConversationStore inicializado');
  }
  
  /**
   * Determina diretório de dados baseado no SO
   */
  getDataDirectory() {
    // NAO renomear para NEXO: e o nome da pasta em %APPDATA% onde vivem as
    // conversas ja gravadas. Mudar aqui deixa o historico do utilizador orfao.
    // Uma futura migracao teria de copiar a pasta antiga para a nova.
    const appName = 'MyAssistBOT';
    
    // Variável de ambiente tem prioridade
    if (process.env.USER_DATA_PATH) {
      return path.join(process.env.USER_DATA_PATH, 'data');
    }
    
    let userDataPath;
    
    switch (process.platform) {
      case 'win32':
        userDataPath = path.join(process.env.APPDATA || '', appName);
        break;
      case 'darwin':
        userDataPath = path.join(process.env.HOME || '', 'Library', 'Application Support', appName);
        break;
      default:
        userDataPath = path.join(process.env.HOME || '', '.mybot');
    }
    
    return path.join(userDataPath, 'data');
  }
  
  get conversationsPath() {
    return path.join(this.dataDir, 'conversations.json');
  }
  
  get preferencesPath() {
    return path.join(this.dataDir, 'preferences.json');
  }
  
  // ═══════════════════════════════════════════════════════════
  // CONVERSAS
  // ═══════════════════════════════════════════════════════════
  
  /**
   * Cria nova conversa
   */
  createConversation(title = null) {
    const conversation = {
      id: uuidv4(),
      title: title || `Conversa ${this.conversations.size + 1}`,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    this.conversations.set(conversation.id, conversation);
    this.saveConversations();
    
    return conversation;
  }
  
  /**
   * Obtém conversa por ID
   */
  getConversation(id) {
    return this.conversations.get(id);
  }
  
  /**
   * Obtém ou cria conversa para utilizador
   */
  getOrCreateConversation(userId) {
    // Procura conversa ativa do utilizador
    for (const [id, conv] of this.conversations) {
      if (conv.userId === userId && Date.now() - conv.updatedAt < 3600000) {
        return conv;
      }
    }
    
    // Cria nova
    const conv = this.createConversation();
    conv.userId = userId;
    return conv;
  }
  
  /**
   * Lista todas as conversas (ordenadas por data)
   */
  listConversations() {
    return Array.from(this.conversations.values())
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  
  /**
   * Adiciona mensagem a conversa
   */
  addMessage(conversationId, message) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversa ${conversationId} não encontrada`);
    }
    
    // Adiciona ID e timestamp se não tiver
    const msg = {
      id: message.id || uuidv4(),
      role: message.role,
      content: message.content,
      timestamp: message.timestamp || Date.now()
    };
    
    conversation.messages.push(msg);
    conversation.updatedAt = Date.now();
    
    // Atualiza título se for primeira mensagem do utilizador
    if (message.role === 'user' && conversation.messages.length <= 2) {
      conversation.title = this.generateTitle(message.content);
    }
    
    this.saveConversations();
    return msg;
  }
  
  /**
   * Obtém histórico formatado para contexto do LLM
   */
  getHistoryForContext(conversationId, maxMessages = 10) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return [];
    
    return conversation.messages
      .slice(-maxMessages)
      .map(m => ({
        role: m.role,
        content: m.content.substring(0, 2000) // Limita tamanho
      }));
  }
  
  /**
   * Elimina conversa
   */
  deleteConversation(id) {
    const deleted = this.conversations.delete(id);
    if (deleted) this.saveConversations();
    return deleted;
  }
  
  /**
   * Limpa histórico de uma conversa
   */
  clearConversation(id) {
    const conversation = this.conversations.get(id);
    if (conversation) {
      conversation.messages = [];
      conversation.updatedAt = Date.now();
      this.saveConversations();
      return true;
    }
    return false;
  }
  
  // ═══════════════════════════════════════════════════════════
  // PERSISTÊNCIA
  // ═══════════════════════════════════════════════════════════
  
  /**
   * Guarda conversas em disco
   */
  saveConversations() {
    try {
      const data = Array.from(this.conversations.values());
      fs.writeJsonSync(this.conversationsPath, data, { spaces: 2 });
    } catch (error) {
      console.error('[Memory] Erro ao guardar conversas:', error.message);
    }
  }
  
  /**
   * Carrega conversas do disco
   */
  loadConversations() {
    try {
      if (fs.existsSync(this.conversationsPath)) {
        const data = fs.readJsonSync(this.conversationsPath);
        data.forEach(c => this.conversations.set(c.id, c));
        console.log(`[Memory] Carregadas ${data.length} conversas`);
      }
    } catch (error) {
      console.error('[Memory] Erro ao carregar conversas:', error.message);
    }
  }
  
  /**
   * Arquiva conversas antigas
   */
  cleanupOldConversations() {
    const cutoff = Date.now() - (this.maxHistoryDays * 24 * 60 * 60 * 1000);
    let cleaned = 0;
    
    for (const [id, conversation] of this.conversations) {
      if (conversation.updatedAt < cutoff && conversation.messages.length === 0) {
        this.conversations.delete(id);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[Memory] Limpas ${cleaned} conversas antigas`);
      this.saveConversations();
    }
  }
  
  /**
   * Gera título automático baseado na primeira mensagem
   */
  generateTitle(content) {
    const clean = content
      .replace(/[^\w\sàáâãçéêíóôõú]/gi, '')
      .substring(0, 40)
      .trim();
    
    return clean || 'Nova Conversa';
  }
  
  // ═══════════════════════════════════════════════════════════
  // PREFERÊNCIAS
  // ═══════════════════════════════════════════════════════════
  
  /**
   * Carrega preferências do utilizador
   */
  loadPreferences() {
    const defaults = {
      defaultMode: 'auto',
      voice: {
        enabled: true,
        speed: 1.0,
        pitch: 1.0,
        volume: 0.8,
        language: 'pt-PT'
      },
      autoStart: true,
      minimizeToTray: true,
      hotkey: 'CommandOrControl+Space',
      confirmSensitive: true,
      maxHistoryDays: 30
    };
    
    try {
      if (fs.existsSync(this.preferencesPath)) {
        const saved = fs.readJsonSync(this.preferencesPath);
        return { ...defaults, ...saved };
      }
    } catch (error) {
      console.error('[Memory] Erro ao carregar preferências:', error.message);
    }
    
    return defaults;
  }
  
  /**
   * Guarda preferências
   */
  savePreferences(preferences) {
    this.userPreferences = { ...this.userPreferences, ...preferences };
    try {
      fs.writeJsonSync(this.preferencesPath, this.userPreferences, { spaces: 2 });
    } catch (error) {
      console.error('[Memory] Erro ao guardar preferências:', error.message);
    }
  }
  
  /**
   * Obtém preferências
   */
  getPreferences() {
    return { ...this.userPreferences };
  }
  
  // ═══════════════════════════════════════════════════════════
  // ESTATÍSTICAS
  // ═══════════════════════════════════════════════════════════
  
  /**
   * Estatísticas de uso
   */
  getStats() {
    const totalMessages = Array.from(this.conversations.values())
      .reduce((sum, c) => sum + c.messages.length, 0);
    
    let storageSize = 0;
    try {
      const stats = fs.statSync(this.conversationsPath);
      storageSize = stats.size;
    } catch {}
    
    return {
      totalConversations: this.conversations.size,
      totalMessages,
      storageSize,
      storageSizeFormatted: this.formatBytes(storageSize)
    };
  }
  
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  /**
   * Procura em conversas
   */
  search(query) {
    const results = [];
    const lowerQuery = query.toLowerCase();
    
    for (const [id, conv] of this.conversations) {
      for (const msg of conv.messages) {
        if (msg.content.toLowerCase().includes(lowerQuery)) {
          results.push({
            conversationId: id,
            conversationTitle: conv.title,
            message: msg
          });
        }
      }
    }
    
    return results.slice(0, 20); // Max 20 resultados
  }
  
  /**
   * Exporta todas as conversas
   */
  exportAll() {
    return {
      exportDate: new Date().toISOString(),
      conversations: Array.from(this.conversations.values()),
      preferences: this.userPreferences,
      stats: this.getStats()
    };
  }
  
  /**
   * Importa conversas
   */
  importData(data) {
    if (data.conversations && Array.isArray(data.conversations)) {
      let imported = 0;
      for (const conv of data.conversations) {
        if (!this.conversations.has(conv.id)) {
          this.conversations.set(conv.id, conv);
          imported++;
        }
      }
      this.saveConversations();
      return imported;
    }
    return 0;
  }
}

// Singleton
const conversationStore = new ConversationStore();

module.exports = { ConversationStore, conversationStore };
