/**
 * 🎨 Gerador de ícones para build do .exe e para o atalho de arranque
 *
 * Converte o icon.svg em:
 *   - assets/icon.png     (512×512 — Electron window + Linux)
 *   - assets/icon.ico     (256×256 multi-size — Windows .exe)
 *   - assets/tray-icon.png (32×32 — System tray)
 *   - assets/icon.icns    (macOS — atalho de arranque)
 *
 * O .icns é gerado com png2icons, uma biblioteca só em JavaScript — ao
 * contrário do caminho tradicional (a ferramenta `iconutil`), não precisa de
 * macOS para correr. Sem ela, o atalho do macOS (orchestrator/atalho.js)
 * continua a funcionar; só fica com o ícone genérico do sistema.
 *
 * Uso: node scripts/generate-icons.js
 */

const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;
const fs = require('fs');
const path = require('path');

let png2icons = null;
try {
  png2icons = require('png2icons');
} catch (e) {
  // Dependência opcional: sem ela, salta-se só o .icns.
}

const SVG_PATH = path.join(__dirname, '..', 'web', 'public', 'icons', 'icon.svg');
const SVG_FALLBACK = path.join(__dirname, '..', 'assets', 'icon.svg');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

async function generateIcons() {
  // Garantir que assets/ existe
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }

  // Encontrar SVG source
  let svgPath = SVG_FALLBACK;
  if (fs.existsSync(SVG_PATH)) {
    svgPath = SVG_PATH;
  }
  
  if (!fs.existsSync(svgPath)) {
    console.error('❌ icon.svg não encontrado em', svgPath);
    console.log('   Coloca o icon.svg em assets/ e re-executa.');
    process.exit(1);
  }

  const svgBuffer = fs.readFileSync(svgPath);
  console.log(`🎨 A gerar ícones a partir de: ${svgPath}`);

  // 1. icon.png — 512×512
  const png512 = path.join(ASSETS_DIR, 'icon.png');
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(png512);
  console.log(`  ✅ icon.png (512×512) → ${png512}`);

  // 2. tray-icon.png — 32×32
  const tray = path.join(ASSETS_DIR, 'tray-icon.png');
  await sharp(svgBuffer)
    .resize(32, 32)
    .png()
    .toFile(tray);
  console.log(`  ✅ tray-icon.png (32×32) → ${tray}`);

  // 3. icon-256.png temporário para ICO
  const png256 = path.join(ASSETS_DIR, 'icon-256.png');
  await sharp(svgBuffer)
    .resize(256, 256)
    .png()
    .toFile(png256);

  // 4. icon.ico — Windows .exe (multi-size gerado automaticamente)
  const icoPath = path.join(ASSETS_DIR, 'icon.ico');
  const icoBuffer = await pngToIco(png256);
  fs.writeFileSync(icoPath, icoBuffer);
  fs.unlinkSync(png256); // limpar temporário
  console.log(`  ✅ icon.ico (multi-size) → ${icoPath}`);

  // 5. icon.icns — macOS (atalho de arranque). O README do png2icons
  // recomenda uma fonte de 1024×1024 para a melhor qualidade em ecrãs retina.
  if (png2icons) {
    const png1024 = await sharp(svgBuffer).resize(1024, 1024).png().toBuffer();
    const icnsBuffer = png2icons.createICNS(png1024, png2icons.BICUBIC2, 0);

    if (icnsBuffer) {
      const icnsPath = path.join(ASSETS_DIR, 'icon.icns');
      fs.writeFileSync(icnsPath, icnsBuffer);
      console.log(`  ✅ icon.icns → ${icnsPath}`);
    } else {
      console.log('  ⚠️  png2icons não conseguiu gerar o .icns — o atalho do macOS fica sem ícone próprio por agora.');
    }
  } else {
    console.log('  ⚪ png2icons não instalado — salto o .icns. npm install traz-lo (é dependência de desenvolvimento).');
  }

  console.log('\n🎉 Ícones gerados com sucesso! Pronto para: npm run dist:win');
}

generateIcons().catch(err => {
  console.error('❌ Erro ao gerar ícones:', err.message);
  process.exit(1);
});
