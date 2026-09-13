/**
 * 🖥️ Perfil do PC
 *
 * Um comando que funciona num PC não funciona necessariamente noutro: o
 * Windows pode estar noutra língua, a pasta Transferências pode estar no
 * OneDrive, o portátil pode não deixar mudar o brilho. Para o NEXO escrever
 * comandos à medida, precisa de saber onde está.
 *
 * O perfil é recolhido uma vez, só com leituras, e guardado neste PC. Volta a
 * ser recolhido passada uma semana, ou quando se pede.
 *
 * O QUE NÃO ENTRA
 * Números de série, endereços MAC, IPs e nomes de redes Wi-Fi. Nada disso ajuda
 * a escrever um comando, e o perfil vai no pedido ao modelo de IA.
 */

const fs = require('fs');
const path = require('path');
const powershell = require('./powershell');

const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000;

function pastaDeDados() {
  return process.env.USER_DATA_PATH
    ? path.join(process.env.USER_DATA_PATH, 'data')
    : path.join(__dirname, '..', 'user_data');
}

function ficheiroDoPerfil() {
  return path.join(pastaDeDados(), 'pc-perfil.json');
}

const SCRIPT_RECOLHA = String.raw`[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'SilentlyContinue'

function Tentar([scriptblock]$bloco) { try { & $bloco } catch { $null } }

$so = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$versaoWin = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'

$cpu = @(Get-CimInstance Win32_Processor | Select-Object -First 1)
$gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object {
  [ordered]@{ nome = $_.Name; resolucao = $(if ($_.CurrentHorizontalResolution) { "$($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution)" } else { $null }) }
})

$discos = @(Tentar { Get-PhysicalDisk | ForEach-Object {
  [ordered]@{ nome = $_.FriendlyName; tipo = [string]$_.MediaType; gb = [math]::Round($_.Size / 1GB) }
} })

$volumes = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
  [ordered]@{ letra = $_.DeviceID; gb = [math]::Round($_.Size / 1GB); livreGb = [math]::Round($_.FreeSpace / 1GB, 1) }
})

$brilho = [bool](Tentar { Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness -ErrorAction Stop })
$bateria = [bool](Get-CimInstance Win32_Battery)

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

$pastasShell = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
function Pasta($valor) { if ($valor) { [Environment]::ExpandEnvironmentVariables($valor) } else { $null } }

$navegador = Tentar { (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice').ProgId }

$chaves = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$programas = @(Get-ItemProperty $chaves |
  Where-Object { $_.DisplayName -and $_.SystemComponent -ne 1 -and -not $_.ParentKeyName -and $_.ReleaseType -notmatch 'Update|Hotfix' } |
  Sort-Object DisplayName -Unique |
  ForEach-Object { [ordered]@{ nome = [string]$_.DisplayName; versao = [string]$_.DisplayVersion; editor = [string]$_.Publisher } })

[ordered]@{
  windows = [ordered]@{
    nome = [string]$so.Caption
    versao = [string]$versaoWin.DisplayVersion
    build = [string]$so.BuildNumber
    arquitectura = [string]$so.OSArchitecture
    idioma = (Get-UICulture).Name
    regiao = (Get-Culture).Name
    ligadoDesde = $so.LastBootUpTime.ToString('yyyy-MM-dd HH:mm')
  }
  powershell = $PSVersionTable.PSVersion.ToString()
  administrador = [bool]$admin
  equipamento = [ordered]@{
    fabricante = [string]$cs.Manufacturer
    modelo = [string]$cs.Model
    processador = [string]$cpu[0].Name.Trim()
    nucleos = [int]$cpu[0].NumberOfCores
    ramGb = [math]::Round($cs.TotalPhysicalMemory / 1GB)
    placasGraficas = $gpus
    discos = $discos
    volumes = $volumes
    portatil = $bateria
    brilhoControlavel = $brilho
  }
  pastas = [ordered]@{
    ambienteDeTrabalho = Pasta $pastasShell.Desktop
    documentos = Pasta $pastasShell.Personal
    transferencias = Pasta $pastasShell.'{374DE290-123F-4565-9164-39C4925E467B}'
    imagens = Pasta $pastasShell.'My Pictures'
    oneDrive = [string]$env:OneDrive
  }
  navegadorPredefinido = [string]$navegador
  programas = $programas
} | ConvertTo-Json -Depth 5 -Compress
`;

let emMemoria = null;

function lerDoDisco() {
  try {
    return JSON.parse(fs.readFileSync(ficheiroDoPerfil(), 'utf8'));
  } catch (e) {
    return null;
  }
}

function gravar(perfil) {
  const destino = ficheiroDoPerfil();
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const temporario = `${destino}.${process.pid}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(perfil, null, 2));
  fs.renameSync(temporario, destino);
}

/** Recolhe o perfil agora, com uma única chamada ao PowerShell. */
async function recolher() {
  const saida = await powershell.correr(SCRIPT_RECOLHA, { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  const inicio = saida.indexOf('{');
  if (inicio < 0) throw new Error('a recolha do perfil não devolveu nada');
  const dados = JSON.parse(saida.slice(inicio));
  return { recolhidoEm: new Date().toISOString(), dados };
}

function caducado(perfil, agora = Date.now()) {
  const quando = Date.parse(perfil?.recolhidoEm || '');
  return !Number.isFinite(quando) || agora - quando > VALIDADE_MS;
}

/**
 * O perfil deste PC, recolhido de novo só quando é preciso.
 * @param {{ refrescar?: boolean }} opcoes
 */
async function obter(opcoes = {}) {
  if (!opcoes.refrescar) {
    const guardado = emMemoria || lerDoDisco();
    if (guardado && !caducado(guardado)) {
      emMemoria = guardado;
      return guardado;
    }
  }
  const novo = await recolher();
  emMemoria = novo;
  try { gravar(novo); } catch (e) { console.warn(`  ⚠️ Não consegui guardar o perfil do PC: ${e.message}`); }
  return novo;
}

/** O perfil que já existe, sem recolher nada. Para quem não pode esperar. */
function jaConhecido() {
  const guardado = emMemoria || lerDoDisco();
  if (guardado) emMemoria = guardado;
  return guardado;
}

function lista(valor) {
  if (valor == null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

/**
 * Uma linha sobre o PC, para acompanhar cada pedido de comando ao modelo.
 * Curta de propósito: vai em todos os pedidos que possam gerar comandos.
 */
function resumoCurto(perfil) {
  const d = perfil?.dados;
  if (!d) return null;
  const w = d.windows || {};
  const partes = [
    `${w.nome || 'Windows'}${w.versao ? ` ${w.versao}` : ''} (build ${w.build || '?'})`,
    `idioma ${w.idioma || '?'}`,
    `PowerShell ${d.powershell || '?'}`,
    d.administrador ? 'com administrador' : 'sem administrador'
  ];
  if (d.pastas?.transferencias) partes.push(`Transferências em ${d.pastas.transferencias}`);
  if (d.pastas?.documentos) partes.push(`Documentos em ${d.pastas.documentos}`);
  return partes.join('; ');
}

/**
 * O perfil em texto, para responder ao utilizador.
 * @param {Object} perfil
 * @param {{ procurarPrograma?: string, maxProgramas?: number }} opcoes
 */
function textoDoPerfil(perfil, opcoes = {}) {
  const d = perfil?.dados;
  if (!d) return 'Ainda não conheço este PC.';
  const w = d.windows || {};
  const e = d.equipamento || {};
  const linhas = [];

  linhas.push(`Windows: ${w.nome || '?'} ${w.versao || ''} (build ${w.build || '?'}, ${w.arquitectura || '?'}), idioma ${w.idioma || '?'}, ligado desde ${w.ligadoDesde || '?'}`);
  linhas.push(`Equipamento: ${[e.fabricante, e.modelo].filter(Boolean).join(' ') || '?'}${e.portatil ? ' (portátil)' : ''}`);
  linhas.push(`Processador: ${e.processador || '?'}, ${e.nucleos || '?'} núcleos; memória: ${e.ramGb || '?'} GB`);

  const gpus = lista(e.placasGraficas).map(g => `${g.nome}${g.resolucao ? ` (${g.resolucao})` : ''}`);
  if (gpus.length) linhas.push(`Placa gráfica: ${gpus.join('; ')}`);

  const discos = lista(e.discos).map(x => `${x.nome} ${x.tipo && x.tipo !== 'Unspecified' ? x.tipo : ''} ${x.gb} GB`.replace(/\s+/g, ' ').trim());
  if (discos.length) linhas.push(`Discos: ${discos.join('; ')}`);
  const volumes = lista(e.volumes).map(v => `${v.letra} ${v.livreGb} GB livres de ${v.gb} GB`);
  if (volumes.length) linhas.push(`Unidades: ${volumes.join('; ')}`);

  linhas.push(`Brilho do ecrã controlável: ${e.brilhoControlavel ? 'sim' : 'não'}`);
  linhas.push(`PowerShell ${d.powershell || '?'}, ${d.administrador ? 'com' : 'sem'} permissões de administrador`);
  if (d.navegadorPredefinido) linhas.push(`Navegador predefinido: ${d.navegadorPredefinido}`);

  const p = d.pastas || {};
  const pastas = [['Ambiente de trabalho', p.ambienteDeTrabalho], ['Documentos', p.documentos], ['Transferências', p.transferencias], ['Imagens', p.imagens]]
    .filter(([, v]) => v).map(([n, v]) => `${n}: ${v}`);
  if (pastas.length) linhas.push(`Pastas: ${pastas.join('; ')}`);

  const programas = lista(d.programas);
  const procura = String(opcoes.procurarPrograma || '').trim().toLowerCase();

  if (procura) {
    const encontrados = programas.filter(x => `${x.nome} ${x.editor}`.toLowerCase().includes(procura));
    linhas.push('');
    linhas.push(encontrados.length
      ? `Programas instalados com "${opcoes.procurarPrograma}":\n${encontrados.map(x => `- ${x.nome}${x.versao ? ` ${x.versao}` : ''}`).join('\n')}`
      : `Não há nenhum programa instalado com "${opcoes.procurarPrograma}" no nome (entre os ${programas.length} que o Windows regista).`);
  } else {
    const max = opcoes.maxProgramas || 80;
    linhas.push('');
    linhas.push(`Programas instalados (${programas.length}):`);
    linhas.push(programas.slice(0, max).map(x => x.nome).join('; ') + (programas.length > max ? `; e mais ${programas.length - max}` : ''));
  }

  linhas.push('');
  linhas.push(`(perfil recolhido em ${new Date(perfil.recolhidoEm).toLocaleString('pt-PT')})`);
  return linhas.join('\n');
}

/** Para os testes: esquece o que está em memória. */
function esquecer() {
  emMemoria = null;
}

module.exports = {
  obter,
  recolher,
  jaConhecido,
  resumoCurto,
  textoDoPerfil,
  caducado,
  esquecer,
  ficheiroDoPerfil,
  VALIDADE_MS
};
