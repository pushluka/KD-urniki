"use client";
import { useCallback, useEffect, useState } from "react";
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
} from "@/lib/supabase";
const locations = ["Kulturni dom", "Družbeni dom", "Druga lokacija"];
const localInput = (value: string) => {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const dateLabel = (d: string) =>
  new Date(d).toLocaleString("sl-SI", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Ljubljana",
  });
export default function Home() {
  const [profile, setProfile] = useState<Profile | null>(null),
    [events, setEvents] = useState<Event[]>([]),
    [people, setPeople] = useState<Profile[]>([]),
    [assignments, setAssignments] = useState<Assignment[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [view, setView] = useState("Koledar"),
    [location, setLocation] = useState("Vse lokacije"),
    [month, setMonth] = useState(
      new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    ),
    [selected, setSelected] = useState<Event | null>(null),
    [creating, setCreating] = useState(false);
  const [documentLinks, setDocumentLinks] = useState<
    { name: string; url: string }[]
  >([]);
  useEffect(() => {
    setDocumentLinks([]);
  }, [selected]);
  const admin = profile?.role === "administrator";
  const load = useCallback(async (id: string) => {
    if (!supabase) return;
    setLoading(true);
    try {
      const results = await Promise.all([
        supabase.from("profiles").select("*"),
        supabase.from("events").select("*").order("starts_at"),
        supabase.from("assignments").select("*"),
      ]);
      for (const r of results) if (r.error) throw r.error;
      const ps = results[0].data as Profile[];
      setPeople(ps);
      setProfile(ps.find((p) => p.id === id) ?? null);
      setEvents(results[1].data as Event[]);
      setAssignments(results[2].data as Assignment[]);
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Podatkov ni bilo mogoče naložiti. Preverite povezavo in migracijo.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionId(session?.user.id ?? null);
      if (!session) {
        setProfile(null);
        setEvents([]);
        setPeople([]);
        setAssignments([]);
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
  async function login(form: FormData) {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setMessage(error ? "Prijava ni uspela. Preverite e-pošto in geslo." : "");
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
      const { error } = await supabase
        .from("events")
        .upsert({
          ...(selected ? { id: selected.id } : {}),
          title: form.get("title"),
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          location: form.get("location"),
          notes: form.get("notes"),
          hostesses_needed: Number(form.get("hostesses_needed")),
          technicians_needed: Number(form.get("technicians_needed")),
        });
      if (error) throw error;
      setCreating(false);
      setSelected(null);
      await load(sessionId);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Shranjevanje ni uspelo.");
    } finally {
      setBusy(false);
    }
  }
  async function assign(user: Profile, checked: boolean) {
    if (!supabase || !selected || !sessionId) return;
    setBusy(true);
    const r = checked
      ? await supabase
          .from("assignments")
          .insert({ event_id: selected.id, user_id: user.id })
      : await supabase
          .from("assignments")
          .delete()
          .eq("event_id", selected.id)
          .eq("user_id", user.id);
    if (r.error) setMessage(r.error.message);
    else await load(sessionId);
    setBusy(false);
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
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="/">
          <span className="brand-icon">
            kd<span>•</span>
          </span>
          <span>
            KD Grosuplje<small>PROSTOR ZA KULTURO</small>
          </span>
        </a>
        <div className="workspace-label">ORGANIZACIJA DELA</div>
        <nav>
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
                  E-pošta
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
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
                {locations.map((l, i) => (
                  <span key={l}>
                    <i className={`dot color-${i}`} />
                    {l}
                  </span>
                ))}
              </div>
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
                        {valid &&
                          monthly
                            .filter(
                              (e) => new Date(e.starts_at).getDate() === day,
                            )
                            .map((e) => (
                              <button
                                className={`event color-${locations.indexOf(e.location)}`}
                                key={e.id}
                                onClick={() => {
                                  setSelected(e);
                                  setMessage("");
                                }}
                              >
                                <small>
                                  {new Date(e.starts_at).toLocaleTimeString(
                                    "sl-SI",
                                    { hour: "2-digit", minute: "2-digit" },
                                  )}
                                </small>
                                <strong>{e.title}</strong>
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
                    className="event-row"
                    key={e.id}
                    onClick={() => setSelected(e)}
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
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={creating ? "Nov dogodek" : selected?.title}
          >
            <button
              className="close"
              aria-label="Zapri"
              onClick={() => {
                setCreating(false);
                setSelected(null);
              }}
            >
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
                  <h3>Razpored ekipe</h3>
                  <p>
                    Potrebujemo {selected.hostesses_needed} hostes in{" "}
                    {selected.technicians_needed} tehnikov.
                  </p>
                  {people
                    .filter((p) => p.role !== "administrator")
                    .map((p) => (
                      <label className="assignment" key={p.id}>
                        <input
                          type="checkbox"
                          disabled={!admin || busy}
                          checked={assignments.some(
                            (a) =>
                              a.event_id === selected.id && a.user_id === p.id,
                          )}
                          onChange={(e) => void assign(p, e.target.checked)}
                        />
                        <span>
                          {p.full_name}
                          <small>{p.role}</small>
                        </span>
                      </label>
                    ))}
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
                          Povezave veljajo 60 sekund. Za osvežitev znova
                          kliknite gumb.
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
                    <button
                      className="outline"
                      onClick={() => setCreating(true)}
                    >
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
                          setSelected(null);
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
          </section>
        </div>
      )}
    </div>
  );
}
