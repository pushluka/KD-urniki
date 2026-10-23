"use client";
import Link from "next/link";
import { staffRequest } from "@/lib/staff-client";
import { EventDialog } from "@/components/event-dialog";
import { EventStaffing } from "@/components/event-staffing";
import { localDateTime as localInput } from "@/lib/staffing";
import { isRecoveryLink, recoveryPath } from "@/lib/recovery";
import { useCallback, useEffect, useState, useRef } from "react";
import {
  CalendarDays,
  Users,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Plus,
  MapPin,
  Clock,
  FileText,
  X,
  ArrowRight,
  Settings,
  LayoutGrid,
} from "lucide-react";
import {
  supabase,
  type Event,
  type Profile,
  type Assignment,
  type ExternalAssignment,
} from "@/lib/supabase";
const locations = ["Kulturni dom", "Družbeni dom", "Druga lokacija"];
const dateLabel = (d: string) =>
  new Date(d).toLocaleString("sl-SI", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Ljubljana",
  });
export default function Home() {
  // Calendar dates use the browser's local timezone. Render them only after mount
  // so prerendered dates cannot replace a user's first interaction during hydration.
  const [accessChecked, setAccessChecked] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  const [profile, setProfile] = useState<Profile | null>(null),
    [events, setEvents] = useState<Event[]>([]),
    [people, setPeople] = useState<Profile[]>([]),
    [assignments, setAssignments] = useState<Assignment[]>([]),
    [external, setExternal] = useState<ExternalAssignment[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [view, setView] = useState("Koledar"),
    [location, setLocation] = useState("Vse lokacije"),
    [month, setMonth] = useState(
      new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    ),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [creating, setCreating] = useState(false);
  const selected = events.find((event) => event.id === selectedId) ?? null;
  function openEvent(event: Event) {
    setSelectedId(event.id);
    setCreating(false);
    setMessage("");
  }
  function closeEvent() {
    setSelectedId(null);
    setCreating(false);
    setMessage("");
  }
  const [documentLinks, setDocumentLinks] = useState<
    { name: string; url: string }[]
  >([]);
  useEffect(() => {
    setDocumentLinks([]);
  }, [selectedId]);
  const admin = profile?.role === "administrator";
  const load = useCallback(async (id: string) => {
    if (!supabase) return false;
    setLoading(true);
    try {
      const access = await staffRequest("/api/auth/password-status");
      if (access.must_change_password) {
        window.location.replace("/nastavi-geslo");
        return false;
      }
      setAccessChecked(true);
      const results = await Promise.all([
        supabase.from("profiles").select("*"),
        supabase.from("events").select("*").order("starts_at"),
        supabase.from("assignments").select("*"),
        supabase.from("external_assignments").select("*"),
      ]);
      for (const r of results) if (r.error) throw r.error;
      const ps = results[0].data as Profile[];
      setPeople(ps);
      setProfile(ps.find((p) => p.id === id) ?? null);
      setEvents(results[1].data as Event[]);
      setAssignments(results[2].data as Assignment[]);
      setExternal(results[3].data as ExternalAssignment[]);
      return true;
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Podatkov ni bilo mogoče naložiti. Preverite povezavo in migracijo.",
      );
      return false;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (isRecoveryLink(new URL(window.location.href))) {
      window.location.replace(
        recoveryPath + window.location.search + window.location.hash,
      );
      return;
    }
    if (
      new URLSearchParams(window.location.search).get("geslo") === "spremenjeno"
    ) {
      setMessage("Geslo je uspešno spremenjeno. Prijavite se z novim geslom.");
      window.history.replaceState(null, "", "/");
    }
    if (!supabase) {
      setLoading(false);
      return;
    }
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionId(session?.user.id ?? null);
      if (!session) {
        setAccessChecked(false);
        setProfile(null);
        setEvents([]);
        setPeople([]);
        setAssignments([]);
        setExternal([]);
        setSelectedId(null);
        setCreating(false);
        setLoading(false);
      }
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setMessage(error.message);
      setSessionId(data.session?.user.id ?? null);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (sessionId) void load(sessionId);
  }, [sessionId, load]);
  // Refresh remote staffing changes without requiring Supabase Realtime setup.
  useEffect(() => {
    if (!sessionId) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void load(sessionId);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [sessionId, load]);
  async function login(form: FormData) {
    if (!supabase) return;
    setBusy(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identity: String(form.get("identity")),
          password: String(form.get("password")),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Prijava ni uspela.");
      const { error } = await supabase.auth.setSession({
        access_token: result.access_token,
        refresh_token: result.refresh_token,
      });
      if (error) throw new Error("Prijava ni uspela. Poskusite znova.");
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Prijava ni uspela. Poskusite znova.",
      );
    }
    setBusy(false);
  }
  async function saveEvent(form: FormData) {
    if (!supabase || !sessionId) return;
    setBusy(true);
    try {
      const start = new Date(String(form.get("starts_at"))),
        end = new Date(String(form.get("ends_at")));
      if (end <= start)
        throw new Error("Zaključek mora biti za začetkom dogodka.");
      const { error } = await supabase.from("events").upsert({
        ...(selected ? { id: selected.id } : {}),
        title: form.get("title"),
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        location: form.get("location"),
        notes: form.get("notes"),
        hostesses_needed: Number(form.get("hostesses_needed")),
        technicians_needed: Number(form.get("technicians_needed")),
        accounting_code: form.get("accounting_code"),
      });
      if (error) throw error;
      setCreating(false);
      setSelectedId(null);
      await load(sessionId);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Shranjevanje ni uspelo.");
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    if (!supabase || !selected) return;
    if (file.type !== "application/pdf" || file.size > 20 * 1024 * 1024) {
      setMessage("Izberite PDF, velik največ 20 MB.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.storage
      .from("technical-documents")
      .upload(`${selected.id}/${crypto.randomUUID()}.pdf`, file, {
        contentType: "application/pdf",
      });
    setMessage(error ? error.message : "PDF je varno shranjen.");
    setBusy(false);
  }
  async function documents() {
    if (!supabase || !selected) return;
    setBusy(true);
    const { data, error } = await supabase.storage
      .from("technical-documents")
      .list(selected.id);
    if (error) setMessage(error.message);
    else if (!data?.length) setMessage("Za ta dogodek še ni dokumentov.");
    else {
      const links = [];
      for (const file of data) {
        const r = await supabase.storage
          .from("technical-documents")
          .createSignedUrl(`${selected.id}/${file.name}`, 60);
        if (r.error) {
          setMessage(r.error.message);
          break;
        }
        links.push({ name: file.name, url: r.data.signedUrl });
      }
      setDocumentLinks(links);
    }
    setBusy(false);
  }
  const personalCalendar =
    profile?.role === "tehnik" || profile?.role === "hostesa";
  const workingEvents = new Set(
    personalCalendar
      ? assignments
          .filter((a) => a.user_id === sessionId)
          .map((a) => a.event_id)
      : [],
  );
  const eventStyle = (event: Event) =>
    personalCalendar
      ? workingEvents.has(event.id)
        ? "is-working"
        : "is-neutral"
      : `color-${locations.indexOf(event.location)}`;
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const receive = (event: MessageEvent) => {
      if (event.data?.type !== "OPEN_PUSH_EVENT") return;
      // Same-origin worker messages only. Ask before leaving an editable dialog.
      if (
        creating &&
        !window.confirm("Odpreti obvestilo? Neshranjeni vnos bo izgubljen.")
      )
        return;
      const target = new URL(event.data.url, window.location.origin);
      if (target.origin === window.location.origin && target.pathname === "/")
        window.location.assign(target.href);
    };
    navigator.serviceWorker.addEventListener("message", receive);
    return () =>
      navigator.serviceWorker.removeEventListener("message", receive);
  }, [creating]);
  const pushLinkHandled = useRef("");
  useEffect(() => {
    if (!profile || loading || !accessChecked) return;
    const params = new URLSearchParams(window.location.search),
      id = params.get("dogodek"),
      recipient = params.get("prejemnik");
    if (
      !id ||
      !/^[0-9a-f-]{36}$/i.test(id) ||
      pushLinkHandled.current === id + sessionId
    )
      return;
    pushLinkHandled.current = id + sessionId;
    if (recipient && recipient !== sessionId) {
      setMessage(
        "Obvestilo je namenjeno drugemu računu. Prijavite se z ustreznim računom.",
      );
      return;
    }
    const notice = params.get("obvestilo");
    if (
      profile.role === "administrator" &&
      notice &&
      /^[0-9a-f-]{36}$/i.test(notice)
    )
      void staffRequest("/api/push/history", "PATCH", {
        id: notice,
        read: true,
      }).catch(() => {});
    const event = events.find((e) => e.id === id);
    if (event) setSelectedId(event.id);
    else setMessage("Dogodek ni več na voljo oziroma nimate dostopa.");
  }, [profile, loading, accessChecked, events, sessionId]);
  const filtered = events.filter(
    (e) =>
      (location === "Vse lokacije" || e.location === location) &&
      (view !== "Moj razpored" ||
        assignments.some(
          (a) => a.event_id === e.id && a.user_id === sessionId,
        )),
  );
  const monthly = filtered.filter((e) => {
    const d = new Date(e.starts_at);
    return (
      d.getFullYear() === month.getFullYear() &&
      d.getMonth() === month.getMonth()
    );
  });
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(),
    offset = (month.getDay() + 6) % 7;
  if (!ready || (sessionId && !accessChecked))
    return (
      <main className="auth-page">
        <div>
          <p role="status">{message || "Nalaganje urnikov …"}</p>
          {message && (
            <button onClick={() => void supabase?.auth.signOut()}>
              Odjava
            </button>
          )}
        </div>
      </main>
    );
  return (
    <div className="shell">
      <aside className="app-navigation">
        <a className="brand" href="/">
          <span className="brand-icon">
            kd<span>•</span>
          </span>
          <span>
            KD Grosuplje<small>PROSTOR ZA KULTURO</small>
          </span>
        </a>
        <div className="workspace-label">ORGANIZACIJA DELA</div>
        <nav
          aria-label="Glavna navigacija"
          className={admin ? "admin-navigation" : undefined}
        >
          {[
            { name: "Koledar", Icon: CalendarDays },
            { name: "Moj razpored", Icon: LayoutGrid },
            { name: "Ekipa", Icon: Users },
          ].map(({ name, Icon }) => (
            <button
              key={name}
              className={view === name ? "nav active" : "nav"}
              onClick={() => setView(name)}
            >
              <Icon size={19} />
              {name}
              {view === name && <span className="nav-dot" />}
            </button>
          ))}
          {profile && (
            <Link className="nav" href="/nastavitve">
              <Settings size={19} />
              Nastavitve
            </Link>
          )}
          {admin && (
            <Link className="nav" href="/obvestila">
              <FileText size={19} />
              Obvestila
            </Link>
          )}
          {admin && (
            <Link className="nav" href="/osebje">
              <Users size={19} />
              Osebje
            </Link>
          )}
        </nav>
        <div className="aside-bottom">
          <div className="help">
            <span className="tiny-label">VSE NA ENEM MESTU</span>
            <p>
              Dobra organizacija.
              <br />
              Odlični dogodki.
            </p>
            <span>Skupaj ustvarjamo kulturo.</span>
          </div>
          <div className="user">
            <span className="avatar">
              {profile?.full_name?.slice(0, 2).toUpperCase() || "KD"}
            </span>
            <div>
              <strong>{profile?.full_name || "Dobrodošli"}</strong>
              <small>{profile?.role || "Prijava v delovni prostor"}</small>
            </div>
            {sessionId && (
              <button
                aria-label="Odjava"
                onClick={() => void supabase?.auth.signOut()}
              >
                <LogOut size={18} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <main>
        <header>
          <span>
            Delovni prostor <span className="crumb">/</span>{" "}
            <strong>{view}</strong>
          </span>
          <span className="today">
            {new Date().toLocaleDateString("sl-SI", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </span>
          {sessionId && (
            <button
              className="mobile-logout"
              aria-label="Odjava"
              onClick={() => void supabase?.auth.signOut()}
            >
              <LogOut size={18} />
            </button>
          )}
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">KD GROSUPLJE · URNIKI</div>
              <h1>
                {view === "Ekipa"
                  ? "Naša ekipa"
                  : view === "Moj razpored"
                    ? "Moj razpored"
                    : "Koledar dogodkov"}
              </h1>
              <p>Pregled dogodkov, prostorov in ekipe. Vse usklajeno.</p>
            </div>
            {admin && view !== "Ekipa" && (
              <button
                className="primary"
                onClick={() => {
                  setMessage("");
                  setCreating(true);
                }}
              >
                <Plus size={18} /> Nov dogodek
              </button>
            )}
          </div>
          {message && (
            <div role="status" className="notice">
              {message}
              <button
                aria-label="Zapri obvestilo"
                onClick={() => setMessage("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!supabase ? (
            <section className="setup">
              <span className="setup-icon">
                <Settings size={24} />
              </span>
              <div>
                <h2>Povežimo vaš delovni prostor</h2>
                <p>
                  Za prijavo in resnične podatke nastavite povezavo Supabase po
                  navodilih v README. Koledar bo prikazal dogodke iz vaše
                  podatkovne baze.
                </p>
                <code>
                  NEXT_PUBLIC_SUPABASE_URL
                  <br />
                  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
                </code>
              </div>
            </section>
          ) : !sessionId ? (
            <section className="login panel">
              <div className="eyebrow">DOBRODOŠLI NAZAJ</div>
              <h2>Prijava v urnike</h2>
              <p>Uporabite svoj službeni uporabniški račun.</p>
              <form action={login}>
                <label>
                  Uporabniško ime ali e-pošta
                  <input
                    name="identity"
                    type="text"
                    autoComplete="username"
                    required
                  />
                </label>
                <label>
                  Geslo
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    minLength={6}
                  />
                </label>
                <button className="primary" disabled={busy}>
                  Prijava <ArrowRight size={17} />
                </button>
              </form>
              <p>
                <Link href="/pozabljeno-geslo">Pozabljeno geslo</Link>
              </p>
            </section>
          ) : !loading && !profile ? (
            <div className="notice">
              Vaš račun še nima profila. Obrnite se na administratorja.
            </div>
          ) : null}
          {sessionId && (
            <div className="stats">
              <div>
                <span className="stat-icon">
                  <CalendarDays />
                </span>
                <div>
                  <small>Dogodki v mesecu</small>
                  <strong>{monthly.length}</strong>
                </div>
              </div>
              <div>
                <span className="stat-icon">
                  <Users />
                </span>
                <div>
                  <small>Člani ekipe</small>
                  <strong>{people.length}</strong>
                </div>
              </div>
              <div>
                <span className="stat-icon">
                  <MapPin />
                </span>
                <div>
                  <small>Lokacije</small>
                  <strong>
                    3 <em>prostori za kulturo</em>
                  </strong>
                </div>
              </div>
            </div>
          )}
          {view === "Ekipa" ? (
            <section className="panel">
              <div className="section-title">
                <h2>Člani ekipe</h2>
                <span>{people.length} članov</span>
              </div>
              {people.length ? (
                people.map((p) => (
                  <div className="person" key={p.id}>
                    <span className="avatar">
                      {p.full_name.slice(0, 2).toUpperCase()}
                    </span>
                    <strong>{p.full_name}</strong>
                    <span className="badge">{p.role}</span>
                  </div>
                ))
              ) : (
                <div className="empty">Za pregled ekipe se prijavite.</div>
              )}
            </section>
          ) : (
            <section className="panel calendar">
              <div className="calendar-toolbar">
                <div className="month-control">
                  <h2>
                    {month.toLocaleDateString("sl-SI", {
                      month: "long",
                      year: "numeric",
                    })}
                  </h2>
                  <button
                    aria-label="Prejšnji mesec"
                    onClick={() =>
                      setMonth(
                        new Date(month.getFullYear(), month.getMonth() - 1, 1),
                      )
                    }
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    aria-label="Naslednji mesec"
                    onClick={() =>
                      setMonth(
                        new Date(month.getFullYear(), month.getMonth() + 1, 1),
                      )
                    }
                  >
                    <ChevronRight size={18} />
                  </button>
                  <button
                    className="outline"
                    onClick={() =>
                      setMonth(
                        new Date(
                          new Date().getFullYear(),
                          new Date().getMonth(),
                          1,
                        ),
                      )
                    }
                  >
                    Danes
                  </button>
                </div>
                <select
                  aria-label="Filtriraj po lokaciji"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                >
                  {["Vse lokacije", ...locations].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div className="legend">
                {personalCalendar ? (
                  <>
                    <span>
                      <i className="dot working-dot" />
                      Delam
                    </span>
                    <span>
                      <i className="dot neutral-dot" />
                      Ostali dogodki
                    </span>
                  </>
                ) : (
                  locations.map((l, i) => (
                    <span key={l}>
                      <i className={`dot color-${i}`} />
                      {l}
                    </span>
                  ))
                )}
              </div>
              <p className="mobile-calendar-hint">
                Dogodki po dnevih v izbranem mesecu
              </p>
              <div className="calendar-grid">
                {["Pon", "Tor", "Sre", "Čet", "Pet", "Sob", "Ned"].map((d) => (
                  <div key={d} className="weekday">
                    {d}
                  </div>
                ))}
                {Array.from(
                  { length: Math.ceil((offset + days) / 7) * 7 },
                  (_, i) => {
                    const day = i - offset + 1;
                    const valid = day > 0 && day <= days;
                    const current =
                      valid &&
                      new Date().toDateString() ===
                        new Date(
                          month.getFullYear(),
                          month.getMonth(),
                          day,
                        ).toDateString();
                    return (
                      <div className={`day ${valid ? "" : "outside"}`} key={i}>
                        <span
                          className={
                            current ? "day-number current" : "day-number"
                          }
                        >
                          {valid ? day : ""}
                        </span>
                        {valid && (
                          <span className="mobile-day-label">
                            {new Date(
                              month.getFullYear(),
                              month.getMonth(),
                              day,
                            ).toLocaleDateString("sl-SI", {
                              weekday: "long",
                              day: "numeric",
                              month: "long",
                            })}
                          </span>
                        )}
                        {valid &&
                          monthly
                            .filter(
                              (e) => new Date(e.starts_at).getDate() === day,
                            )
                            .map((e) => (
                              <button
                                className={`event ${eventStyle(e)}`}
                                key={e.id}
                                type="button"
                                aria-label={`Odpri dogodek: ${e.title}${workingEvents.has(e.id) ? " – Delam" : ""}`}
                                onClick={() => openEvent(e)}
                              >
                                <small>
                                  {new Date(e.starts_at).toLocaleTimeString(
                                    "sl-SI",
                                    { hour: "2-digit", minute: "2-digit" },
                                  )}
                                </small>
                                <strong>{e.title}</strong>
                                {workingEvents.has(e.id) && (
                                  <span className="working-label">Delam</span>
                                )}
                              </button>
                            ))}
                      </div>
                    );
                  },
                )}
              </div>
              <div className="calendar-footer">
                <span>
                  {loading
                    ? "Nalaganje dogodkov …"
                    : monthly.length
                      ? `${monthly.length} dogodkov v izbranem mesecu`
                      : "V tem mesecu še ni dogodkov."}
                </span>
                <span>Časovni pas: Ljubljana</span>
              </div>
            </section>
          )}
          {view !== "Ekipa" && (
            <section className="upcoming">
              <div className="section-title">
                <h2>
                  Na sporedu <span>Naslednji dogodki</span>
                </h2>
                <CalendarDays size={20} />
              </div>
              {filtered
                .filter((e) => new Date(e.ends_at) >= new Date())
                .slice(0, 5)
                .map((e) => (
                  <button
                    className={`event-row ${personalCalendar ? eventStyle(e) : ""}`}
                    key={e.id}
                    type="button"
                    onClick={() => openEvent(e)}
                  >
                    <div className="date-tile">
                      <strong>{new Date(e.starts_at).getDate()}</strong>
                      <small>
                        {new Date(e.starts_at).toLocaleDateString("sl-SI", {
                          month: "short",
                        })}
                      </small>
                    </div>
                    <div>
                      <h3>{e.title}</h3>
                      {workingEvents.has(e.id) && (
                        <span className="working-label">Delam</span>
                      )}
                      <p>
                        <MapPin size={14} />
                        {e.location} <Clock size={14} />
                        {dateLabel(e.starts_at)}
                      </p>
                    </div>
                    <ArrowRight size={19} />
                  </button>
                ))}
              {!filtered.some((e) => new Date(e.ends_at) >= new Date()) && (
                <div className="empty">
                  <CalendarDays size={28} />
                  <h3>Prostor za nove dogodke</h3>
                  <p>
                    {sessionId
                      ? "Prihodnji dogodki bodo prikazani tukaj."
                      : "Prijavite se za pregled dogodkov in razporedov."}
                  </p>
                </div>
              )}
            </section>
          )}
          <footer>
            KD Grosuplje <span>Skupaj ustvarjamo prostor za kulturo.</span>
          </footer>
        </div>
      </main>
      {(creating || selected) && (
        <EventDialog
          title={
            creating
              ? selected
                ? "Uredi dogodek"
                : "Nov dogodek"
              : selected!.title
          }
          onClose={closeEvent}
        >
          <button className="close" aria-label="Zapri" onClick={closeEvent}>
            <X />
          </button>
          {creating ? (
            <>
              <div className="eyebrow">NAČRTOVANJE</div>
              <h2>{selected ? "Uredi dogodek" : "Nov dogodek"}</h2>
              <form action={saveEvent}>
                <label>
                  Naslov dogodka
                  <input
                    name="title"
                    defaultValue={selected?.title}
                    maxLength={160}
                    required
                  />
                </label>
                <div className="two">
                  <label>
                    Začetek (vaš lokalni čas)
                    <input
                      name="starts_at"
                      defaultValue={
                        selected ? localInput(selected.starts_at) : undefined
                      }
                      type="datetime-local"
                      required
                    />
                  </label>
                  <label>
                    Zaključek
                    <input
                      name="ends_at"
                      defaultValue={
                        selected ? localInput(selected.ends_at) : undefined
                      }
                      type="datetime-local"
                      required
                    />
                  </label>
                </div>
                <label>
                  Lokacija
                  <select name="location" defaultValue={selected?.location}>
                    {locations.map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Računovodska postavka
                  <select
                    name="accounting_code"
                    defaultValue={selected?.accounting_code ?? ""}
                    required
                  >
                    <option value="" disabled>
                      Izberite postavko
                    </option>
                    <option value="110">110</option>
                    <option value="111">111</option>
                  </select>
                </label>
                <div className="two">
                  <label>
                    Število hostes
                    <input
                      name="hostesses_needed"
                      type="number"
                      min="0"
                      max="100"
                      defaultValue={selected?.hostesses_needed ?? 0}
                      required
                    />
                  </label>
                  <label>
                    Število tehnikov
                    <input
                      name="technicians_needed"
                      type="number"
                      min="0"
                      max="100"
                      defaultValue={selected?.technicians_needed ?? 0}
                      required
                    />
                  </label>
                </div>
                <label>
                  Opombe
                  <textarea
                    name="notes"
                    defaultValue={selected?.notes}
                    rows={3}
                  />
                </label>
                <button className="primary" disabled={busy}>
                  Shrani dogodek
                </button>
              </form>
            </>
          ) : (
            selected && (
              <>
                <span className="badge">{selected.location}</span>
                <h2>{selected.title}</h2>
                <p>
                  {dateLabel(selected.starts_at)} –{" "}
                  {dateLabel(selected.ends_at)}
                </p>
                <p className="notes">{selected.notes}</p>
                <p>
                  Računovodska postavka:{" "}
                  <strong>{selected.accounting_code ?? "Ni določena"}</strong>
                </p>
                <EventStaffing
                  key={selected.id}
                  event={selected}
                  profile={profile}
                  people={people}
                  assignments={assignments}
                  external={external}
                  onSaved={async () => {
                    if (!sessionId || !(await load(sessionId)))
                      throw new Error(
                        "Osvežitev razporeda ni uspela. Osvežite stran in preverite shranjene podatke.",
                      );
                  }}
                />
                {(admin || profile?.role === "tehnik") && (
                  <div className="documents">
                    <h3>Tehnična dokumentacija</h3>
                    <button
                      className="outline"
                      disabled={busy}
                      onClick={() => void documents()}
                    >
                      <FileText size={16} /> Prikaži PDF-dokumente
                    </button>
                    {documentLinks.map((doc, i) => (
                      <p key={doc.name}>
                        <a
                          className="document-link"
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Odpri PDF {i + 1} ↗
                        </a>
                      </p>
                    ))}
                    {documentLinks.length > 0 && (
                      <p>
                        Povezave veljajo 60 sekund. Za osvežitev znova kliknite
                        gumb.
                      </p>
                    )}
                    {admin && (
                      <label>
                        Naloži zasebni PDF (do 20 MB)
                        <input
                          type="file"
                          accept="application/pdf"
                          disabled={busy}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void upload(f);
                          }}
                        />
                      </label>
                    )}
                  </div>
                )}
                {admin && (
                  <button className="outline" onClick={() => setCreating(true)}>
                    Uredi dogodek
                  </button>
                )}
                {admin && (
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        !supabase ||
                        !sessionId ||
                        !confirm(
                          "Ali želite izbrisati dogodek in njegov razpored?",
                        )
                      )
                        return;
                      setBusy(true);
                      const { error } = await supabase
                        .from("events")
                        .delete()
                        .eq("id", selected.id);
                      if (error) setMessage(error.message);
                      else {
                        setSelectedId(null);
                        await load(sessionId);
                      }
                      setBusy(false);
                    }}
                  >
                    Izbriši dogodek
                  </button>
                )}
              </>
            )
          )}
          {message && (
            <p role="status" className="notice">
              {message}
            </p>
          )}
        </EventDialog>
      )}
    </div>
  );
}
