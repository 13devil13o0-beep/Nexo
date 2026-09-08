/**
 * 🧠 NEXO - Decision Engine
 * Decide se resposta deve ser falada, escrita ou ambos
 * Detecta ações sensíveis que requerem confirmação
 */

class DecisionEngine {
  constructor() {
    // Limiares para decisão
    this.MAX_SPEAK_LENGTH = 300;
    this.MAX_SPEAK_WORDS = 50;
    
    // Indicadores de código
    this.CODE_INDICATORS = [
      '```', '`', 'function', 'class', 'const ', 'let ', 'var ',
      'import ', 'export ', 'require(', 'module.exports', '=>'
    ];
    
    // Padrões
    this.URL_PATTERN = /https?:\/\/[^\s]+/g;
    this.EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    
    // Dados sensíveis
    this.SENSITIVE_PATTERNS = [
      /password\s*[:=]\s*\S+/i,
      /token\s*[:=]\s*\S+/i,
      /api[_-]?key\s*[:=]\s*\S+/i,
      /secret\s*[:=]\s*\S+/i,
      /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Cartões
      /\b\d{3}-\d{2}-\d{4}\b/, // SSN (US)
      /\b\d{9}\b/ // NIF (PT - 9 dígitos)
    ];
  }
  
  // ═══════════════════════════════════════════════════════════
  // DECISÃO DE OUTPUT
  // ═══════════════════════════════════════════════════════════
  
  /**
   * Decide o modo de output baseado no conteúdo e preferências
   * @param {string} content - Conteúdo da resposta
   * @param {string} userPreference - 'auto', 'text', 'speak', 'both'
   * @returns {{ mode: string, shouldSpeak: boolean, reason: string }}
   */
  decideOutputMode(content, userPreference = 'auto') {
    // Se usuário forçou modo específico
    if (userPreference !== 'auto') {
      return {
        mode: userPreference,
        shouldSpeak: userPreference === 'speak' || userPreference === 'both',
        reason: 'Modo forçado pelo utilizador'
      };
    }
    
    // Análise de conteúdo
    const analysis = this.analyzeContent(content);
    
    // Regras de decisão (em ordem de prioridade)
    
    if (analysis.hasCode) {
      return {
        mode: 'text',
        shouldSpeak: false,
        reason: 'Contém código - melhor visual'
      };
    }
    
    if (analysis.hasSensitiveData) {
      return {
        mode: 'text',
        shouldSpeak: false,
        reason: 'Contém dados sensíveis - privacidade'
      };
    }
    
    if (analysis.hasURLs) {
      return {
        mode: 'text',
        shouldSpeak: false,
        reason: 'Contém links - precisa de cópia'
      };
    }
    
    if (analysis.hasEmails) {
      return {
        mode: 'text',
        shouldSpeak: false,
        reason: 'Contém emails - precisa de cópia'
      };
    }
    
    if (analysis.hasLists) {
      return {
        mode: 'both',
        shouldSpeak: true,
        reason: 'Lista de itens - texto + resumo voz'
      };
    }
    
    if (analysis.wordCount > this.MAX_SPEAK_WORDS) {
      return {
        mode: 'text',
        shouldSpeak: false,
        reason: 'Resposta muito longa para fala'
      };
    }
    
    if (analysis.length > this.MAX_SPEAK_LENGTH) {
      return {
        mode: 'both',
        shouldSpeak: true,
        reason: 'Resposta longa mas falável - ambos os modos'
      };
    }
    
    // Resposta curta e simples - fala é ideal
    if (analysis.wordCount <= 15 && !analysis.hasNumbers) {
      return {
        mode: 'speak',
        shouldSpeak: true,
        reason: 'Resposta curta e direta - ideal para voz'
      };
    }
    
    // Padrão: ambos para melhor UX
    return {
      mode: 'both',
      shouldSpeak: true,
      reason: 'Resposta balanceada - voz + texto'
    };
  }
  
  // ═══════════════════════════════════════════════════════════
  // ANÁLISE DE CONTEÚDO
  // ═══════════════════════════════════════════════════════════
  
  /**
   * Analisa conteúdo da mensagem
   */
  analyzeContent(content) {
    const length = content.length;
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
    const lowerContent = content.toLowerCase();
    
    // Detecta código
    const hasCode = this.CODE_INDICATORS.some(indicator =>
      lowerContent.includes(indicator.toLowerCase())
    ) || /[{};]/.test(content) || /^\s{2,}/m.test(content);
    
    // Detecta URLs
    const hasURLs = this.URL_PATTERN.test(content);
    
    // Detecta emails
    const hasEmails = this.EMAIL_PATTERN.test(content);
    
    // Detecta dados sensíveis
    const hasSensitiveData = this.SENSITIVE_PATTERNS.some(pattern =>
      pattern.test(content)
    );
    
    // Detecta números significativos (3+ dígitos)
    const hasNumbers = /\d{3,}/.test(content);
    
    // Detecta listas
    const hasLists = /^\s*[-*•\d+\.]\s/m.test(content) || content.includes('\n- ');
    
    return {
      length,
      wordCount,
      hasCode,
      hasURLs,
      hasEmails,
      hasSensitiveData,
      hasNumbers,
      hasLists
    };
  }
  
  // ═══════════════════════════════════════════════════════════
  // TEXTO FALÁVEL
  // ═══════════════════════════════════════════════════════════
  
  /**
   * Extrai a parte "falável" do texto (remove código, URLs, etc)
   */
  extractSpeakableText(content) {
    return content
      // Remove blocos de código
      .replace(/```[\s\S]*?```/g, ' código omitido ')
      // Remove código inline
      .replace(/`[^`]+`/g, ' código ')
      // Simplifica URLs
      .replace(this.URL_PATTERN, 'link')
      // Simplifica emails
      .replace(this.EMAIL_PATTERN, 'email')
      // Remove caracteres especiais
      .replace(/[*_#]/g, '')
      // Remove espaços extras
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  /**
   * Prepara texto para síntese de voz (TTS)
   */
  prepareForTTS(content, maxLength = 500) {
    let text = this.extractSpeakableText(content);
    
    // Truncar se muito longo
    if (text.length > maxLength) {
      text = text.substring(0, maxLength);
      // Encontra o último ponto ou espaço
      const lastPeriod = text.lastIndexOf('.');
      const lastSpace = text.lastIndexOf(' ');
      const cutPoint = lastPeriod > maxLength - 100 ? lastPeriod : lastSpace;
      text = text.substring(0, cutPoint) + '...';
    }
    
    return text;
  }
  
  // ═══════════════════════════════════════════════════════════
  // AÇÕES SENSÍVEIS
  // ═══════════════════════════════════════════════════════════
  
  /**
   * Verifica se ação requer confirmação do utilizador
   * @returns {{ required: boolean, reason?: string, riskLevel?: string }}
   */
  requiresConfirmation(content) {
    const patterns = [
      // Alto risco
      { pattern: /pagamento|payment|pagar|comprar|buy|purchase/i, reason: 'Ação de pagamento', risk: 'high' },
      { pattern: /transferir|transfer.*dinheiro|enviar.*€|\$\d+/i, reason: 'Transferência monetária', risk: 'high' },
      { pattern: /eliminar|apagar|delete|remover.*tudo/i, reason: 'Eliminação de dados', risk: 'high' },
      { pattern: /formatar|format.*disco|limpar.*sistema/i, reason: 'Operação destrutiva', risk: 'high' },
      
      // Médio risco
      { pattern: /instalar|install|download.*exe/i, reason: 'Instalação de software', risk: 'medium' },
      { pattern: /executar|run|execute.*script/i, reason: 'Execução de script', risk: 'medium' },
      { pattern: /exportar|export.*dados|backup/i, reason: 'Exportação de dados', risk: 'medium' },
      { pattern: /mover|move.*ficheiro/i, reason: 'Mover ficheiros', risk: 'medium' },
      
      // Baixo risco (só alerta)
      { pattern: /token|api.*key|password|senha|credencial/i, reason: 'Manipulação de credenciais', risk: 'low' },
      { pattern: /enviar.*email|send.*mail/i, reason: 'Envio de email', risk: 'low' }
    ];
    
    for (const { pattern, reason, risk } of patterns) {
      if (pattern.test(content)) {
        return {
          required: risk === 'high' || risk === 'medium',
          reason,
          riskLevel: risk
        };
      }
    }
    
    return { required: false };
  }
  
  /**
   * Classifica intenção do utilizador
   */
  classifyIntent(content) {
    const lowerContent = content.toLowerCase();
    
    // Saudações
    if (/^(olá|oi|bom dia|boa tarde|boa noite|hey|hi|hello)/i.test(lowerContent)) {
      return { type: 'greeting', confidence: 0.9 };
    }
    
    // Perguntas
    if (/^(o que|como|quando|onde|porquê|qual|quem|quantos?)/i.test(lowerContent) ||
        lowerContent.includes('?')) {
      return { type: 'question', confidence: 0.8 };
    }
    
    // Comandos
    if (/^(cria|criar|faz|fazer|abre|abrir|lista|listar|mostra|mostrar|executa)/i.test(lowerContent)) {
      return { type: 'command', confidence: 0.85 };
    }
    
    // Código
    if (/^(código|code|programar?|debug|corrigir.*código)/i.test(lowerContent) ||
        content.includes('```')) {
      return { type: 'code', confidence: 0.9 };
    }
    
    // Ficheiros
    if (/ficheiro|arquivo|file|pasta|folder|document/i.test(lowerContent)) {
      return { type: 'file_operation', confidence: 0.7 };
    }
    
    // PDF
    if (/pdf|documento|relatório|report/i.test(lowerContent)) {
      return { type: 'document', confidence: 0.7 };
    }
    
    // Conversação genérica
    return { type: 'conversation', confidence: 0.5 };
  }
  
  /**
   * Determina urgência da mensagem
   */
  detectUrgency(content) {
    const lowerContent = content.toLowerCase();
    
    if (/urgente|asap|já|agora|imediatamente|rápido/i.test(lowerContent)) {
      return 'high';
    }
    
    if (/quando puderes|se possível|eventualmente/i.test(lowerContent)) {
      return 'low';
    }
    
    return 'normal';
  }
}

// Singleton
const decisionEngine = new DecisionEngine();

module.exports = { DecisionEngine, decisionEngine };
