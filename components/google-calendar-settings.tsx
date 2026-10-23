"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { staffRequest } from "@/lib/staff-client";
type Status = {
  configured: boolean;
  status: string;
  calendar_id: string | null;
  calendar_name: string | null;
  last_error: string | null;
  last_synced_at: string | null;
  needs_restore: boolean;
};
export function GoogleCalendarSettings() {
  const [status, setStatus] = useState<Status | null>(null),
    [restore, setRestore] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setStatus(await staffRequest("/api/google/status"));
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Stanja ni mogoče preveriti.",
      );
    }
  }, []);
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("google");
    if (result === "cancelled" || result === "expired") {
      setMessage(
        result === "cancelled"
          ? "Google povezava ni bila potrjena. Začnite znova, ko jo želite vključiti."
          : "Google povezava je potekla. Začnite znova.",
      );
      window.history.replaceState(null, "", "/nastavitve");
    }
    void load();
    const focus = () => void load();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [load]);
  async function connect() {
    setBusy(true);
    setMessage("");
    try {
      const data = await staffRequest("/api/google/start", "POST");
      const target = new URL(data.url);
      if (target.origin !== "https://accounts.google.com")
        throw new Error("Neveljavna povezava.");
      window.location.assign(target.href);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Povezava ni uspela.");
      setBusy(false);
    }
  }
  async function select(recover = false) {
    setBusy(true);
    setMessage("");
    try {
      await staffRequest(
        "/api/google/select",
        "POST",
        recover ? { calendar_id: restore } : { create: true },
      );
      await load();
      setMessage(
        "Uskladitev vaših trenutnih dodelitev je dodana v strežniško vrsto.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Izbira ni uspela.");
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    if (
      !window.confirm(
        "Prekinem povezavo? Že ustvarjeni vnosi ostanejo v Google Koledarju; prihodnja sinhronizacija se ustavi.",
      )
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      await staffRequest("/api/google/disconnect", "POST");
      await load();
      setMessage(
        "Povezava je prekinjena. Že ustvarjeni vnosi ostanejo v Googlu.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Odklop ni uspel.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="google-settings">
      <h2>Google Koledar</h2>
      <p>
        Povezava je prostovoljna. Sinhronizirajo se izključno dogodki, na
        katerih ste sami razporejeni, z vašim prihodom in zaključkom.
      </p>
      <p>
        Uporablja se ločen koledar »KD Urniki – Moje delo«, ki ga ustvari
        aplikacija. Do seznama vaših osebnih koledarjev ne dostopa.
      </p>
      {!status ? (
        <p>Preverjanje povezave …</p>
      ) : (
        <>
          <p>
            Stanje:{" "}
            {(
              {
                disconnected: "ni povezave",
                awaiting_calendar: "potrdite namenski koledar",
                connected: "povezano",
                reauthorize: "potrebna je ponovna povezava",
              } as Record<string, string>
            )[status.status] ?? "ni povezave"}
            {status.calendar_name ? ` · ${status.calendar_name}` : ""}.
          </p>
          {!status.configured && (
            <p>Google povezava še ni nastavljena. Obvestite administratorja.</p>
          )}
          {status.last_error && !status.needs_restore && (
            <p>
              Uskladitev zahteva pozornost. Ob poteku dovoljenja povežite račun
              znova. Začasne napake strežnik ponovi samodejno; če težava ostane,
              obvestite administratorja.
            </p>
          )}
          {status.last_synced_at && (
            <p>
              Zadnja uskladitev:{" "}
              {new Date(status.last_synced_at).toLocaleString("sl-SI", {
                timeZone: "Europe/Ljubljana",
              })}
              .
            </p>
          )}
          {["disconnected", "reauthorize"].includes(status.status) ? (
            <>
              <button
                disabled={busy || !status.configured}
                onClick={() => void connect()}
              >
                Poveži Google Koledar
              </button>
              {status.status === "reauthorize" && (
                <button disabled={busy} onClick={() => void disconnect()}>
                  Prekini Google Koledar
                </button>
              )}
            </>
          ) : (
            <>
              <button disabled={busy} onClick={() => void disconnect()}>
                Prekini Google Koledar
              </button>{" "}
              <button
                disabled={busy || !status.configured}
                onClick={() => void select()}
              >
                {status.status === "connected"
                  ? "Ponovno uskladi moje dodelitve"
                  : "Potrdi namenski koledar in uskladi moje dodelitve"}
              </button>
              {status.needs_restore && (
                <div>
                  <p>
                    Odgovor o ustvarjanju koledarja ni bil potrjen. Da ne
                    nastanejo dvojniki, aplikacija ne ustvari novega samodejno.
                    V Google Koledarju preverite »KD Urniki – Moje delo« in iz
                    njegovih nastavitev kopirajte ID koledarja.
                  </p>
                  <label>
                    ID namenskega koledarja
                    <input
                      value={restore}
                      onChange={(e) => setRestore(e.target.value)}
                      maxLength={1024}
                    />
                  </label>
                  <button
                    disabled={busy || !restore}
                    onClick={() => void select(true)}
                  >
                    Obnovi povezavo z namenskim koledarjem
                  </button>
                </div>
              )}
            </>
          )}
          <p>
            Ob odklopu že ustvarjeni vnosi ostanejo. Ob ponovni povezavi z istim
            koledarjem se uskladijo trenutne dodelitve in odstranijo samo stari
            aplikacijski vnosi za dogodke, s katerih ste bili odstranjeni. Pri
            povezavi drugega Google računa stari vnosi ostanejo v prejšnjem
            računu.
          </p>
        </>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <Link href="/zasebnost/google">
        Podatki in dovoljenja Google povezave
      </Link>
    </section>
  );
}
