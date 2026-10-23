"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { staffRequest } from "@/lib/staff-client";
export default function GoogleReturn() {
  const started = useRef(false),
    [message, setMessage] = useState("Zaključevanje Google povezave …");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const ticket = new URLSearchParams(window.location.search).get("ticket");
    window.history.replaceState(null, "", "/nastavitve/google");
    if (!ticket) {
      setMessage("Povezava ni veljavna. Začnite znova v Nastavitvah.");
      return;
    }
    void staffRequest("/api/google/finish", "POST", { ticket })
      .then(() => window.location.replace("/nastavitve"))
      .catch((e) =>
        setMessage(e instanceof Error ? e.message : "Povezava ni uspela."),
      );
  }, []);
  return (
    <main className="auth-page">
      <section className="panel install-guide">
        <h1>Google Koledar</h1>
        <p role="status">{message}</p>
        <Link href="/nastavitve">Nazaj v Nastavitve</Link>
      </section>
    </main>
  );
}
