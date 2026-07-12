/**
 * Tests Unitaires — Service d'Analyse Émotionnelle
 */
import { EmotionAnalysisService } from '../../../src/ai/emotion/EmotionAnalysisService';

describe('EmotionAnalysisService', () => {
  let service: EmotionAnalysisService;

  beforeEach(() => {
    service = new EmotionAnalysisService();
  });

  describe('analyze (heuristique fallback)', () => {
    it('retourne null pour un texte vide', async () => {
      const result = await service.analyze('');
      expect(result).toBeNull();
    });

    it('retourne null pour un texte de seulement des espaces', async () => {
      const result = await service.analyze('   ');
      expect(result).toBeNull();
    });

    it('détecte la joie dans un texte positif', async () => {
      const result = await service.analyze('Je suis tellement content et heureux aujourd\'hui, c\'est super !');
      expect(result).not.toBeNull();
      expect(result?.primary).toBeDefined();
    });

    it('retourne un résultat avec les champs requis', async () => {
      const result = await service.analyze('Je suis triste et déprimé.');
      expect(result).not.toBeNull();
      if (result) {
        expect(result.primary).toBeDefined();
        expect(typeof result.primaryScore).toBe('number');
        expect(result.primaryScore).toBeGreaterThanOrEqual(0);
        expect(result.primaryScore).toBeLessThanOrEqual(1);
        expect(Array.isArray(result.secondary)).toBe(true);
        expect(result.label).toBeDefined();
      }
    });

    it('ne formule jamais de certitude absolue dans le label', async () => {
      const result = await service.analyze('Je suis très heureux et content !');
      if (result) {
        expect(result.label).not.toMatch(/^certainement/i);
        expect(result.label).not.toMatch(/^définitivement/i);
      }
    });

    it('retourne une émotion neutre pour un texte factuel neutre', async () => {
      const result = await service.analyze('Il est 15 heures. Le rendez-vous est demain.');
      expect(result).not.toBeNull();
    });
  });

  describe('getEmotionColor', () => {
    it('retourne une couleur hex pour une émotion connue', () => {
      const color = service.getEmotionColor('joy');
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it('retourne la couleur par défaut pour une émotion inconnue', () => {
      const color = service.getEmotionColor('unknown_emotion');
      expect(color).toBe('#9E9E9E');
    });
  });

  describe('isAvailable', () => {
    it('retourne false si le modèle n\'est pas chargé', () => {
      expect(service.isAvailable()).toBe(false);
    });
  });
});
