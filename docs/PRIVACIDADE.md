# 🔒 Privacidade

O NEXO corre no teu computador. Esta página diz, sem rodeios, o que fica cá
dentro, o que sai, e para onde.

---

## Em resumo

| | |
|---|---|
| **Telemetria** | Nenhuma. O projecto não inclui nenhuma biblioteca de análise ou recolha de utilização. |
| **Conta / registo** | Não existe. O NEXO não tem contas nem servidores nossos. |
| **Servidores do projecto** | Não há. Nada do que fazes passa por infraestrutura nossa, porque não temos nenhuma. |
| **As tuas conversas** | Ficheiros no teu disco, em `memory/`. |
| **As tuas chaves de API** | No teu ficheiro `.env` local, que está excluído do controlo de versões. |

---

## O que sai do teu computador

Só três coisas, e todas por tua escolha:

**1. O texto que envias ao motor de IA.**
Para o NEXO responder, a tua mensagem vai para o fornecedor que configuraste —
Groq, Cerebras, OpenAI, Anthropic, Google ou outro. O que cada um faz com esse
texto rege-se pelos termos deles, não pelos nossos.

> **A excepção:** se usares o [Ollama](https://ollama.com), o modelo corre no
> teu computador e **nada sai** — nem sequer precisas de ligação à internet.

**2. As pesquisas na web**, quando pedes uma.
Vão para o DuckDuckGo (por omissão) ou para o Serper, se tiveres configurado.

**3. Nada mais.**
Não há mais nenhum destino. As restantes ligações que o código contém são
endereços de documentação e páginas de criação de chaves — links para
abrires, não sítios para onde enviamos seja o que for.

---

## O que o NEXO consegue fazer no teu computador

O NEXO é um assistente de secretária, e por isso tem capacidades que, listadas
a frio, são poderosas. Preferimos dizê-las do que escondê-las:

- ler e escrever ficheiros nas pastas autorizadas
- ver o que está no ecrã (captura de imagem), quando lho pedes
- ler e escrever na área de transferência
- escrever com o teclado e mover o rato
- abrir aplicações, listar e terminar processos
- executar comandos e ligar-se a máquinas por SSH

**Tudo isto acontece localmente.** Nenhuma destas acções envia dados para
lado nenhum — o ficheiro que o NEXO lê fica no teu disco, a captura de ecrã
serve para o modelo a analisar se tu o pedires, e mais nada.

---

## Como estas capacidades estão travadas

Não bastava dizer "é local". Cada ferramenta declara uma **classe de risco**, e
a classe decide se corre sem perguntar:

| Classe | O que faz | Precisa de autorização? |
|--------|-----------|-------------------------|
| `ler` | pesquisa, ficheiros, estado do sistema | Não |
| `escrever` | cria notas e documentos, dentro do projecto | Não, mas fica registado |
| `sistema` | controla a máquina: ecrã, aplicações, comandos | **Sim, uma vez por ferramenta** |

Uma ferramenta da classe `sistema` **nasce negada**. Só corre depois de
autorizares explicitamente, e a autorização fica guardada em
`memory/permissions.json`, onde a podes ver e retirar quando quiseres.

Além disso:

- **Ficheiros:** só pastas autorizadas. Fora delas, o acesso é recusado.
- **Código:** corre numa caixa isolada, sem acesso a ficheiros, rede ou processos.
- **Comandos:** lista de bloqueio para os destrutivos; processos críticos do
  sistema não podem ser terminados.
- **Hardware físico** (drones, robôs): exige autorização escrita em código, e
  nunca é comandável a partir do chat.

---

## Onde ficam os teus dados

Tudo dentro da pasta do projecto:

```
memory/          conversas, memória, permissões concedidas, métricas
outputs/         documentos que o NEXO cria para ti
logs/            registo de acções
.env             as tuas chaves de API
```

Nada disto é enviado a lado nenhum. Para apagar, apaga as pastas.

O `.env`, o `memory/` e os `logs/` estão excluídos do controlo de versões
(`.gitignore`), para não irem parar a um repositório por engano.

---

## Se encontrares algo que contradiga esta página

Abre um [issue](https://github.com/13devil13o0-beep/Nexo/issues). O código está
todo público e pode ser verificado — é essa a diferença entre dizer isto e
poder prová-lo.
