# 🧭 nexo/navegacao — Supervisor de Missão

O NEXO como **cérebro de missão** de um aparelho que se move: drone, robô, veículo.
Planeia rotas, reage a imprevistos e, se o destino ficar inacessível, escolhe um
plano B que cumpra o mesmo propósito.

---

## ⛔ A divisão que torna isto possível

| Camada | Quem manda | Escala | Decide |
|---|---|---|---|
| **Voo** | piloto automático do aparelho (PX4, ArduPilot, SDK do fabricante) | milissegundos | estabilizar, não bater, geofence, regressar por falha |
| **Missão** | **NEXO (este módulo)** | segundos | que ponto a seguir, o plano ainda serve, qual o plano B |

**Este módulo nunca pilota.** Um obstáculo que aparece a 12 m/s resolve-se na
primeira camada. Um ciclo de decisão com um modelo de linguagem pelo meio nunca
chega a tempo — e fingir que chega seria o único erro verdadeiramente perigoso
que este código podia cometer.

---

## 🔒 As três barreiras

**1. Um dispositivo tem de se declarar.**
`simulado` é obrigatório no contrato. Quem o omite é tratado como **físico** —
nunca ao contrário. É a mesma regra do custo em `nexo/contracts.js`: desconhecido
nunca vira zero.

**2. Hardware exige autorização explícita em código.**
```js
new ControladorDeMissao({ dispositivo: droneReal, permitirDispositivoReal: true })
```
Sem essa linha, o controlador recusa antes de enviar a primeira ordem.

**3. O chat nunca comanda hardware.**
As ferramentas `planear_rota` e `simular_missao` correm **sempre** em aparelho
simulado, sem opção. Um modelo interpreta mal de vez em quando: interpretar mal
uma simulação custa um parágrafo errado.

---

## 🧠 Quem decide o quê

Determinístico, sempre, sem rede — **nunca passa por um modelo**:
bateria crítica · reserva de regresso · altitude · raio máximo · zonas proibidas ·
perda de comunicação · chegada.

O modelo entra **num único sítio**: ordenar planos B que as regras **já
aprovaram** (`cerebro.ordenarAlternativas`). Nunca acrescenta destinos, nunca
levanta um veto, nunca é esperado. Se falhar, usa-se a ordem por distância e a
missão segue.

> As regras decidem o que é **possível**; o modelo opina sobre o que é **preferível**.

---

## 📦 Ficheiros

| Ficheiro | O que faz |
|---|---|
| `contrato.js` | O que um dispositivo tem de saber fazer. Não importa nada do projecto. |
| `geo.js` | Haversine, rumos, zonas circulares e poligonais, contornos. |
| `planeador.js` | Rota, contorno de zonas, tempo e energia. Geométrico — não conhece terreno. |
| `cerebro.js` | Decisões. Regras determinísticas + opinião opcional da IA. |
| `controlador.js` | O ciclo: lê estado → decide → executa → regista. |
| `dispositivos/simulado.js` | O único aparelho incluído. |
| `pedidos.js` | Ponte para linguagem natural (usada pelas ferramentas). |

---

## 🚀 Usar

```bash
npm run missao        # demonstração completa, com destino a fechar a meio do voo
```

```js
const { criarSimulado, ControladorDeMissao } = require('./nexo/navegacao');

const drone = criarSimulado({ posicao: { lat: 40.15, lng: -8.65, alt: 60 } });

const c = new ControladorDeMissao({
  dispositivo: drone,
  missao: {
    objetivo: { proposito: 'inspecionar', alvo: 'zona-sul' },   // obrigatório
    inicio:  { lat: 40.15, lng: -8.65, alt: 60 },
    destino: { lat: 40.18, lng: -8.68, alt: 60 },
    alternativas: [
      { nome: 'Observação B', localizacao: { lat: 40.169, lng: -8.66 }, proposito: 'inspecionar' }
    ],
    regras: {
      zonasProibidas: [{ nome: 'aeródromo', centro: { lat: 40.166, lng: -8.667 }, raioM: 400 }],
      altitudeMaxM: 120,
      reservaRegressoPct: 25
    },
    autonomia: 'supervisionado'   // trocar de destino pergunta primeiro
  }
});

c.on('confirmacao', d => c.confirmar(true));   // ou perguntar ao utilizador
c.on('fim', ({ resumo }) => console.log(c.formatarRegisto(), resumo));
await c.iniciar();
```

**`objetivo.proposito` é obrigatório.** Sem ele não há como validar um plano B, e
um plano B por validar é pior do que nenhum: vai para outro sítio qualquer e diz
que cumpriu.

---

## ✈️ Ligar hardware real

Não vem nenhum adaptador incluído, de propósito. Para escrever um:

1. Implementa `ligar`, `estado`, `irPara`, `parar`, `regressar` sobre o SDK do aparelho.
2. Declara `simulado: false` e as `capacidades` verdadeiras.
3. Passa `permitirDispositivoReal: true` ao controlador.
4. **Mantém o piloto automático a mandar na segurança.** O `irPara` deve pedir ao
   aparelho que vá a um ponto — nunca desligar o que o protege.

E antes disso: voo autónomo é regulado. Em Portugal, ANAC/EASA. Este módulo não
é conformidade legal e não substitui autorização nenhuma.
