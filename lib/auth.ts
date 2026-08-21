import { compare } from "bcryptjs";
import { cookies } from "next/headers";
import { SESSION_COOKIE, readSession } from "./session";

/** Vérification des identifiants. Runtime Node uniquement (bcrypt). */

type User = { username: string; hash: string };

function users(): User[] {
  const raw = process.env.PORTAL_USERS ?? "";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(":");
      return {
        username: entry.slice(0, separator).trim().toLowerCase(),
        hash: entry.slice(separator + 1).trim(),
      };
    })
    .filter((user) => user.username && user.hash.startsWith("$2"));
}

/**
 * Renvoie le nom d'utilisateur si les identifiants sont valides, sinon `null`.
 * Un hash factice est comparé lorsque l'utilisateur n'existe pas afin que le
 * temps de réponse ne révèle pas l'existence d'un compte.
 */
export async function verifyCredentials(username: string, password: string): Promise<string | null> {
  const decoy = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.Wq8ZeK6r0iZ3M8XfP1V2r9d1S7bC8yq";
  const user = users().find((candidate) => candidate.username === username.trim().toLowerCase());
  const ok = await compare(password, user?.hash ?? decoy);
  return ok && user ? user.username : null;
}

/** Session courante côté serveur, ou `null` si non connecté. */
export async function currentUser(): Promise<string | null> {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  return session?.sub ?? null;
}
