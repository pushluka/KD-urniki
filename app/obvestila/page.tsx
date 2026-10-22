"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { staffRequest } from "@/lib/staff-client";
type Notice = {
  id: string;
  user_id: string;
  event_id: string;
  event_title: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
};
export default function Notifications() {
  const request = useRef(0);
  const [items, setItems] = useState<Notice[]>([]),
    [offset, setOffset] = useState(0),
    [next, setNext] = useState<number | null>(null),
    [allowed, setAllowed] = useState(false),
    [message, setMessage] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const current = ++request.current;
    try {
      const data = await staffRequest(`/api/push/history?offset=${offset}`);
      if (current !== request.current) return;
      setItems(data.items);
      setNext(data.next_offset);
      setAllowed(true);
      setMessage("");
    } catch (e) {
      if (current !== request.current) return;
      setMessage(
        e instanceof Error ? e.message : "Obvestil ni mogoče naložiti.",
      );
      setItems([]);
      setAllowed(false);
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [offset]);
  useEffect(() => {
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        request.current++;
        setItems([]);
        setAllowed(false);
        setLoading(false);
        setMessage("Za ogled obvestil se prijavite kot administrator.");
      }
    });
    return () => {
      request.current++;
      subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 30000);
    return () => {
      window.removeEventListener("focus", refresh);
      clearInterval(timer);
    };
  }, [load]);
  async function mark(item: Notice, read: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await staffRequest("/api/push/history", "PATCH", { id: item.id, read });
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Sprememba ni uspela.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="panel notification-history">
        <div className="eyebrow">KD GROSUPLJE · URNIKI</div>
        <h1>Obvestila</h1>
        <p>
          Zgodovina zadnjih 14 dni, od najnovejših. Prebranost je skupna vsem
          vašim napravam.
        </p>
        {allowed && (
          <p>
            <Link href="/nastavitve">Vklop obvestil na tej napravi</Link>
          </p>
        )}
        {loading && <p role="status">Nalaganje obvestil …</p>}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        {allowed && !loading && !items.length && (
          <p>Ni obvestil na tej strani.</p>
        )}
        {items.map((item) => (
          <article
            key={item.id}
            className={
              item.read_at ? "notification-item" : "notification-item unread"
            }
            aria-label={item.title}
          >
            <span className="badge">
              {item.read_at ? "Prebrano" : "Neprebrano"}
            </span>
            <h2>{item.title}</h2>
            <p>{item.body}</p>
            <time dateTime={item.created_at}>
              {new Date(item.created_at).toLocaleString("sl-SI", {
                timeZone: "Europe/Ljubljana",
              })}
            </time>
            <p>
              <Link
                href={`/?dogodek=${item.event_id}&prejemnik=${item.user_id}&obvestilo=${item.id}`}
              >
                Odpri dogodek: {item.event_title}
              </Link>
            </p>
            <button
              disabled={busy}
              onClick={() => void mark(item, !item.read_at)}
            >
              {item.read_at ? "Označi kot neprebrano" : "Označi kot prebrano"}
            </button>
          </article>
        ))}
        {allowed && (
          <div className="notification-pagination">
            <button
              disabled={offset === 0 || busy}
              onClick={() => {
                setLoading(true);
                setOffset(Math.max(0, offset - 50));
              }}
            >
              Novejša
            </button>
            <button
              disabled={next === null || busy}
              onClick={() => {
                if (next !== null) {
                  setLoading(true);
                  setOffset(next);
                }
              }}
            >
              Starejša
            </button>
          </div>
        )}
        <p>
          <Link href="/">Nazaj na urnike</Link>
        </p>
      </section>
    </main>
  );
}
