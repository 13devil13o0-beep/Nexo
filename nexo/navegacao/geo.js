/**
 * 🌍 Geometria de Navegação
 *
 * Matemática de esfera, sem dependências e sem aproximações escondidas. Tudo o
 * que aqui está devolve metros, graus ou segundos — nunca unidades implícitas.
 *
 * A Terra é tratada como esfera de raio médio. O erro face ao elipsóide anda
 * pelos 0,3%, o que a estas distâncias (centenas de metros a dezenas de
 * quilómetros) é muito menos do que a incerteza do próprio GPS. Para cálculos
 * geodésicos exactos seria preciso Vincenty, e não é o caso de uso.
 */

const RAIO_TERRA_M = 6371008.8;

const rad = g => (g * Math.PI) / 180;
const grau = r => (r * 180) / Math.PI;

/** Normaliza um rumo para [0, 360). */
function normalizarRumo(g) {
  return ((g % 360) + 360) % 360;
}

/**
 * Distância em metros entre dois pontos (haversine).
 * Ignora a altitude: para o que aqui se decide, a diferença é irrelevante.
 */
function distancia(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * RAIO_TERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rumo inicial de A para B, em graus a partir do Norte. */
function rumo(a, b) {
  const dLng = rad(b.lng - a.lng);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return normalizarRumo(grau(Math.atan2(y, x)));
}

/** O ponto a que se chega andando `metros` no rumo `graus` a partir de `p`. */
function projectar(p, graus, metros) {
  const d = metros / RAIO_TERRA_M;
  const t = rad(graus);
  const lat1 = rad(p.lat);
  const lng1 = rad(p.lng);

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(t));
  const lng2 = lng1 + Math.atan2(
    Math.sin(t) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  );

  return {
    lat: grau(lat2),
    lng: normalizarLongitude(grau(lng2)),
    alt: p.alt != null ? p.alt : undefined
  };
}

function normalizarLongitude(lng) {
  return ((lng + 540) % 360) - 180;
}

/** Ponto a uma fracção 0..1 do caminho entre A e B. */
function interpolar(a, b, fraccao) {
  const total = distancia(a, b);
  const ponto = projectar(a, rumo(a, b), total * fraccao);

  if (a.alt != null && b.alt != null) {
    ponto.alt = a.alt + (b.alt - a.alt) * fraccao;
  }
  return ponto;
}

/**
 * Distância mínima de um ponto ao segmento A→B, em metros.
 *
 * Projecta para um plano local em metros antes de fazer a conta. A poucos
 * quilómetros do ponto de referência a distorção é desprezável, e evita a
 * trigonometria esférica de cross-track, que a estas escalas não acrescenta
 * precisão útil.
 */
function distanciaAoSegmento(p, a, b) {
  const escalaLng = Math.cos(rad((a.lat + b.lat) / 2));
  const mPorGrau = (Math.PI * RAIO_TERRA_M) / 180;

  const px = (p.lng - a.lng) * escalaLng * mPorGrau;
  const py = (p.lat - a.lat) * mPorGrau;
  const bx = (b.lng - a.lng) * escalaLng * mPorGrau;
  const by = (b.lat - a.lat) * mPorGrau;

  const comprimento2 = bx * bx + by * by;
  if (comprimento2 === 0) return distancia(p, a);

  // Onde é que a perpendicular cai, entre 0 (em A) e 1 (em B).
  let t = (px * bx + py * by) / comprimento2;
  t = Math.max(0, Math.min(1, t));

  const dx = px - t * bx;
  const dy = py - t * by;
  return Math.sqrt(dx * dx + dy * dy);
}

// ═══════════════════════════════════════════════════════════
// ZONAS
// ═══════════════════════════════════════════════════════════

/**
 * Uma zona é um círculo { centro:{lat,lng}, raioM } ou um polígono
 * { poligono:[{lat,lng}, ...] }. Ambos aceitam `nome` e `motivo`.
 */

function dentroDoCirculo(p, zona) {
  return distancia(p, zona.centro) <= zona.raioM;
}

/** Ray casting num plano local. Suficiente para zonas de alguns quilómetros. */
function dentroDoPoligono(p, poligono) {
  let dentro = false;

  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const yi = poligono[i].lat, xi = poligono[i].lng;
    const yj = poligono[j].lat, xj = poligono[j].lng;

    const cruza = (yi > p.lat) !== (yj > p.lat)
      && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;

    if (cruza) dentro = !dentro;
  }

  return dentro;
}

function dentroDaZona(p, zona) {
  if (!zona) return false;
  if (zona.raioM != null && zona.centro) return dentroDoCirculo(p, zona);
  if (Array.isArray(zona.poligono)) return dentroDoPoligono(p, zona.poligono);
  return false;
}

/**
 * O segmento A→B atravessa a zona?
 *
 * Para um círculo há resposta fechada: basta a distância do centro ao segmento.
 * Para um polígono, amostra-se o segmento — não é exacto, mas o passo é
 * pequeno em relação a qualquer zona real e falha sempre para o lado seguro
 * quando se reduz o passo.
 */
function segmentoAtravessaZona(a, b, zona, passoM = 25) {
  if (!zona) return false;

  if (zona.raioM != null && zona.centro) {
    return distanciaAoSegmento(zona.centro, a, b) <= zona.raioM;
  }

  if (Array.isArray(zona.poligono)) {
    if (dentroDoPoligono(a, zona.poligono) || dentroDoPoligono(b, zona.poligono)) return true;

    const total = distancia(a, b);
    const amostras = Math.max(2, Math.ceil(total / passoM));
    for (let i = 1; i < amostras; i++) {
      if (dentroDoPoligono(interpolar(a, b, i / amostras), zona.poligono)) return true;
    }
  }

  return false;
}

/** Todas as zonas que o segmento atravessa. */
function zonasNoCaminho(a, b, zonas = []) {
  return zonas.filter(z => segmentoAtravessaZona(a, b, z));
}

/**
 * Raio efectivo de uma zona, para saber o quanto é preciso afastar-se.
 * Num polígono, usa-se a maior distância do centróide a um vértice.
 */
function raioDaZona(zona) {
  if (zona.raioM != null) return zona.raioM;

  if (Array.isArray(zona.poligono) && zona.poligono.length) {
    const c = centroide(zona.poligono);
    return Math.max(...zona.poligono.map(v => distancia(c, v)));
  }

  return 0;
}

function centroDaZona(zona) {
  if (zona.centro) return zona.centro;
  if (Array.isArray(zona.poligono) && zona.poligono.length) return centroide(zona.poligono);
  return null;
}

function centroide(pontos) {
  const lat = pontos.reduce((s, p) => s + p.lat, 0) / pontos.length;
  const lng = pontos.reduce((s, p) => s + p.lng, 0) / pontos.length;
  return { lat, lng };
}

/**
 * Um ponto por onde passar para contornar a zona, com folga.
 *
 * Desvia-se perpendicularmente ao caminho, para o lado que der a volta mais
 * curta, e afasta-se o suficiente para a zona ficar de fora com margem. Não é
 * um planeador óptimo — é um contorno honesto, e diz-se aqui que o é.
 */
function pontoDeContorno(a, b, zona, folgaM = 50) {
  const centro = centroDaZona(zona);
  if (!centro) return null;

  const raio = raioDaZona(zona) + folgaM;
  const rumoDoCaminho = rumo(a, b);

  // De que lado do caminho está o centro da zona: contorna-se pelo outro.
  const rumoAoCentro = rumo(a, centro);
  const diferenca = normalizarRumo(rumoAoCentro - rumoDoCaminho);
  const ladoEsquerdo = diferenca > 180;

  const rumoDeFuga = normalizarRumo(rumoDoCaminho + (ladoEsquerdo ? 90 : -90));
  return projectar(centro, rumoDeFuga, raio);
}

module.exports = {
  RAIO_TERRA_M,
  distancia,
  rumo,
  projectar,
  interpolar,
  distanciaAoSegmento,
  dentroDoCirculo,
  dentroDoPoligono,
  dentroDaZona,
  segmentoAtravessaZona,
  zonasNoCaminho,
  raioDaZona,
  centroDaZona,
  pontoDeContorno,
  normalizarRumo
};
