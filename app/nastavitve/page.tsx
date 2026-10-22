"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
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
  const [key, setKey] = useState<string | null>(null),
    [allowed, setAllowed] = useState(false),
    [ready, setReady] = useState(false),
    [enabled, setEnabled] = useState(false),
    [busy, setBusy] = useState(false),
    [permission, setPermission] = useState("default"),
    [message, setMessage] = useState(""),
    [supported, setSupported] = useState(false),
    [ios, setIos] = useState(false);
  useEffect(() => {
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
    if ("Notification" in window) setPermission(Notification.permission);
    void staffRequest("/api/push/subscription")
      .then(async (data) => {
        setAllowed(true);
        setKey(data.public_key);
        if (supported) {
          const r = await navigator.serviceWorker.getRegistration("/"),
            sub = await r?.pushManager.getSubscription();
          setEnabled(
            Notification.permission === "granted" &&
              !!sub &&
              data.endpoint_hashes.includes(await hash(sub.endpoint)),
          );
        }
      })
      .catch((e) => setMessage(e.message))
      .finally(() => setReady(true));
  }, []);
  async function enable() {
    if (!key || busy) return;
    setBusy(true);
    setMessage("");
    try {
      // Called directly in the click handler: Safari requires a user gesture.
      const permission = await Notification.requestPermission();
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
      setEnabled(true);
      setMessage("Obvestila so omogočena na tej napravi.");
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Vklop ni uspel. Poskusite znova.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
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
      setEnabled(false);
      setMessage(
        serverFailed
          ? "Naprava je odjavljena od obvestil. Zastarelo naročnino bo strežnik odstranil ob naslednjem pošiljanju."
          : "Obvestila so izklopljena na tej napravi.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Izklop ni uspel.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="panel install-guide">
        <div className="eyebrow">KD GROSUPLJE · URNIKI</div>
        <h1>Nastavitve obvestil</h1>
        <p>
          Obvestila o vaših razporeditvah so izbirna. Nastavitev velja samo za
          to napravo in račun. Aplikacijo lahko uporabljate brez obvestil.
        </p>
        {!ready ? (
          <p role="status">Preverjanje nastavitev …</p>
        ) : (
          allowed && (
            <>
              <p>
                Dovoljenje:{" "}
                {permission === "granted"
                  ? "dovoljeno"
                  : permission === "denied"
                    ? "zavrnjeno"
                    : "še ni izbrano"}
                . Obvestila na tej napravi:{" "}
                {enabled ? "vklopljena" : "izklopljena"}.
              </p>
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
              <button
                className="primary"
                disabled={
                  !supported ||
                  !key ||
                  enabled ||
                  busy ||
                  permission === "denied"
                }
                onClick={() => void enable()}
              >
                Omogoči obvestila
              </button>{" "}
              <button
                disabled={!supported || busy}
                onClick={() => void disable()}
              >
                Izklopi obvestila
              </button>
              <p>
                V obvestilu ni naslova dogodka ali osebnih ur. Podrobnosti so
                dostopne šele v aplikaciji. Na skupni napravi se po uporabi
                odjavite.
              </p>
            </>
          )
        )}
        {message && (
          <p className="notice" role="status">
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
