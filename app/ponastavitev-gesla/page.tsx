"use client";
import Link from "next/link";
import { staffRequest } from "@/lib/staff-client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  establishRecovery,
  invalidRecovery,
  updateRecoveryPassword,
} from "@/lib/recovery";
export default function ResetPassword() {
  const started = useRef(false);
  const [userId, setUserId] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const url = new URL(window.location.href);
    // Remove credentials and one-use codes from browser history before any requests.
    window.history.replaceState(null, "", url.pathname);
    if (!supabase) {
      setMessage("Povezava Supabase ni nastavljena.");
      setLoading(false);
      return;
    }
    void establishRecovery(supabase.auth, url)
      .then(setUserId)
      .catch(() => setMessage(invalidRecovery))
      .finally(() => setLoading(false));
  }, []);
  async function submit(form: FormData) {
    if (!supabase || !userId || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const status = await staffRequest("/api/auth/password-status");
      if (status.must_change_password) {
        const changed = await staffRequest(
          "/api/auth/change-initial-password",
          "POST",
          {
            password: String(form.get("password")),
            confirmation: String(form.get("confirmation")),
          },
        );
        const { error } = await supabase.auth.setSession(changed);
        if (error)
          throw new Error(
            "Geslo je spremenjeno. Ponovno se prijavite z novim geslom.",
          );
        await supabase.auth.signOut({ scope: "local" });
      } else
        await updateRecoveryPassword(
          supabase.auth,
          userId,
          String(form.get("password")),
          String(form.get("confirmation")),
        );
      window.location.replace("/?geslo=spremenjeno");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : invalidRecovery);
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="panel login">
        <div className="eyebrow">KD GROSUPLJE · URNIKI</div>
        <h1>Novo geslo</h1>
        <p>
          {loading
            ? "Preverjanje obnovitvene povezave …"
            : "Nastavite novo geslo za svoj račun."}
        </p>
        {userId && (
          <form action={submit}>
            <label>
              Novo geslo
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                disabled={busy}
              />
            </label>
            <label>
              Potrdite novo geslo
              <input
                name="confirmation"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                disabled={busy}
              />
            </label>
            <p>Uporabite vsaj 12 znakov.</p>
            <button className="primary" disabled={busy}>
              {busy ? "Shranjevanje …" : "Shrani novo geslo"}
            </button>
          </form>
        )}
        {message && (
          <p role="alert" className="notice">
            {message}
          </p>
        )}
        <p>
          <Link href="/pozabljeno-geslo">Zahtevaj novo povezavo</Link>
        </p>
        <Link href="/">Nazaj na prijavo</Link>
      </section>
    </main>
  );
}
