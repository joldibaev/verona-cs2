import { useState } from "react";
import { SteamIcon } from "../components/brand-icons";
import { Button } from "../components/ui";

export default function LoginView() {
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState("");

  async function login() {
    if (checking) return;
    setChecking(true);
    setStatus("Проверяем готовность панели...");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);

    try {
      const response = await fetch("/api/auth/me", {
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (response.status !== 200 && response.status !== 401) {
        throw new Error(`Backend returned ${response.status}`);
      }
      window.location.assign("/api/auth/steam");
    } catch {
      setStatus("Панель запускается. Подождите несколько секунд и попробуйте снова.");
      setChecking(false);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-mark">V</div>
        <p className="kicker">VERONA CS2 CONTROL PLANE</p>
        <h1>Сервер под контролем.</h1>
        <p>
          Войдите через Steam, чтобы управлять сервером и своим игровым loadout.
        </p>
        <Button
          type="button"
          className="steam-button"
          disabled={checking}
          onClick={() => void login()}
        >
          <SteamIcon size={22} />
          {checking ? "Подождите..." : "Войти через Steam"}
        </Button>
        <div
          role="status"
          aria-live="polite"
          className="mt-3 min-h-5 text-sm text-amber-300"
        >
          {status}
        </div>
        <small>Steam OpenID · пароль не передаётся Verona CS2</small>
      </section>
    </main>
  );
}
