"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { staffRequest } from "@/lib/staff-client";
export default function InitialPassword() {
  const [pending, setPending] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    void staffRequest("/api/auth/password-status")
      .then((result) => {
        if (!result.must_change_password) {
          window.location.replace("/");
          return;
        }
        setPending(true);
      })
      .catch((e) =>
        setMessage(
          e instanceof Error ? e.message : "Preverjanje seje ni uspelo.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);
  async function submit(form: FormData) {
    if (!supabase || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const password = String(form.get("password")),
        confirmation = String(form.get("confirmation"));
      if (password !== confirmation) throw new Error("Gesli se ne ujemata.");
      const result = await staffRequest(
        "/api/auth/change-initial-password",
        "POST",
        { password, confirmation },
      );
      const { error } = await supabase.auth.setSession(result);
      if (error)
        throw new Error(
          "Geslo je spremenjeno. Ponovno se prijavite z novim geslom.",
        );
      window.location.replace("/");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Sprememba ni uspela.");
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="panel login">
        <div className="eyebrow">KD GROSUPLJE · URNIKI</div>
        <h1>Nastavi novo geslo</h1>
        <p>
          {loading
            ? "Preverjanje prijave …"
            : "Pred uporabo urnikov morate zamenjati začetno oziroma začasno geslo."}
        </p>
        {pending && (
          <form action={submit}>
            <label>
              Novo geslo
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                required
                disabled={busy}
              />
            </label>
            <label>
              Potrditev novega gesla
              <input
                name="confirmation"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                required
                disabled={busy}
              />
            </label>
            <p>Vsaj 12 znakov. Novo geslo mora biti drugačno od trenutnega.</p>
            <button className="primary" disabled={busy}>
              {busy ? "Shranjevanje …" : "Shrani novo geslo"}
            </button>
          </form>
        )}
        {message && (
          <p className="notice" role="alert">
            {message}
          </p>
        )}
        <p>
          <button
            disabled={busy}
            onClick={async () => {
              await supabase?.auth.signOut({ scope: "local" });
              window.location.replace("/");
            }}
          >
            Odjava
          </button>
        </p>
        <Link href="/pozabljeno-geslo">Potrebujete pomoč z geslom?</Link>
      </section>
    </main>
  );
}
