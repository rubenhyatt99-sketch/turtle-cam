import { LoginForm } from "@/components/LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="login-wrap">
      <div className="login">
        <h1>🐢 Turtle Cam</h1>
        <p className="sub">Accès privé au portail de surveillance.</p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
