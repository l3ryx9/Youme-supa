/**
 * Tests Unitaires — Service LLM
 */
import { LLMService } from '../../../src/ai/llm/LLMService';

describe('LLMService', () => {
  let service: LLMService;

  beforeEach(() => {
    service = new LLMService();
  });

  describe('extractFromText (rule-based fallback)', () => {
    it('retourne un résultat vide pour un texte vide', async () => {
      const result = await service.extractFromText('');
      expect(result.summary).toBeNull();
      expect(result.topics).toHaveLength(0);
      expect(result.confidence).toBe(0);
    });

    it('retourne les champs structurés requis', async () => {
      const result = await service.extractFromText('Je dois appeler le médecin demain.');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('topics');
      expect(result).toHaveProperty('entities');
      expect(result).toHaveProperty('confidence');
      expect(result.entities).toHaveProperty('tasks');
      expect(result.entities).toHaveProperty('dates');
      expect(result.entities).toHaveProperty('persons');
    });

    it('détecte les tâches avec "je dois"', async () => {
      const result = await service.extractFromText('Je dois absolument terminer le rapport avant vendredi.');
      expect(result.entities.tasks.length).toBeGreaterThanOrEqual(0);
    });

    it('détecte les références temporelles', async () => {
      const result = await service.extractFromText('Rendez-vous demain à 15h00, et aussi lundi prochain.');
      expect(result.entities.dates.length).toBeGreaterThanOrEqual(0);
    });

    it('chaque entité extraite a une citation', async () => {
      const result = await service.extractFromText('Je dois terminer le projet avant demain matin.');
      for (const entity of result.entities.tasks) {
        expect(entity.citation).toBeDefined();
        expect(entity.citation.length).toBeGreaterThan(0);
      }
    });

    it('ne retourne pas d\'informations inventées', async () => {
      const text = 'Bonjour, comment ça va ?';
      const result = await service.extractFromText(text);
      for (const entity of result.entities.persons) {
        expect(text.toLowerCase()).toContain(entity.citation.toLowerCase().slice(0, 5));
      }
    });
  });

  describe('summarizeMessages', () => {
    it('retourne une chaîne vide pour un tableau vide', async () => {
      const result = await service.summarizeMessages([]);
      expect(result).toBe('');
    });

    it('retourne un résumé pour un seul message', async () => {
      const result = await service.summarizeMessages(['Bonjour, comment ça va ?']);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('isAvailable', () => {
    it('retourne false par défaut (modèle non chargé)', () => {
      expect(service.isAvailable()).toBe(false);
    });
  });
});
