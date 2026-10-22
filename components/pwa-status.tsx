"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
export function PwaStatus() {
  const [offline, setOffline] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [updating, setUpdating] = useState(false);
  const [failed, setFailed] = useState(false);
  const reloadOnChange = useRef(false);
  useEffect(() => {
    const online = () => setOffline(!navigator.onLine);
    online();
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
    };
  }, []);
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    let installing: ServiceWorker | null = null;
    const changed = () => {
      if (
        registration?.waiting &&
        navigator.serviceWorker.controller &&
        !disposed
      )
        setWaiting(registration.waiting);
    };
    const found = () => {
      installing?.removeEventListener("statechange", changed);
      installing = registration?.installing ?? null;
      installing?.addEventListener("statechange", changed);
    };
    const controlled = () => {
      if (reloadOnChange.current) window.location.reload();
      else setWaiting(null);
    };
    const check = () => {
      if (navigator.onLine && document.visibilityState === "visible")
        void registration?.update().catch(() => {});
    };
    navigator.serviceWorker.addEventListener("controllerchange", controlled);
    window.addEventListener("focus", check);
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((r) => {
        if (disposed) return;
        registration = r;
        changed();
        found();
        r.addEventListener("updatefound", found);
        check();
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      registration?.removeEventListener("updatefound", found);
      installing?.removeEventListener("statechange", changed);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        controlled,
      );
      window.removeEventListener("focus", check);
    };
  }, []);
  return (
    <>
      {offline && (
        <p className="pwa-offline" role="status">
          Ni internetne povezave. Za prijavo, urnike in dokumente potrebujete
          povezavo.
        </p>
      )}
      <div className="pwa-tools">
        <Link href="/namestitev">Namestitev na telefon</Link>
        {failed && (
          <span>
            Namestitev trenutno ni na voljo. Poskusite znova ob naslednjem
            obisku.
          </span>
        )}
        {waiting && (
          <div role="status">
            <p>
              Na voljo je nova različica. Pred posodobitvijo shranite spremembe.
            </p>
            <button
              disabled={updating}
              onClick={() => {
                reloadOnChange.current = true;
                setUpdating(true);
                waiting.postMessage({ type: "ACTIVATE_UPDATE" });
              }}
            >
              {updating ? "Posodabljanje …" : "Posodobi aplikacijo"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
