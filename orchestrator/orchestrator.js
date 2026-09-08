/**
 * 🧠 Orchestrator - Cérebro do NEXO
 * 
 * Coordena todos os agentes e processa pedidos
 */

const os = require('os');
const intentParser = require('./intentParser');
const pluginLoader = require('./pluginLoader');
const agentChaining = require('./agentChaining');
const security = require('./security');
const aiAgent = require('../agents/aiAgent');
const pdfAgent = require('../agents/pdfAgent');
const fileAgent = require('../agents/fileAgent');
const codeRunner = require('../agents/codeRunner');
const webSearchAgent = require('../agents/webSearchAgent');
const systemAgent = require('../agents/systemAgent');
const inputAgent = require('../agents/inputAgent');
const projectBuilder = require('../agents/projectBuilder');
const remoteAgent = require('../agents/remoteAgent');
const automationAgent = require('../agents/automationAgent');
const skillAgent = require('../agents/skillAgent');
const visionAgent = require('../agents/visionAgent');
const alertAgent = require('../agents/alertAgent');
const workflowAgent = require('../agents/workflowAgent');
const clipboardAgent = require('../agents/clipboardAgent');
const customProvider = require('../agents/customProvider');
const smartMemory = require('../memory/smartMemory');
const { conversationStore } = require('../memory/conversationStore');
const { decisionEngine } = require('../memory/decisionEngine');
const i18n = require('../i18n/i18n');
const toolLoop = require('./toolLoop');
const tools = require('./tools');
const permissions = require('./permissions');

// Carregar plugins ao iniciar
pluginLoader.loadAll();

// Inicializar novos agentes
smartMemory.init();
skillAgent.init();
workflowAgent.init();
clipboardAgent.init(false); // sem auto-monitor por defeito
customProvider.init();
i18n.init();
alertAgent.init((notification) => {
  console.log(`🔔 Alerta: ${notification.message}`);
});

// Inicializar automação com referência ao orchestrator (lazy)
setTimeout(() => {
  automationAgent.init(module.exports);
}, 100);

/**
 * Processa prompt do utilizador
 */
async function handlePrompt(prompt, context = {}) {
  const userId = security.getUserId(context);
  const startTime = Date.now();
  const t = (key, vars) => i18n.t(key, vars, userId);
  
  try {
    // Obter ou criar conversa
    const conversation = conversationStore.getOrCreateConversation(userId);
    
    // Guardar mensagem do utilizador
    conversationStore.addMessage(conversation.id, {
      role: 'user',
      content: prompt
    });
    
    // Verificar se ação requer confirmação
    const confirmation = decisionEngine.requiresConfirmation(prompt);
    if (confirmation.required && !context.confirmed) {
      return t('general.confirmation_required', { reason: confirmation.reason });
    }
    
    // Log da ação
    security.logAction(userId, 'prompt-received', { 
      prompt: prompt.substring(0, 100),
      source: context.source || 'unknown',
      conversationId: conversation.id
    });
    
    // Analisar intenção
    // Smart intent parsing: regex primeiro, LLM fallback se ambíguo
    const intentData = await intentParser.parseIntentSmart(prompt);
    const classification = decisionEngine.classifyIntent(prompt);
    security.logAction(userId, 'intent-parsed', { 
      intent: intentData.intent,
      method: intentData.method || 'regex',
      classification: classification.type
    });
    
    let response;

    // Verificar plugins primeiro (prioridade a extensões do utilizador)
    const pluginMatch = pluginLoader.matchIntent(prompt);
    if (pluginMatch) {
      console.log(`🔌 Plugin match: ${pluginMatch.plugin} → ${pluginMatch.intent}`);
      const pluginResult = await pluginLoader.executeHandler(pluginMatch, { userId, conversation });
      response = pluginResult.response || pluginResult.error || t('general.plugin_no_response');
      
      // Guardar e retornar
      conversationStore.addMessage(conversation.id, { role: 'assistant', content: response });
      const elapsed = Date.now() - startTime;
      security.logAction(userId, 'response-sent', { intent: pluginMatch.intent, elapsed, plugin: pluginMatch.plugin });
      const prefs = conversationStore.getPreferences();
      const outputDecision = decisionEngine.decideOutputMode(response, prefs.defaultMode);
      return { text: response, outputMode: outputDecision.mode, shouldSpeak: outputDecision.shouldSpeak, speakableText: outputDecision.speakableText || response.replace(/[*_#`~\[\]]/g, ''), elapsed, timestamp: new Date().toISOString(), conversationId: conversation.id };
    }

    // ═══════════════════════════════════════════════════════════
    // Agent Chaining — Detectar e executar multi-passo
    // ═══════════════════════════════════════════════════════════
    if (agentChaining.isMultiStep(prompt)) {
      console.log('🔗 Multi-step detectado — a decompor...');
      const steps = await agentChaining.decompose(prompt);
      
      if (steps && steps.length > 1) {
        security.logAction(userId, 'chain-started', { steps: steps.length });

        // Mostrar plano ao utilizador
        const planPreview = agentChaining.formatChainPlan(steps);
        console.log(planPreview);

        // Executar chain com fail-fast activado
        const chainResult = await agentChaining.executeChain(
          steps,
          async (agent, input) => executeChainStep(agent, input, userId, conversation),
          (step, total, action) => {
            console.log(`  ⏳ [${step}/${total}] ${action}`);
          },
          { failFast: true }
        );

        response = agentChaining.formatChainResult(chainResult);
        security.logAction(userId, 'chain-completed', { 
          steps: chainResult.totalSteps, 
          completed: chainResult.completedSteps 
        });

        // Guardar e retornar
        conversationStore.addMessage(conversation.id, { role: 'assistant', content: response });
        const elapsed = Date.now() - startTime;
        const prefs = conversationStore.getPreferences();
        const outputDecision = decisionEngine.decideOutputMode(response, prefs.defaultMode);
        return { text: response, outputMode: outputDecision.mode, shouldSpeak: false, conversationId: conversation.id, elapsed, chain: true };
      }
    }
    
    // ═══════════════════════════════════════════════════════
    // Smart Memory — extrair factos da conversa
    // ═══════════════════════════════════════════════════════
    try {
      const extracted = smartMemory.extractFromConversation(prompt, userId);
      if (extracted.length > 0) {
        console.log(`🧠 Smart Memory: +${extracted.length} facto(s) aprendido(s)`);
      }
    } catch (e) { /* silencioso */ }

    // ═══════════════════════════════════════════════════════
    // Skill Agent — verificar comandos personalizados
    // ═══════════════════════════════════════════════════════
    const skillMatch = skillAgent.matchSkill(prompt, userId);
    if (skillMatch && intentData.intent === 'chat') {
      console.log(`🎓 Skill match: "${skillMatch.name}"`);
      const skillResult = await skillAgent.executeSkill(skillMatch, prompt);
      if (skillResult.hasPrompts) {
        // executar cada passo via orchestrator
        const results = [];
        for (const step of skillResult.steps) {
          const stepResult = await handlePrompt(step, context);
          results.push(typeof stepResult === 'string' ? stepResult : stepResult.text);
        }
        response = `🎓 **Skill "${skillMatch.name}" executada:**\n\n${results.join('\n\n---\n\n')}`;
      } else {
        response = skillResult.output || '✅ Skill executada.';
      }
      
      conversationStore.addMessage(conversation.id, { role: 'assistant', content: response });
      const elapsed = Date.now() - startTime;
      const prefs = conversationStore.getPreferences();
      const outputDecision = decisionEngine.decideOutputMode(response, prefs.defaultMode);
      return { text: response, outputMode: outputDecision.mode, shouldSpeak: false, conversationId: conversation.id, elapsed };
    }

    switch (intentData.intent) {
      case 'create_pdf':
        const topic = intentData.entities.topic || prompt.replace(/cri(a|ar)\s+pdf\s*(sobre|de|com)?\s*/i, '');
        const pdfPath = await pdfAgent.createPDF(topic);
        response = t('pdf.created', { path: pdfPath });
        break;
        
      case 'create_note':
        const content = intentData.entities.content || prompt;
        const title = content.split(' ').slice(0, 5).join(' ');
        const result = fileAgent.createNote(title, content);
        response = result.success 
          ? t('note.created', { path: result.path })
          : result.error;
        break;
        
      case 'run_code':
        const code = codeRunner.extractCode(prompt);
        if (!code) {
          response = t('code.extract_error');
        } else {
          const execResult = codeRunner.runCode(code, userId);
          response = execResult.success
            ? execResult.output
            : execResult.error;
          response += '\n\n' + t('code.remaining', { remaining: execResult.remaining, max: codeRunner.MAX_EXEC_PER_MIN });
        }
        break;
        
      case 'list_files':
        response = fileAgent.listAllFiles();
        break;
        
      case 'system_info':
        response = getSystemInfo(userId);
        break;
        
      case 'agents_list':
        response = getAgentsList(userId);
        break;
        
      case 'help':
        response = getHelpMessage(userId);
        break;
        
      case 'current_time':
        response = getCurrentTime(userId);
        break;
        
      case 'current_date':
        response = getCurrentDate(userId);
        break;
        
      case 'web_search':
        // Pesquisa web
        const searchQuery = intentData.entities.query || prompt;
        console.log(`🔍 Pesquisa web: "${searchQuery}"`);
        
        // Fazer pesquisa
        const searchResults = await webSearchAgent.search(searchQuery);
        const formattedResults = webSearchAgent.formatResults(searchResults);
        
        // Se tiver resultados úteis, usar IA para resumir
        if (searchResults.results?.length > 0 || searchResults.abstract || searchResults.answer) {
          const searchContext = `Resultados da pesquisa web para "${searchQuery}":\n\n${formattedResults}`;
          const aiSummary = await aiAgent.askAI(
            t('search.ai_prompt', { prompt }) + '\n\n' + searchContext,
            [],
            { maxTokens: 1024, userId }
          );
          const sourcesLines = formattedResults.split('\n').filter(l => l.includes('🔗')).slice(0, 3).join('\n');
          response = t('search.results_header', { query: searchQuery }) + '\n\n' + aiSummary + '\n\n---\n' + t('search.sources') + '\n' + sourcesLines;
        } else {
          response = formattedResults;
        }
        break;
      
      // ========== SYSTEM CONTROLLER - Level 1 ==========
      case 'system_create_file':
        const createPath = intentData.entities.path;
        const createContent = intentData.entities.content || '';
        if (!createPath) {
          response = t('system.create_file.missing_path');
        } else {
          const createResult = await systemAgent.createFile(createPath, createContent);
          response = createResult.success 
            ? t('system.create_file.success', { path: createResult.path, size: createResult.size })
            : t('system.create_file.error', { error: createResult.error });
        }
        break;
        
      case 'system_read_file':
        const readPath = intentData.entities.path;
        if (!readPath) {
          response = t('system.read_file.missing_path');
        } else {
          const readResult = await systemAgent.readFile(readPath);
          response = readResult.success 
            ? t('system.read_file.success', { path: readPath }) + `\n\`\`\`\n${readResult.content.slice(0, 2000)}${readResult.content.length > 2000 ? '\n' + t('general.truncated') : ''}\n\`\`\``
            : t('system.read_file.error', { error: readResult.error });
        }
        break;
        
      case 'system_edit_file':
        const editPath = intentData.entities.path;
        const editContent = intentData.entities.content;
        if (!editPath || !editContent) {
          response = t('system.edit_file.missing_params');
        } else {
          const editResult = await systemAgent.editFile(editPath, editContent, intentData.entities.mode || 'replace');
          response = editResult.success 
            ? t('system.edit_file.success', { path: editResult.path, size: editResult.size })
            : t('system.edit_file.error', { error: editResult.error });
        }
        break;
        
      case 'system_list_dir':
        const listPath = intentData.entities.path || '.';
        const listResult = await systemAgent.listDirectory(listPath);
        if (listResult.success) {
          const items = listResult.items.slice(0, 20);
          const itemsList = items.map(i => `${i.isDirectory ? '📁' : '📄'} ${i.name}${i.isDirectory ? '/' : ''}`).join('\n');
          response = t('system.list_dir.success', { path: listResult.path }) + `\n${itemsList}${listResult.items.length > 20 ? '\n' + t('system.list_dir.more_items', { count: listResult.items.length - 20 }) : ''}`;
        } else {
          response = t('system.list_dir.error', { error: listResult.error });
        }
        break;
        
      case 'system_open_folder':
        const openPath = intentData.entities.path || '.';
        const openResult = await systemAgent.openFolder(openPath);
        response = openResult.success 
          ? t('system.open_folder.success', { path: openResult.path })
          : t('system.open_folder.error', { error: openResult.error });
        break;
        
      case 'system_execute':
        const execCmd = intentData.entities.command;
        if (!execCmd) {
          response = t('system.execute.missing_command');
        } else {
          console.log(`⚙️ Executando comando: ${execCmd}`);
          const execResult = await systemAgent.executeCommand(execCmd);
          if (execResult.success) {
            const output = execResult.stdout || execResult.stderr || t('general.no_output');
            response = t('system.execute.success', { command: execCmd }) + `\n\`\`\`\n${output.slice(0, 1500)}${output.length > 1500 ? '\n' + t('general.truncated') : ''}\n\`\`\``;
          } else {
            response = t('system.execute.error', { error: execResult.error });
          }
        }
        break;
        
      case 'system_run_script':
        const scriptPath = intentData.entities.path;
        if (!scriptPath) {
          response = t('system.run_script.missing_path');
        } else {
          console.log(`🚀 Executando script: ${scriptPath}`);
          const scriptResult = await systemAgent.runScript(scriptPath);
          if (scriptResult.success) {
            const output = scriptResult.stdout || scriptResult.stderr || t('general.no_output');
            response = t('system.run_script.success', { path: scriptPath }) + `\n\`\`\`\n${output.slice(0, 1500)}${output.length > 1500 ? '\n' + t('general.truncated') : ''}\n\`\`\``;
          } else {
            response = t('system.run_script.error', { error: scriptResult.error });
          }
        }
        break;
      
      // ========== LEVEL 2 - APLICAÇÕES, PROCESSOS, JANELAS ==========
      
      case 'system_open_app':
        const appName = intentData.entities.app;
        if (!appName) {
          response = t('system.open_app.missing');
        } else {
          console.log(`🚀 Abrindo aplicação: ${appName}`);
          const appResult = await systemAgent.openApp(appName);
          response = appResult.success 
            ? t('system.open_app.success', { name: appName })
            : `❌ ${appResult.error}`;
        }
        break;
        
      case 'system_open_url':
        const urlToOpen = intentData.entities.url;
        if (!urlToOpen) {
          response = t('system.open_url.missing');
        } else {
          console.log(`🌐 Abrindo URL: ${urlToOpen}`);
          const urlResult = await systemAgent.openUrl(urlToOpen);
          response = urlResult.success 
            ? t('system.open_url.success', { url: urlResult.url })
            : `❌ ${urlResult.error}`;
        }
        break;
        
      case 'system_list_processes':
        const processFilter = intentData.entities.filter || '';
        console.log(`📋 Listando processos${processFilter ? ` (filtro: ${processFilter})` : ''}`);
        const procResult = await systemAgent.listProcesses(processFilter);
        if (procResult.success) {
          const procList = procResult.processes.slice(0, 15).map(p => 
            `• **${p.name}** (PID: ${p.pid}) - ${p.memory}`
          ).join('\n');
          response = t('system.list_processes.header', { count: procResult.count }) + `\n\n${procList}${procResult.count > 15 ? '\n\n' + t('system.list_processes.more', { count: procResult.count - 15 }) : ''}`;
        } else {
          response = `❌ ${procResult.error}`;
        }
        break;
        
      case 'system_kill_process':
        const procIdentifier = intentData.entities.identifier;
        if (!procIdentifier) {
          response = t('system.kill_process.missing');
        } else {
          console.log(`💀 Terminando processo: ${procIdentifier}`);
          const killResult = await systemAgent.killProcess(procIdentifier);
          response = killResult.success 
            ? t('system.kill_process.success', { identifier: procIdentifier })
            : `❌ ${killResult.error}`;
        }
        break;
        
      case 'system_list_windows':
        console.log(`🪟 Listando janelas abertas`);
        const winResult = await systemAgent.listWindows();
        if (winResult.success) {
          const winList = winResult.windows.slice(0, 15).map(w => 
            `• **${w.title}** (${w.process})`
          ).join('\n');
          response = t('system.list_windows.header', { count: winResult.count }) + `\n\n${winList}`;
        } else {
          response = `❌ ${winResult.error}`;
        }
        break;
        
      case 'system_focus_window':
        const windowToFocus = intentData.entities.window;
        if (!windowToFocus) {
          response = t('system.focus_window.missing');
        } else {
          console.log(`🎯 Focando janela: ${windowToFocus}`);
          const focusResult = await systemAgent.focusWindow(windowToFocus);
          response = focusResult.success 
            ? t('system.focus_window.success', { window: focusResult.window })
            : `❌ ${focusResult.error}`;
        }
        break;
        
      case 'system_window_action':
        const actionWindow = intentData.entities.window;
        const windowAction = intentData.entities.action || 'minimize';
        if (!actionWindow) {
          response = t('system.window_action.missing');
        } else {
          console.log(`🪟 ${windowAction} janela: ${actionWindow}`);
          const actionResult = await systemAgent.windowAction(actionWindow, windowAction);
          const actionLabel = t(`system.window_action.${windowAction}`) || windowAction;
          response = actionResult.success 
            ? t('system.window_action.success', { action: actionLabel, window: actionResult.window })
            : `❌ ${actionResult.error}`;
        }
        break;
      
      // ========== LEVEL 3 - INPUT: TECLADO, RATO, SCREENSHOTS ==========
      
      case 'input_type':
        const textToType = intentData.entities.text;
        if (!textToType) {
          response = t('input.type.missing');
        } else {
          console.log(`⌨️ Digitando: ${textToType.substring(0, 30)}...`);
          const typeResult = await inputAgent.typeText(textToType);
          response = typeResult.success 
            ? t('input.type.success', { length: textToType.length, window: typeResult.window })
            : `❌ ${typeResult.error}`;
        }
        break;
        
      case 'input_shortcut':
        const shortcutKeys = intentData.entities.keys;
        if (!shortcutKeys) {
          response = t('input.shortcut.missing');
        } else {
          console.log(`⚡ Atalho: ${shortcutKeys}`);
          const shortcutResult = await inputAgent.pressShortcut(shortcutKeys);
          response = shortcutResult.success 
            ? t('input.shortcut.success', { keys: shortcutKeys })
            : `❌ ${shortcutResult.error}`;
        }
        break;
        
      case 'input_key':
        const keyToPress = intentData.entities.key;
        const keyTimes = intentData.entities.times || 1;
        if (!keyToPress) {
          response = t('input.key.missing');
        } else {
          console.log(`⌨️ Tecla: ${keyToPress} x${keyTimes}`);
          const keyResult = await inputAgent.pressKey(keyToPress, keyTimes);
          response = keyResult.success 
            ? t('input.key.success', { key: keyToPress, times: keyTimes })
            : `❌ ${keyResult.error}`;
        }
        break;
        
      case 'input_click':
        const clickX = intentData.entities.x;
        const clickY = intentData.entities.y;
        const clickButton = intentData.entities.button || 'left';
        const isDouble = intentData.entities.double;
        
        console.log(`🖱️ Click ${isDouble ? 'duplo' : clickButton}${clickX ? ` em (${clickX}, ${clickY})` : ''}`);
        
        const clickResult = isDouble 
          ? await inputAgent.doubleClick(clickX, clickY)
          : await inputAgent.mouseClick(clickButton, clickX, clickY);
        
        response = clickResult.success 
          ? t('input.click.success', { type: isDouble ? t('input.click.double') : clickButton, position: clickX ? `(${clickX}, ${clickY})` : '' })
          : `❌ ${clickResult.error}`;
        break;
        
      case 'input_scroll':
        const scrollDir = intentData.entities.direction || 'down';
        const scrollAmount = intentData.entities.amount || 3;
        
        console.log(`📜 Scroll ${scrollDir} x${scrollAmount}`);
        const scrollResult = await inputAgent.mouseScroll(scrollDir, scrollAmount);
        
        response = scrollResult.success 
          ? t('input.scroll.success', { direction: scrollDir === 'up' ? t('input.scroll.up') : t('input.scroll.down'), amount: scrollAmount })
          : `❌ ${scrollResult.error}`;
        break;
        
      case 'input_move':
        const moveX = intentData.entities.x;
        const moveY = intentData.entities.y;
        
        if (!moveX || !moveY) {
          response = t('input.move.missing');
        } else {
          console.log(`➡️ Movendo cursor para (${moveX}, ${moveY})`);
          const moveResult = await inputAgent.moveMouse(moveX, moveY);
          response = moveResult.success 
            ? t('input.move.success', { x: moveX, y: moveY })
            : `❌ ${moveResult.error}`;
        }
        break;
        
      case 'input_screenshot':
        console.log(`📸 Capturando screenshot`);
        const ssResult = await inputAgent.takeScreenshot();
        response = ssResult.success 
          ? t('input.screenshot.success', { filename: ssResult.filename, path: ssResult.path })
          : `❌ ${ssResult.error}`;
        break;
        
      case 'input_copy':
        const copyText = intentData.entities.text;
        if (!copyText) {
          response = t('input.copy.missing');
        } else {
          console.log(`📋 Copiando para clipboard`);
          const copyResult = await inputAgent.copyToClipboard(copyText);
          response = copyResult.success 
            ? t('input.copy.success', { length: copyText.length })
            : `❌ ${copyResult.error}`;
        }
        break;
        
      case 'input_paste':
        console.log(`📄 Colando do clipboard`);
        const pasteResult = await inputAgent.pasteFromClipboard();
        response = pasteResult.success 
          ? t('input.paste.success')
          : `❌ ${pasteResult.error}`;
        break;
        
      case 'input_get_position':
        const posResult = await inputAgent.getMousePosition();
        response = posResult.success 
          ? t('input.get_position.success', { x: posResult.x, y: posResult.y })
          : `❌ ${posResult.error}`;
        break;

      // ========== PROJECT BUILDER ==========
      case 'project_blueprint': {
        const bpDesc = intentData.entities.description || prompt;
        console.log(`📐 Pedido de blueprint: "${bpDesc}"`);

        const bpResult = await projectBuilder.generateBlueprint(bpDesc);
        if (!bpResult.success) {
          response = bpResult.error;
        } else {
          // Guardar descrição na conversa para possível "criar projeto" posterior
          conversation._blueprintDescription = bpDesc;
          response = bpResult.summary;
        }
        break;
      }

      case 'project_create':
        const projectDesc = intentData.entities.description || prompt;
        console.log(`🏗️ Pedido de projeto: "${projectDesc}"`);

        // Planificar primeiro
        const planResult = await projectBuilder.planProject(projectDesc);
        if (!planResult.success) {
          response = planResult.error;
        } else {
          // Guardar plano na conversa para confirmação futura
          conversation._pendingPlan = planResult.plan;
          response = planResult.summary;
        }
        break;

      case 'project_list':
        const projects = projectBuilder.listProjects();
        if (projects.length === 0) {
          response = t('project.list_empty');
        } else {
          response = t('project.list_header', { count: projects.length }) + '\n\n';
          projects.forEach(p => {
            response += `📁 **${p.name}** — ${p.description || 'N/A'}\n`;
            response += `   📄 ${p.files} ficheiros | 📅 ${p.created.toLocaleDateString()}\n\n`;
          });
        }
        break;

      // ========== REMOTE AGENT - SSH ==========
      
      case 'remote_list_machines':
        const machinesResult = remoteAgent.listMachines();
        response = machinesResult.formatted;
        break;

      case 'remote_add_machine':
        const addAlias = intentData.entities.alias;
        const addHost = intentData.entities.host;
        const addUser = intentData.entities.username;
        if (!addAlias || !addHost) {
          response = t('remote.add_machine_missing');
        } else {
          const addResult = remoteAgent.addMachine(addAlias, {
            host: addHost,
            username: addUser || 'root'
          });
          response = addResult.success ? addResult.message : addResult.error;
        }
        break;

      case 'remote_remove_machine':
        const removeAlias = intentData.entities.alias;
        if (!removeAlias) {
          response = t('remote.remove_machine_missing');
        } else {
          const removeResult = remoteAgent.removeMachine(removeAlias);
          response = removeResult.success ? removeResult.message : removeResult.error;
        }
        break;

      case 'remote_execute':
        const remoteAlias = intentData.entities.alias;
        const remoteCmd = intentData.entities.command;
        if (!remoteAlias || !remoteCmd) {
          response = t('remote.execute_missing');
        } else {
          console.log(`📡 Executando em ${remoteAlias}: ${remoteCmd}`);
          const remoteResult = await remoteAgent.executeRemote(remoteAlias, remoteCmd);
          response = remoteAgent.formatRemoteResult(remoteResult);
        }
        break;

      case 'remote_status':
        const statusAlias = intentData.entities.alias;
        const remoteStatus = remoteAgent.getStatus();
        if (statusAlias) {
          const machines = remoteAgent.loadMachines();
          const machine = machines[statusAlias];
          if (machine) {
            response = t('remote.status_info', { alias: statusAlias, host: machine.host, port: machine.port, username: machine.username, os: machine.os, lastConnected: machine.lastConnected || t('remote.status_never') });
          } else {
            response = t('remote.status_not_found', { alias: statusAlias });
          }
        } else {
          response = t('remote.status_header', { ssh: remoteStatus.sshModule, count: remoteStatus.machinesCount });
        }
        break;
      
      // ═══════════════════════════════════════════════════
      // RAG - Retrieval Augmented Generation
      // ═══════════════════════════════════════════════════
      
      case 'rag_index': {
        const ragEngine = require('./ragEngine');
        const indexDir = (intentData.entities && intentData.entities.directory) || path.join(__dirname, '..', 'Documentos');
        const result = await ragEngine.indexDirectory(indexDir);
        const stats = ragEngine.getStats();
        response = t('rag.index_success', { indexed: result.indexed, skipped: result.skipped, chunks: stats.totalChunks, sources: stats.totalSources, vocabulary: stats.vocabularySize });
        if (result.errors.length > 0) {
          response += '\n\n' + t('rag.index_errors', { count: result.errors.length });
        }
        break;
      }

      case 'rag_search': {
        const ragEngine = require('./ragEngine');
        const searchResults = await ragEngine.search((intentData.entities && intentData.entities.query) || prompt, { topK: 5 });
        if (searchResults.length === 0) {
          response = t('rag.search_empty');
        } else {
          response = t('rag.search_header', { count: searchResults.length }) + '\n\n';
          for (const r of searchResults) {
            const basename = require('path').basename(r.source);
            response += `📄 **${basename}** (${(r.score * 100).toFixed(0)}%)\n`;
            response += `> ${r.text.substring(0, 200)}${r.text.length > 200 ? '...' : ''}\n\n`;
          }
        }
        break;
      }

      case 'rag_stats': {
        const ragEngine = require('./ragEngine');
        await ragEngine.init();
        const stats = ragEngine.getStats();
        response = t('rag.stats', { chunks: stats.totalChunks, sources: stats.totalSources, docs: stats.totalDocs, vocabulary: stats.vocabularySize });
        if (stats.sources.length > 0) {
          response += `\n\n📋 ${stats.sources.join(', ')}`;
        } else {
          response += '\n' + t('rag.stats_empty_hint');
        }
        break;
      }

      case 'file_upload':
        response = t('rag.file_upload');
        break;

      // ═══════════════════════════════════════════════════════
      // AUTOMATION AGENT — Tarefas Agendadas
      // ═══════════════════════════════════════════════════════
      
      case 'schedule_task': {
        const taskResult = automationAgent.createTask(prompt, userId);
        if (taskResult.success) {
          response = t('automation.task_created', {
            name: taskResult.task.name,
            type: taskResult.task.schedule.type,
            description: taskResult.task.schedule.description || '',
            next: new Date(taskResult.task.nextRun).toLocaleString()
          });
        } else {
          response = `❌ ${taskResult.error}`;
        }
        break;
      }

      case 'list_tasks': {
        // listTasks devolve texto já formatado, não uma lista. Tratá-lo como
        // array rebentava com "tasks.forEach is not a function".
        response = automationAgent.listTasks(userId);
        break;
      }

      case 'delete_task': {
        const taskId = intentData.entities.taskId || intentData.entities.name;
        if (!taskId) {
          response = t('automation.delete_missing');
        } else {
          const delResult = automationAgent.deleteTask(taskId, userId);
          response = delResult.success ? t('automation.delete_success', { name: delResult.name }) : `❌ ${delResult.error}`;
        }
        break;
      }

      case 'task_history': {
        const history = automationAgent.getHistory(userId);
        if (history.length === 0) {
          response = t('automation.history_empty');
        } else {
          response = t('automation.history_header', { count: Math.min(history.length, 10) }) + '\n\n';
          history.slice(-10).reverse().forEach(h => {
            const icon = h.success ? '✅' : '❌';
            response += `${icon} **${h.taskName}** — ${new Date(h.executedAt).toLocaleString()}\n`;
          });
        }
        break;
      }

      // ═══════════════════════════════════════════════════════
      // SMART MEMORY — Memória Inteligente
      // ═══════════════════════════════════════════════════════
      
      case 'remember': {
        const memResult = smartMemory.remember(prompt, userId);
        // remember devolve { success, message }, não { fact }. Ler .fact.content
        // rebentava com "Cannot read properties of undefined".
        response = memResult.success
          ? memResult.message
          : `❌ ${memResult.error || 'não consegui memorizar isso'}`;
        break;
      }

      case 'recall': {
        const query = intentData.entities.query || prompt;
        const memories = smartMemory.recall(query, userId);
        if (memories.length === 0) {
          response = t('memory.recall_empty');
        } else {
          response = t('memory.recall_header', { count: memories.length }) + '\n\n';
          memories.forEach((m, i) => {
            response += `${i + 1}. ${m.content}\n   📂 ${m.category} | 📅 ${new Date(m.createdAt).toLocaleDateString()}\n\n`;
          });
        }
        break;
      }

      case 'forget': {
        const forgetQuery = intentData.entities.query || prompt;
        const forgetResult = smartMemory.forget(forgetQuery, userId);
        response = forgetResult.success
          ? t('memory.forget_success', { count: forgetResult.removed })
          : `❌ ${forgetResult.error}`;
        break;
      }

      case 'memory_profile': {
        const profile = smartMemory.getFullProfile(userId);
        if (!profile || Object.keys(profile).length === 0) {
          response = t('memory.profile_empty');
        } else {
          response = t('memory.profile_header') + '\n\n';
          for (const [category, facts] of Object.entries(profile)) {
            const emoji = t(`memory.categories.${category}`) || `📌 ${category}`;
            response += `${emoji}:\n`;
            facts.forEach(f => { response += `   • ${f.content}\n`; });
            response += '\n';
          }
        }
        break;
      }

      // ═══════════════════════════════════════════════════════
      // SKILL AGENT — Comandos Personalizados
      // ═══════════════════════════════════════════════════════
      
      case 'create_skill': {
        const skillResult = skillAgent.createSkill(prompt, userId);
        if (skillResult.success) {
          response = t('skill.created', {
            name: skillResult.skill.name,
            trigger: skillResult.skill.trigger,
            count: skillResult.skill.actions.length
          });
        } else {
          response = `❌ ${skillResult.error}`;
        }
        break;
      }

      case 'list_skills': {
        // listSkills devolve texto já formatado, não uma lista.
        response = skillAgent.listSkills(userId);
        break;
      }

      case 'delete_skill': {
        const skillName = intentData.entities.name || prompt;
        const delSkill = skillAgent.deleteSkill(skillName, userId);
        response = delSkill.success ? t('skill.delete_success', { name: delSkill.name }) : `❌ ${delSkill.error}`;
        break;
      }

      // ═══════════════════════════════════════════════════════
      // VISION AGENT — Captura + Análise Visual
      // ═══════════════════════════════════════════════════════
      
      case 'screenshot_analyze': {
        if (!visionAgent.isAvailable()) {
          response = t('vision.unavailable');
          break;
        }
        console.log('📸 Capturando e analisando ecrã...');
        const visionPrompt = intentData.entities.prompt || 'Descreve o que vês no ecrã';
        const visionResult = await visionAgent.captureAndAnalyze(visionPrompt);
        response = visionResult.success
          ? t('vision.analyze_success', { analysis: visionResult.analysis })
          : `❌ ${visionResult.error}`;
        break;
      }

      case 'screen_ocr': {
        if (!visionAgent.isAvailable()) {
          response = t('vision.unavailable');
          break;
        }
        console.log('📝 Extraindo texto do ecrã...');
        const ocrResult = await visionAgent.extractTextFromScreen();
        response = ocrResult.success
          ? t('vision.ocr_success') + `\n\n\`\`\`\n${ocrResult.text}\n\`\`\``
          : `❌ ${ocrResult.error}`;
        break;
      }

      case 'screen_errors': {
        if (!visionAgent.isAvailable()) {
          response = t('vision.unavailable');
          break;
        }
        console.log('🔍 Procurando erros no ecrã...');
        const errResult = await visionAgent.findScreenErrors();
        response = errResult.success
          ? t('vision.errors_success', { analysis: errResult.analysis })
          : `❌ ${errResult.error}`;
        break;
      }

      // ═══════════════════════════════════════════════════════
      // ALERT AGENT — Monitorização Proativa
      // ═══════════════════════════════════════════════════════
      
      case 'create_monitor': {
        const monResult = alertAgent.createMonitor(prompt, userId);
        if (monResult.success) {
          response = t('alert.monitor_created', {
            name: monResult.monitor.name,
            type: monResult.monitor.type,
            url: monResult.monitor.url || ''
          });
        } else {
          response = `❌ ${monResult.error}`;
        }
        break;
      }

      case 'create_reminder': {
        const remResult = alertAgent.createMonitor(prompt, userId);
        if (remResult.success) {
          response = t('alert.reminder_created', {
            name: remResult.monitor.name,
            when: remResult.monitor.triggerAt ? new Date(remResult.monitor.triggerAt).toLocaleString() : ''
          });
        } else {
          response = `❌ ${remResult.error}`;
        }
        break;
      }

      case 'list_monitors': {
        const monitors = alertAgent.listMonitors(userId);
        if (monitors.length === 0) {
          response = t('alert.list_empty');
        } else {
          response = t('alert.list_header', { count: monitors.length }) + '\n\n';
          monitors.forEach((m, i) => {
            const typeIcon = { url: '🌐', reminder: '⏰', rss: '📡', keyword: '🔑' }[m.type] || '📌';
            response += `${typeIcon} **${i + 1}. ${m.name}**\n`;
            response += `   ${m.type} | ${m.enabled ? '✅' : '⏸️'}\n\n`;
          });
        }
        break;
      }

      case 'delete_monitor': {
        const monId = intentData.entities.monitorId || intentData.entities.name;
        const delMon = alertAgent.deleteMonitor(monId, userId);
        response = delMon.success ? t('alert.delete_success', { name: delMon.name }) : `❌ ${delMon.error}`;
        break;
      }

      case 'alert_history': {
        const alertHist = alertAgent.getAlertHistory(userId);
        if (alertHist.length === 0) {
          response = t('alert.history_empty');
        } else {
          response = t('alert.history_header', { count: Math.min(alertHist.length, 10) }) + '\n\n';
          alertHist.slice(-10).reverse().forEach(a => {
            response += `🔔 **${a.monitorName}** — ${new Date(a.triggeredAt).toLocaleString()}\n`;
            response += `   ${a.message}\n\n`;
          });
        }
        break;
      }

      // ═══════════════════════════════════════════════════════
      // WORKFLOW AGENT — Receitas & Fluxos
      // ═══════════════════════════════════════════════════════
      
      case 'list_workflows': {
        // listWorkflows devolve texto formatado e o seu parâmetro é a
        // categoria, não o utilizador. Passar o userId filtrava tudo.
        response = workflowAgent.listWorkflows();
        break;
      }

      case 'run_workflow': {
        const wfName = intentData.entities.name || prompt;
        const wfInput = intentData.entities.input || '';
        const workflow = workflowAgent.findWorkflow(wfName, userId);
        if (!workflow) {
          response = t('workflow.not_found');
          break;
        }
        console.log(`🔄 Executando workflow: ${workflow.name}`);
        const prepared = workflowAgent.prepareExecution(workflow, wfInput);
        
        // Executar cada passo via orchestrator
        const wfResults = [];
        for (let i = 0; i < prepared.steps.length; i++) {
          console.log(`  ⏳ [${i + 1}/${prepared.steps.length}] ${prepared.steps[i].substring(0, 50)}...`);
          try {
            const stepResult = await handlePrompt(prepared.steps[i], context);
            wfResults.push({
              step: i + 1,
              input: prepared.steps[i],
              output: typeof stepResult === 'string' ? stepResult : stepResult.text,
              success: true
            });
          } catch (e) {
            wfResults.push({ step: i + 1, input: prepared.steps[i], output: e.message, success: false });
          }
        }
        response = workflowAgent.formatResult(workflow.name, wfResults);
        break;
      }

      case 'create_workflow': {
        const wfResult = workflowAgent.createWorkflow(prompt, userId);
        if (wfResult.success) {
          response = t('workflow.created', { name: wfResult.workflow.name, count: wfResult.workflow.steps.length });
        } else {
          response = `❌ ${wfResult.error}`;
        }
        break;
      }

      case 'delete_workflow': {
        const delWfName = intentData.entities.name || prompt;
        const delWf = workflowAgent.deleteWorkflow(delWfName, userId);
        response = delWf.success ? t('workflow.delete_success', { name: delWf.name }) : `❌ ${delWf.error}`;
        break;
      }

      // ═══════════════════════════════════════════════════════
      // CLIPBOARD AGENT — Área de Transferência Inteligente
      // ═══════════════════════════════════════════════════════
      
      case 'clipboard_current': {
        const clipCurrent = clipboardAgent.getCurrentClipboard();
        if (clipCurrent.success) {
          const sensitive = clipboardAgent.detectSensitiveData(clipCurrent.content);
          response = t('clipboard.current_header') + `\n\n\`\`\`\n${clipCurrent.content.substring(0, 500)}${clipCurrent.content.length > 500 ? '\n...' : ''}\n\`\`\`\n` +
            t('clipboard.current_type', { type: clipCurrent.type }) +
            (sensitive.length > 0 ? '\n' + t('clipboard.current_sensitive', { types: sensitive.map(s => s.type).join(', ') }) : '');
        } else {
          response = t('clipboard.current_error', { error: clipCurrent.error });
        }
        break;
      }

      case 'clipboard_history': {
        const clipHist = clipboardAgent.getHistory();
        if (clipHist.length === 0) {
          response = t('clipboard.history_empty');
        } else {
          response = t('clipboard.history_header', { count: clipHist.length }) + '\n\n';
          clipHist.slice(-10).reverse().forEach((c, i) => {
            const pinned = c.pinned ? '📌 ' : '';
            const preview = c.content.substring(0, 60).replace(/\n/g, ' ');
            response += `${pinned}${i + 1}. [${c.type}] ${preview}${c.content.length > 60 ? '...' : ''}\n`;
            response += `   📅 ${new Date(c.timestamp).toLocaleString()}\n\n`;
          });
        }
        break;
      }

      case 'clipboard_search': {
        const clipQuery = intentData.entities.query || prompt;
        const clipResults = clipboardAgent.searchHistory(clipQuery);
        if (clipResults.length === 0) {
          response = t('clipboard.search_empty', { query: clipQuery });
        } else {
          response = t('clipboard.search_header', { count: clipResults.length }) + '\n\n';
          clipResults.forEach((c, i) => {
            const preview = c.content.substring(0, 80).replace(/\n/g, ' ');
            response += `${i + 1}. [${c.type}] ${preview}...\n`;
          });
        }
        break;
      }

      case 'clipboard_monitor': {
        const isMonitoring = clipboardAgent.isMonitoring?.() || false;
        if (isMonitoring) {
          clipboardAgent.stopMonitoring();
          response = t('clipboard.monitor_stopped');
        } else {
          clipboardAgent.startMonitoring();
          response = t('clipboard.monitor_started');
        }
        break;
      }

      // ═══════════════════════════════════════════════════════════
      // CUSTOM AI PROVIDER — Integração de IA paga pelo utilizador
      // ═══════════════════════════════════════════════════════════

      case 'setup_ai_provider': {
        try {
          const parsed = customProvider.parseSetupFromText(prompt);
          if (!parsed) {
            const catalog = customProvider.getProviderCatalog();
            let catalogMsg = t('provider.setup.catalog_header') + '\n\n';
            for (const [id, info] of Object.entries(catalog)) {
              catalogMsg += `**${info.name}** (\`${id}\`)\n`;
              catalogMsg += `   ${info.models.slice(0, 3).map(m => m.id).join(', ')}\n`;
              catalogMsg += `   ${info.description}\n\n`;
            }
            catalogMsg += '---\n\n' + t('provider.setup.instructions') + '\n\n' + t('provider.setup.need_key');
            response = catalogMsg;
          } else {
            const validation = await customProvider.validateApiKey(parsed.providerId, parsed.apiKey, parsed.baseUrl);
            if (!validation.valid) {
              response = t('provider.setup.invalid_key', { provider: parsed.providerId, error: validation.error });
            } else {
              const setupResult = customProvider.setupProvider(userId, {
                providerId: parsed.providerId, apiKey: parsed.apiKey, model: parsed.model, baseUrl: parsed.baseUrl
              });
              if (setupResult.success) {
                const info = customProvider.getProviderInfo(userId);
                response = t('provider.setup.success', { name: info.providerName, model: info.model }) + '\n\n';
                response += t('provider.setup.usage_info', { name: info.providerName }) + '\n\n';
                response += t('provider.setup.useful_commands');
              } else {
                response = t('provider.setup.error', { error: setupResult.error });
              }
            }
          }
        } catch (err) {
          response = t('provider.setup.exception', { error: err.message });
        }
        break;
      }

      case 'list_ai_providers': {
        const catalog = customProvider.listAvailableProviders();
        let msg = t('provider.list.header') + '\n\n';
        const currentInfo = customProvider.getProviderInfo(userId);
        if (currentInfo) {
          msg += t('provider.list.current', { name: currentInfo.providerName, model: currentInfo.model, status: currentInfo.enabled ? '🟢' : '🔴', tokens: currentInfo.usage?.totalTokens || 0 }) + '\n\n---\n\n';
        }
        msg += t('provider.list.all_header') + '\n\n';
        catalog.forEach(p => {
          const isCurrent = currentInfo?.providerId === p.id;
          msg += `${isCurrent ? '👉 ' : ''}**${p.name}** (\`${p.id}\`)${isCurrent ? ' ←' : ''}\n`;
          msg += `   ${p.description}\n`;
          msg += `   💰 $${p.pricing}/1M tokens\n`;
          msg += `   🤖 ${p.models.slice(0, 3).join(', ')}${p.models.length > 3 ? ` (+${p.models.length - 3})` : ''}\n\n`;
        });
        if (!currentInfo) msg += t('provider.list.configure_hint');
        response = msg;
        break;
      }

      case 'remove_ai_provider': {
        const removeResult = customProvider.removeProvider(userId);
        if (removeResult.success) {
          response = t('provider.remove.success', { name: removeResult.removedProvider });
        } else {
          response = removeResult.error || t('provider.remove.no_provider');
        }
        break;
      }

      case 'ai_provider_status': {
        const providerInfo = customProvider.getProviderInfo(userId);
        if (!providerInfo) {
          response = t('provider.status.no_provider');
        } else {
          response = t('provider.status.header') + '\n\n';
          response += `🔌 **${providerInfo.providerName}**\n`;
          response += `🤖 ${providerInfo.model}\n`;
          response += `📊 ${providerInfo.enabled ? '🟢' : '🔴'}\n`;
          response += `📅 ${new Date(providerInfo.configuredAt).toLocaleDateString()}\n`;
          response += `📈 ${providerInfo.usage?.totalTokens || 0} tokens | ${providerInfo.usage?.totalRequests || 0}\n\n`;
          response += providerInfo.enabled ? t('provider.status.active_msg') : t('provider.status.inactive_msg');
          response += '\n\n' + t('provider.status.commands');
        }
        break;
      }

      case 'toggle_ai_provider': {
        const toggleResult = customProvider.toggleProvider(userId);
        if (toggleResult.success) {
          response = toggleResult.enabled
            ? t('provider.toggle.enabled', { name: toggleResult.provider })
            : t('provider.toggle.disabled', { name: toggleResult.provider });
        } else {
          response = toggleResult.error || t('provider.toggle.no_provider');
        }
        break;
      }

      case 'set_ai_model': {
        const modelMatch = prompt.match(/(?:modelo|model)\s+(?:para\s+)?(\S+)/i) ||
                           prompt.match(/(?:trocar|mudar|alterar|usar|switch)\s+(?:para\s+)?(\S+)/i);
        if (modelMatch) {
          const modelId = modelMatch[1];
          const setResult = customProvider.setModel(userId, modelId);
          if (setResult.success) {
            response = t('provider.model.changed', { model: setResult.model, provider: setResult.provider });
          } else {
            response = setResult.error || '❌';
          }
        } else {
          const info = customProvider.getProviderInfo(userId);
          if (info) {
            const catalog = customProvider.getProviderCatalog();
            const provider = catalog[info.providerId];
            if (provider) {
              response = t('provider.model.list_header', { name: info.providerName, model: info.model }) + '\n\n';
              provider.models.forEach(m => {
                const isCurrent = m.id === info.model;
                response += `${isCurrent ? '👉 ' : '• '}**${m.id}**${m.description ? ` — ${m.description}` : ''}${isCurrent ? ' ←' : ''}\n`;
              });
              response += '\n' + t('provider.model.change_hint');
            } else {
              response = t('provider.model.provider_not_found');
            }
          } else {
            response = t('provider.model.no_provider');
          }
        }
        break;
      }

      case 'ai_provider_onboarding': {
        response = t('provider.onboarding');
        break;
      }

      // ═══════════════════════════════════════════════════════════
      // i18n — Language Management
      // ═══════════════════════════════════════════════════════════

      case 'change_language': {
        const langInput = intentData.entities.language;
        const langCode = i18n.normalizeLangCode(langInput);
        if (!langCode || !i18n.isSupported(langCode)) {
          const langList = i18n.SUPPORTED_LANGUAGES.map(l => `${i18n.getLanguageFlag(l)} ${i18n.getLanguageName(l)} (\`${l}\`)`).join('\n');
          response = t('language.unsupported', { lang: langInput, list: langList });
        } else {
          const currentLang = i18n.getUserLanguage(userId);
          if (currentLang === langCode) {
            response = t('language.already_set', { language: i18n.getLanguageName(langCode) });
          } else {
            i18n.setUserLanguage(userId, langCode);
            // Use the NEW language for the response
            response = i18n.t('language.changed', { language: i18n.getLanguageName(langCode) }, userId);
          }
        }
        break;
      }

      case 'list_languages': {
        let msg = t('language.list_header') + '\n\n';
        const currentLang = i18n.getUserLanguage(userId);
        i18n.SUPPORTED_LANGUAGES.forEach(l => {
          const isCurrent = l === currentLang;
          msg += `${isCurrent ? '👉 ' : ''}${i18n.getLanguageFlag(l)} **${i18n.getLanguageName(l)}** (\`${l}\`)${isCurrent ? ' ←' : ''}\n`;
        });
        msg += '\n' + t('language.current', { language: i18n.getLanguageName(currentLang) });
        msg += '\n' + t('language.change_hint');
        response = msg;
        break;
      }

      case 'grant_permission': {
        const tool = intentData.entities.tool;
        if (!tool || !tools.porNome(tool)) {
          response = `❌ Não conheço a ferramenta "${tool || ''}". Diz "permissões" para ver quais existem.`;
        } else {
          permissions.conceder(userId, tool);
          response = `✅ Ferramenta "${tool}" autorizada. Já a posso usar sem voltar a pedir.`;
        }
        break;
      }

      case 'revoke_permission': {
        const tool = intentData.entities.tool;
        const tinha = permissions.revogar(userId, tool);
        response = tinha
          ? `✅ Autorização de "${tool}" revogada.`
          : `ℹ️ A ferramenta "${tool}" não estava autorizada.`;
        break;
      }

      case 'list_permissions': {
        const aprovadas = permissions.listar(userId);
        const pol = permissions.politica();
        response = `🔐 **Permissões de ferramentas**\n\n` +
          `Política: ler=${pol.ler}, escrever=${pol.escrever}, sistema=${pol.sistema}\n\n` +
          (aprovadas.length
            ? `Autorizadas por ti:\n${aprovadas.map(a => `• ${a.ferramenta}`).join('\n')}`
            : `Ainda não autorizaste nenhuma ferramenta de sistema.`);
        break;
      }

      case 'chat':
      default:
        // Verificar se há um plano de projeto pendente e o user confirmou
        if (conversation._pendingPlan && /^(?:sim|yes|criar|cria|build|ok|confirmo|avança|go)\b/i.test(prompt)) {
          console.log('🔨 Utilizador confirmou – a construir projeto...');
          const buildResult = await projectBuilder.buildProject(conversation._pendingPlan);
          delete conversation._pendingPlan;
          response = projectBuilder.formatBuildResult(buildResult);
          break;
        }
        // Cancelar plano pendente se user disser não
        if (conversation._pendingPlan && /^(?:não|nao|no|cancela|cancel)\b/i.test(prompt)) {
          delete conversation._pendingPlan;
          response = t('project.cancelled');
          break;
        }

        // Usar IA para responder com contexto de conversa
        const history = conversationStore.getHistoryForContext(conversation.id, 8);

        // ═══ NÍVEL 2 DA CASCATA: ferramentas ═══
        // Chegar aqui significa que nenhuma regra reconheceu o pedido. Antes
        // caía-se logo em conversa genérica, mesmo havendo um agente capaz.
        // Agora o modelo pode escolher entre um punhado de ferramentas, e só
        // se isso não der nada é que se segue para o chat simples.
        try {
          const comFerramentas = await toolLoop.correr(prompt, { userId, historico: history });
          if (comFerramentas && comFerramentas.texto) {
            response = comFerramentas.texto;
            if (comFerramentas.ferramentasUsadas.length) {
              security.logAction(userId, 'tools-used', {
                ferramentas: comFerramentas.ferramentasUsadas,
                passos: comFerramentas.passos
              });
            }
            break;
          }
        } catch (err) {
          console.warn(`  ⚠️ Ciclo de ferramentas falhou: ${err.message}`);
        }


        // Enriquecer com RAG se houver documentos indexados
        let enrichedPrompt = prompt;
        try {
          const ragEngine = require('./ragEngine');
          const ragStats = ragEngine.getStats();
          if (ragStats.totalChunks > 0) {
            const ragContext = await ragEngine.getContext(prompt, { topK: 3, minScore: 0.1 });
            if (ragContext) {
              enrichedPrompt = `${ragContext}\n\nPergunta do utilizador: ${prompt}`;
            }
          }
        } catch {}

        // Enriquecer com Smart Memory — contexto pessoal do utilizador
        try {
          const memoryContext = smartMemory.getContextForPrompt(userId);
          if (memoryContext) {
            enrichedPrompt = `${memoryContext}\n\n${enrichedPrompt}`;
          }
        } catch {}
        
        response = await aiAgent.askAI(enrichedPrompt, history, { userId });
        break;
    }
    
    // Guardar resposta na conversa
    conversationStore.addMessage(conversation.id, {
      role: 'assistant',
      content: response
    });
    
    // Decidir modo de output
    const prefs = conversationStore.getPreferences();
    const outputDecision = decisionEngine.decideOutputMode(response, prefs.defaultMode);
    
    // Log tempo de resposta
    const elapsed = Date.now() - startTime;
    security.logAction(userId, 'response-sent', { 
      intent: intentData.intent,
      elapsed,
      responseLength: response.length,
      outputMode: outputDecision.mode,
      conversationId: conversation.id
    });
    
    // Retornar resposta com metadata
    return {
      text: response,
      outputMode: outputDecision.mode,
      shouldSpeak: outputDecision.shouldSpeak,
      speakableText: outputDecision.shouldSpeak ? decisionEngine.prepareForTTS(response) : null,
      conversationId: conversation.id,
      elapsed
    };
    
  } catch (error) {
    security.logAction(userId, 'error', { 
      message: error.message,
      stack: error.stack?.substring(0, 200)
    });
    
    console.error('❌ Erro no orchestrator:', error);
    return t('general.error', { message: error.message });
  }
}

/**
 * Informação do sistema
 */
function getSystemInfo(userId) {
  const t = (key, vars) => i18n.t(key, vars, userId);
  const uptime = process.uptime();
  const memory = process.memoryUsage();
  const execRestantes = codeRunner.getRemainingExecutions(security.getUserId({}));
  
  return `${t('system_info.title')}

${t('system_info.version')}
${t('system_info.uptime', { uptime: formatUptime(uptime) })}
${t('system_info.memory', { used: Math.round(memory.heapUsed / 1024 / 1024), total: Math.round(os.totalmem() / 1024 / 1024) })}
${t('system_info.platform', { platform: os.platform(), arch: os.arch() })}
${t('system_info.node', { version: process.version })}

${t('system_info.ai_header')}
   ${aiAgent.isAvailable() ? t('system_info.groq_configured') : t('system_info.groq_not_configured')}
   ${t('system_info.model', { model: aiAgent.GROQ_MODEL })}

${t('system_info.limits_header')}
   ${t('system_info.exec_limit', { remaining: execRestantes, max: codeRunner.MAX_EXEC_PER_MIN })}

${t('system_info.files_header')}
   ${t('system_info.allowed_folders', { count: fileAgent.ALLOWED_READ.length })}`;
}

/**
 * Lista de agentes disponíveis
 */
function getAgentsList(userId) {
  const t = (key, vars) => i18n.t(key, vars, userId);
  return `${t('agents.title')}

${t('agents.ai')}
   Status: ${aiAgent.isAvailable() ? t('agents.status_online') : t('agents.status_offline')}

${t('agents.web_search')}
   Status: ${webSearchAgent.isAvailable() ? t('agents.status_online') : t('agents.status_offline')}

${t('agents.pdf')}
   Status: ${t('agents.status_online')}

${t('agents.file')}
   Status: ${t('agents.status_online')}

${t('agents.code')}
   Status: ${t('agents.status_online')}
   ${t('agents.code_limit', { max: codeRunner.MAX_EXEC_PER_MIN })}

${t('agents.project')}
   Status: ${aiAgent.isAvailable() ? t('agents.status_online') : t('agents.status_offline')}

${t('agents.remote')}

${t('agents.automation')}
   Status: ${t('agents.status_online')}

${t('agents.smart_memory')}
   Status: ${t('agents.status_online')} (${t('agents.smart_memory_count', { count: smartMemory.getStats().totalFacts })})

${t('agents.skill')}
   Status: ${t('agents.status_online')} (${t('agents.skill_count', { count: skillAgent.getStats().total })})

${t('agents.vision')}
   Status: ${visionAgent.isAvailable() ? t('agents.status_online') : t('agents.vision_needs_key')}

${t('agents.alert')}
   Status: ${t('agents.status_online')} (${t('agents.alert_count', { count: alertAgent.getStats().total })})

${t('agents.workflow')}
   Status: ${t('agents.status_online')} (${t('agents.workflow_count', { count: workflowAgent.getStats().builtIn + workflowAgent.getStats().custom })})

${t('agents.clipboard')}
   Status: ${t('agents.status_online')}

${t('agents.custom_provider')}
   Status: ${t('agents.status_available')}`;
}

/**
 * Mensagem de ajuda
 */
function getHelpMessage(userId) {
  const t = (key, vars) => i18n.t(key, vars, userId);
  return `${t('help.title')}

${t('help.basic')}

${t('help.time')}

${t('help.examples')}

${t('help.search')}

${t('help.project')}

${t('help.chaining')}

${t('help.automation')}

${t('help.memory')}

${t('help.skills')}

${t('help.vision')}

${t('help.alerts')}

${t('help.workflows')}

${t('help.clipboard')}

${t('help.custom_provider')}

${t('help.language')}

${t('help.dashboard')}

${t('help.footer')}`;
}

/**
 * Retorna hora atual formatada
 */
function getCurrentTime(userId) {
  const t = (key, vars) => i18n.t(key, vars, userId);
  const now = new Date();
  const langCode = i18n.getUserLanguage(userId);
  const locale = { pt: 'pt-PT', en: 'en-US', es: 'es-ES', fr: 'fr-FR' }[langCode] || 'pt-PT';
  const options = { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
    hour12: false,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };
  const timeStr = now.toLocaleTimeString(locale, options);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  
  return t('time.current', { time: timeStr }) + '\n' + t('time.timezone', { timezone });
}

/**
 * Retorna data atual formatada
 */
function getCurrentDate(userId) {
  const t = (key, vars) => i18n.t(key, vars, userId);
  const now = new Date();
  const langCode = i18n.getUserLanguage(userId);
  const locale = { pt: 'pt-PT', en: 'en-US', es: 'es-ES', fr: 'fr-FR' }[langCode] || 'pt-PT';
  const options = { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  };
  const dateStr = now.toLocaleDateString(locale, options);
  const formattedDate = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
  
  return t('date.current', { date: formattedDate });
}

/**
 * Formata uptime
 */
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  
  return parts.join(' ');
}

// ═══════════════════════════════════════════════════════════
// AGENT CHAINING — Executor de passos individuais
// ═══════════════════════════════════════════════════════════

/**
 * Executa um passo de chain individual mapeando para o agente correto
 */
async function executeChainStep(agentName, input, userId, conversation) {
  const ct = (key, vars) => i18n.t(key, vars, userId);
  switch (agentName) {
    case 'ai_chat':
      return await aiAgent.askAI(input, [], { userId });

    case 'web_search':
      return await webSearchAgent.search(input);

    case 'create_pdf': {
      const pdfPath = await pdfAgent.createPDF(input);
      return ct('chain.pdf_created', { path: pdfPath });
    }

    case 'create_file': {
      // Tentar extrair título e conteúdo
      const title = input.split('\n')[0].substring(0, 50) || 'chain-output';
      const result = fileAgent.createNote(title, input);
      return result.success ? ct('chain.file_created', { path: result.path }) : result.error;
    }

    case 'run_code': {
      const code = codeRunner.extractCode(input) || input;
      const result = codeRunner.runCode(code, userId);
      return result.success ? result.output : result.error;
    }

    case 'system_open_app': {
      const result = await systemAgent.openApp(input);
      return result.success ? ct('chain.app_opened', { name: input }) : result.error;
    }

    case 'system_open_url': {
      const url = input.match(/https?:\/\/\S+/)?.[0] || input;
      const result = await systemAgent.openUrl(url);
      return result.success ? ct('chain.url_opened', { url }) : result.error;
    }

    case 'system_execute': {
      const result = await systemAgent.executeCommand(input);
      return result.success ? result.output : result.error;
    }

    case 'screenshot': {
      const result = await systemAgent.takeScreenshot();
      return result.success ? ct('chain.screenshot', { path: result.path }) : result.error;
    }

    case 'type_text': {
      const result = await inputAgent.typeText(input);
      return result.success ? ct('chain.text_typed') : result.error;
    }

    case 'shortcut': {
      const result = await inputAgent.executeShortcut(input);
      return result.success ? ct('chain.shortcut_executed', { keys: input }) : result.error;
    }

    case 'remote_execute': {
      // Input: "alias: command"
      const parts = input.split(':');
      if (parts.length >= 2) {
        const alias = parts[0].trim();
        const cmd = parts.slice(1).join(':').trim();
        const result = await remoteAgent.executeRemote(alias, cmd);
        return remoteAgent.formatRemoteResult(result);
      }
      return ct('chain.remote_format');
    }

    case 'remote_list_machines': {
      const result = remoteAgent.listMachines();
      return result.formatted;
    }

    case 'schedule_task': {
      const taskResult = automationAgent.createTask(input, userId);
      return taskResult.success ? ct('chain.task_scheduled', { name: taskResult.task.name }) : taskResult.error;
    }

    case 'remember': {
      const memResult = smartMemory.remember(input, userId);
      return memResult.success ? ct('chain.memorized', { content: memResult.fact.content }) : memResult.error;
    }

    case 'recall': {
      const memories = smartMemory.recall(input, userId);
      return memories.length > 0 ? memories.map(m => m.content).join('\n') : ct('chain.memory_empty');
    }

    case 'screenshot_analyze': {
      if (!visionAgent.isAvailable()) return ct('chain.vision_unavailable');
      const vResult = await visionAgent.captureAndAnalyze(input || 'Descreve o ecrã');
      return vResult.success ? vResult.analysis : vResult.error;
    }

    case 'screen_ocr': {
      if (!visionAgent.isAvailable()) return ct('chain.vision_unavailable');
      const ocrResult = await visionAgent.extractTextFromScreen();
      return ocrResult.success ? ocrResult.text : ocrResult.error;
    }

    case 'create_monitor': {
      const monResult = alertAgent.createMonitor(input, userId);
      return monResult.success ? ct('chain.monitor_created', { name: monResult.monitor.name }) : monResult.error;
    }

    case 'run_workflow': {
      const wf = workflowAgent.findWorkflow(input, userId);
      if (!wf) return ct('chain.workflow_not_found');
      const prep = workflowAgent.prepareExecution(wf, '');
      return ct('chain.workflow_prepared', { name: wf.name, steps: prep.steps.length });
    }

    case 'clipboard_current': {
      const clip = clipboardAgent.getCurrentClipboard();
      return clip.success ? clip.content : clip.error;
    }

    default:
      // Fallback: usar IA
      return await aiAgent.askAI(input, [], { userId });
  }
}

module.exports = {
  handlePrompt,
  getSystemInfo,
  getAgentsList,
  getHelpMessage
};
