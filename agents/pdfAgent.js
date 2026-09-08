/**
 * 📄 PDF Agent - Criação de documentos PDF
 * 
 * Usa AI Agent para gerar conteúdo e PDFKit para criar ficheiro
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const aiAgent = require('./aiAgent');

const OUTPUTS_DIR = path.join(__dirname, '..', 'Documentos');

// Garantir que pasta existe
if (!fs.existsSync(OUTPUTS_DIR)) {
  fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
}

/**
 * Cria PDF com conteúdo gerado por IA
 */
async function createPDF(topic, folder = null) {
  const targetFolder = folder || OUTPUTS_DIR;
  
  // Garantir pasta destino
  if (!fs.existsSync(targetFolder)) {
    fs.mkdirSync(targetFolder, { recursive: true });
  }

  // Gerar conteúdo com IA
  let content;
  try {
    content = await aiAgent.generateContent(topic, 'documento PDF');
  } catch (err) {
    console.warn('⚠️ Fallback: IA indisponível, usando texto padrão');
    content = generateFallback(topic);
  }

  // Criar PDF
  const fileName = `documento_${Date.now()}.pdf`;
  const filePath = path.join(targetFolder, fileName);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 }
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Header
    doc.fontSize(24)
       .font('Helvetica-Bold')
       .text('NEXO - Documento Gerado', { align: 'center' });
    
    doc.moveDown();
    doc.fontSize(14)
       .font('Helvetica')
       .fillColor('#666')
       .text(`Tópico: ${topic}`, { align: 'center' });
    
    doc.moveDown();
    doc.fontSize(10)
       .text(`Data: ${new Date().toLocaleString('pt-PT')}`, { align: 'center' });

    // Linha separadora
    doc.moveDown();
    doc.strokeColor('#333')
       .lineWidth(1)
       .moveTo(50, doc.y)
       .lineTo(545, doc.y)
       .stroke();
    
    doc.moveDown(2);

    // Conteúdo
    doc.fillColor('#000')
       .fontSize(12)
       .font('Helvetica')
       .text(content, {
         align: 'justify',
         lineGap: 5
       });

    // Footer
    doc.moveDown(3);
    doc.fontSize(9)
       .fillColor('#999')
       .text('───────────────────────────────────────', { align: 'center' });
    doc.text('Gerado por NEXO - Assistente IA', { align: 'center' });

    doc.end();

    stream.on('finish', () => {
      console.log(`📄 PDF criado: ${filePath}`);
      resolve(filePath);
    });

    stream.on('error', reject);
  });
}

/**
 * Fallback quando IA não disponível
 */
function generateFallback(topic) {
  return `DOCUMENTO SOBRE: ${topic.toUpperCase()}
═══════════════════════════════════════

Este documento foi gerado em modo fallback porque o serviço de IA 
estava temporariamente indisponível.

Por favor, tenta novamente mais tarde para obter conteúdo 
gerado por inteligência artificial.

───────────────────────────────────────
Gerado em: ${new Date().toLocaleString('pt-PT')}
Por: NEXO`;
}

/**
 * Lista PDFs criados
 */
function listPDFs() {
  if (!fs.existsSync(OUTPUTS_DIR)) {
    return [];
  }
  
  return fs.readdirSync(OUTPUTS_DIR)
    .filter(f => f.endsWith('.pdf'))
    .map(f => ({
      name: f,
      path: path.join(OUTPUTS_DIR, f),
      created: fs.statSync(path.join(OUTPUTS_DIR, f)).birthtime
    }))
    .sort((a, b) => b.created - a.created);
}

module.exports = {
  createPDF,
  listPDFs,
  OUTPUTS_DIR
};
