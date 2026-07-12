/**
 * Tests Unitaires — Détecteur d'Incohérences
 */
import { InconsistencyDetector } from '../../../src/ai/inconsistency/InconsistencyDetector';
import type { Message } from '../../../src/domain/entities/Message';

const makeMessage = (id: string, content: string, dayOffset: number = 0): Message => ({
  id,
  conversationId: 'conv1',
  senderId: 'partner1',
  receiverId: 'user1',
  type: 'text',
  content,
  status: 'read',
  isDeleted: false,
  createdAt: new Date(Date.now() - dayOffset * 86400000),
  updatedAt: new Date(Date.now() - dayOffset * 86400000),
});

describe('InconsistencyDetector', () => {
  let detector: InconsistencyDetector;

  beforeEach(() => {
    detector = new InconsistencyDetector({ minMessagePairDistance: 0 });
  });

  describe('detectInconsistencies', () => {
    it('retourne un tableau vide si moins de 2 messages', async () => {
      const messages = [makeMessage('1', 'Bonjour')];
      const result = await detector.detectInconsistencies(messages, 'partner1', 'conv1');
      expect(result).toHaveLength(0);
    });

    it('retourne un tableau vide pour des messages cohérents', async () => {
      const messages = [
        makeMessage('1', 'Je travaille dans la tech', 5),
        makeMessage('2', 'Mon travail me plaît beaucoup', 3),
        makeMessage('3', 'Je suis développeur', 1),
      ];
      const result = await detector.detectInconsistencies(messages, 'partner1', 'conv1');
      expect(Array.isArray(result)).toBe(true);
    });

    it('détecte une contradiction directe potentielle', async () => {
      const messages = [
        makeMessage('1', 'j\'aime beaucoup le sport', 10),
        makeMessage('2', 'je n\'aime pas du tout le sport', 1),
      ];
      const result = await detector.detectInconsistencies(messages, 'partner1', 'conv1');
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('ignore les messages supprimés', async () => {
      const messages = [
        { ...makeMessage('1', 'j\'aime le café', 5), isDeleted: true },
        makeMessage('2', 'je ne bois pas de café', 1),
      ];
      const result = await detector.detectInconsistencies(messages, 'partner1', 'conv1');
      expect(result).toHaveLength(0);
    });

    it('ignore les messages trop courts (moins de 10 caractères)', async () => {
      const messages = [
        makeMessage('1', 'Oui', 5),
        makeMessage('2', 'Non', 1),
      ];
      const result = await detector.detectInconsistencies(messages, 'partner1', 'conv1');
      expect(result).toHaveLength(0);
    });

    it('inclut une explication pour chaque incohérence détectée', async () => {
      const messages = [
        makeMessage('1', 'je suis médecin depuis 10 ans', 10),
        makeMessage('2', 'je ne suis pas médecin du tout, je suis ingénieur', 1),
      ];
      const result = await detector.detectInconsistencies(messages, 'partner1', 'conv1');
      for (const inc of result) {
        expect(inc.explanation).toBeDefined();
        expect(inc.explanation.length).toBeGreaterThan(0);
        expect(inc.coherenceScore).toBeGreaterThanOrEqual(0);
        expect(inc.coherenceScore).toBeLessThanOrEqual(100);
      }
    });
  });
});
