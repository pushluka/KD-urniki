"use client";
import Link from "next/link";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { recoveryRedirect } from "@/lib/recovery";
export default function ForgotPassword() {
  const [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false),
    [message, setMessage] = useState("");
  async function submit(form: FormData) {
    if (!supabase || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        String(form.get("email")).trim(),
        { redirectTo: recoveryRedirect(window.location.origin) },
      );
      if (error) throw error;
      setSent(true);
    } catch {
      setMessage("Zahteve ni bilo mogoče poslati. Poskusite pozneje.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="panel login">
        <div className="eyebrow">KD GROSUPLJE · URNIKI</div>
        <h1>Pozabljeno geslo</h1>
        <p>
          Poslali vam bomo povezavo za varno nastavitev novega gesla na e-pošto
          računa. Če uporabljate uporabniško ime brez e-pošte za obnovitev, se
          obrnite na administratorja.
        </p>
        {!supabase ? (
          <p role="alert">Povezava Supabase ni nastavljena.</p>
        ) : sent ? (
          <p role="status" className="notice">
            Če za ta e-poštni naslov obstaja račun, boste prejeli povezavo za
            obnovitev. Preverite tudi neželeno pošto.
          </p>
        ) : (
          <form action={submit}>
            <label>
              E-pošta
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={busy}
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "Pošiljanje …" : "Pošlji povezavo"}
            </button>
          </form>
        )}
        {message && (
          <p role="alert" className="notice">
            {message}
          </p>
        )}
        <p>
          <Link href="/">Nazaj na prijavo</Link>
        </p>
      </section>
    </main>
  );
}
