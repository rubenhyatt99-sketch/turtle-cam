import Link from "next/link";

/** Barre de navigation du portail, avec l'onglet courant mis en évidence. */
export function Nav({ current, user }: { current: "live" | "timeline" | "insights"; user: string }) {
  const links = [
    { key: "live", href: "/", label: "Direct" },
    { key: "timeline", href: "/timeline", label: "Enregistrements" },
    { key: "insights", href: "/insights", label: "Comportement" },
  ] as const;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="dot" />
        Turtle Cam
      </div>
      <nav className="nav">
        {links.map((link) => (
          <Link key={link.key} href={link.href} aria-current={current === link.key ? "page" : undefined}>
            {link.label}
          </Link>
        ))}
      </nav>
      <form action="/api/auth/logout" method="post">
        <button className="linkish" type="submit">
          {user} · Déconnexion
        </button>
      </form>
    </header>
  );
}
