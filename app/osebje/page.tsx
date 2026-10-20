"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EventDialog } from "@/components/event-dialog";
import { staffRequest } from "@/lib/staff-client";
type Staff = {
  id: string;
  full_name: string;
  role: "tehnik" | "hostesa";
  is_active: boolean;
  username?: string;
  first_name?: string;
  last_name?: string;
};
export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]),
    [allowed, setAllowed] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [editing, setEditing] = useState<Staff | null>(null),
    [creating, setCreating] = useState(false),
    [reset, setReset] = useState<Staff | null>(null);
  const load = useCallback(async () => {
    try {
      const result = await staffRequest("/api/staff");
      setStaff(result.staff);
      setAllowed(true);
    } catch (e) {
      setStaff([]);
      setAllowed(false);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load().catch((e) =>
      setMessage(e instanceof Error ? e.message : "Dostop ni mogoč."),
    );
  }, [load]);
  async function action(
    path: string,
    method: string,
    body: unknown,
    success: string,
  ) {
    if (busy) return false;
    setBusy(true);
    setMessage("");
    try {
      await staffRequest(path, method, body);
      await load();
      setMessage(success);
      return true;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Zahteva ni uspela.");
      await load().catch(() => {});
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function save(form: FormData) {
    const body = {
      first_name: form.get("first_name"),
      last_name: form.get("last_name"),
      username: form.get("username"),
      role: form.get("role"),
      ...(!editing
        ? {
            password: form.get("password"),
            recovery_email: form.get("recovery_email"),
          }
        : {}),
    };
    if (
      await action(
        editing ? `/api/staff/${editing.id}` : "/api/staff",
        editing ? "PATCH" : "POST",
        body,
        editing
          ? "Podatki sodelavca so shranjeni."
          : "Račun je ustvarjen. Začetno geslo predajte sodelavcu po varni poti.",
      )
    ) {
      setCreating(false);
      setEditing(null);
    }
  }
  function close() {
    if (busy) return;
    setCreating(false);
    setEditing(null);
    setReset(null);
    setMessage("");
  }
  return (
    <main className="staff-page">
      <div className="eyebrow">KD GROSUPLJE · ADMINISTRACIJA</div>
      <div className="page-heading">
        <div>
          <h1>Osebje</h1>
          <p>Računi, tehniki in hostese.</p>
        </div>
        <Link href="/">Nazaj na koledar</Link>
      </div>
      {loading && <p role="status">Preverjanje dostopa …</p>}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {allowed && (
        <>
          <button
            className="primary"
            onClick={() => {
              setCreating(true);
              setMessage("");
            }}
          >
            Dodaj sodelavca
          </button>
          <section className="staff-list" aria-label="Seznam osebja">
            {staff.length === 0 ? (
              <p>Ni sodelavcev. Obstoječi administrator ostane ohranjen.</p>
            ) : (
              staff.map((person) => (
                <article
                  className="panel staff-person"
                  key={person.id}
                  aria-label={person.full_name}
                >
                  <div>
                    <h2>{person.full_name}</h2>
                    <p>
                      {person.username
                        ? `@${person.username}`
                        : "Uporabniško ime še ni določeno"}{" "}
                      · {person.role}
                    </p>
                    <span className="badge">
                      {person.is_active ? "Aktiven" : "Deaktiviran"}
                    </span>
                  </div>
                  <div className="staff-actions">
                    <button
                      disabled={busy}
                      onClick={() => {
                        setEditing(person);
                        setMessage("");
                      }}
                    >
                      Uredi
                    </button>
                    <button
                      disabled={busy || !person.is_active}
                      onClick={() => {
                        setReset(person);
                        setMessage("");
                      }}
                    >
                      Ponastavi geslo
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            person.is_active
                              ? `Deaktiviram sodelavca ${person.full_name}? Dodelitve bodo ohranjene.`
                              : `Ponovno aktiviram sodelavca ${person.full_name}?`,
                          )
                        )
                          void action(
                            `/api/staff/${person.id}/active`,
                            "POST",
                            { is_active: !person.is_active },
                            "Stanje sodelavca je shranjeno.",
                          );
                      }}
                    >
                      {person.is_active ? "Deaktiviraj" : "Aktiviraj"}
                    </button>
                  </div>
                </article>
              ))
            )}
          </section>
        </>
      )}
      {(creating || editing) && allowed && (
        <EventDialog
          title={editing ? "Uredi sodelavca" : "Dodaj sodelavca"}
          onClose={close}
        >
          <button
            type="button"
            className="close"
            aria-label="Zapri"
            disabled={busy}
            onClick={close}
          >
            ×
          </button>
          <h2>{editing ? "Uredi sodelavca" : "Dodaj sodelavca"}</h2>
          <form action={save}>
            <fieldset disabled={busy}>
              <div className="two">
                <label>
                  Ime
                  <input
                    name="first_name"
                    defaultValue={editing?.first_name}
                    required
                    maxLength={60}
                    autoComplete="off"
                  />
                </label>
                <label>
                  Priimek
                  <input
                    name="last_name"
                    defaultValue={editing?.last_name}
                    required
                    maxLength={60}
                    autoComplete="off"
                  />
                </label>
              </div>
              <label>
                Uporabniško ime
                <input
                  name="username"
                  defaultValue={editing?.username}
                  required
                  minLength={3}
                  maxLength={32}
                  pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,31}"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </label>
              <p>
                3–32 znakov: a–z, številke, pika, podčrtaj in pomišljaj. Velike
                in male črke se obravnavajo enako.
              </p>
              <label>
                Vloga
                <select name="role" defaultValue={editing?.role ?? "tehnik"}>
                  <option value="tehnik">Tehnik</option>
                  <option value="hostesa">Hostesa</option>
                </select>
              </label>
              {!editing && (
                <>
                  <label>
                    Začetno geslo
                    <input
                      name="password"
                      type="password"
                      required
                      minLength={12}
                      maxLength={256}
                      autoComplete="new-password"
                    />
                  </label>
                  <label>
                    E-pošta za obnovitev (neobvezno)
                    <input
                      name="recovery_email"
                      type="email"
                      maxLength={254}
                      autoComplete="off"
                    />
                  </label>
                  <p>
                    Brez e-pošte lahko geslo pozneje ponastavi administrator.
                    Geslo se po ustvarjanju ne prikaže.
                  </p>
                </>
              )}
              <button className="primary">
                {busy
                  ? "Shranjevanje …"
                  : editing
                    ? "Shrani sodelavca"
                    : "Ustvari račun"}
              </button>
            </fieldset>
          </form>
          {message && (
            <p role="alert" className="notice">
              {message}
            </p>
          )}
        </EventDialog>
      )}
      {reset && allowed && (
        <EventDialog title="Ponastavi geslo" onClose={close}>
          <button
            type="button"
            className="close"
            aria-label="Zapri"
            disabled={busy}
            onClick={close}
          >
            ×
          </button>
          <h2>Ponastavi geslo</h2>
          <p>{reset.full_name}</p>
          <button
            disabled={busy}
            onClick={() =>
              void action(
                `/api/staff/${reset.id}/password`,
                "POST",
                { mode: "email" },
                "Povezava za obnovitev je poslana na e-pošto računa.",
              )
            }
          >
            Pošlji obnovitveno povezavo
          </button>
          <p>
            Če račun nima e-pošte za obnovitev, določite novo začasno geslo.
          </p>
          <form
            action={async (form) => {
              if (
                await action(
                  `/api/staff/${reset.id}/password`,
                  "POST",
                  {
                    mode: "password",
                    password: form.get("password"),
                    confirmation: form.get("confirmation"),
                  },
                  "Geslo je ponastavljeno. Novo geslo varno predajte sodelavcu.",
                )
              )
                setReset(null);
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Novo začasno geslo
                <input
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={256}
                  autoComplete="new-password"
                />
              </label>
              <label>
                Potrditev gesla
                <input
                  name="confirmation"
                  type="password"
                  required
                  minLength={12}
                  maxLength={256}
                  autoComplete="new-password"
                />
              </label>
              <button className="primary">Nastavi začasno geslo</button>
            </fieldset>
          </form>
          {message && (
            <p role="alert" className="notice">
              {message}
            </p>
          )}
        </EventDialog>
      )}
    </main>
  );
}
