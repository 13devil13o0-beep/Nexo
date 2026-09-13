/**
 * ✋ Regras das alterações geradas
 *
 * A fase das leituras recusava tudo o que mudasse o PC. Esta abre uma porta
 * pequena, e só uma lista de alterações conhecidas passa por ela. Cada uma
 * tem o alvo verificado pelo código, a partir do valor que o próprio
 * PowerShell diz que cada parâmetro recebe (ver o ligador no analisador).
 *
 * O QUE PASSA, SEMPRE COM UM "SIM" DO UTILIZADOR
 *   - valores do registo do utilizador (HKCU), fora das zonas que arrancam
 *     programas, mudam políticas ou desviam a rede
 *   - criar pastas e ficheiros novos, copiar, mover e renomear, só dentro das
 *     pastas pessoais (Ambiente de trabalho, Documentos, Transferências, ...)
 *   - acrescentar texto a um ficheiro dessas pastas
 *   - abrir um programa, uma pasta ou um site
 *   - fechar um programa pelo nome (nunca os do Windows, o antivírus ou o NEXO)
 *   - esvaziar a Reciclagem, pôr texto na área de transferência, mudar o brilho
 *   - bloquear o PC, agendar ou cancelar o encerramento, mudar o plano de energia
 *
 * O QUE NÃO PASSA
 * Apagar ficheiros, sobrescrever (-Force), o registo da máquina (HKLM),
 * serviços, drivers, desinstalar, e qualquer alvo que só se saiba a correr
 * (variáveis, pipeline, ciclos). Um alvo que não está escrito no comando não
 * pode ser mostrado ao utilizador antes do "sim", e então não se pede o "sim".
 */

const path = require('path');

/** Parâmetros que qualquer comando pode ter sem mudar o que faz. */
const COMUNS = new Set([
  'erroraction', 'warningaction', 'informationaction', 'errorvariable', 'warningvariable',
  'informationvariable', 'outvariable', 'outbuffer', 'pipelinevariable', 'verbose', 'debug',
  'whatif', 'confirm', 'passthru'
]);

/** Programas que servem para correr outro código. Abri-los é uma porta aberta. */
const INTERPRETADORES = new Set([
  'powershell', 'pwsh', 'powershell_ise', 'cmd', 'wscript', 'cscript', 'mshta', 'rundll32', 'regsvr32',
  'certutil', 'bitsadmin', 'msiexec', 'reg', 'regedit', 'schtasks', 'sc', 'wmic', 'bcdedit', 'diskpart',
  'format', 'net', 'net1', 'netsh', 'takeown', 'icacls', 'cacls', 'vssadmin', 'wevtutil', 'cipher',
  'curl', 'wget', 'ftp', 'tftp', 'installutil', 'msbuild', 'forfiles', 'pcalua', 'hh', 'ssh', 'scp',
  'python', 'pythonw', 'py', 'node', 'java', 'javaw', 'wsl', 'bash', 'wt', 'conhost', 'runas',
  'shutdown', 'taskkill', 'sdelete', 'robocopy', 'xcopy', 'attrib', 'mountvol', 'fsutil', 'cmstp', 'odbcconf'
]);

/** Extensões que, abertas, correm código. */
const EXTENSOES_QUE_CORREM_CODIGO = new Set([
  '.ps1', '.psm1', '.psd1', '.bat', '.cmd', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta',
  '.msi', '.msp', '.reg', '.scr', '.lnk', '.url', '.jar', '.py', '.pyw', '.com', '.cpl', '.dll',
  '.appref-ms', '.application', '.inf', '.scf', '.pif', '.msc', '.sct', '.ws', '.xbap'
]);

/**
 * Zonas do registo do utilizador que ficam de fora.
 *
 * Todas têm a mesma coisa em comum: um valor lá posto faz um programa correr,
 * muda regras de segurança ou desvia a ligação à internet. O arranque do
 * Windows tem ferramenta própria, com o seu "sim".
 */
const REGISTO_PROIBIDO = [
  '\\policies', '\\software\\classes', '\\environment', '\\currentversion\\run', '\\winlogon',
  'image file execution options', 'shell folders', 'command processor', 'windows defender',
  'appcompatflags', '\\security', 'startupapproved', '\\app paths', 'shellservice', 'internet settings',
  'group policy', '\\fileexts', '\\powershell', 'script host', '\\uninstall',
  '\\windows nt\\currentversion\\windows', 'explorer\\browser helper objects', '\\silentprocessexit'
];

/** Nomes de valores que costumam apontar para um programa a correr. */
const VALORES_PROIBIDOS = new Set(['scrnsave.exe', 'debugger', 'autorun', 'load', 'run', 'shell', 'userinit']);

function lista(valor) {
  if (valor == null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

function parametro(c, nome) {
  const alvo = nome.toLowerCase();
  return lista(c.parametros).find(p => String(p.nome).toLowerCase() === alvo) || null;
}

/**
 * O valor de um parâmetro tal como vai chegar ao comando, quando se sabe.
 *
 * Aceita constantes e textos com $env:X ("$env:USERPROFILE\Desktop"), que se
 * resolvem com o mesmo ambiente com que o comando vai correr. Qualquer outra
 * variável é um alvo que só se sabe a correr, e devolve null.
 *
 * @returns {string[]|null}
 */
function valoresDe(p, ambiente = process.env) {
  if (!p) return null;
  if (p.valor !== null && p.valor !== undefined) return [String(p.valor)];
  if (lista(p.valores).length) return lista(p.valores).map(String);
  if (p.tipo !== 'ExpandableStringExpressionAst' || typeof p.texto !== 'string') return null;

  let texto = p.texto.trim();
  if (!/^".*"$/s.test(texto)) return null;
  texto = texto.slice(1, -1);
  if (texto.includes('`') || texto.includes('$(')) return null;

  const procurar = (nome) => {
    const chave = Object.keys(ambiente).find(k => k.toLowerCase() === nome.toLowerCase());
    return chave ? ambiente[chave] : undefined;
  };
  let falhou = false;
  const expandido = texto.replace(/\$\{env:([A-Za-z0-9_()]+)\}|\$env:([A-Za-z0-9_]+)/gi, (_, a, b) => {
    const v = procurar(a || b);
    if (v === undefined) falhou = true;
    return v === undefined ? '' : v;
  });
  if (falhou || expandido.includes('$')) return null;
  return [expandido];
}

function ehDoRegisto(valor) {
  return /^\s*(hkcu:|hklm:|hkcr:|hku:|hkcc:|hkey_|registry::|microsoft\.powershell\.core\\registry::)/i.test(String(valor));
}

/**
 * Uma chave do registo do utilizador, fora das zonas proibidas.
 * @returns {{ ok: true, chave: string } | { ok: false, motivo: string }}
 */
function chaveDoUtilizador(valor) {
  let chave = String(valor || '').trim()
    .replace(/^microsoft\.powershell\.core\\registry::/i, '')
    .replace(/^registry::/i, '')
    .replace(/^hkey_current_user(?=\\|$)/i, 'HKCU:')
    .replace(/\//g, '\\');

  if (!/^hkcu:(\\|$)/i.test(chave)) {
    return { ok: false, motivo: `${valor} não é do registo do utilizador (só HKCU; o resto precisa de administrador e mexe na máquina toda)` };
  }
  if (/[*?[\]]/.test(chave)) return { ok: false, motivo: `a chave ${valor} tem caracteres especiais (*, ?)` };

  // Sem fronteira no fim de propósito: "\currentversion\run" apanha também RunOnce.
  const baixo = `${chave.toLowerCase()}\\`;
  const proibida = REGISTO_PROIBIDO.find(z => baixo.includes(z));
  if (proibida) return { ok: false, motivo: `a zona do registo "${proibida.replace(/^\\/, '')}" fica de fora: lá um valor pode pôr programas a correr ou mudar a segurança` };
  return { ok: true, chave };
}

/**
 * Um caminho dentro das pastas pessoais do utilizador.
 *
 * @param {string} valor
 * @param {string[]} raizes  pastas onde se pode mexer
 * @param {{ estrito?: boolean, casa?: string }} opcoes  estrito: a própria
 *   raiz não conta (mover ou renomear a pasta Documentos inteira fica de fora)
 */
function caminhoDoUtilizador(valor, raizes, opcoes = {}) {
  let caminho = String(valor || '').trim().replace(/\//g, '\\');
  if (!caminho) return { ok: false, motivo: 'caminho vazio' };

  if (/^~(\\|$)/.test(caminho)) {
    const casa = opcoes.casa || process.env.USERPROFILE || '';
    caminho = casa + caminho.slice(1);
  }
  if (!/^[a-z]:\\/i.test(caminho)) return { ok: false, motivo: `${valor} não é um caminho completo (tem de começar por C:\\ ou pela pasta pessoal)` };
  if (caminho.split('\\').some(parte => parte === '..' || parte === '.')) return { ok: false, motivo: `${valor} tem ".." ou "." no caminho` };
  if (/[<>"|]/.test(caminho) || /:.*:/.test(caminho.slice(2))) return { ok: false, motivo: `${valor} tem caracteres inválidos` };

  // Com curingas, conta a parte fixa antes do primeiro.
  const curinga = caminho.search(/[*?[]/);
  const fixo = (curinga >= 0 ? caminho.slice(0, curinga) : caminho).replace(/\\+$/, '');
  const baixo = fixo.toLowerCase();

  for (const raiz of lista(raizes)) {
    const r = String(raiz).replace(/[\\/]+$/, '').toLowerCase();
    if (!r) continue;
    if (baixo.startsWith(`${r}\\`)) return { ok: true, caminho };
    // "Downloads\*.pdf" é dentro; "Downloads*" apanharia também a pasta
    // "Downloads-antigos" ao lado, que já está fora.
    if (curinga >= 0 && baixo === r && caminho.slice(0, curinga).endsWith('\\')) return { ok: true, caminho };
    if (baixo === r && !opcoes.estrito) return { ok: true, caminho };
  }
  return { ok: false, motivo: `${valor} está fora das pastas pessoais (Ambiente de trabalho, Documentos, Transferências, Imagens, Música, Vídeos)` };
}

/** A mesma chave ou o mesmo caminho, escritos de formas diferentes, comparam igual. */
function normalizarAlvo(alvo) {
  return String(alvo || '').trim()
    .replace(/^microsoft\.powershell\.core\\registry::/i, '')
    .replace(/^registry::/i, '')
    .replace(/^hkey_current_user(?=\\|$)/i, 'HKCU:')
    .replace(/\//g, '\\')
    .replace(/\\+$/, '')
    .toLowerCase();
}

function nomeSimples(valor) {
  const nome = String(valor || '').trim();
  return nome && !/[\\/:*?"<>|]/.test(nome) && nome !== '.' && nome !== '..';
}

/** Recusa parâmetros que não estão na lista deste comando. */
function parametrosFora(c, permitidos) {
  const aceites = new Set(permitidos);
  return lista(c.parametros)
    .map(p => String(p.nome))
    .filter(n => !COMUNS.has(n.toLowerCase()) && !aceites.has(n.toLowerCase()));
}

function exigirValores(c, nome, ctx) {
  const p = parametro(c, nome);
  if (!p) return { valores: null };
  const valores = valoresDe(p, ctx.ambiente);
  if (!valores) return { erro: `o -${nome} de ${c.resolvido} só se sabe a correr: tem de estar escrito no comando` };
  return { valores };
}

// ═══════════════════════════════════════════════════════════
// CADA ALTERAÇÃO PERMITIDA
// ═══════════════════════════════════════════════════════════

function caminhosDoItem(c, ctx) {
  const p = exigirValores(c, 'Path', ctx);
  if (p.erro) return p;
  const lp = exigirValores(c, 'LiteralPath', ctx);
  if (lp.erro) return lp;
  const valores = [...(p.valores || []), ...(lp.valores || [])];
  if (!valores.length) return { erro: `${c.resolvido} precisa do caminho escrito no comando` };
  return { valores };
}

function noRegisto(c, ctx, verbo) {
  const caminhos = caminhosDoItem(c, ctx);
  if (caminhos.erro) return { motivo: caminhos.erro };
  const chaves = [];
  for (const v of caminhos.valores) {
    const r = chaveDoUtilizador(v);
    if (!r.ok) return { motivo: r.motivo };
    chaves.push(r.chave);
  }
  const nome = exigirValores(c, 'Name', ctx);
  if (nome.erro) return { motivo: nome.erro };
  const nomes = nome.valores || [];
  const proibido = nomes.find(n => VALORES_PROIBIDOS.has(n.toLowerCase()));
  if (proibido) return { motivo: `o valor "${proibido}" costuma apontar para um programa a correr` };

  const valor = parametro(c, 'Value');
  let novo = '';
  if (valor) {
    const vs = valoresDe(valor, ctx.ambiente);
    if (!vs) return { motivo: `o valor a gravar em ${nomes.join(', ') || 'registo'} tem de estar escrito no comando` };
    novo = ` para ${vs.join(', ')}`;
  }
  return { resumo: `${verbo} ${nomes.length ? `"${nomes.join('", "')}"` : 'a chave'} em ${chaves.join('; ')}${novo}` };
}

const ALTERACOES = {
  'set-itemproperty': (c, ctx) => {
    const fora = parametrosFora(c, ['path', 'literalpath', 'name', 'value', 'type']);
    if (fora.length) return { motivo: `Set-ItemProperty com -${fora[0]} fica de fora` };
    return noRegisto(c, ctx, 'muda o valor');
  },

  'new-itemproperty': (c, ctx) => {
    const fora = parametrosFora(c, ['path', 'literalpath', 'name', 'value', 'propertytype']);
    if (fora.length) return { motivo: `New-ItemProperty com -${fora[0]} fica de fora` };
    return noRegisto(c, ctx, 'cria o valor');
  },

  'remove-itemproperty': (c, ctx) => {
    const fora = parametrosFora(c, ['path', 'literalpath', 'name']);
    if (fora.length) return { motivo: `Remove-ItemProperty com -${fora[0]} fica de fora` };
    return noRegisto(c, ctx, 'apaga o valor');
  },

  'new-item': (c, ctx) => {
    const fora = parametrosFora(c, ['path', 'name', 'itemtype', 'value']);
    if (fora.length) return { motivo: `New-Item com -${fora[0]} fica de fora (sem -Force: nunca substitui o que já existe)` };
    const caminhos = exigirValores(c, 'Path', ctx);
    if (caminhos.erro) return { motivo: caminhos.erro };
    if (!caminhos.valores) return { motivo: 'New-Item precisa do caminho escrito no comando' };
    const nome = exigirValores(c, 'Name', ctx);
    if (nome.erro) return { motivo: nome.erro };
    if (nome.valores && !nome.valores.every(nomeSimples)) return { motivo: 'o -Name de New-Item tem de ser só um nome, sem pastas' };
    const completos = caminhos.valores.map(v => (nome.valores ? `${v.replace(/[\\/]+$/, '')}\\${nome.valores[0]}` : v));

    if (completos.every(ehDoRegisto)) {
      const chaves = [];
      for (const v of completos) {
        const r = chaveDoUtilizador(v);
        if (!r.ok) return { motivo: r.motivo };
        chaves.push(r.chave);
      }
      return { resumo: `cria a chave do registo ${completos.join('; ')}`, criados: chaves };
    }

    const tipo = exigirValores(c, 'ItemType', ctx);
    if (tipo.erro) return { motivo: tipo.erro };
    const qual = String((tipo.valores || [''])[0]).toLowerCase();
    if (!['file', 'directory'].includes(qual)) return { motivo: 'New-Item só cria ficheiros (-ItemType File) ou pastas (-ItemType Directory)' };
    for (const v of completos) {
      const r = caminhoDoUtilizador(v, ctx.raizes, { estrito: true });
      if (!r.ok) return { motivo: r.motivo };
      if (/[*?[]/.test(v)) return { motivo: 'New-Item não aceita curingas no caminho' };
    }
    return { resumo: `cria ${qual === 'file' ? 'o ficheiro' : 'a pasta'} ${completos.join('; ')} (se já existir, não substitui)`, criados: completos };
  },

  // Apagar só existe para desfazer o que o próprio NEXO criou, e só vazio.
  //
  // Medido: depois de criar uma chave de registo com um "sim", "desfaz a
  // última alteração" não tinha como a tirar. Apagar ficheiros do utilizador
  // continua de fora. Sem -Recurse nem -Force, uma pasta onde entretanto se
  // guardou alguma coisa não é apagada: o Windows recusa e nada se perde.
  'remove-item': (c, ctx) => {
    const fora = parametrosFora(c, ['path', 'literalpath']);
    if (fora.length) return { motivo: `Remove-Item com -${fora[0]} fica de fora: só se apaga, vazio, o que o próprio NEXO criou` };
    const caminhos = caminhosDoItem(c, ctx);
    if (caminhos.erro) return { motivo: caminhos.erro };
    const criados = ctx.criadosPeloNexo || new Set();
    for (const v of caminhos.valores) {
      if (/[*?[]/.test(v)) return { motivo: 'Remove-Item não aceita curingas' };
      const chave = ehDoRegisto(v) ? chaveDoUtilizador(v) : caminhoDoUtilizador(v, ctx.raizes, { estrito: true });
      if (!chave.ok) return { motivo: chave.motivo };
      if (!criados.has(normalizarAlvo(chave.chave || chave.caminho))) {
        return { motivo: `${v} não foi criado pelo NEXO: apagar ficheiros, pastas ou chaves do utilizador fica de fora (só se apaga o que o NEXO criou, para desfazer)` };
      }
    }
    return { resumo: `apaga ${caminhos.valores.join('; ')}, criado pelo NEXO (só se estiver vazio)` };
  },

  'copy-item': (c, ctx) => copiarOuMover(c, ctx, 'copia', ['path', 'literalpath', 'destination', 'recurse', 'container', 'filter', 'include', 'exclude']),
  'move-item': (c, ctx) => copiarOuMover(c, ctx, 'move', ['path', 'literalpath', 'destination', 'filter', 'include', 'exclude']),

  'rename-item': (c, ctx) => {
    const fora = parametrosFora(c, ['path', 'literalpath', 'newname']);
    if (fora.length) return { motivo: `Rename-Item com -${fora[0]} fica de fora` };
    const caminhos = caminhosDoItem(c, ctx);
    if (caminhos.erro) return { motivo: caminhos.erro };
    for (const v of caminhos.valores) {
      const r = caminhoDoUtilizador(v, ctx.raizes, { estrito: true });
      if (!r.ok) return { motivo: r.motivo };
      if (/[*?[]/.test(v)) return { motivo: 'Rename-Item não aceita curingas' };
    }
    const novo = exigirValores(c, 'NewName', ctx);
    if (novo.erro || !novo.valores) return { motivo: novo.erro || 'Rename-Item precisa do novo nome escrito no comando' };
    if (!nomeSimples(novo.valores[0])) return { motivo: 'o novo nome tem de ser só um nome, sem pastas' };
    return { resumo: `muda o nome de ${caminhos.valores.join('; ')} para "${novo.valores[0]}"` };
  },

  'add-content': (c, ctx) => {
    const fora = parametrosFora(c, ['path', 'literalpath', 'value', 'encoding']);
    if (fora.length) return { motivo: `Add-Content com -${fora[0]} fica de fora` };
    const caminhos = caminhosDoItem(c, ctx);
    if (caminhos.erro) return { motivo: caminhos.erro };
    for (const v of caminhos.valores) {
      const r = caminhoDoUtilizador(v, ctx.raizes, { estrito: true });
      if (!r.ok) return { motivo: r.motivo };
      if (/[*?[]/.test(v)) return { motivo: 'Add-Content não aceita curingas' };
      if (EXTENSOES_QUE_CORREM_CODIGO.has(path.extname(v).toLowerCase())) return { motivo: `escrever num ficheiro ${path.extname(v)} é escrever código que corre` };
    }
    return { resumo: `acrescenta texto ao fim de ${caminhos.valores.join('; ')}` };
  },

  'stop-process': (c, ctx) => {
    const fora = parametrosFora(c, ['name']);
    if (fora.length) return { motivo: `Stop-Process só pelo nome (-Name), sem -${fora[0]}` };
    const nomes = exigirValores(c, 'Name', ctx);
    if (nomes.erro || !nomes.valores) return { motivo: nomes.erro || 'Stop-Process precisa do nome do programa escrito no comando' };
    for (const n of nomes.valores) {
      const limpo = n.toLowerCase().replace(/\.exe$/, '');
      if (/[*?[]/.test(limpo)) return { motivo: 'Stop-Process não aceita curingas: fecharia programas que ninguém nomeou' };
      if (ctx.protegidos.has(limpo)) return { motivo: `"${n}" é do Windows, do antivírus ou do próprio NEXO, e não se fecha` };
    }
    return { resumo: `fecha à força ${nomes.valores.join(', ')} (o que não estiver guardado perde-se)`, irreversivel: true };
  },

  'start-process': (c, ctx) => {
    const fora = parametrosFora(c, ['filepath', 'argumentlist', 'workingdirectory', 'windowstyle']);
    if (fora.length) return { motivo: `Start-Process com -${fora[0]} fica de fora (por exemplo -Verb RunAs pediria administrador)` };
    const ficheiro = exigirValores(c, 'FilePath', ctx);
    if (ficheiro.erro || !ficheiro.valores) return { motivo: ficheiro.erro || 'Start-Process precisa do programa escrito no comando' };
    const alvo = ficheiro.valores[0].trim();

    const argumentos = parametro(c, 'ArgumentList');
    const args = argumentos ? valoresDe(argumentos, ctx.ambiente) : [];
    if (argumentos && !args) return { motivo: 'os argumentos de Start-Process têm de estar escritos no comando' };

    if (/^https?:\/\/[^\s"'<>]+$/i.test(alvo)) {
      if (args.length) return { motivo: 'um site abre-se sem argumentos' };
      return { resumo: `abre o site ${alvo} no navegador`, textosPermitidos: [alvo] };
    }
    if (/^ms-settings:[a-z0-9-]*$/i.test(alvo)) {
      if (args.length) return { motivo: 'as Definições abrem-se sem argumentos' };
      return { resumo: `abre as Definições do Windows (${alvo})` };
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(alvo) && !/^[a-z]:\\/i.test(alvo)) {
      return { motivo: `"${alvo}" é um endereço de protocolo que pode lançar outra coisa; só se abrem sites http e https` };
    }

    const base = path.win32.basename(alvo).toLowerCase();
    const extensao = path.win32.extname(base);
    const semExtensao = extensao === '.exe' ? base.slice(0, -4) : base;
    if (INTERPRETADORES.has(semExtensao)) return { motivo: `${alvo} serve para correr outros comandos, e não se abre por aqui` };
    if (EXTENSOES_QUE_CORREM_CODIGO.has(extensao)) return { motivo: `um ficheiro ${extensao} corre código ao ser aberto` };
    if ((args || []).some(a => /^\s*[\\/]{2}|https?:|file:/i.test(a))) return { motivo: 'os argumentos têm endereços ou caminhos de rede' };
    // Um navegador aberto com estas opções fica controlável por outros programas.
    if ((args || []).some(a => /remote-debugging|load-extension|disable-web-security|user-data-dir|--app=|--gpu-launcher|--utility-cmd-prefix|--renderer-cmd-prefix/i.test(a))) {
      return { motivo: 'essas opções deixam outros programas controlar o que se abre' };
    }

    return { resumo: `abre ${alvo}${args.length ? ` com "${args.join(' ')}"` : ''}` };
  },

  'clear-recyclebin': (c) => {
    const fora = parametrosFora(c, ['driveletter', 'force']);
    if (fora.length) return { motivo: `Clear-RecycleBin com -${fora[0]} fica de fora` };
    // Medido: com -WhatIf fica pendurado à espera de uma resposta que não vem.
    return { resumo: 'esvazia a Reciclagem (o que lá está desaparece de vez)', irreversivel: true, simulavel: false };
  },

  'set-clipboard': (c) => {
    const fora = parametrosFora(c, ['value', 'append']);
    if (fora.length) return { motivo: `Set-Clipboard com -${fora[0]} fica de fora` };
    return { resumo: 'põe texto na área de transferência' };
  },

  'invoke-cimmethod': (c, ctx, analise) => {
    const fora = parametrosFora(c, ['methodname', 'arguments']);
    if (fora.length) return { motivo: `Invoke-CimMethod com -${fora[0]} fica de fora` };
    const metodo = exigirValores(c, 'MethodName', ctx);
    const nome = String((metodo.valores || [''])[0]).toLowerCase();
    const doBrilho = lista(analise.comandos).some(o =>
      String(o.resolvido).toLowerCase() === 'get-ciminstance' &&
      lista(o.parametros).some(p => String(p.nome).toLowerCase() === 'classname' && String(p.valor).toLowerCase() === 'wmimonitorbrightnessmethods'));
    if (nome !== 'wmisetbrightness' || !doBrilho) return { motivo: 'Invoke-CimMethod só serve aqui para mudar o brilho (WmiSetBrightness em WmiMonitorBrightnessMethods)' };
    return { resumo: 'muda o brilho do ecrã', recebePipeline: true };
  }
};

function copiarOuMover(c, ctx, verbo, permitidos) {
  const fora = parametrosFora(c, permitidos);
  if (fora.length) return { motivo: `${c.resolvido} com -${fora[0]} fica de fora (sem -Force: nunca substitui o que já existe)` };
  const origens = caminhosDoItem(c, ctx);
  if (origens.erro) return { motivo: origens.erro };
  for (const v of origens.valores) {
    const r = caminhoDoUtilizador(v, ctx.raizes, { estrito: true });
    if (!r.ok) return { motivo: r.motivo };
  }
  const destino = exigirValores(c, 'Destination', ctx);
  if (destino.erro || !destino.valores) return { motivo: destino.erro || `${c.resolvido} precisa do destino escrito no comando` };
  for (const v of destino.valores) {
    const r = caminhoDoUtilizador(v, ctx.raizes);
    if (!r.ok) return { motivo: `o destino ${r.motivo}` };
    if (/[*?[]/.test(v)) return { motivo: 'o destino não pode ter curingas' };
  }
  return { resumo: `${verbo} ${origens.valores.join('; ')} para ${destino.valores.join('; ')}` };
}

// ═══════════════════════════════════════════════════════════
// PROGRAMAS DO WINDOWS COM ARGUMENTOS EXACTOS
// ═══════════════════════════════════════════════════════════

function argumentosDoPrograma(c) {
  const posicionais = lista(c.parametros)
    .filter(p => /^\d+$/.test(String(p.nome)))
    .sort((a, b) => Number(a.nome) - Number(b.nome));
  const valores = [];
  for (const p of posicionais) {
    // "user32.dll,LockWorkStation" chega como lista de dois, e o PowerShell
    // volta a juntá-los com vírgula ao passar a um programa.
    if (p.valor === null || p.valor === undefined) {
      if (!lista(p.valores).length) return null;
      valores.push(lista(p.valores).map(String).join(','));
      continue;
    }
    valores.push(String(p.valor));
  }
  // O ligador só devolve posicionais; se houver elementos que não viu, não se sabe o que lá vai.
  if (lista(c.elementos).length !== valores.length) return null;
  return valores;
}

function duracaoLegivel(segundos) {
  const s = Number(segundos);
  if (s < 120) return `${s} segundos`;
  if (s < 7200) return `${Math.round(s / 60)} minutos`;
  return `${Math.round(s / 360) / 10} horas`;
}

const PROGRAMAS = {
  shutdown: (args) => {
    const a = args.map(x => x.toLowerCase().replace(/^-/, '/'));
    if (a.length === 1 && a[0] === '/a') return { resumo: 'cancela o encerramento agendado' };
    if (a.length === 3 && ['/s', '/r'].includes(a[0]) && a[1] === '/t' && /^\d+$/.test(a[2])) {
      const segundos = Number(a[2]);
      if (segundos < 30) return { motivo: 'o encerramento tem de dar pelo menos 30 segundos, para dar tempo de cancelar' };
      if (segundos > 315360000) return { motivo: 'tempo de encerramento inválido' };
      return {
        resumo: `${a[0] === '/s' ? 'desliga' : 'reinicia'} o PC daqui a ${duracaoLegivel(segundos)} (cancela-se com "shutdown /a" antes disso; o que não estiver guardado perde-se)`,
        irreversivel: true
      };
    }
    return { motivo: 'do shutdown só se aceita "/s /t segundos", "/r /t segundos" ou "/a"' };
  },

  rundll32: (args) => {
    if (args.length === 1 && args[0].toLowerCase() === 'user32.dll,lockworkstation') return { resumo: 'bloqueia o PC (volta-se a entrar com o PIN ou a palavra-passe)' };
    return { motivo: 'do rundll32 só se aceita "user32.dll,LockWorkStation"' };
  },

  powercfg: (args) => {
    const a = args.map(x => x.toLowerCase().replace(/^-/, '/'));
    const esquema = a[1] || '';
    const valido = /^(scheme_min|scheme_max|scheme_balanced|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(esquema);
    if (a.length === 2 && a[0] === '/setactive' && valido) return { resumo: `muda o plano de energia para ${args[1]}` };
    return { motivo: 'do powercfg só se aceita "/setactive" com um plano' };
  }
};

function avaliarPrograma(c, ctx) {
  const caminho = String(c.caminhoDoPrograma || '').toLowerCase();
  const sistema = String(ctx.ambiente.SystemRoot || ctx.ambiente.SYSTEMROOT || 'C:\\Windows').toLowerCase().replace(/\\+$/, '');
  const nome = path.win32.basename(caminho).replace(/\.exe$/, '');
  const regra = PROGRAMAS[nome];
  if (!regra) return { motivo: `o programa "${c.nome}" não está na lista (só shutdown, rundll32 para bloquear e powercfg)` };
  if (!caminho.startsWith(`${sistema}\\system32\\`)) return { motivo: `${c.nome} não é o do Windows (${c.caminhoDoPrograma})` };
  const args = argumentosDoPrograma(c);
  if (!args) return { motivo: `os argumentos de ${c.nome} têm de estar todos escritos no comando` };
  const r = regra(args);
  return r.motivo ? r : { ...r, simulavel: false };
}

/**
 * Avalia um comando que muda o PC.
 * @returns {{ motivo: string } | { resumo, irreversivel, simulavel, textosPermitidos }}
 */
function avaliarAlteracao(c, analise, ctx) {
  if (c.tipo === 'Application') return avaliarPrograma(c, ctx);

  const nome = String(c.resolvido).toLowerCase();
  const regra = ALTERACOES[nome];
  if (!regra) return { motivo: `${c.resolvido} não está na lista de alterações que o NEXO pode fazer` };

  const r = regra(c, ctx, analise);
  if (r.motivo) return r;
  if (c.posicao > 0 && !r.recebePipeline) {
    return { motivo: `${c.resolvido} recebe o alvo pela pipeline (|): o alvo tem de estar escrito no comando para se poder mostrar antes do "sim"` };
  }
  return {
    comando: c.resolvido,
    resumo: r.resumo,
    irreversivel: r.irreversivel === true,
    simulavel: r.simulavel === false ? false : c.simulavel === true,
    textosPermitidos: r.textosPermitidos || [],
    criados: (r.criados || []).map(normalizarAlvo)
  };
}

module.exports = {
  avaliarAlteracao,
  caminhoDoUtilizador,
  chaveDoUtilizador,
  normalizarAlvo,
  valoresDe,
  ALTERACOES,
  PROGRAMAS,
  INTERPRETADORES,
  EXTENSOES_QUE_CORREM_CODIGO,
  REGISTO_PROIBIDO
};
