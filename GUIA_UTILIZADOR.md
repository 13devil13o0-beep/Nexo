# 🤖 NEXO — Guia do Utilizador

> **O teu assistente IA pessoal, gratuito e multi-plataforma.**
> Controla o teu PC, cria apps, pesquisa a web, gera documentos — tudo por linguagem natural.

---

## 📋 Índice

1. [Início Rápido (3 minutos)](#-início-rápido)
2. [Interfaces — Onde Usar](#-interfaces--onde-usar)
3. [O que o NEXO Consegue Fazer](#-o-que-o-nexo-consegue-fazer)
4. [Guia por Exemplos](#-guia-por-exemplos)
5. [Internacionalização (i18n)](#-internacionalização-i18n)
6. [Multi-Provedor de IA](#-multi-provedor-de-ia)
7. [Configuração Avançada](#-configuração-avançada)
8. [FAQ](#-faq)
9. [Resolução de Problemas](#-resolução-de-problemas)

---

## 🚀 Início Rápido

### Pré-requisitos

- **Node.js 18+** → [nodejs.org](https://nodejs.org)
- **Git** → [git-scm.com](https://git-scm.com)

### 2 Passos para Começar

```bash
# 1. Trazer o NEXO e deixá-lo pronto
git clone https://github.com/13devil13o0-beep/Nexo.git
cd Nexo
npm run instalar

# 2. Iniciar
npm start
```

O `npm run instalar` é um assistente guiado que trata de tudo: confirma a
versão do Node, descarrega **só** as bibliotecas que este computador precisa e
ajuda-te a escolher o motor de IA.

A primeira pergunta é a que decide o resto:

> *Utilizas alguma IA pessoal contratada que queiras usar com o NEXO?*

| Resposta | O que acontece |
|----------|----------------|
| **Não** — quero as gratuitas | Guia-te pelo **Groq** e pelo **Cerebras**. Ambos grátis, rápidos, prontos em dois cliques. Ficas com dois porque se um atinge o limite diário, o NEXO passa ao outro sozinho. |
| **Sim**, já pago por uma IA | Usas a tua chave (OpenAI, Claude, Gemini) e ela passa a ser a primeira da cadeia. |
| **Local**, sem internet | Usa o [Ollama](https://ollama.com/download): grátis, sem conta, sem ligação, e **nada do que escreves sai do teu computador**. |

Cada chave é testada contra o fornecedor **antes** de ser gravada — não acabas
a instalação convencido de que está tudo bem para só descobrires na primeira
frase que não estava.

No fim, se o computador tiver ecrã, o instalador pergunta se queres um
**ícone do NEXO na área de trabalho** — um clique para abrir, em vez de teres
de vir sempre a um terminal. Funciona em Windows, macOS e Linux, com o
mecanismo nativo de cada sistema (nunca um instalador de terceiros). Perdeste
o ícone ou mudaste a pasta do projecto de sítio? `npm run atalho` recria-o a
qualquer momento.

Sem ecrã, ou se preferires sempre o terminal ou o browser, o instalador
escreve na mesma um ficheiro `COMO_ABRIR.md` na raiz do projecto, com os
comandos para cada interface e o endereço para abrir de outro dispositivo na
mesma rede — para não teres de te lembrar do que apareceu no ecrã da
instalação.

> **Já instalado e alguma coisa deixou de funcionar?** `npm run diagnostico`
> diz o que falta e como se resolve. Também apanha nomes de variáveis escritos
> por pouco — um `CEREBRAS_APY_KEY` em vez de `CEREBRAS_API_KEY` comporta-se
> exactamente como se a chave não existisse.

#### Obter a chave gratuita do Groq (30 segundos)

1. Abre [console.groq.com/keys](https://console.groq.com/keys)
2. Cria conta (email ou Google)
3. Clica **"Create API Key"** → copia
4. Cola quando o `npm run instalar` pedir

> **Custo:** 0€ — o Groq oferece **14.400 pedidos/dia** grátis.

---

## 💻 Interfaces — Onde Usar

O NEXO é **o mesmo cérebro** acessível de 6 formas diferentes:

| Interface | Comando | Quando Usar |
|-----------|---------|-------------|
| 🖥️ **Desktop** | `npm run desktop` | Uso diário no PC (Windows/Mac/Linux) |
| 🌐 **Web** | `npm run core` | No browser (interface local) |
| 📱 **Telegram** | `npm run telegram` | Acesso remoto via mensagem |
| 🎮 **Discord** | `npm run discord` | Partilhar com amigos num servidor |
| ⌨️ **Terminal** | `npm run cli` | Para devs, uso rápido sem GUI |
| 🔌 **API REST** | `npm run core` | Integração com outros sistemas |

```bash
# Iniciar TUDO de uma vez
npm run dev:all
```

### O NEXO escolhe o modo sozinho

`npm start` olha para o aparelho antes de arrancar e escolhe entre quatro
perfis. Não tens de saber qual — mas podes forçar:

| Perfil | Quando arranca assim | O que corre |
|--------|----------------------|-------------|
| 🖥️ **Completo** | ecrã e memória folgada | janela própria, bandeja, atalhos globais |
| 📱 **Leve** | ecrã pequeno ou pouca memória | só o motor; a página abre no browser, mais leve |
| ⌨️ **Consola** | sessão SSH, sem ambiente gráfico | a REPL do terminal, com o motor por trás |
| ⚙️ **Serviço** | servidor, contentor, sem terminal | só o motor, sem janela nenhuma |

```bash
npm run dispositivo          # ver o que detectou, sem arrancar nada
npm start -- --modo=servico  # forçar um perfil
```

A escolha manual fica guardada e ganha sempre à detecção automática. No modo
serviço a chave de API passa a ser obrigatória: sem janela, nada denuncia que
o servidor ficou aberto na rede.

### Distribuição .exe (Windows)

1. Gera os ícones: `npm run icons`
2. Cria o executável: `npm run dist:win`
3. O instalador e a versão portable ficam em `dist/`
4. Partilha o `.exe` — o código fonte não fica exposto!

---

## ⚡ O que o NEXO Consegue Fazer

### 🧠 Nível 0 — Conversa Inteligente

| Capacidade | Exemplo |
|-----------|---------|
| Perguntas e respostas | *"Qual é a capital da Mongólia?"* |
| Geração de texto | *"Escreve um email profissional a agradecer"* |
| Tradução | *"Traduz 'bom dia' para japonês"* |
| Análise e opinião | *"Compara React vs Vue para um projeto pequeno"* |
| Memória de conversa | Lembra o que disseste antes na mesma sessão |

### 🔍 Nível 1 — Pesquisa Web em Tempo Real

| Capacidade | Exemplo |
|-----------|---------|
| Factos e informação | *"O que é o ChatGPT?"* |
| Notícias recentes | *"Notícias sobre inteligência artificial"* |
| Preços e cotações | *"Preço do Bitcoin hoje"* |
| Previsão do tempo | *"Tempo em Lisboa"* |
| Pessoas e eventos | *"Quem é Elon Musk?"* |

### 📄 Nível 2 — Criação de Conteúdo

| Capacidade | Exemplo |
|-----------|---------|
| Gerar PDF completo | *"Cria PDF sobre energia solar"* |
| Criar notas | *"Criar nota: reunião sexta às 15h"* |
| Criar ficheiros | *"Cria ficheiro lista.txt com compras da semana"* |

### 💻 Nível 3 — Execução de Código

| Capacidade | Exemplo |
|-----------|---------|
| JavaScript simples | *"Executar: 2 + 2"* |
| Arrays e objetos | *"Executa: [1,2,3].map(x => x*10)"* |
| Math e lógica | *"Código: Math.sqrt(144)"* |

> Sandbox seguro — sem acesso ao sistema, limite 5 exec/min.

### 🖥️ Nível 4 — Controlo do Sistema Operativo

| Capacidade | Exemplo |
|-----------|---------|
| Abrir programas | *"Abre o Chrome"*, *"Abre o Notepad"* |
| Abrir sites | *"Abre youtube.com"* |
| Gerir processos | *"Lista processos"*, *"Mata o Chrome"* |
| Listar janelas | *"Janelas abertas"*, *"Foca no VS Code"* |
| Executar comandos | *"Comando: dir /b"* |
| Gerir ficheiros | *"Lista ficheiros"*, *"Lê ficheiro notas.txt"* |

### ⌨️ Nível 5 — Automação de Input (Teclado/Rato)

| Capacidade | Exemplo |
|-----------|---------|
| Digitar texto | *"Digita: Hello World"* |
| Atalhos de teclado | *"Pressiona Ctrl+S"* |
| Clicar no ecrã | *"Clica em 500, 300"* |
| Screenshots | *"Tira screenshot"* |
| Clipboard | *"Copia este texto"*, *"Cola"* |
| Scroll | *"Scroll para baixo"* |

### 🏗️ Nível 6 — Construção de Projetos Completos

| Capacidade | Exemplo |
|-----------|---------|
| Criar app completa | *"Cria uma app de tarefas em React"* |
| API backend | *"Cria uma API REST de utilizadores com Express"* |
| Site portfolio | *"Cria um site portfolio moderno"* |
| Ver projetos | *"Lista os meus projetos"* |

> A IA planifica a estrutura, gera o código de cada ficheiro, e cria tudo automaticamente.
> Fluxo: **descreve → revê o plano → confirma → projeto criado!**

### 📡 Nível 7 — Automação Remota via SSH *(Em Desenvolvimento)*

| Capacidade | Exemplo |
|-----------|---------|
| Registar máquinas | Adicionar servidores por IP/alias |
| Executar comandos | Comandos remotos via SSH |
| Monitorizar | Estado de máquinas remotas |

### 🔗 Nível 8 — Agent Chaining (Multi-Passo)

Combina **múltiplos agentes numa única instrução**. A IA decompõe o pedido em passos sequenciais e executa-os um a um, passando contexto entre eles.

| Capacidade | Exemplo |
|-----------|---------|
| Pesquisa + PDF | "Pesquisa sobre React hooks e cria um PDF resumo" |
| Multi-ação | "Faz screenshot e depois cria uma nota com o resultado" |
| Encadeamento | "Pesquisa sobre IA, cria ficheiro resumo e abre no browser" |

> O sistema detecta automaticamente pedidos com múltiplas ações (conectores como "e depois", "e cria", vírgulas) e orquestra tudo.

### 📊 Nível 9 — Dashboard em Tempo Real

Acede a **`/dashboard`** no browser para monitorizar o sistema:

| Métrica | Descrição |
|---------|-----------|
| Ações totais | Contador global de ações processadas |
| Uptime & Memória | Estado do servidor em tempo real |
| Log de atividade | Últimas 50 ações com timestamp e detalhes |
| Top intenções | Gráfico das intenções mais usadas |
| Agentes ativos | Vista geral de todos os agentes disponíveis |

> URL: `http://localhost:7777/dashboard`

### ⏰ Nível 10 — Automação e Lembretes

| Capacidade | Exemplo |
|-----------|----------|
| Agendar tarefas | *"Agenda backup diário às 3h"* |
| Criar lembretes | *"Lembra-me às 15h para reunir"* |
| Listar tarefas | *"Lista tarefas agendadas"* |
| Histórico | *"Histórico de tarefas"* |

### 🧩 Nível 11 — Memória Inteligente e Skills

| Capacidade | Exemplo |
|-----------|----------|
| Memorizar preferências | *"Lembra que prefiro Python"* |
| Recordar informação | *"O que sabes sobre mim?"* |
| Criar skills | *"Cria skill de deploy"* |
| Listar skills | *"Que skills existem?"* |

### 👁️ Nível 12 — Visão, Alertas, Workflows e Clipboard

| Capacidade | Exemplo |
|-----------|----------|
| Analisar screenshot | *"Analisa este screenshot"* |
| Detetar erros no ecrã | *"Há erros no ecrã?"* |
| Criar monitores | *"Alerta se CPU > 90%"* |
| Criar workflows | *"Cria workflow de deploy"* |
| Clipboard histórico | *"Mostra histórico do clipboard"* |
| Pesquisa no clipboard | *"Pesquisa 'URL' no clipboard"* |

---

### 🔧 Nível 13 — Ferramentas escolhidas pela própria IA

Antes, o que o parser de regras não reconhecesse caía em conversa genérica —
mesmo havendo um agente capaz de resolver. Agora há um nível intermédio: o
modelo recebe um punhado de ferramentas escolhidas pelas palavras da tua
mensagem, decide se precisa de alguma, e o NEXO executa-a e devolve-lhe o
resultado.

Não tens de fazer nada para isto acontecer. Notas-o em perguntas que antes
davam respostas vagas:

- *"quanto é 17% de 4.320?"* → executa o cálculo em vez de estimar
- *"o que está no meu ecrã?"* → captura e analisa
- *"que ficheiros mexi hoje?"* → vai ver

**Cada ferramenta declara a sua classe de risco**, e é isso que decide se corre
sem perguntar:

| Classe | O que faz | Precisa de autorização? |
|--------|-----------|-------------------------|
| `ler` | pesquisa, ficheiros, estado do sistema | não |
| `escrever` | cria notas, PDFs, dentro do projecto | não (registado) |
| `sistema` | controla a máquina: ecrã, apps, comandos | **sim, uma vez por ferramenta** |

```
👤 Tu: que erro está no meu ecrã?
🤖 NEXO: 🔒 A ferramenta "analisar_ecra" controla o teu sistema e precisa
         de autorização. Diz "permite analisar_ecra" para autorizar.

👤 Tu: permite analisar_ecra
🤖 NEXO: ✅ Autorizada.
```

Para veres o que já autorizaste: *"que permissões tenho dadas?"*

---

### 🧭 Nível 14 — Missões para aparelhos que se movem

O NEXO pode servir de **cérebro de missão** a um drone ou robô: planeia a rota,
contorna zonas proibidas e, se o destino ficar inacessível, escolhe um plano B
que cumpra o **mesmo propósito** em vez de desistir.

```bash
npm run missao    # demonstração completa, num aparelho simulado
```

Ou pelo chat:

```
👤 Tu: planeia uma rota de 40.15,-8.65 até 40.18,-8.68 evitando o
       aeródromo em 40.166,-8.667 raio 400
🤖 NEXO: 🧭 Rota planeada — 4,3 km, ~6 min, contorna o aeródromo
```

> ⚠️ **O NEXO decide missão, não voo.** Quem estabiliza o aparelho e desvia de
> obstáculos é o piloto automático dele. E só vem incluído um aparelho
> **simulado**: comandar hardware real exige escrever um adaptador e autorizá-lo
> explicitamente em código. Voo autónomo é regulado pela ANAC/EASA.

---

## 📚 Guia por Exemplos

### Exemplo 1: Criar uma App Completa com IA

```
👤 Tu: Cria uma app de lista de tarefas em HTML e JavaScript

🤖 NEXO: 🏗️ Plano do Projeto: lista-de-tarefas
          📝 Aplicação simples de lista de tarefas
          🔧 Tecnologias: HTML, JavaScript, CSS
          
          📁 Ficheiros (6):
            🌐 index.html — Página principal
            🎨 style.css — Estilos
            📜 script.js — Lógica da aplicação
            📦 package.json — Configuração npm
            📖 README.md — Instruções
            🙈 .gitignore — Git config
          
          💬 Diz "sim" para construir o projeto.

👤 Tu: sim

🤖 NEXO: ✅ Projeto Criado!
          📁 Local: outputs/projects/lista-de-tarefas
          📄 Ficheiros criados: 6/6
```

### Exemplo 2: Pesquisa Web + Documento

```
👤 Tu: O que é inteligência artificial?

🤖 NEXO: 🔍 A inteligência artificial é um campo da ciência da
          computação que se dedica a criar sistemas capazes de...

👤 Tu: Cria um PDF sobre esse tema

🤖 NEXO: 📄 PDF criado com sucesso!
          📁 outputs/inteligencia_artificial_1707.pdf
```

### Exemplo 3: Automação Desktop Completa

```
👤 Tu: Abre o Chrome
🤖 NEXO: ✅ Aplicação aberta: chrome

👤 Tu: Digita: github.com
🤖 NEXO: ✅ Texto digitado: "github.com"

👤 Tu: Pressiona Enter
🤖 NEXO: ✅ Tecla pressionada: Enter

👤 Tu: Tira screenshot
🤖 NEXO: ✅ Screenshot guardado: outputs/screenshot_1707.png
```

### Exemplo 4: Conversa com Memória Persistente

```
👤 Tu: O meu nome é Pedro e sou programador Python
🤖 NEXO: Olá Pedro! Prazer em conhecer-te!

👤 Tu: Qual linguagem eu uso?
🤖 NEXO: Usas Python, como me disseste há pouco! 🐍
```

---

## 📝 Referência Rápida de Comandos

| Comando | Ação |
|---------|------|
| `/help` | Mostra ajuda completa |
| `/status` | Estado do sistema e agentes |
| `/agents` | Lista agentes disponíveis |
| `Cria PDF sobre [tema]` | Gera documento PDF |
| `Criar nota: [texto]` | Cria nota de texto |
| `Executar: [código JS]` | Corre código JavaScript |
| `Pesquisa [tema]` | Pesquisa na internet |
| `Abre [app/site]` | Abre programa ou website |
| `Lista processos` | Processos em execução |
| `Mata [processo]` | Termina processo |
| `Janelas abertas` | Lista janelas do sistema |
| `Digita: [texto]` | Simula escrita no teclado |
| `Pressiona [teclas]` | Simula atalho (ex: Ctrl+C) |
| `Screenshot` | Captura de ecrã |
| `Lembra-me às [hora]` | Cria lembrete |
| `Muda idioma para [lang]` | Muda língua |
| `Lembra que [info]` | Memoriza preferência |
| `Cria skill [nome]` | Cria skill reutilizável |
| `Alerta se [condição]` | Cria monitor |
| `Mostra clipboard` | Clipboard atual |
| `Cria projeto [desc]` | Gera app completa via IA |
| `Lista projetos` | Projetos já criados |
| `Listar ficheiros` | Mostra ficheiros na pasta |

---

## 🌍 Internacionalização (i18n)

O NEXO suporta **4 idiomas** com deteção automática:

| Idioma | Código | Como mudar |
|--------|--------|------------|
| 🇵🇹 Português | `pt` | *"Muda para português"* |
| 🇬🇧 English | `en` | *"Change to English"* |
| 🇪🇸 Español | `es` | *"Cambia a español"* |
| 🇫🇷 Français | `fr` | *"Change en français"* |

No CLI também podes usar o comando `/lang`:
```
/lang english     → Muda para inglês
/lang español     → Cambia al español
```

> Cada utilizador (Telegram/Discord) pode ter o seu próprio idioma. O sistema deteta automaticamente o idioma do OS.

---

## 🔀 Multi-Provedor de IA

Não estás limitado ao Groq. O NEXO tenta **vários provedores automaticamente**:

| Prioridade | Provedor | Custo |
|:----------:|----------|:-----:|
| 0 | Provedor Custom (teu) | — |
| 1 | Groq (LLaMA 3.3 70B) | Grátis |
| 2 | Cerebras | Grátis |
| 3 | Google Gemini | Grátis |
| 4 | HuggingFace | Grátis |
| 5 | Ollama (local) | Grátis |

Para configurar, usa `npm run setup` e segue o assistente, ou adiciona as chaves no `.env`.

---

## ⚙️ Configuração Avançada

### Ficheiro `.env` Completo

```env
# ═══ IA (obrigatório) ═══
GROQ_API_KEY=gsk_xxxxx
MODEL=llama-3.3-70b-versatile
FALLBACK_MODEL=mixtral-8x7b-32768

# ═══ Servidor ═══
PORT=7777

# ═══ Bots (opcionais) ═══
TELEGRAM_BOT_TOKEN=
DISCORD_BOT_TOKEN=

# ═══ Pesquisa Web (opcional — sem isto usa DuckDuckGo grátis) ═══
SERPER_API_KEY=
BRAVE_SEARCH_API_KEY=

# ═══ Provedores IA adicionais (opcionais) ═══
CEREBRAS_API_KEY=
GEMINI_API_KEY=
HF_API_KEY=
OLLAMA_URL=http://localhost:11434

# ═══ Segurança ═══
JWT_SECRET=uma-chave-secreta-qualquer
```

### Portas de Rede

| Serviço | Porta | Variável |
|---------|-------|----------|
| Servidor (API + Web) | 7777 | `PORT` |
| Webhooks | 3002 | `WEBHOOK_PORT` |

### Configurar Telegram Bot

1. No Telegram, fala com **@BotFather**
2. Envia `/newbot`, dá um nome e username
3. Copia o token → cola em `TELEGRAM_BOT_TOKEN` no `.env`
4. Executa `npm run telegram`

### Configurar Discord Bot

1. Vai a [discord.com/developers](https://discord.com/developers/applications)
2. Cria aplicação → Bot → copia o token
3. Cola em `DISCORD_BOT_TOKEN` no `.env`
4. Convida o bot ao teu servidor com as permissões necessárias
5. Executa `npm run discord`

---

## ❓ FAQ

**Q: Quanto custa usar o NEXO?**
R: Zero. A API Groq oferece 14.400 pedidos/dia grátis. O NEXO é 100% gratuito.

**Q: As minhas conversas são privadas?**
R: Sim. As conversas ficam guardadas localmente no teu PC. O texto enviado para a IA é processado pela API Groq (necessário para gerar respostas), mas nunca é partilhado com terceiros.

**Q: Posso usar no telemóvel?**
R: Sim! Inicia `npm run core`, abre o IP do PC no browser do telemóvel (porta 7777). Também podes usar o bot Telegram para acesso remoto.

**Q: O código que executo é seguro?**
R: Sim. Corre numa sandbox isolada (Node.js VM), sem acesso a ficheiros, rede ou sistema. Limite de 5 execuções por minuto.

**Q: E se a API Groq deixar de ser gratuita?**
R: O NEXO suporta qualquer API compatível com OpenAI. Podes trocar para Ollama (local, offline), LM Studio, ou outro provider.

**Q: Funciona em Mac/Linux?**
R: Sim. Desktop (Electron), Web, CLI e Bots funcionam em todos os OS. A automação de input (nível 5) usa PowerShell no Windows — noutros OS necessita adaptação.

**Q: Como adiciono novas capacidades?**
R: Cria um ficheiro `.js` na pasta `plugins/`, seguindo o template `plugins/_example.js`. O sistema carrega-os automaticamente sem tocar no código principal.

---

## 🆘 Resolução de Problemas

| Problema | Solução |
|----------|---------|
| "GROQ_API_KEY not found" | Executa `npm run setup` ou verifica `.env` |
| Porta 7777 já em uso | Muda `PORT=7778` no `.env` |
| `npm install` falha | Verifica Node.js 18+ com `node -v` |
| Desktop não abre | Usa `npm run dev` (inicia core + desktop juntos) |
| Bot Telegram não responde | Verifica token no `.env`, reinicia com `npm run telegram` |
| "Rate limit exceeded" | Espera 1 min (limite Groq: 30 req/min) |
| Screenshots não funcionam | Requer PowerShell (Windows) |
| Projeto não é criado | Verifica `GROQ_API_KEY`, a IA precisa estar online |

---

## 📊 Tabela de Agentes

| Agente | Função | Motor | Status |
|--------|--------|-------|--------|
| 🧠 AI Agent | Chat inteligente | Multi-provedor (Groq/Cerebras/Gemini/...) | ✅ Online |
| 🔍 Web Search | Pesquisa na internet | DuckDuckGo / Serper | ✅ Online |
| 📄 PDF Agent | Criar documentos PDF | PDFKit | ✅ Online |
| 📁 File Agent | Gerir ficheiros | Node.js fs | ✅ Online |
| ⚡ Code Runner | Executar código JS | Node.js VM sandbox | ✅ Online |
| 🖥️ System Agent | Controlo do SO | PowerShell / exec | ✅ Online |
| ⌨️ Input Agent | Automação input | PowerShell SendKeys | ✅ Online |
| 🏗️ Project Builder | Criar projetos | IA + System Agent | ✅ Online |
| 📡 Remote Agent | Automação SSH | ssh2 | ✅ Online |
| ⏰ Automation Agent | Tarefas agendadas | node-cron | ✅ Online |
| 🧩 Smart Memory | Memória inteligente | JSON persistente | ✅ Online |
| 🎓 Skill Agent | Skills reutilizáveis | JSON + IA | ✅ Online |
| 👁️ Vision Agent | Análise visual/OCR | Screenshot + IA | ✅ Online |
| 🚨 Alert Agent | Monitores/alertas | Polling + cron | ✅ Online |
| 🔄 Workflow Agent | Workflows multi-passo | JSON + chaining | ✅ Online |
| 📋 Clipboard Agent | Clipboard avançado | PowerShell | ✅ Online |
| 🔗 Agent Chaining | Multi-passo | Orchestrator IA | ✅ Online |
| 📊 Dashboard | Métricas tempo real | Express + Chart.js | ✅ Online |
| 🔌 Plugin System | Extensibilidade | Hot-reload | ✅ Online |
| 🌐 i18n | 4 idiomas | JSON locales | ✅ Online |

---

<p align="center">
  <b>🤖 NEXO v2.0</b><br>
  16+ agentes · 6 interfaces · 80+ comandos · 4 idiomas · 100% gratuito<br>
  Feito com ❤️ para simplificar o teu dia-a-dia
</p>
