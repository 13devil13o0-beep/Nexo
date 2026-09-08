/**
 * 🌤️ Plugin de Tempo — Previsão Meteorológica
 * 
 * Comandos:
 *   "tempo em Aveiro"
 *   "previsão para amanhã"
 *   "tempo hoje"
 *   "chove hoje?"
 */

module.exports = {
  name: 'tempo',
  description: 'Previsão meteorológica e tempo por localidade',
  version: '1.0.0',

  intents: {
    'tempo_atual': {
      patterns: [
        /tempo\s+(?:em|no|de|para)\s+(.+)/i,
        /(?:qual|como)\s+(?:está|está)\s+o\s+tempo\s+(?:em|para)\s+(.+)/i,
        /previsão\s+(?:do|para)\s+tempo\s+(?:em|para)\s+(.+)/i,
        /tempo\s+hoje\s+(?:em|para)\s+(.+)/i
      ],
      extract: (text) => {
        const match = text.match(/(?:tempo|previsão)\s+(?:em|no|de|para)\s+(.+)/i);
        let local = match?.[1]?.trim() || 'Aveiro';
        // Limpar palavras desnecessárias
        local = local.replace(/\b(hoje|amanhã|agora|em|no|de|para)\b/gi, '').trim();
        return { local: local || 'Aveiro' };
      },
      handler: async (entities, context) => {
        const { local } = entities;
        return {
          success: true,
          response: `🌤️ **Previsão para ${local}**\n\n🔍 A pesquisar...`
        };
      }
    },

    'tempo_hoje': {
      patterns: [
        /tempo\s+hoje/i,
        /como\s+está\s+o\s+tempo\s+hoje/i,
        /vai\s+chover\s+hoje/i,
        /chove\s+hoje/i
      ],
      extract: () => {
        return { local: 'Aveiro' }; // Localização padrão
      },
      handler: async (entities) => {
        return {
          success: true,
          response: `🌤️ **Tempo em ${entities.local} hoje:**\n\n🔍 A pesquisar...`
        };
      }
    }
  },

  onLoad: () => {
    console.log('    🌤️ Plugin de Tempo carregado!');
  }
};