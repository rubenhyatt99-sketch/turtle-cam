/**
 * Enveloppe les appels Drive pour qu'une panne côté Google (ou une variable
 * d'environnement manquante) dégrade la page au lieu de la faire planter.
 */
export async function safe<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch (error) {
    console.error("[turtle-cam] chargement Drive impossible:", (error as Error).message);
    return fallback;
  }
}
