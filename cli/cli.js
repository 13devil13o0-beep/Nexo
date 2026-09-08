#!/usr/bin/env node

/**
 * 🖥️ NEXO CLI
 * Interface de linha de comandos com suporte i18n
 */

require('dotenv').config();
const readline = require('readline');
const i18n = require('../i18n/i18n');

class MyBotCLI {
  constructor() {
    this.orchestrator = null;
    this.history = [];
    this.userId = 'cli-' + Date.now();
    
    // Inicializar i18n
    i18n.init();
    
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '\n🤖 > '
    });
    
    this.loadOrchestrator();
  }
  
  t(key, vars) {
    return i18n.t(key, vars, this.userId);
  }
  
  async loadOrchestrator() {
    try {
      const { handlePrompt } = require('../orchestrator/orchestrator');
      this.orchestrator = handlePrompt;
    } catch (e) {
      console.error(this.t('cli.loader_error', { message: e.message }));
      process.exit(1);
    }
  }
  
  banner() {
    console.clear();
    console.log(`
==========================================================

    M   M  Y   Y  BBBBB   OOO   TTTTT
    MM MM   Y Y   B   B  O   O    T
    M M M    Y    BBBBB  O   O    T
    M   M    Y    B   B  O   O    T
    M   M    Y    BBBBB   OOO     T

           ${this.t('cli.banner_title')}

==========================================================
    `);
    console.log(`  ${this.t('cli.commands_header')}`);
    console.log(`  ${this.t('cli.cmd_help')}`);
    console.log(`  ${this.t('cli.cmd_clear')}`);
    console.log(`  ${this.t('cli.cmd_history')}`);
    console.log(`  ${this.t('cli.cmd_status')}`);
    console.log(`  ${this.t('cli.cmd_lang')}`);
    console.log(`  ${this.t('cli.cmd_exit')}`);
    console.log('');
    console.log(`  ${this.t('cli.prompt_hint')}`);
    console.log('-'.repeat(60));
  }
  
  async start() {
    this.banner();
    
    this.rl.prompt();
    
    this.rl.on('line', async (line) => {
      const input = line.trim();
      
      if (!input) {
        this.rl.prompt();
        return;
      }
      
      // Comandos especiais
      if (input.startsWith('/')) {
        await this.handleCommand(input);
        this.rl.prompt();
        return;
      }
      
      // Processar mensagem
      await this.processMessage(input);
      this.rl.prompt();
    });
    
    this.rl.on('close', () => {
      console.log(`\n${this.t('cli.goodbye')}\n`);
      process.exit(0);
    });
  }
  
  async handleCommand(input) {
    const [cmd, ...args] = input.split(' ');
    
    switch (cmd) {
      case '/help':
        this.showHelp();
        break;
      
      case '/clear':
        this.banner();
        break;
      
      case '/history':
        this.showHistory();
        break;
      
      case '/status':
        this.showStatus();
        break;
      
      case '/lang': {
        const langArg = args.join(' ').trim();
        if (langArg) {
          const langCode = i18n.normalizeLangCode(langArg);
          if (langCode && i18n.isSupported(langCode)) {
            i18n.setUserLanguage(this.userId, langCode);
            console.log(`\n${this.t('language.changed', { language: i18n.getLanguageName(langCode) })}`);
          } else {
            const list = Object.entries(i18n.SUPPORTED_LANGUAGES)
              .map(([code, name]) => `  ${i18n.getLanguageFlag(code)} ${name} (${code})`)
              .join('\n');
            console.log(`\n${this.t('language.unsupported', { lang: langArg, list })}`);
          }
        } else {
          const list = Object.entries(i18n.SUPPORTED_LANGUAGES)
            .map(([code, name]) => {
              const flag = i18n.getLanguageFlag(code);
              const current = code === i18n.getUserLanguage(this.userId) ? ' ✅' : '';
              return `  ${flag} ${name} (${code})${current}`;
            })
            .join('\n');
          console.log(`\n${this.t('language.list_header')}\n\n${list}\n\n${this.t('language.change_hint')}`);
        }
        break;
      }
      
      case '/exit':
      case '/quit':
        this.rl.close();
        break;
      
      default:
        console.log(`\n${this.t('cli.unknown_cmd')}`);
    }
  }
  
  showHelp() {
    console.log(`
${this.t('cli.help_title')}
━━━━━━━━━━━━━━━━━━━━━

${this.t('cli.cmd_help')}
${this.t('cli.cmd_clear')}
${this.t('cli.cmd_history')}
${this.t('cli.cmd_status')}
${this.t('cli.cmd_lang')}
${this.t('cli.cmd_exit')}

━━━━━━━━━━━━━━━━━━━━━
${this.t('cli.help_examples')}
• ${this.t('cli.help_ex1')}
• ${this.t('cli.help_ex2')}
• ${this.t('cli.help_ex3')}
• ${this.t('cli.help_ex4')}
    `);
  }
  
  showHistory() {
    if (this.history.length === 0) {
      console.log(`\n${this.t('cli.history_empty')}`);
      return;
    }
    
    console.log(`\n${this.t('cli.history_title')}\n`);
    this.history.slice(-10).forEach((msg, i) => {
      const role = msg.role === 'user' ? '👤' : '🤖';
      const preview = msg.content.substring(0, 60) + (msg.content.length > 60 ? '...' : '');
      console.log(`  ${i + 1}. ${role} ${preview}`);
    });
  }
  
  showStatus() {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const mem = process.memoryUsage();
    
    console.log(`
${this.t('cli.status_title')}
━━━━━━━━━━━━━━━━━━━━━

${this.t('cli.status_online')}
${this.t('cli.status_uptime', { hours, mins })}
${this.t('cli.status_model', { model: process.env.MODEL || 'llama-3.3-70b-versatile' })}
${this.t('cli.status_memory', { used: Math.round(mem.heapUsed / 1024 / 1024), total: Math.round(mem.heapTotal / 1024 / 1024) })}
${this.t('cli.status_messages', { count: this.history.length })}
    `);
  }
  
  async processMessage(input) {
    this.history.push({ role: 'user', content: input });
    
    process.stdout.write(`\n${this.t('cli.processing')}`);
    const spinner = setInterval(() => {
      process.stdout.write('.');
    }, 500);
    
    try {
      const result = await this.orchestrator(input, {
        userId: this.userId,
        platform: 'cli'
      });
      
      clearInterval(spinner);
      console.log('\n');
      
      const responseText = typeof result === 'string' ? result : (result.text || result.toString());
      
      console.log('┌' + '─'.repeat(58) + '┐');
      
      const lines = responseText.split('\n');
      for (const line of lines) {
        const wrapped = this.wrapText(line, 56);
        for (const w of wrapped) {
          console.log('│ ' + w.padEnd(56) + ' │');
        }
      }
      
      console.log('└' + '─'.repeat(58) + '┘');
      
      this.history.push({ role: 'assistant', content: responseText });
      
    } catch (error) {
      clearInterval(spinner);
      console.log('\n');
      console.log(this.t('cli.error', { message: error.message }));
    }
  }
  
  wrapText(text, maxWidth) {
    if (text.length <= maxWidth) return [text];
    
    const words = text.split(' ');
    const lines = [];
    let current = '';
    
    for (const word of words) {
      if ((current + word).length > maxWidth) {
        if (current) lines.push(current.trim());
        current = word + ' ';
      } else {
        current += word + ' ';
      }
    }
    if (current) lines.push(current.trim());
    
    return lines.length ? lines : [''];
  }
}

// Run
const cli = new MyBotCLI();
cli.start();
