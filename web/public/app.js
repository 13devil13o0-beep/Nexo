/**
 * 🚀 NEXO — Interface Única
 *
 * A mesma interface serve o browser e a aplicação de secretária. O Electron
 * carrega esta página do servidor unificado em vez de ter uma cópia própria,
 * e limita-se a acrescentar a janela, o tray e a ponte de permissões.
 *
 * Fora do Electron, window.electronAPI não existe e os controlos de janela
 * desaparecem. Tudo o resto funciona igual.
 *
 * Comunica com o Core via HTTP API e WebSocket.
 * Inclui: voz, sidebar, conversas, agentes, histórico.
 */

/** Estamos dentro do Electron ou num browser normal? */
const IS_ELECTRON = typeof window !== 'undefined' && !!window.electronAPI;

/**
 * Perfil da página, decidido no <head> antes de este ficheiro correr.
 *
 * 'leve' num telemóvel, num ecrã pequeno, com pouca memória ou com poupança de
 * dados ligada. Não é uma interface diferente: é a mesma, sem o que custa caro
 * e pouco acrescenta — realce de código, animações e voz.
 */
const PERFIL = document.documentElement.dataset.perfil === 'leve' ? 'leve' : 'completo';
const LEVE = PERFIL === 'leve';

/** No perfil leve não se arrasta o histórico todo para dentro do ecrã. */
const MAX_MENSAGENS_LEVE = 20;

/**
 * Traz o realce de código, que são ~90 KB entre script e folha de estilo.
 * Só no perfil completo: no leve, o formatMessage já sabe viver sem o hljs e
 * limita-se a mostrar o bloco de código sem cores.
 */
function carregarRealceDeCodigo() {
  if (LEVE || typeof hljs !== 'undefined') return;

  const estilo = document.createElement('link');
  estilo.rel = 'stylesheet';
  estilo.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css';
  document.head.appendChild(estilo);

  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js';
  script.async = true;
  script.onerror = () => console.warn('Realce de código indisponível (sem rede?). O resto funciona à mesma.');
  document.head.appendChild(script);
}

/**
 * Base do servidor. Servida pelo próprio Core, a origem já está correcta,
 * incluindo acesso remoto por IP ou domínio. O localhost é só a rede de
 * segurança para quando a página é aberta a partir do disco (file://).
 */
function apiBase() {
  const origin = window.location.origin;
  if (origin && origin.startsWith('http')) return origin;
  return 'http://localhost:7777';
}

/** Endereço do WebSocket derivado da mesma origem, com ws:// ou wss://. */
function wsBase() {
  const http = apiBase();
  return http.replace(/^http/, 'ws');
}

class MyBotApp {
  constructor() {
    this.apiUrl = apiBase();
    this.wsUrl = wsBase();
    this.ws = null;
    this.currentConversationId = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 15;
    this.recognition = null;
    this.isListening = false;
    this.voiceTranscript = '';  // accumulated voice text across restarts
    this.ttsEnabled = localStorage.getItem('mybot_tts_enabled') === 'true';
    this.sidebarOpen = true;
    this.pendingRequestId = null;
    this.pendingFile = null;    // ficheiro anexado aguardando envio
    
    this.elements = {
      statusDot: document.getElementById('statusDot'),
      statusText: document.getElementById('statusText'),
      messagesArea: document.getElementById('messagesArea'),
      messagesContainer: document.getElementById('messagesContainer'),
      welcomeScreen: document.getElementById('welcomeScreen'),
      messageInput: document.getElementById('messageInput'),
      btnSend: document.getElementById('btnSend'),
      btnVoice: document.getElementById('btnVoice'),
      micIcon: document.getElementById('micIcon'),
      voiceStatus: document.getElementById('voiceStatus'),
      hintText: document.getElementById('hintText'),
      btnTTS: document.getElementById('btnTTS'),
      ttsIcon: document.getElementById('ttsIcon'),
      btnUpload: document.getElementById('btnUpload'),
      fileInput: document.getElementById('fileInput'),
      btnMinimize: document.getElementById('btnMinimize'),
      btnHide: document.getElementById('btnHide'),
      btnNewChat: document.getElementById('btnNewChat'),
      btnNewChatSidebar: document.getElementById('btnNewChatSidebar'),
      btnToggleSidebar: document.getElementById('btnToggleSidebar'),
      sidebar: document.getElementById('sidebar'),
      conversationList: document.getElementById('conversationList'),
      agentList: document.getElementById('agentList'),
      searchConversations: document.getElementById('searchConversations'),
      btnDashboard: document.getElementById('btnDashboard'),
      btnWebUI: document.getElementById('btnWebUI'),
      toastContainer: document.getElementById('toastContainer'),
      // Attachment preview elements
      attachmentPreview: document.getElementById('attachmentPreview'),
      attachmentIcon: document.getElementById('attachmentIcon'),
      attachmentName: document.getElementById('attachmentName'),
      attachmentSize: document.getElementById('attachmentSize'),
      btnRemoveAttachment: document.getElementById('btnRemoveAttachment')
    };
    
    this.init();
  }
  
  async init() {
    console.log('🤖 NEXO Desktop - Inicializando...');
    
    this.applyPlatformChrome();
    this.applyProfileChrome();
    this.checkFirstRun();
    this.setupEventListeners();
    this.setupQuickActions();
    this.setupAutoResize();
    this.setupSpeechRecognition();
    this.setupTTSToggle();
    this.setupElectronEvents();
    this.setupKeyboardShortcuts();
    
    // Conectar ao Core
    await this.connectToCore();
    
    // Carregar dados
    this.loadConversations();
    this.loadAgents();
    
    // Focar no input
    this.elements.messageInput.focus();
    
    console.log('✅ NEXO pronto!');
  }
  
  // ═══════════════════════════════════════════════════════════
  // ADAPTAÇÃO À PLATAFORMA
  // ═══════════════════════════════════════════════════════════

  /**
   * Minimizar e esconder só fazem sentido numa janela nativa. Num browser
   * seriam botões mortos, por isso desaparecem. O atalho de escape para o
   * tray também deixa de se anunciar.
   */
  applyPlatformChrome() {
    // A ocultação vive no CSS (body.is-browser). O atributo hidden não chega,
    // porque .title-btn declara display:flex e ganha ao estilo do agente.
    document.body.classList.add(IS_ELECTRON ? 'is-electron' : 'is-browser');

    // O botao de troca existe nas duas cascas, com o destino de cada uma.
    const troca = this.elements.btnWebUI;
    if (troca) {
      troca.textContent = IS_ELECTRON ? '🌐 Usar no browser' : '🖥️ Usar em janela';
      troca.title = IS_ELECTRON
        ? 'Abrir no browser e passar a arrancar assim'
        : 'Passar a arrancar na janela do NEXO (aplica-se ao próximo arranque)';
    }
  }

  /**
   * O que muda entre o perfil completo e o leve.
   *
   * Nada disto toca no motor: as ferramentas, os agentes e a memória são os
   * mesmos nos dois. Só muda o que a página carrega e desenha.
   */
  applyProfileChrome() {
    document.body.classList.add(LEVE ? 'perfil-leve' : 'perfil-completo');

    if (LEVE) {
      console.log('📱 Perfil leve: sem realce de código, sem animações, sem voz.');
      return;
    }

    carregarRealceDeCodigo();
  }

  // ═══════════════════════════════════════════════════════════
  // PRIMEIRO ACESSO
  // ═══════════════════════════════════════════════════════════

  checkFirstRun() {
    const hasSeenWelcome = localStorage.getItem('mybot_welcome_seen_v2');
    if (!hasSeenWelcome) {
      this.showWelcomeGuide();
      localStorage.setItem('mybot_welcome_seen_v2', 'true');
    }
  }
  
  showWelcomeGuide() {
    const modal = document.createElement('div');
    modal.className = 'welcome-modal';
    modal.innerHTML = `
      <div class="welcome-modal-content">
        <div style="font-size:60px;margin-bottom:12px">🤖</div>
        <h2 style="color:var(--accent);margin-bottom:8px">Bem-vindo ao NEXO!</h2>
        <p style="color:var(--text-secondary);margin-bottom:20px">O teu assistente IA pessoal está pronto!</p>
        
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
          <div style="background:var(--accent-dim);padding:10px;border-radius:10px;font-size:13px">🧠 Respondo a tudo</div>
          <div style="background:var(--accent-dim);padding:10px;border-radius:10px;font-size:13px">📄 Crio PDFs</div>
          <div style="background:var(--accent-dim);padding:10px;border-radius:10px;font-size:13px">💻 Executo código</div>
          <div style="background:var(--accent-dim);padding:10px;border-radius:10px;font-size:13px">🔍 Pesquiso na web</div>
          <div style="background:var(--accent-dim);padding:10px;border-radius:10px;font-size:13px">📁 Gestão ficheiros</div>
          <div style="background:var(--accent-dim);padding:10px;border-radius:10px;font-size:13px">🎤 Entrada por voz</div>
        </div>
        
        <div style="background:rgba(255,165,0,0.15);padding:12px;border-radius:10px;margin-bottom:20px;font-size:12px;color:#ffa500;text-align:left">
          <strong>💡 Dicas Rápidas:</strong><br>
          • <strong>Ctrl+Space</strong> — Abrir/focar janela<br>
          • <strong>Ctrl+M</strong> — Ativar voz<br>
          • <strong>Esc</strong> — Minimizar para tray<br>
          • Diz <code style="background:#0d1117;padding:2px 6px;border-radius:4px">/help</code> para ver comandos
        </div>
        
        <button id="welcomeStartBtn" style="background:var(--accent);color:var(--bg-primary);border:none;padding:14px 36px;border-radius:25px;font-size:15px;font-weight:bold;cursor:pointer">
          🚀 Começar a Usar!
        </button>
      </div>
    `;
    document.body.appendChild(modal);
    
    document.getElementById('welcomeStartBtn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  }
  
  // ═══════════════════════════════════════════════════════════
  // CONEXÃO COM CORE
  // ═══════════════════════════════════════════════════════════
  
  async connectToCore() {
    try {
      const response = await fetch(`${this.apiUrl}/api/status`);
      
      if (response.ok) {
        const data = await response.json();
        this.updateStatus(true, data);
        this.connectWebSocket();
      } else {
        throw new Error('Core não responde');
      }
    } catch (error) {
      console.warn('Core não disponível, tentando reconectar...');
      this.updateStatus(false);
      this.scheduleReconnect();
    }
  }
  
  connectWebSocket() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    
    try {
      this.ws = new WebSocket(`${this.wsUrl}`);
    } catch (e) {
      console.error('Erro ao criar WebSocket:', e);
      return;
    }
    
    this.ws.onopen = () => {
      console.log('✅ WebSocket conectado');
      this.updateStatus(true);
      this.reconnectAttempts = 0;
    };
    
    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleWSMessage(message);
      } catch (e) {
        console.error('Erro a parsear WS:', e);
      }
    };
    
    this.ws.onclose = () => {
      console.warn('WebSocket desconectado');
      this.updateStatus(false);
      this.scheduleReconnect();
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket erro:', error);
    };
  }
  
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.showToast('Não foi possível conectar ao Core. Verifica se está a correr.', 'error');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 15000);
    
    this.elements.statusText.textContent = `A reconectar (${this.reconnectAttempts})...`;
    setTimeout(() => this.connectToCore(), delay);
  }
  
  updateStatus(online, data = null) {
    this.isConnected = online;
    this.elements.statusDot.classList.toggle('online', online);

    // Só /api/status traz o estado da IA. As chamadas do WebSocket vêm sem
    // dados, e antes faziam o indicador cair para aviso sem nada ter mudado.
    if (data?.ai) this.aiAvailable = !!data.ai.available;

    if (online) {
      const aiStatus = this.aiAvailable === false ? '⚠️' : '✅';
      this.elements.statusText.textContent = `Online ${aiStatus}`;
    } else {
      this.elements.statusText.textContent = 'Offline';
    }
  }
  
  handleWSMessage(message) {
    switch (message.type) {
      case 'connected':
        console.log('WS Conectado:', message.data?.message);
        break;
        
      case 'chat_response':
        this.removeTypingIndicator();
        // Limpar placeholder de streaming se existir (para intents não-streaming)
        if (this._streamingDiv) {
          this._streamingDiv.remove();
          this._streamingDiv = null;
          this._streamingText = '';
        }
        const responseText = message.data?.response || message.data?.text || '';
        if (responseText) {
          this.addMessage('bot', responseText);
          
          // TTS se ativado — usar speakableText ou responseText
          const ttsText = message.data?.speakableText || responseText;
          this.speak(ttsText);
        }
        break;
      
      case 'stream_token':
        // Token de streaming — acumular e atualizar placeholder
        if (this._streamingDiv) {
          this._streamingText = (this._streamingText || '') + (message.data?.token || '');
          const content = this._streamingDiv.querySelector('.message-content');
          if (content) {
            content.innerHTML = this.formatMessage(this._streamingText) + '<span class="streaming-cursor">▊</span>';
          }
          this.elements.messagesArea.scrollTop = this.elements.messagesArea.scrollHeight;
        }
        break;
      
      case 'stream_done':
        // Streaming terminado — finalizar mensagem
        if (this._streamingDiv && this._streamingText) {
          const content = this._streamingDiv.querySelector('.message-content');
          if (content) {
            content.innerHTML = this.formatMessage(this._streamingText);
            // Adicionar botões de copiar a blocos de código
            content.querySelectorAll('pre').forEach(pre => {
              const btn = document.createElement('button');
              btn.className = 'code-copy-btn';
              btn.textContent = 'Copiar';
              btn.addEventListener('click', () => {
                const code = pre.querySelector('code')?.textContent || pre.textContent;
                this.copyToClipboard(code);
                btn.textContent = '✅';
                setTimeout(() => { btn.textContent = 'Copiar'; }, 2000);
              });
              pre.style.position = 'relative';
              pre.appendChild(btn);
            });
          }
          this.speak(this._streamingText);
        }
        this._streamingDiv = null;
        this._streamingText = '';
        break;
        
      case 'error':
        this.removeTypingIndicator();
        if (this._streamingDiv) {
          const content = this._streamingDiv.querySelector('.message-content');
          if (content) content.innerHTML = `❌ ${message.data?.message || 'Erro'}`;
          this._streamingDiv = null;
          this._streamingText = '';
        } else {
          this.addMessage('bot', `❌ ${message.data?.message || 'Erro desconhecido'}`);
        }
        break;
        
      case 'pong':
        break;
        
      default:
        console.log('WS mensagem:', message.type, message.data);
    }
  }
  
  // ═══════════════════════════════════════════════════════════
  // EVENT LISTENERS
  // ═══════════════════════════════════════════════════════════
  
  setupEventListeners() {
    // Enviar mensagem
    this.elements.btnSend.addEventListener('click', () => this.sendMessage());
    
    this.elements.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    
    // Voz
    this.elements.btnVoice.addEventListener('click', () => this.toggleVoice());
    
    // TTS toggle
    this.elements.btnTTS.addEventListener('click', () => this.toggleTTS());
    
    // Upload ficheiro
    if (this.elements.btnUpload) {
      this.elements.btnUpload.addEventListener('click', () => {
        this.elements.fileInput?.click();
      });
    }
    if (this.elements.fileInput) {
      this.elements.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
    }
    
    // Remover anexo
    if (this.elements.btnRemoveAttachment) {
      this.elements.btnRemoveAttachment.addEventListener('click', () => this.removeAttachment());
    }
    
    // Title bar
    this.elements.btnMinimize.addEventListener('click', () => {
      if (window.electronAPI) window.electronAPI.minimizeWindow();
    });
    
    this.elements.btnHide.addEventListener('click', () => {
      if (window.electronAPI) window.electronAPI.hideWindow();
    });
    
    // Nova conversa
    this.elements.btnNewChat.addEventListener('click', () => this.startNewConversation());
    this.elements.btnNewChatSidebar.addEventListener('click', () => this.startNewConversation());
    
    // Sidebar toggle
    this.elements.btnToggleSidebar.addEventListener('click', () => this.toggleSidebar());
    
    // Pesquisa conversas
    this.elements.searchConversations.addEventListener('input', (e) => {
      this.filterConversations(e.target.value);
    });
    
    // Sidebar footer buttons
    //
    // O painel é uma página do próprio NEXO, servida pelo mesmo motor. Navega-se
    // para lá dentro da janela. Antes ia por shell.openExternal, que no Electron
    // atirava o browser do sistema para cima do utilizador — e quando o browser
    // não vinha ao de cima, o botão parecia simplesmente não fazer nada.
    this.elements.btnDashboard.addEventListener('click', () => {
      this.abrirPagina('/dashboard');
    });

    // Trocar entre a janela própria e o browser. Nunca os dois ao mesmo tempo.
    this.elements.btnWebUI.addEventListener('click', () => this.trocarInterface());
  }

  /**
   * Alterna entre a janela de secretária e o browser, e GUARDA a escolha.
   *
   * A escolha fica nas definições, por isso os arranques seguintes já abrem
   * onde preferes — não é só para esta vez. É a diferença entre um atalho e
   * uma preferência.
   *
   * Da janela para o browser a troca é imediata: abre-se o browser e esconde-se
   * a janela para a bandeja. Ao contrário não dá para ser instantâneo — uma
   * página não pode lançar uma aplicação de secretária — por isso aplica-se ao
   * próximo arranque, e diz-se isso em vez de fingir que aconteceu.
   */
  async trocarInterface() {
    const paraBrowser = IS_ELECTRON;
    const preferida = paraBrowser ? 'browser' : 'janela';

    try {
      await fetch(`${this.apiUrl}/api/dispositivo/modo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interfacePreferida: preferida })
      });
    } catch (e) {
      this.showToast('Não consegui guardar a preferência.', 'error');
      return;
    }

    if (paraBrowser) {
      this.openExternal(this.apiUrl);
      // A janela some para a bandeja em vez de fechar: fechá-la levaria o
      // motor com ela, e a página que acabámos de abrir ficava sem servidor.
      setTimeout(() => window.electronAPI?.hideWindow(), 600);
    } else {
      this.showToast('✅ Da próxima vez o NEXO abre na janela própria.', 'success');
    }
  }

  /**
   * Navega para outra página do NEXO, na mesma janela.
   * Serve /dashboard, /setup e /sponsor — tudo servido pelo mesmo motor.
   */
  abrirPagina(caminho) {
    window.location.href = caminho.startsWith('http') ? caminho : `${this.apiUrl}${caminho}`;
  }

  /** Sai para fora do NEXO: browser do sistema no Electron, separador novo no browser. */
  openExternal(url) {
    if (window.electronAPI) {
      window.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }
  
  setupQuickActions() {
    // Capability cards
    document.querySelectorAll('.capability-card').forEach(card => {
      card.addEventListener('click', () => {
        const action = card.dataset.action;
        if (action) {
          this.elements.messageInput.value = action;
          this.sendMessage();
        }
      });
    });
    
    // Quick chips
    document.querySelectorAll('.quick-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const action = chip.dataset.action;
        if (action) {
          this.elements.messageInput.value = action;
          this.sendMessage();
        }
      });
    });
  }
  
  setupAutoResize() {
    const textarea = this.elements.messageInput;
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    });
  }
  
  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+M para voz
      if (e.ctrlKey && e.key === 'm') {
        e.preventDefault();
        this.toggleVoice();
      }
      
      // Ctrl+T para TTS
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault();
        this.toggleTTS();
      }
      
      // Esc para minimizar
      if (e.key === 'Escape') {
        if (window.electronAPI) window.electronAPI.hideWindow();
      }
      
      // Ctrl+N nova conversa
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        this.startNewConversation();
      }
      
      // Ctrl+B toggle sidebar
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        this.toggleSidebar();
      }
      
      // Ctrl+U upload ficheiro
      if (e.ctrlKey && e.key === 'u') {
        e.preventDefault();
        this.elements.fileInput?.click();
      }
    });
  }
  
  setupElectronEvents() {
    if (!window.electronAPI) return;
    
    window.electronAPI.onCoreStatus((data) => {
      this.updateStatus(data.online);
    });
    
    window.electronAPI.onNewConversation(() => {
      this.startNewConversation();
    });
  }
  
  // ═══════════════════════════════════════════════════════════
  // SIDEBAR
  // ═══════════════════════════════════════════════════════════
  
  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
    this.elements.sidebar.classList.toggle('collapsed', !this.sidebarOpen);
  }
  
  async loadConversations() {
    try {
      const response = await fetch(`${this.apiUrl}/api/conversations`);
      if (!response.ok) return;
      
      const conversations = await response.json();
      this.renderConversations(conversations);
    } catch (e) {
      console.warn('Erro ao carregar conversas:', e);
    }
  }
  
  renderConversations(conversations) {
    if (!conversations || conversations.length === 0) {
      this.elements.conversationList.innerHTML = `
        <div class="empty-conversations">
          <p>💬 Nenhuma conversa ainda</p>
          <p style="margin-top:4px;font-size:11px">Começa a escrever!</p>
        </div>
      `;
      return;
    }
    
    this.elements.conversationList.innerHTML = conversations.map(conv => `
      <div class="conv-item ${conv.id === this.currentConversationId ? 'active' : ''}" data-id="${conv.id}">
        <span class="conv-icon">💬</span>
        <div class="conv-info">
          <div class="conv-title">${this.escapeHtml(conv.title || 'Nova Conversa')}</div>
          <div class="conv-time">${this.formatTime(conv.updatedAt)} • ${conv.messageCount || 0} msgs</div>
        </div>
        <button class="conv-delete" data-id="${conv.id}" title="Eliminar">🗑️</button>
      </div>
    `).join('');
    
    // Event listeners para conversas
    this.elements.conversationList.querySelectorAll('.conv-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('conv-delete')) return;
        this.loadConversation(item.dataset.id);
      });
    });
    
    // Event listeners para delete
    this.elements.conversationList.querySelectorAll('.conv-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteConversation(btn.dataset.id);
      });
    });
  }
  
  async loadConversation(id) {
    try {
      const response = await fetch(`${this.apiUrl}/api/conversations/${id}`);
      if (!response.ok) return;
      
      const conversation = await response.json();
      this.currentConversationId = id;
      
      // Limpar e mostrar mensagens
      this.elements.messagesContainer.innerHTML = '';
      this.elements.welcomeScreen.classList.add('hidden');
      
      if (conversation.messages) {
        // No perfil leve mostram-se só as últimas: desenhar uma conversa de
        // duzentas mensagens num telemóvel fraco trava-o durante segundos.
        const mensagens = LEVE
          ? conversation.messages.slice(-MAX_MENSAGENS_LEVE)
          : conversation.messages;

        if (LEVE && conversation.messages.length > mensagens.length) {
          const omitidas = conversation.messages.length - mensagens.length;
          this.addMessage('bot', `_(modo leve: ${omitidas} mensagens anteriores não foram carregadas)_`, false);
        }

        mensagens.forEach(msg => {
          const role = msg.role === 'user' ? 'user' : 'bot';
          this.addMessage(role, msg.content, false);
        });
      }
      
      // Atualizar sidebar
      this.loadConversations();
    } catch (e) {
      console.error('Erro ao carregar conversa:', e);
    }
  }
  
  async deleteConversation(id) {
    try {
      await fetch(`${this.apiUrl}/api/conversations/${id}`, { method: 'DELETE' });
      
      if (id === this.currentConversationId) {
        this.startNewConversation();
      }
      
      this.loadConversations();
      this.showToast('Conversa eliminada', 'info');
    } catch (e) {
      console.error('Erro ao eliminar conversa:', e);
    }
  }
  
  filterConversations(query) {
    const items = this.elements.conversationList.querySelectorAll('.conv-item');
    const q = query.toLowerCase();
    
    items.forEach(item => {
      const title = item.querySelector('.conv-title').textContent.toLowerCase();
      item.style.display = title.includes(q) ? 'flex' : 'none';
    });
  }
  
  // ═══════════════════════════════════════════════════════════
  // AGENTES
  // ═══════════════════════════════════════════════════════════
  
  async loadAgents() {
    try {
      const response = await fetch(`${this.apiUrl}/api/agents`);
      if (!response.ok) return;
      
      const agents = await response.json();
      this.renderAgents(agents);
    } catch (e) {
      // Fallback estático
      this.renderAgents([
        { icon: '🧠', name: 'IA Chat', status: 'online' },
        { icon: '📄', name: 'PDF', status: 'online' },
        { icon: '📁', name: 'Ficheiros', status: 'online' },
        { icon: '⚡', name: 'Código', status: 'online' },
        { icon: '🔍', name: 'Web Search', status: 'online' },
        { icon: '🖥️', name: 'Sistema', status: 'online' },
        { icon: '🏗️', name: 'Projetos', status: 'online' }
      ]);
    }
  }
  
  renderAgents(agents) {
    this.elements.agentList.innerHTML = agents.map(agent => `
      <div class="agent-item">
        <span class="agent-icon">${agent.icon}</span>
        <span class="agent-name">${agent.name}</span>
        <span class="agent-status ${agent.status === 'online' ? '' : 'offline'}"></span>
      </div>
    `).join('');
  }
  
  // ═══════════════════════════════════════════════════════════
  // UPLOAD DE FICHEIROS (ANEXAR + ENVIAR MANUAL)
  // ═══════════════════════════════════════════════════════════
  
  /**
   * Retorna ícone apropriado para o tipo de ficheiro
   */
  getFileIcon(filename) {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const icons = {
      // Documentos
      pdf: '📕', doc: '📘', docx: '📘', txt: '📄', md: '📝',
      // Código
      js: '🟨', ts: '🔷', py: '🐍', html: '🌐', css: '🎨', json: '📋',
      // Imagens
      jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🎨',
      // Áudio
      mp3: '🎵', wav: '🎵', ogg: '🎵',
      // Vídeo
      mp4: '🎬', webm: '🎬', mov: '🎬', avi: '🎬',
      // Dados
      csv: '📊', xml: '📰', yaml: '⚙️', yml: '⚙️'
    };
    return icons[ext] || '📎';
  }
  
  /**
   * Formata tamanho de ficheiro
   */
  formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  
  /**
   * Anexa ficheiro para preview (não envia automaticamente)
   */
  async handleFileUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    
    // Reset input para permitir re-upload do mesmo ficheiro
    event.target.value = '';
    
    // Tamanho máximo 5MB
    if (file.size > 5 * 1024 * 1024) {
      this.showToast('Ficheiro demasiado grande (máx 5MB)', 'error');
      return;
    }
    
    // Guardar ficheiro pendente
    this.pendingFile = file;
    
    // Mostrar preview do anexo
    this.showAttachmentPreview(file);
    
    // Focar no input para o utilizador poder adicionar mensagem
    this.elements.messageInput.focus();
    this.showToast(`📎 ${file.name} anexado — clica Enviar para processar`, 'info');
  }
  
  /**
   * Mostra preview do ficheiro anexado
   */
  showAttachmentPreview(file) {
    if (!this.elements.attachmentPreview) return;
    
    this.elements.attachmentIcon.textContent = this.getFileIcon(file.name);
    this.elements.attachmentName.textContent = file.name;
    this.elements.attachmentSize.textContent = this.formatFileSize(file.size);
    this.elements.attachmentPreview.style.display = 'flex';
    
    // Adicionar classe de destaque ao botão de upload
    this.elements.btnUpload?.classList.add('has-attachment');
  }
  
  /**
   * Remove anexo pendente
   */
  removeAttachment() {
    this.pendingFile = null;
    
    if (this.elements.attachmentPreview) {
      this.elements.attachmentPreview.style.display = 'none';
    }
    
    this.elements.btnUpload?.classList.remove('has-attachment');
    this.showToast('Anexo removido', 'info');
  }
  
  /**
   * Envia ficheiro anexado para o servidor
   */
  async uploadPendingFile() {
    if (!this.pendingFile) return null;
    
    const file = this.pendingFile;
    
    try {
      // Converter para base64
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      
      const response = await fetch(`${this.apiUrl}/api/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          data: base64,
          indexForRAG: true
        })
      });
      
      const result = await response.json();
      
      // Limpar anexo pendente
      this.pendingFile = null;
      if (this.elements.attachmentPreview) {
        this.elements.attachmentPreview.style.display = 'none';
      }
      this.elements.btnUpload?.classList.remove('has-attachment');
      
      return { success: result.success, file, result };
    } catch (err) {
      return { success: false, file, error: err.message };
    }
  }
  
  // ═══════════════════════════════════════════════════════════
  // MENSAGENS
  // ═══════════════════════════════════════════════════════════
  
  async sendMessage() {
    const text = this.elements.messageInput.value.trim();
    const hasFile = !!this.pendingFile;
    
    // Se não há texto nem ficheiro, não fazer nada
    if (!text && !hasFile) return;
    
    // Limpar input
    this.elements.messageInput.value = '';
    this.elements.messageInput.style.height = 'auto';
    
    // Esconder welcome screen
    this.elements.welcomeScreen.classList.add('hidden');
    
    // Se há ficheiro pendente, processar primeiro
    if (hasFile) {
      const fileName = this.pendingFile.name;
      const fileSize = this.formatFileSize(this.pendingFile.size);
      const fileIcon = this.getFileIcon(fileName);
      
      // Mostrar mensagem do utilizador com anexo + texto
      const userMsg = text 
        ? `${fileIcon} **Ficheiro:** ${fileName} (${fileSize})\n\n${text}`
        : `${fileIcon} **Ficheiro:** ${fileName} (${fileSize})`;
      this.addMessage('user', userMsg);
      
      this.showTypingIndicator();
      
      // Enviar ficheiro
      const uploadResult = await this.uploadPendingFile();
      
      if (uploadResult?.success) {
        let msg = `✅ **${uploadResult.file.name}** carregado com sucesso`;
        if (uploadResult.result?.rag) {
          msg += `\n\n📚 Indexado para contexto — ${uploadResult.result.rag.totalChunks} chunks`;
        }
        
        // Se tinha texto, enviar como pergunta sobre o ficheiro
        if (text) {
          msg += `\n\n---\n\n🔄 A processar a tua pergunta...`;
          this.removeTypingIndicator();
          this.addMessage('bot', msg);
          
          // Agora enviar a mensagem de texto (que pode usar o contexto do ficheiro)
          await this.sendTextMessage(text);
        } else {
          this.removeTypingIndicator();
          this.addMessage('bot', msg);
          this.showToast(`${uploadResult.file.name} carregado!`, 'success');
        }
      } else {
        this.removeTypingIndicator();
        this.addMessage('bot', `❌ Erro ao enviar ficheiro: ${uploadResult?.error || 'Erro desconhecido'}`);
      }
      
      return;
    }
    
    // Se só há texto (sem ficheiro)
    await this.sendTextMessage(text);
  }
  
  /**
   * Envia apenas mensagem de texto (sem ficheiro)
   */
  async sendTextMessage(text) {
    // Adicionar mensagem do utilizador (se ainda não foi adicionada)
    if (!this.pendingFile) {
      this.addMessage('user', text);
    }
    
    // Decidir se usa streaming (chat simples) ou rota normal (comandos)
    const isCommand = /^(executa|run:|listar|cria um pdf|status|ajuda|help)/i.test(text);
    
    // Enviar para o Core
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        const requestId = Date.now().toString();
        this.pendingRequestId = requestId;
        
        if (!isCommand) {
          // Streaming via WebSocket — criar placeholder para tokens
          this._streamingDiv = this.createStreamingMessage();
          this._streamingText = '';
          
          this.ws.send(JSON.stringify({
            type: 'chat_stream',
            requestId,
            data: {
              message: text,
              conversationId: this.currentConversationId
            }
          }));
        } else {
          // Comando normal (não-streamable)
          this.showTypingIndicator();
          
          this.ws.send(JSON.stringify({
            type: 'chat',
            requestId,
            data: {
              message: text,
              conversationId: this.currentConversationId
            }
          }));
        }
      } else {
        // Via HTTP fallback
        const response = await fetch(`${this.apiUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            conversationId: this.currentConversationId
          })
        });
        
        const data = await response.json();
        this.removeTypingIndicator();
        
        if (data.success) {
          this.addMessage('bot', data.response);
          this.currentConversationId = data.conversationId;
          
          // TTS se ativado
          const ttsText = data.speakableText || data.response;
          this.speak(ttsText);
        } else {
          this.addMessage('bot', `❌ ${data.error}`);
        }
      }
      
      // Atualizar lista de conversas
      setTimeout(() => this.loadConversations(), 1000);
      
    } catch (error) {
      this.removeTypingIndicator();
      this.addMessage('bot', `❌ Erro de conexão: ${error.message}\n\nVerifica se o Core está a correr (npm run core)`);
    }
  }
  
  addMessage(role, content, scroll = true) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    const time = new Date().toLocaleTimeString('pt-PT', {
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const avatar = role === 'user' ? '👤' : '🤖';
    const sender = role === 'user' ? 'Tu' : 'NEXO';
    
    messageDiv.innerHTML = `
      <div class="message-header">
        <span class="message-avatar">${avatar}</span>
        <span class="message-sender">${sender}</span>
      </div>
      <div class="message-content">${this.formatMessage(content)}</div>
      <div class="message-footer">
        <span class="message-time">${time}</span>
        <div class="message-actions">
          <button class="msg-action-btn copy-btn" title="Copiar">📋</button>
        </div>
      </div>
    `;
    
    // Copy button
    messageDiv.querySelector('.copy-btn').addEventListener('click', () => {
      this.copyToClipboard(content);
    });
    
    this.elements.messagesContainer.appendChild(messageDiv);
    
    if (scroll) {
      this.elements.messagesArea.scrollTop = this.elements.messagesArea.scrollHeight;
    }
  }
  
  formatMessage(text) {
    if (!text) return '';
    
    // Se marked.js está disponível, usar markdown completo com syntax highlighting
    if (typeof marked !== 'undefined') {
      try {
        marked.setOptions({
          highlight: function(code, lang) {
            if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
              return hljs.highlight(code, { language: lang }).value;
            }
            if (typeof hljs !== 'undefined') {
              return hljs.highlightAuto(code).value;
            }
            return code;
          },
          breaks: true,
          gfm: true
        });
        return marked.parse(text);
      } catch (e) {
        console.warn('Marked error, fallback:', e);
      }
    }
    
    // Fallback: markdown manual
    let formatted = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    formatted = formatted.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code class="lang-${lang || 'text'}">${code.trim()}</code></pre>`;
    });
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    formatted = formatted.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank">$1</a>');
    formatted = formatted.replace(/\n/g, '<br>');
    
    return formatted;
  }
  
  showTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'message bot typing';
    indicator.id = 'typingIndicator';
    indicator.innerHTML = `
      <div class="message-header">
        <span class="message-avatar">🤖</span>
        <span class="message-sender">NEXO</span>
      </div>
      <div class="message-content">
        <div class="typing-indicator">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    `;
    
    this.elements.messagesContainer.appendChild(indicator);
    this.elements.messagesArea.scrollTop = this.elements.messagesArea.scrollHeight;
  }
  
  removeTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) indicator.remove();
  }
  
  /**
   * Cria mensagem placeholder para streaming de tokens
   */
  createStreamingMessage() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message bot streaming';
    
    const time = new Date().toLocaleTimeString('pt-PT', {
      hour: '2-digit',
      minute: '2-digit'
    });
    
    messageDiv.innerHTML = `
      <div class="message-header">
        <span class="message-avatar">🤖</span>
        <span class="message-sender">NEXO</span>
      </div>
      <div class="message-content"><span class="streaming-cursor">▊</span></div>
      <div class="message-footer">
        <span class="message-time">${time}</span>
        <div class="message-actions">
          <button class="msg-action-btn copy-btn" title="Copiar">📋</button>
        </div>
      </div>
    `;
    
    messageDiv.querySelector('.copy-btn').addEventListener('click', () => {
      this.copyToClipboard(this._streamingText || '');
    });
    
    this.elements.messagesContainer.appendChild(messageDiv);
    this.elements.messagesArea.scrollTop = this.elements.messagesArea.scrollHeight;
    
    return messageDiv;
  }

  startNewConversation() {
    this.currentConversationId = null;
    this.elements.messagesContainer.innerHTML = '';
    this.elements.welcomeScreen.classList.remove('hidden');
    this.elements.messageInput.focus();
    this.loadConversations();
  }
  
  // ═══════════════════════════════════════════════════════════
  // RECONHECIMENTO DE VOZ
  // ═══════════════════════════════════════════════════════════
  
  setupSpeechRecognition() {
    // No perfil leve a voz não arranca: o reconhecimento contínuo é dos maiores
    // gastos de bateria e processador que a página tem, e quem está num
    // telemóvel fraco não a pediu.
    if (LEVE) {
      this.elements.btnVoice.classList.add('disabled');
      this.elements.btnVoice.title = 'Voz desligada no modo leve';
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.log('Speech Recognition não suportado');
      this.elements.btnVoice.classList.add('disabled');
      this.elements.btnVoice.title = 'Voz não suportada neste ambiente';
      return;
    }
    
    this.recognition = new SpeechRecognition();
    this.recognition.lang = 'pt-PT';
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;
    
    this.recognition.onstart = () => {
      console.log('[Voice] Recognition started');
      this.isListening = true;
      this.elements.btnVoice.classList.add('listening');
      this.elements.micIcon.textContent = '🔴';
      this.elements.voiceStatus.textContent = '🎤 A ouvir... fala agora (clica 🔴 para parar)';
      this.elements.hintText.style.display = 'none';
    };
    
    this.recognition.onresult = (event) => {
      let sessionFinal = '';
      let interim = '';
      
      // Only process new results from resultIndex
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          sessionFinal += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      
      // Accumulate final transcript across recognition restarts
      if (sessionFinal) {
        this.voiceTranscript += sessionFinal;
      }
      
      // Show accumulated + interim in textarea
      const displayText = this.voiceTranscript + interim;
      this.elements.messageInput.value = displayText;
      this.elements.voiceStatus.textContent = displayText
        ? `🎤 ${displayText}`
        : '🎤 A ouvir... fala agora';
      
      // Auto resize textarea
      this.elements.messageInput.style.height = 'auto';
      this.elements.messageInput.style.height = Math.min(this.elements.messageInput.scrollHeight, 120) + 'px';
    };
    
    this.recognition.onend = () => {
      console.log('[Voice] Recognition ended, isListening:', this.isListening);
      
      // If still supposed to be listening, auto-restart (recognition ends naturally after silence)
      if (this.isListening) {
        this._restartRecognition();
        return;
      }
      
      // User explicitly stopped — update UI but do NOT auto-send
      this.elements.btnVoice.classList.remove('listening');
      this.elements.micIcon.textContent = '🎤';
      this.elements.hintText.style.display = '';
      
      const text = this.elements.messageInput.value.trim();
      if (text) {
        this.elements.voiceStatus.textContent = '✅ Texto capturado — clica ➤ ou pressiona Enter para enviar';
        setTimeout(() => {
          if (this.elements.voiceStatus.textContent.startsWith('✅')) {
            this.elements.voiceStatus.textContent = '';
          }
        }, 5000);
      } else {
        this.elements.voiceStatus.textContent = '';
      }
    };
    
    this.recognition.onerror = (event) => {
      console.warn('[Voice] Error:', event.error);
      
      // no-speech and aborted are not fatal — recognition will restart via onend
      if (event.error === 'no-speech') {
        this.elements.voiceStatus.textContent = '🎤 Não ouvi nada... continua a falar';
        return;
      }
      if (event.error === 'aborted') {
        return; // onend will handle restart
      }
      
      // network error — likely CSP or offline, try restart
      if (event.error === 'network') {
        console.warn('[Voice] Network error — speech servers may be unreachable');
        this.elements.voiceStatus.textContent = '🎤 Reconectando ao serviço de voz...';
        return; // onend will try restart
      }
      
      // Fatal error — stop completely
      this.isListening = false;
      this.elements.btnVoice.classList.remove('listening');
      this.elements.micIcon.textContent = '🎤';
      this.elements.hintText.style.display = '';
      
      if (event.error === 'not-allowed') {
        this.elements.voiceStatus.textContent = '❌ Microfone bloqueado — permite o acesso nas definições';
      } else {
        this.elements.voiceStatus.textContent = `❌ Erro: ${event.error}`;
      }
      
      setTimeout(() => { this.elements.voiceStatus.textContent = ''; }, 4000);
    };
  }
  
  /**
   * Restart recognition with retry logic for robustness
   */
  _restartRecognition(attempt = 0) {
    if (!this.isListening) return;
    
    const delay = attempt === 0 ? 100 : 500;
    setTimeout(() => {
      if (!this.isListening) return;
      try {
        this.recognition.start();
        console.log('[Voice] Restarted successfully');
      } catch (e) {
        console.warn('[Voice] Restart attempt', attempt + 1, 'failed:', e.message);
        if (attempt < 3) {
          this._restartRecognition(attempt + 1);
        } else {
          // Give up after 3 retries
          this.stopListening();
          this.elements.voiceStatus.textContent = '❌ Microfone parou — clica 🎤 para tentar de novo';
          setTimeout(() => { this.elements.voiceStatus.textContent = ''; }, 4000);
        }
      }
    }, delay);
  }
  
  stopListening() {
    this.isListening = false;
    try { this.recognition.stop(); } catch (e) { /* ignore */ }
    this.elements.btnVoice.classList.remove('listening');
    this.elements.micIcon.textContent = '🎤';
    this.elements.hintText.style.display = '';
  }
  
  async toggleVoice() {
    if (!this.recognition) {
      this.showToast('Reconhecimento de voz não suportado neste ambiente', 'error');
      return;
    }
    
    if (this.isListening) {
      // Stop listening — text stays in input for user to review/send
      this.isListening = false;
      try { this.recognition.stop(); } catch (e) { /* ignore */ }
    } else {
      // Start listening — clear previous transcript
      this.voiceTranscript = '';
      this.elements.messageInput.value = '';
      this.elements.voiceStatus.textContent = 'A pedir acesso ao microfone...';
      
      // No Electron, pedir permissão explícita antes de usar SpeechRecognition
      try {
        // Solicitar acesso ao microfone explicitamente
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          await navigator.mediaDevices.getUserMedia({ audio: true });
          console.log('[Voice] Microphone permission granted');
        }
      } catch (permErr) {
        console.warn('[Voice] Microphone permission error:', permErr);
        this.elements.voiceStatus.textContent = '❌ Microfone bloqueado — permite o acesso nas definições';
        setTimeout(() => { this.elements.voiceStatus.textContent = ''; }, 4000);
        return;
      }
      
      try {
        this.recognition.start();
      } catch (e) {
        console.error('[Voice] Failed to start:', e);
        this.elements.voiceStatus.textContent = '❌ Não foi possível iniciar o microfone';
        setTimeout(() => { this.elements.voiceStatus.textContent = ''; }, 3000);
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════
  // TEXT-TO-SPEECH
  // ═══════════════════════════════════════════════════════════
  
  setupTTSToggle() {
    // Atualizar UI com estado guardado
    this.updateTTSButton();
  }
  
  toggleTTS() {
    this.ttsEnabled = !this.ttsEnabled;
    localStorage.setItem('mybot_tts_enabled', this.ttsEnabled.toString());
    this.updateTTSButton();
    
    if (this.ttsEnabled) {
      this.showToast('🔊 Voz de resposta ativada', 'success');
    } else {
      window.speechSynthesis?.cancel();
      this.showToast('🔇 Voz de resposta desativada', 'info');
    }
  }
  
  updateTTSButton() {
    if (this.ttsEnabled) {
      this.elements.ttsIcon.textContent = '🔊';
      this.elements.btnTTS.classList.add('active');
      this.elements.btnTTS.title = 'Desativar voz de resposta (Ctrl+T)';
    } else {
      this.elements.ttsIcon.textContent = '🔇';
      this.elements.btnTTS.classList.remove('active');
      this.elements.btnTTS.title = 'Ativar voz de resposta (Ctrl+T)';
    }
  }
  
  cleanTextForTTS(text) {
    if (!text) return '';
    
    let cleaned = text;
    
    // Remover emojis
    cleaned = cleaned.replace(/[\u{1F600}-\u{1F64F}]/gu, '');
    cleaned = cleaned.replace(/[\u{1F300}-\u{1F5FF}]/gu, '');
    cleaned = cleaned.replace(/[\u{1F680}-\u{1F6FF}]/gu, '');
    cleaned = cleaned.replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '');
    cleaned = cleaned.replace(/[\u{2600}-\u{26FF}]/gu, '');
    cleaned = cleaned.replace(/[\u{2700}-\u{27BF}]/gu, '');
    cleaned = cleaned.replace(/[\u{FE00}-\u{FE0F}]/gu, '');
    cleaned = cleaned.replace(/[\u{1F900}-\u{1F9FF}]/gu, '');
    cleaned = cleaned.replace(/[\u{200D}\u{20E3}\u{FE0F}]/gu, '');
    
    // Remover blocos de código inteiros
    cleaned = cleaned.replace(/```[\s\S]*?```/g, ' bloco de código ');
    
    // Remover código inline
    cleaned = cleaned.replace(/`[^`]+`/g, '');
    
    // Remover caminhos de ficheiros (ex: /home/user/file.txt, C:\Users\..., ./folder/file.js)
    cleaned = cleaned.replace(/(?:[A-Z]:)?(?:[\\\/][\w.\-@]+)+\.\w+/gi, '');
    cleaned = cleaned.replace(/(?:[A-Z]:)?(?:[\\\/][\w.\-@]+){2,}/gi, '');
    
    // Remover nomes de ficheiros com extensões comuns
    cleaned = cleaned.replace(/\b[\w\-]+\.(?:js|ts|py|html|css|json|pdf|txt|md|jpg|png|gif|svg|xml|yaml|yml|log|csv|sh|bat|exe|zip|tar|gz|doc|docx|xls|xlsx|mp3|mp4|wav)\b/gi, '');
    
    // Remover URLs
    cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, '');
    
    // Remover formatação markdown
    cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
    cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
    cleaned = cleaned.replace(/#{1,6}\s/g, '');
    cleaned = cleaned.replace(/^\s*[-*]\s/gm, '');
    cleaned = cleaned.replace(/^\s*\d+\.\s/gm, '');
    
    // Remover linhas que são só labels técnicos (ex: "📁 Localização:", "📊 Tamanho:")
    cleaned = cleaned.replace(/^.*(?:Localização|Tamanho|Formato|Extensão|Caminho|Path|Size|Location)\s*:.*$/gim, '');
    
    // Remover sequências de números longos (IDs, hashes, tamanhos em bytes)
    cleaned = cleaned.replace(/\b\d{5,}\b/g, '');
    
    // Remover KB, MB, GB com números
    cleaned = cleaned.replace(/\b\d+(?:\.\d+)?\s*(?:KB|MB|GB|TB|bytes)\b/gi, '');
    
    // Limpar espaços múltiplos e linhas em branco
    cleaned = cleaned.replace(/\n\s*\n/g, '\n');
    cleaned = cleaned.replace(/[ \t]+/g, ' ');
    cleaned = cleaned.trim();
    
    return cleaned;
  }
  
  speak(text) {
    if (!('speechSynthesis' in window)) return;
    if (!this.ttsEnabled) return;
    
    // Limpar texto para TTS
    const cleanText = this.cleanTextForTTS(text);
    if (!cleanText) return;
    
    // Cancelar qualquer fala anterior
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'pt-PT';
    utterance.rate = 1;
    utterance.pitch = 1;
    
    // Tentar usar voz portuguesa
    const voices = window.speechSynthesis.getVoices();
    const ptVoice = voices.find(v => v.lang.startsWith('pt'));
    if (ptVoice) utterance.voice = ptVoice;
    
    window.speechSynthesis.speak(utterance);
  }
  
  // ═══════════════════════════════════════════════════════════
  // UTILITÁRIOS
  // ═══════════════════════════════════════════════════════════
  
  async copyToClipboard(text) {
    try {
      if (window.electronAPI) {
        await window.electronAPI.copyToClipboard(text);
      } else {
        await navigator.clipboard.writeText(text);
      }
      this.showToast('📋 Copiado!', 'success');
    } catch (e) {
      console.error('Erro ao copiar:', e);
    }
  }
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    }
    
    return date.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
  }
  
  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    this.elements.toastContainer.appendChild(toast);
    
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

// ═══════════════════════════════════════════════════════════
// INICIAR APP
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  window.mybot = new MyBotApp();
});
