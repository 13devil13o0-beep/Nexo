# 🤖 NEXO - Referência Rápida

## Comandos de Início

```bash
npm run instalar      # Assistente guiado: verifica, instala e configura a IA
npm start             # Arranca no modo certo para este computador
npm run diagnostico   # O que está bem, o que falta e como se resolve
```

## Diagnóstico e manutenção

| Comando | O que faz |
|---------|-----------|
| `npm run diagnostico` | Estado da instalação (Node, bibliotecas, motor de IA) |
| `npm run atalho` | (Re)cria o ícone de arranque na área de trabalho |
| `npm run dispositivo` | Que perfil de arranque este aparelho justifica |
| `npm run providers` | Fornecedores conhecidos: quem sabe ferramentas, quem é local |
| `npm run check:models` | Avisa se algum fornecedor descontinuou o modelo configurado |
| `npm run metrics` | Tokens, custo e latência dos pedidos |
| `npm run bench` | Banco de ensaios: 30 tarefas sempre iguais |
| `npm run missao` | Demonstração de missão num aparelho simulado |

## Perfis de arranque

| Perfil | Quando | O que corre |
|--------|--------|-------------|
| Completo | ecrã + memória | janela própria, bandeja, atalhos |
| Leve | ecrã pequeno ou pouca RAM | motor + página leve no browser |
| Consola | SSH, sem gráficos | REPL do terminal |
| Serviço | servidor, contentor | só o motor, sem janela |

```bash
npm start -- --modo=servico   # forçar
NEXO_MODO=leve npm start      # ou pelo ambiente
```

## Interfaces

| Comando | Plataforma |
|---------|------------|
| `npm run desktop` | App Desktop |
| `npm run core` | Servidor (API + Web) |
| `npm run web` | Sinónimo de core |
| `npm run telegram` | Bot Telegram |
| `npm run discord` | Bot Discord |
| `npm run cli` | Terminal |

## Exemplos de Uso

### Chat IA
- "Qual é a capital de França?"
- "Explica-me o que é blockchain"
- "Traduz 'bom dia' para inglês"

### Criar PDF
- "Cria um PDF sobre energia renovável"
- "Gera documento sobre história do Brasil"

### Executar Código
- "Executar: console.log(2+2)"
- "Código: Math.sqrt(144)"

### Ficheiros
- "Listar ficheiros"
- "Criar nota: reunião às 15h"

## Comandos Especiais

| Comando | Ação |
|---------|------|
| `/help` | Ajuda |
| `/status` | Estado do sistema |
| `/agents` | Listar agentes |

## Portas

| Serviço | Porta |
|---------|-------|
| Servidor (API + Web) | 7777 |
| Webhooks | 3002 |

## API Endpoints

```
GET  /api/status          - Estado
POST /api/chat            - Enviar mensagem
GET  /api/conversations   - Listar conversas
GET  /api/stats           - Estatísticas
```

## Limites Gratuitos

- **30 pedidos/minuto**
- **14.400 pedidos/dia**
- **5 execuções código/minuto**

---

👤 "Abre o Chrome e vai a github.com"          → Abre browser, digita URL, carrega Enter
👤 "Cria uma app de tarefas em React"           → Planifica, gera código, cria 6+ ficheiros
👤 "Preço do Bitcoin hoje"                      → Pesquisa web em tempo real + resumo IA
👤 "Cria PDF sobre energia solar"               → Documento A4 profissional gerado por IA
👤 "Tira screenshot e lista os processos"       → Captura ecrã + lista processos do sistema
👤 "Executar: [1,2,3].map(x => x * 10)"        → Executa código JS em sandbox seguro → [10,20,30]

*NEXO v2.0*
