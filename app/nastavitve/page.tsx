"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { staffRequest } from "@/lib/staff-client";
function bytes(key: string) {
  return Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
}
async function hash(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export default function PushSettings() {
  const [role, setRole] = useState("");
  const [key, setKey] = useState<string | null>(null),
    [allowed, setAllowed] = useState(false),
    [ready, setReady] = useState(false),
    [enabled, setEnabled] = useState(false),
    [busy, setBusy] = useState(false),
    [permission, setPermission] = useState("default"),
    [message, setMessage] = useState(""),
    [supported, setSupported] = useState(false),
    [ios, setIos] = useState(false);
  const request = useRef(0);
  const working = useRef(false);
  const refresh = useCallback(async (clearMessage = true) => {
    const current = ++request.current;
    setReady(false);
    if (clearMessage) setMessage("");
    const apple =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone =
      matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone;
    const supported =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window &&
      window.isSecureContext &&
      (!apple || !!standalone);
    setIos(apple && !standalone);
    setSupported(supported);
    const permission =
      "Notification" in window ? Notification.permission : "default";
    setPermission(permission);
    try {
      const data = await staffRequest("/api/push/subscription");
      let enabled = false;
      if (supported && permission === "granted") {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const sub = await registration?.pushManager.getSubscription();
        const existing = sub?.options.applicationServerKey;
        const matchingKey =
          !!data.public_key &&
          (!existing ||
            new Uint8Array(existing).toString() ===
              bytes(data.public_key).toString());
        enabled =
          !!sub &&
          matchingKey &&
          data.endpoint_hashes.includes(await hash(sub.endpoint));
      }
      if (current !== request.current) return;
      setAllowed(true);
      setRole(data.role ?? "");
      setKey(data.public_key);
      setEnabled(enabled);
    } catch (e) {
      if (current !== request.current) return;
      setAllowed(false);
      setEnabled(false);
      setMessage(
        e instanceof Error ? e.message : "Stanja obvestil ni mogoče preveriti.",
      );
    } finally {
      if (current === request.current) setReady(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const check = () => {
      if (!working.current && document.visibilityState === "visible")
        void refresh();
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    let authCheck: ReturnType<typeof setTimeout> | undefined;
    const subscription = supabase?.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        request.current++;
        clearTimeout(authCheck);
        authCheck = setTimeout(check, 0);
      }
      if (event === "SIGNED_OUT") {
        request.current++;
        setAllowed(false);
        setEnabled(false);
        setReady(true);
        setMessage("Za nadaljevanje se prijavite.");
      }
    }).data.subscription;
    return () => {
      request.current++;
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
      clearTimeout(authCheck);
      subscription?.unsubscribe();
    };
  }, [refresh]);
  async function enable() {
    if (!key || working.current) return;
    working.current = true;
    request.current++;
    setBusy(true);
    setMessage("");
    try {
      // Called directly in the click handler: Safari requires a user gesture.
      const permission =
        Notification.permission === "default"
          ? await Notification.requestPermission()
          : Notification.permission;
      setPermission(permission);
      if (permission !== "granted")
        throw new Error(
          "Obvestila niso dovoljena. Dovoljenje lahko spremenite v nastavitvah brskalnika oziroma telefona.",
        );
      const r = await navigator.serviceWorker.ready;
      const capable = await new Promise<boolean>((resolve) => {
        const channel = new MessageChannel();
        const finish = (ok: boolean) => {
          clearTimeout(timer);
          channel.port1.close();
          channel.port2.close();
          resolve(ok);
        };
        const timer = setTimeout(() => finish(false), 2000);
        channel.port1.onmessage = (event) => finish(event.data?.push === true);
        if (r.active)
          r.active.postMessage({ type: "PUSH_CAPABILITIES" }, [channel.port2]);
        else finish(false);
      });
      if (!capable)
        throw new Error(
          "Najprej posodobite aplikacijo z gumbom Posodobi aplikacijo, nato znova vključite obvestila.",
        );
      let sub = await r.pushManager.getSubscription();
      const existing = sub?.options.applicationServerKey;
      if (
        sub &&
        existing &&
        new Uint8Array(existing).toString() !== bytes(key).toString()
      ) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await r.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes(key),
      });
      try {
        await staffRequest("/api/push/subscription", "POST", sub.toJSON());
      } catch (e) {
        await sub.unsubscribe();
        throw e;
      }
      // The subsequent browser/server check is the source of the displayed state.
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Vklop ni uspel. Poskusite znova.",
      );
    } finally {
      await refresh(false);
      working.current = false;
      setBusy(false);
    }
  }
  async function disable() {
    if (working.current) return;
    working.current = true;
    request.current++;
    setBusy(true);
    setMessage("");
    try {
      const r = await navigator.serviceWorker.getRegistration("/"),
        sub = await r?.pushManager.getSubscription();
      let serverFailed = false;
      if (sub) {
        try {
          await staffRequest("/api/push/subscription", "DELETE", {
            endpoint: sub.endpoint,
          });
        } catch {
          serverFailed = true;
        }
        if (!(await sub.unsubscribe()))
          throw new Error(
            "Izklop ni potrjen. Preverite dovoljenje v nastavitvah brskalnika.",
          );
      }
      setMessage(
        serverFailed
          ? "Naprava je odjavljena od obvestil. Zastarelo naročnino bo strežnik odstranil ob naslednjem pošiljanju."
          : "",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Izklop ni uspel.");
    } finally {
      await refresh(false);
      working.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="panel install-guide">
        <div className="eyebrow">KD GROSUPLJE · URNIKI</div>
        <h1>Nastavitve obvestil</h1>
        <p>
          {role === "administrator"
            ? "Obvestila o razporeditvah ekipe so izbirna."
            : "Obvestila o vaših razporeditvah so izbirna."}{" "}
          Nastavitev velja samo za to napravo in račun. Aplikacijo lahko
          uporabljate brez obvestil.
        </p>
        <p role="status" aria-label="Stanje obvestil">
          {!ready
            ? "Preverjanje nastavitev …"
            : !allowed
              ? "Stanja obvestil ni mogoče preveriti."
              : !supported
                ? "Obvestila v tem brskalniku niso podprta."
                : permission === "denied"
                  ? "Obvestila so blokirana."
                  : !key
                    ? "Obvestila na strežniku niso nastavljena."
                    : enabled
                      ? "Obvestila so vključena."
                      : "Obvestila so izključena."}
        </p>
        {ready && allowed && (
          <>
            {permission === "denied" && supported && (
              <p>
                V nastavitvah telefona oziroma brskalnika dovolite obvestila za
                to spletno mesto, nato se vrnite v Nastavitve.
              </p>
            )}
            {ios && (
              <p>
                Na iPhonu potrebujete iOS/iPadOS 16.4 ali novejši. Aplikacijo
                najprej dodajte na začetni zaslon v Safariju in jo odprite z
                ikono.
              </p>
            )}
            {!supported && (
              <p>
                Potisna obvestila v tem brskalniku niso na voljo. Uporabite
                podprt brskalnik ali nameščeno aplikacijo.
              </p>
            )}
            {!key && (
              <p>
                Strežnik za obvestila še ni nastavljen. Obvestite
                administratorja.
              </p>
            )}
            {supported &&
              permission !== "denied" &&
              key &&
              (enabled ? (
                <button disabled={busy} onClick={() => void disable()}>
                  {busy ? "Izklapljanje …" : "Izklopi obvestila"}
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void enable()}
                >
                  {busy ? "Vklapljanje …" : "Omogoči obvestila"}
                </button>
              ))}
            <p>
              V obvestilu ni naslova dogodka ali osebnih ur. Podrobnosti so
              dostopne šele v aplikaciji. Na skupni napravi se po uporabi
              odjavite.
            </p>
          </>
        )}
        {ready && !allowed && (
          <button disabled={busy} onClick={() => void refresh()}>
            Preveri znova
          </button>
        )}
        {message && (
          <p className="notice" role="alert">
            {message}
          </p>
        )}
        <p>
          <Link href="/namestitev">Navodila za namestitev</Link>
        </p>
        <Link href="/">Nazaj na urnike</Link>
      </section>
    </main>
  );
}
