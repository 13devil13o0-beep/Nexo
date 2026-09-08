# 🧭 NEXO/ — Blueprint da Camada de Fornecedores

> Esta pasta não é o projecto NEXO inteiro (isso é [`docs/BLUEPRINT.md`](../docs/BLUEPRINT.md)).
> É uma peça dele: a fronteira que separa "o que o NEXO precisa" de "quem
> responde por trás". Este documento explica porque existe, o que já faz e o
> que falta para deixar de ser só uma vista de leitura.

---

## 1. Porque esta pasta existe

O projecto cresceu com **dois catálogos de fornecedores em paralelo**, sem
nenhum a saber da existência do outro:

| Catálogo | Fornecedores | Vive em |
|---|---|---|
| Cadeia gratuita/interna | groq, cerebras, gemini, huggingface, ollama | `orchestrator/llmRouter.js` |
| Fornecedor pessoal do utilizador | openai, anthropic, mistral, deepseek, xai, cohere, openrouter, custom | `agents/customProvider.js` |

Não era uma decisão de arquitectura — era um acidente histórico. A
consequência era concreta: o **ciclo de ferramentas** (`orchestrator/toolLoop.js`)
foi construído a pensar só no primeiro catálogo, por isso o Claude — que vive
no segundo — não conseguia usar nenhuma ferramenta do NEXO, mesmo sendo o
fornecedor mais capaz de o fazer bem.

`nexo/` nasce para resolver isto em duas frentes distintas:

1. **Tradução de protocolo** (`adapters/`) — a Anthropic fala um dialecto
   diferente do formato OpenAI-like que o resto do NEXO usa. Sem isto, o
   Claude não conseguia sequer receber uma ferramenta.
2. **Unificação de catálogo** (`contracts.js` + `providers.js`) — dar aos
   dois catálogos a mesma forma, para que perguntas como "quem sabe usar
   ferramentas?" ou "quem corre sem sair da máquina?" tenham uma resposta
   sem ter de se ler dois ficheiros diferentes.

---

## 2. Estado actual

| Ficheiro | O que faz | Está ligado ao que executa? |
|---|---|---|
| `contracts.js` | Define a forma `AIProvider` e o contrato (ainda por implementar) `SimulationProvider`. Não importa nada do projecto — é a única peça que qualquer camada pode ler sem risco de ciclo de imports. | N/A — é só forma, não comportamento |
| `providers.js` | Lê `llmRouter.PROVIDERS` e `customProvider.PROVIDER_CATALOG`, devolve os dois na forma comum (`listar`, `porId`, `capazesDe`, `formatarRelatorio`). | **Não.** É uma vista de leitura. Usado hoje só por `scripts/providers-report.js` (`npm run providers`). O `llmRouter` continua a decidir routing com os seus próprios filtros manuais (`p.supportsTools` em `llmRouter.js:331`), duplicados dos que `providers.js` já sabe calcular via `capazesDe()`. |
| `adapters/anthropic.js` | Traduz mensagens/ferramentas/respostas entre o formato comum do NEXO e o formato de mensagens da Anthropic. | **Sim.** `orchestrator/llmRouter.js:20` importa-o e `llmRouter.js:395-396` chama `conversar()` no `case 'anthropic'`. Também coberto em `test/test-all.js:1404`. |

Resumo numa frase: **a tradução de protocolo já está em produção; a
unificação de catálogo ainda é só um relatório de diagnóstico.**

---

## 3. Os contratos

### `AIProvider` (implementado)

```
id            'claude' | 'groq' | 'ollama' | ...
nome          nome legível
origem        'interno' (llmRouter) | 'pessoal' (customProvider)
configurado   tem chave, ou é local e está acessível
privacidade   'local' | 'remoto'
capacidades   { ferramentas, visao, streaming, raciocinio }
custo         { entradaPorMilhao, saidaPorMilhao, conhecido }
modeloPadrao  string
```

Regra que já vale a pena proteger: **custo desconhecido é `conhecido: false`,
nunca zero.** `precoDe()` em `providers.js` seria a fonte de erros de
faturação silenciosos se inventasse um preço em vez de admitir que não sabe.

### `SimulationProvider` (definido, zero implementações)

Contrato para um fornecedor que responde com resultados de simulação, não
com afirmações sobre o mundo real:

```
simular(pedido)   → { cenarios[], factores[], incerteza, execucoes, aviso }
disponivel()      → boolean
capacidades()     → { agentesMax, plataformas, deterministico }
```

A frase que este contrato proíbe por desenho: *"esta app tem 82% de hipóteses
de sucesso"*. A frase que exige: *"nas condições desta simulação, a
alternativa B saiu melhor em 82% das execuções"*. Hoje isto é só intenção —
não há nenhum módulo em `nexo/` nem fora dele que implemente
`SimulationProvider`. Fica registado aqui para não se perder, não para
sugerir que está a caminho.

---

## 4. Onde isto entra na cascata do NEXO

```
pedido do utilizador
      │
      ▼
Nível 1 — intentParser (regex)           orchestrator/intentParser.js
      │  não reconheceu?
      ▼
Nível 2 — ciclo de ferramentas           orchestrator/toolLoop.js + tools.js
      │    escolhe ferramentas plausíveis (tools.seleccionar)
      │    pede ao llmRouter.chat({ tools })
      │    llmRouter filtra fornecedores por p.supportsTools
      │    ─── se o fornecedor for 'anthropic' → nexo/adapters/anthropic.js
      │        traduz ferramentas/mensagens/resposta nos dois sentidos
      │  nenhuma ferramenta resolveu?
      ▼
Nível 3 — chat livre (RAG + memória + IA em texto)
```

`nexo/providers.js` não está neste caminho. Vive ao lado, respondido só
quando alguém pergunta explicitamente pelo estado dos fornecedores
(`npm run providers`).

---

## 5. O que falta para a unificação deixar de ser só um relatório

Por ordem de valor por esforço:

1. **Fazer o `llmRouter` consultar `providers.js` em vez de filtrar à mão.**
   `llmRouter.js:331` (`providers.filter(p => p.supportsTools)`) devia
   chamar `providers.capazesDe({ capacidades: { ferramentas: true } })`.
   Ganho: uma só definição de "quem sabe fazer o quê", em vez de duas que
   podem divergir sem ninguém notar.

2. **Declarar `ferramentas` correctamente no catálogo pessoal.**
   `doCatalogoPessoal()` em `providers.js:78-80` marca `ferramentas: false`
   para *todos* os fornecedores pessoais, incluindo o OpenAI e o próprio
   Claude — que já tem adaptador. É uma bandeira, não um limite técnico: fica
   `false` até o `customProvider.js` passar a expor tool-calling nas suas
   chamadas. Sem isto, o adaptador da Anthropic existe mas o nível 2 nunca o
   vê como opção quando o utilizador tem um fornecedor pessoal activo.

3. **Adaptador só para quem precisa.**
   Groq, Cerebras, DeepSeek, xAI, OpenRouter e a maior parte dos "pessoais"
   já falam o dialecto OpenAI-like nativamente — não precisam de adaptador.
   Gemini e Ollama têm formatos próprios e hoje a tradução deles vive
   dispersa dentro do `llmRouter.js`. Se o nível 2 (ferramentas) vier a
   precisar deles, o padrão é extrair essa tradução para
   `nexo/adapters/gemini.js` / `nexo/adapters/ollama.js`, do mesmo modo que
   se fez para a Anthropic — não antes de haver necessidade real.

4. **Expor o relatório fora da consola.**
   `formatarRelatorio()` só corre via `npm run providers`. Uma vez que o
   nível 2 dependa de `capazesDe()` para escolher fornecedor, o mesmo dado
   vale a pena aparecer no dashboard (`web/public/dashboard.html`) — não como
   feature nova, como consequência directa de já existir.

5. **`SimulationProvider`.** Sem prioridade definida; fica documentado no
   contrato para quando houver um caso de uso concreto a puxar a
   implementação, em vez de se construir por simetria com `AIProvider`.

---

## 6. Regras desta pasta

Além das regras gerais do NEXO ([`docs/BLUEPRINT.md`](../docs/BLUEPRINT.md)),
esta pasta tem as suas próprias, porque é fronteira:

- **`contracts.js` nunca importa nada do projecto.** É o único ficheiro que
  qualquer camada — agente, orchestrator, adaptador — pode requerer sem
  risco de ciclo. Se um dia precisar de importar algo, é sinal de que deixou
  de ser um contrato e passou a ser lógica; separar antes de acontecer.
- **`providers.js` não executa nada.** É deliberado (ver cabeçalho do
  ficheiro): permite verificar a unificação pelo banco de ensaios antes de
  se tocar em quem efectivamente chama os fornecedores. Quando o ponto 1 do
  roadmap acima for feito, este ficheiro passa a decidir — não antes.
- **Um adaptador devolve sempre a forma comum do NEXO** (`{ success, text,
  toolCalls, raw, provider, model, tokens, stopReason }`), nunca a resposta
  crua do fornecedor. É o que permite ao histórico de conversa ser neutro e,
  em teoria, mudar de fornecedor a meio de uma conversa sem que o utilizador
  note.
- **Custo desconhecido ≠ custo zero**, sempre. Ver `CUSTO_DESCONHECIDO` em
  `contracts.js`.

---

*Documento gerado em 2026-09-08, a partir da auditoria de `nexo/`,
`orchestrator/llmRouter.js`, `orchestrator/toolLoop.js`, `orchestrator/tools.js`
e `scripts/providers-report.js`.*
