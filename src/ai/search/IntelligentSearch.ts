/**
 * Service de Recherche Intelligente
 *
 * Permet des requêtes sémantiques sur la mémoire IA :
 * - Sujets fréquents discutés
 * - Historique des discussions sur un thème
 * - Projets et tâches évoqués
 * - Résumés par période temporelle
 * - Messages liés à un domaine (travail, famille, santé...)
 *
 * Chaque résultat inclut TOUJOURS la citation exacte du message source.
 */
import { memoryRepository } from '@infrastructure/storage/LocalMemoryRepository';
import type { SearchResult, MemoryEntry, MemoryCategory } from '@domain/entities/Memory';

export interface SearchQuery {
  text: string;
  partnerId?: string;
  category?: MemoryCategory;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  totalCount: number;
  query: string;
  executedAt: Date;
}

export class IntelligentSearch {
  /**
   * Recherche dans la mémoire IA avec un texte libre.
   * Chaque résultat inclut la citation exacte du message source.
   */
  async search(query: SearchQuery): Promise<SearchResponse> {
    const rawResults = await memoryRepository.searchMemory(
      query.text,
      query.partnerId
    );

    let filtered = rawResults;

    if (query.category) {
      filtered = filtered.filter(
        (r) => r.memoryEntry?.category === query.category
      );
    }

    if (query.fromDate) {
      filtered = filtered.filter((r) => r.timestamp >= query.fromDate!);
    }

    if (query.toDate) {
      filtered = filtered.filter((r) => r.timestamp <= query.toDate!);
    }

    const limited = filtered.slice(0, query.limit ?? 50);

    return {
      results: limited,
      totalCount: filtered.length,
      query: query.text,
      executedAt: new Date(),
    };
  }

  /**
   * Retourne les sujets les plus fréquemment discutés avec un partenaire.
   */
  async getFrequentTopics(
    partnerId: string,
    limit = 10
  ): Promise<Array<{ topic: string; count: number; lastCitation: string }>> {
    const entries = await memoryRepository.getMemoryEntries(partnerId, 'topic');

    const topicCount = new Map<
      string,
      { count: number; lastCitation: string }
    >();

    for (const entry of entries) {
      const key = entry.value.toLowerCase();
      const existing = topicCount.get(key);
      if (existing) {
        existing.count++;
        if (entry.timestamp > new Date(existing.lastCitation)) {
          existing.lastCitation = entry.citation;
        }
      } else {
        topicCount.set(key, { count: 1, lastCitation: entry.citation });
      }
    }

    return Array.from(topicCount.entries())
      .map(([topic, data]) => ({ topic, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Retourne les tâches et projets mentionnés par un partenaire.
   */
  async getTasksAndProjects(partnerId: string): Promise<{
    tasks: MemoryEntry[];
    projects: MemoryEntry[];
  }> {
    const [tasks, projects] = await Promise.all([
      memoryRepository.getMemoryEntries(partnerId, 'task'),
      memoryRepository.getMemoryEntries(partnerId, 'project'),
    ]);
    return { tasks, projects };
  }

  /**
   * Retourne un résumé temporel des discussions.
   */
  async getTemporalSummary(
    conversationId: string,
    fromDate?: Date,
    toDate?: Date
  ): Promise<{
    summaries: any[];
    emotionTimeline: Array<{ date: Date; emotion: string; score: number }>;
    keyTopics: string[];
  }> {
    const summaries = await memoryRepository.getSummaries(conversationId);

    const filtered = summaries.filter((s) => {
      if (fromDate && s.fromDate < fromDate) return false;
      if (toDate && s.toDate > toDate) return false;
      return true;
    });

    const allTopics = filtered.flatMap((s) => s.topics);
    const uniqueTopics = [...new Set(allTopics)].slice(0, 10);

    return {
      summaries: filtered,
      emotionTimeline: [],
      keyTopics: uniqueTopics,
    };
  }

  /**
   * Retourne tous les souvenirs liés à une personne mentionnée.
   */
  async getMemoriesAboutPerson(
    partnerId: string,
    personName: string
  ): Promise<MemoryEntry[]> {
    const entries = await memoryRepository.getMemoryEntries(partnerId, 'person');
    return entries.filter((e) =>
      e.value.toLowerCase().includes(personName.toLowerCase())
    );
  }

  /**
   * Retourne les préférences et goûts détectés.
   */
  async getPreferences(partnerId: string): Promise<MemoryEntry[]> {
    return memoryRepository.getMemoryEntries(partnerId, 'preference');
  }
}

export const intelligentSearch = new IntelligentSearch();
