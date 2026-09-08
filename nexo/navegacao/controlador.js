/**
 * 🔄 Controlador de Missão
 *
 * Junta as peças: lê o estado, pergunta ao cérebro, executa a decisão, regista
 * tudo. Um ciclo por segundo, por omissão.
 *
 * PORQUE UM SEGUNDO E NÃO CINCO
 * A cinco segundos, um aparelho a 12 m/s anda sessenta metros entre decisões.
 * Como este ciclo não é o que evita obstáculos — isso é do piloto automático —
 * um segundo já é folgado para decisões de missão, e não sobrecarrega nada.
 *
 * PORQUE HÁ UM PORTÃO À ENTRADA
 * O contrato obriga cada dispositivo a declarar se é simulado. Aqui isso deixa
 * de ser informação e passa a ser barreira: um dispositivo físico não recebe a
 * primeira ordem sem alguém ter dito, por escrito, que sim. Um engano em código
 * de simulação custa um registo errado; em hardware custa o aparelho.
 */

const EventEmitter = require('events');

const geo = require('./geo');
const planeador = require('./planeador');
const cerebro = require('./cerebro');
const { ACCOES, AUTONOMIA, URGENCIA, validarDispositivo, validarMissao, missao: construirMissao } = require('./contrato');

const INTERVALO_PADRAO_MS = 1000;

class ControladorDeMissao extends EventEmitter {
  /**
   * @param {Object} opcoes
   * @param {Object} opcoes.dispositivo         cumpre nexo/navegacao/contrato
   * @param {Object} opcoes.missao              contrato.missao()
   * @param {number} [opcoes.intervaloMs]
   * @param {boolean} [opcoes.permitirDispositivoReal]  exigido para hardware
   * @param {boolean} [opcoes.usarModelo]       deixa a IA ordenar planos B
   */
  constructor(opcoes = {}) {
    super();

    this.dispositivo = opcoes.dispositivo;
    this.missao = construirMissao(opcoes.missao || {});
    this.intervaloMs = opcoes.intervaloMs || INTERVALO_PADRAO_MS;
    this.permitirDispositivoReal = opcoes.permitirDispositivoReal === true;
    this.usarModelo = opcoes.usarModelo === true;

    this.estado = 'parado';   // parado | a-caminho | aguarda-confirmacao | terminado
    this.destinoActual = this.missao.destino;
    this.rota = null;
    this.indicePonto = 0;
    this.ciclosSemResposta = 0;
    this.ciclo = null;
    this.registo = [];
    this.decisaoPendente = null;
    this.ultimoEstado = null;
    this.resultado = null;
  }

  // ═══════════════════════════════════════════════════════════
  // ARRANQUE
  // ═══════════════════════════════════════════════════════════

  /**
   * Verificações antes de o aparelho receber a primeira ordem.
   * @returns {{ok:boolean, erros:string[]}}
   */
  verificar() {
    const erros = [];

    const d = validarDispositivo(this.dispositivo);
    if (!d.valido) erros.push(`dispositivo inválido: falta ${d.faltas.join(', ')}`);

    const m = validarMissao(this.missao);
    if (!m.valido) erros.push(`missão inválida: falta ${m.faltas.join(', ')}`);

    // O portão. Ver cabeçalho.
    if (this.dispositivo && this.dispositivo.simulado === false && !this.permitirDispositivoReal) {
      erros.push(
        `"${this.dispositivo.nome}" é um dispositivo físico. ` +
        'Para o comandar é preciso passar permitirDispositivoReal: true, ' +
        'depois de confirmares que o aparelho está em condições e que o voo é legal onde vais voar.'
      );
    }

    // Autonomia total num aparelho físico é uma combinação que ninguém deve
    // fazer sem querer: em hardware, o modo autónomo tem de ser pedido duas
    // vezes — no dispositivo e na missão.
    if (this.dispositivo?.simulado === false
        && this.missao.autonomia === AUTONOMIA.AUTONOMO
        && !this.permitirDispositivoReal) {
      erros.push('modo autónomo com dispositivo físico exige permitirDispositivoReal: true');
    }

    return { ok: erros.length === 0, erros };
  }

  async iniciar() {
    const verificacao = this.verificar();
    if (!verificacao.ok) {
      const erro = new Error(verificacao.erros.join(' · '));
      this.anotar('recusa', erro.message);
      this.emit('erro', erro);
      throw erro;
    }

    await this.dispositivo.ligar();

    const capacidades = this.dispositivo.capacidades;
    this.rota = planeador.planear(this.missao.inicio, this.missao.destino, this.missao.regras, capacidades);

    if (!this.rota.viavel) {
      // Nem sequer há rota inicial. Antes de desistir, ver se um plano B serve.
      this.anotar('plano', `rota inicial inviável: ${this.rota.motivo}`);

      const alternativas = planeador.avaliarAlternativas(
        this.missao.inicio, this.missao.alternativas, this.missao, capacidades, 100
      );
      const viavel = alternativas.filter(a => a.viavel).sort((a, b) => a.distanciaM - b.distanciaM)[0];

      if (!viavel) {
        const erro = new Error(`missão impossível à partida: ${this.rota.motivo}`);
        this.anotar('recusa', erro.message);
        this.emit('erro', erro);
        throw erro;
      }

      this.destinoActual = viavel.localizacao;
      this.rota = viavel.rota;
      this.anotar('plano', `destino inicial substituído por "${viavel.nome}"`);
    }

    this.indicePonto = 0;
    this.estado = 'a-caminho';
    this.anotar('inicio',
      `${Math.round(this.rota.distanciaM)} m, ~${Math.round(this.rota.tempoEstimadoS || 0)} s, ` +
      `${this.rota.pontos.length} pontos` +
      (this.rota.zonasContornadas.length ? `, ${this.rota.zonasContornadas.length} zona(s) contornada(s)` : '')
    );

    await this.irParaPontoActual();

    // Sem unref(): uma missão a decorrer TEM de segurar o processo. Um ciclo
    // que deixa o Node fechar é um aparelho no ar sem ninguém a olhar.
    this.ciclo = setInterval(() => this.tick().catch(e => this.emit('erro', e)), this.intervaloMs);

    this.emit('inicio', { rota: this.rota, destino: this.destinoActual });
    return this.rota;
  }

  // ═══════════════════════════════════════════════════════════
  // CICLO
  // ═══════════════════════════════════════════════════════════

  async tick() {
    if (this.estado === 'terminado' || this.estado === 'aguarda-confirmacao') return;

    const estado = await this.dispositivo.estado();

    if (!estado) {
      this.ciclosSemResposta++;
      this.emit('sem-resposta', this.ciclosSemResposta);
    } else {
      this.ciclosSemResposta = 0;
      this.ultimoEstado = estado;
      this.emit('estado', estado);
    }

    const decisao = cerebro.avaliar(estado || this.ultimoEstado, this.missao, {
      capacidades: this.dispositivo.capacidades,
      destinoActual: this.destinoActual,
      rota: this.rota,
      ciclosSemResposta: this.ciclosSemResposta
    });

    await this.executar(decisao, estado);
  }

  async executar(decisao, estado) {
    // Só se regista o que muda alguma coisa. Um "continuar" por segundo enchia
    // o registo de ruído e escondia o que interessa.
    const repetida = this.ultimaDecisao
      && this.ultimaDecisao.accao === decisao.accao
      && this.ultimaDecisao.motivo === decisao.motivo;

    if (!repetida) {
      this.anotar('decisao', `${decisao.accao}: ${decisao.motivo}`, decisao.urgencia);
      this.emit('decisao', decisao);
    }
    this.ultimaDecisao = decisao;

    switch (decisao.accao) {
      case ACCOES.CONTINUAR:
        await this.seguirRota(estado);
        break;

      case ACCOES.DESVIAR:
        if (decisao.destino) await this.dispositivo.irPara(decisao.destino);
        break;

      case ACCOES.MUDAR_DESTINO:
        // Uma decisão de segurança nunca espera. Esta não é: é de missão.
        if (decisao.precisaConfirmacao && decisao.urgencia !== URGENCIA.SEGURANCA) {
          this.estado = 'aguarda-confirmacao';
          this.decisaoPendente = decisao;
          this.anotar('espera', `à espera de confirmação para mudar de destino`);
          this.emit('confirmacao', decisao);
        } else {
          await this.aplicarNovoDestino(decisao);
        }
        break;

      case ACCOES.REGRESSAR:
        await this.dispositivo.regressar();
        this.terminar('regressou', decisao.motivo);
        break;

      case ACCOES.PARAR:
        await this.dispositivo.parar();
        this.terminar('parado', decisao.motivo);
        break;

      case ACCOES.CONCLUIR:
        await this.dispositivo.parar();
        this.terminar('concluida', decisao.motivo);
        break;
    }
  }

  /** Anda de ponto em ponto da rota planeada. */
  async seguirRota(estado) {
    if (!estado || !this.rota?.pontos?.length) return;

    const alvo = this.rota.pontos[this.indicePonto];
    if (!alvo) return;

    const chegou = geo.distancia(estado.posicao, alvo) <= (this.missao.regras.raioChegadaM ?? cerebro.RAIO_CHEGADA_M);

    if (chegou && this.indicePonto < this.rota.pontos.length - 1) {
      this.indicePonto++;
      await this.irParaPontoActual();
      return;
    }

    // Aparelho parado a meio do caminho (ordem perdida, ou acabou de aceitar um
    // desvio): reenviar o ponto em vez de ficar a pairar à espera.
    if (!estado.aMover && !chegou) await this.irParaPontoActual();
  }

  async irParaPontoActual() {
    const ponto = this.rota?.pontos?.[this.indicePonto];
    if (!ponto) return;

    const resposta = await this.dispositivo.irPara(ponto);
    if (resposta && resposta.aceite === false) {
      this.anotar('recusa', `o aparelho recusou o ponto: ${resposta.motivo}`, URGENCIA.ATENCAO);
    }
  }

  async aplicarNovoDestino(decisao) {
    this.destinoActual = decisao.destino;
    this.rota = decisao.rota || planeador.replanear(
      this.ultimoEstado?.posicao || this.missao.inicio,
      decisao.destino,
      this.missao.regras,
      this.dispositivo.capacidades
    );
    this.indicePonto = 0;
    this.estado = 'a-caminho';
    this.decisaoPendente = null;
    this.ultimaDecisao = null;

    this.anotar('novo-destino', `a caminho de ${JSON.stringify(this.destinoActual)}`);
    await this.irParaPontoActual();
  }

  // ═══════════════════════════════════════════════════════════
  // INTERVENÇÃO HUMANA
  // ═══════════════════════════════════════════════════════════

  /**
   * Responde a um pedido de confirmação.
   * Recusar não é "continuar na mesma": é regressar. Se o destino ficou
   * inacessível e a pessoa não aceita a alternativa, andar por ali à espera de
   * ordens só gasta bateria.
   */
  async confirmar(aceita) {
    if (this.estado !== 'aguarda-confirmacao' || !this.decisaoPendente) {
      return { ok: false, motivo: 'não há nada à espera de confirmação' };
    }

    const decisao = this.decisaoPendente;

    if (aceita) {
      this.anotar('confirmado', 'alternativa aceite');
      await this.aplicarNovoDestino(decisao);
      return { ok: true, destino: this.destinoActual };
    }

    this.anotar('recusado', 'alternativa recusada — a regressar');
    this.estado = 'a-caminho';
    this.decisaoPendente = null;
    await this.dispositivo.regressar();
    this.terminar('regressou', 'alternativa recusada por quem supervisiona');
    return { ok: true, destino: this.missao.inicio };
  }

  /** Interrompe a missão e imobiliza o aparelho. */
  async abortar(motivo = 'interrompida por quem supervisiona') {
    await this.dispositivo.parar();
    this.terminar('abortada', motivo);
  }

  terminar(resultado, motivo) {
    if (this.ciclo) clearInterval(this.ciclo);
    this.ciclo = null;
    this.estado = 'terminado';
    this.resultado = { resultado, motivo };
    this.anotar('fim', `${resultado}: ${motivo}`);
    this.emit('fim', { resultado, motivo, registo: this.registo, resumo: this.resumo() });
  }

  // ═══════════════════════════════════════════════════════════
  // REGISTO
  // ═══════════════════════════════════════════════════════════

  anotar(tipo, texto, urgencia = URGENCIA.ROTINA) {
    const linha = {
      quando: new Date().toISOString(),
      segundos: this.ultimoEstado?.segundosDecorridos ?? null,
      tipo,
      urgencia,
      texto,
      bateria: this.ultimoEstado ? Math.round(this.ultimoEstado.bateria) : null,
      posicao: this.ultimoEstado?.posicao || null
    };
    this.registo.push(linha);
    return linha;
  }

  resumo() {
    return {
      missao: this.missao.nome,
      objetivo: this.missao.objetivo,
      estado: this.estado,
      resultado: this.resultado,
      destinoInicial: this.missao.destino,
      destinoFinal: this.destinoActual,
      destinoTrocado: this.destinoActual !== this.missao.destino,
      bateriaFinal: this.ultimoEstado ? Math.round(this.ultimoEstado.bateria) : null,
      duracaoS: this.ultimoEstado?.segundosDecorridos ?? null,
      decisoes: this.registo.filter(l => l.tipo === 'decisao').length,
      simulado: this.dispositivo?.simulado === true
    };
  }

  /** Registo em texto, para consola ou para responder no chat. */
  formatarRegisto() {
    const icone = {
      inicio: '🚀', decisao: '🧠', plano: '📍', espera: '⏸️', confirmado: '✅',
      recusado: '↩️', recusa: '⛔', 'novo-destino': '🔀', fim: '🏁'
    };

    return this.registo.map(l => {
      const t = l.segundos != null ? `[${String(l.segundos).padStart(4)}s]` : '[    ]';
      const b = l.bateria != null ? ` ${String(l.bateria).padStart(3)}%` : '     ';
      const marca = l.urgencia === URGENCIA.SEGURANCA ? ' 🔴' : '';
      return `${t}${b} ${icone[l.tipo] || '·'} ${l.texto}${marca}`;
    }).join('\n');
  }
}

module.exports = { ControladorDeMissao, INTERVALO_PADRAO_MS };
