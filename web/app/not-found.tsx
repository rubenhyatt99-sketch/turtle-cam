import Link from "next/link";

export default function NotFound() {
  return (
    <main className="login-wrap">
      <div className="login" style={{ textAlign: "center" }}>
        <h1>🐢 Introuvable</h1>
        <p className="sub">Ce contenu n’existe pas ou n’est plus dans la fenêtre de rétention de 7 jours.</p>
        <Link className="btn" href="/" style={{ display: "block", padding: 12 }}>
          Retour au direct
        </Link>
      </div>
    </main>
  );
}
