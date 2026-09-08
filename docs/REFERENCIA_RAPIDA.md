# 🤖 NEXO - Referência Rápida

## Comandos de Início

```bash
npm install           # Instalar
npm run setup         # Configurar
npm run dev          # Iniciar tudo
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
