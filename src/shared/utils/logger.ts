/**
 * Logger centralisé
 * Trace toutes les erreurs de l'application avec leur code technique
 * (Firebase Auth, Firestore, etc.) pour faciliter le diagnostic, ainsi que
 * les plantages JS et les promesses rejetées non gérées (voir
 * installGlobalErrorHandlers), pour ne rater aucun problème.
 */

export interface AppLogEntry {
  timestamp: string;
  context: string;
  code: string;
  message: string;
  stack?: string;
}

const MAX_LOGS = 100;
const logs: AppLogEntry[] = [];
type Listener = (logs: AppLogEntry[]) => void;
const listeners = new Set<Listener>();

function extractCode(error: any): string {
  if (!error) return 'unknown';
  if (typeof error.code === 'string' && error.code.length > 0) return error.code;
  if (typeof error.name === 'string' && error.name !== 'Error') return error.name;
  return 'unknown';
}

function extractMessage(error: any): string {
  if (!error) return 'Erreur inconnue';
  if (typeof error.message === 'string' && error.message.length > 0) return error.message;
  return String(error);
}

function extractStack(error: any): string | undefined {
  if (error && typeof error.stack === 'string' && error.stack.length > 0) return error.stack;
  return undefined;
}

/**
 * Enregistre une erreur : imprime dans la console avec son code technique
 * et la garde en mémoire pour l'écran de journal de débogage.
 */
export function logError(context: string, error: any): AppLogEntry {
  const entry: AppLogEntry = {
    timestamp: new Date().toISOString(),
    context,
    code: extractCode(error),
    message: extractMessage(error),
    stack: extractStack(error),
  };

  // eslint-disable-next-line no-console
  console.error(`[${entry.context}] (${entry.code}) ${entry.message}`, error);

  logs.unshift(entry);
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
  listeners.forEach((l) => l(logs));

  return entry;
}

/**
 * Trace un événement normal (pas une erreur) dans le même journal, pour
 * pouvoir suivre le déroulé d'un flux (ex: login réussi + navigation) même
 * quand rien ne plante — utile quand le bug est un blocage silencieux plutôt
 * qu'une exception.
 */
export function logInfo(context: string, details?: Record<string, unknown>): AppLogEntry {
  const entry: AppLogEntry = {
    timestamp: new Date().toISOString(),
    context,
    code: 'info',
    message: details ? JSON.stringify(details) : 'ok',
  };

  // eslint-disable-next-line no-console
  console.log(`[${entry.context}] ${entry.message}`);

  logs.unshift(entry);
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
  listeners.forEach((l) => l(logs));

  return entry;
}

/**
 * Formate un message d'erreur lisible incluant le code technique,
 * à utiliser dans les Alert.alert() affichées à l'utilisateur.
 */
export function formatErrorForUser(error: any, fallbackMessage?: string): string {
  const code = extractCode(error);
  const message = fallbackMessage ?? extractMessage(error);
  return code !== 'unknown' ? `${message}\n\n(code: ${code})` : message;
}

export function getLogs(): AppLogEntry[] {
  return logs;
}

export function subscribeToLogs(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearLogs(): void {
  logs.length = 0;
  listeners.forEach((l) => l(logs));
}

let globalHandlersInstalled = false;

/**
 * Capture TOUS les problèmes de l'application dans le journal, pas seulement
 * ceux explicitement enregistrés via logError() dans le code :
 *  - les exceptions JS non interceptées (plantages) ;
 *  - les promesses rejetées sans .catch() (sinon totalement silencieuses).
 * À appeler une seule fois, au démarrage de l'app (voir app/_layout.tsx).
 */
export function installGlobalErrorHandlers(): void {
  if (globalHandlersInstalled) return;
  globalHandlersInstalled = true;

  const errorUtils = (global as any).ErrorUtils;
  if (errorUtils?.setGlobalHandler) {
    const defaultHandler = errorUtils.getGlobalHandler?.();
    errorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
      logError(isFatal ? 'UncaughtException (fatal)' : 'UncaughtException', error);
      defaultHandler?.(error, isFatal);
    });
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rejectionTracking = require('promise/setimmediate/rejection-tracking');
    rejectionTracking.enable({
      allRejections: true,
      onUnhandled: (_id: number, error: any) => {
        logError('UnhandledPromiseRejection', error);
      },
      onHandled: () => {},
    });
  } catch {
    // Module de suivi des promesses indisponible sur cette version de RN : non bloquant.
  }
}
