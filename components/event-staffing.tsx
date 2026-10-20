"use client";
import { useState } from "react";
import {
  supabase,
  type Assignment,
  type Event,
  type ExternalAssignment,
  type Profile,
} from "@/lib/supabase";
import { assignmentTimes, localDateTime } from "@/lib/staffing";
const timeLabel = (value: string) =>
  new Date(value).toLocaleString("sl-SI", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
function TimeFields({
  arrives,
  finishes,
}: {
  arrives: string;
  finishes: string;
}) {
  return (
    <div className="two">
      <label>
        Prihod
        <input
          name="arrives_at"
          type="datetime-local"
          defaultValue={localDateTime(arrives)}
          required
        />
      </label>
      <label>
        Predvideni zaključek
        <input
          name="finishes_at"
          type="datetime-local"
          defaultValue={localDateTime(finishes)}
          required
        />
      </label>
    </div>
  );
}
export function EventStaffing({
  event,
  profile,
  people,
  assignments,
  external,
  onSaved,
}: {
  event: Event;
  profile: Profile | null;
  people: Profile[];
  assignments: Assignment[];
  external: ExternalAssignment[];
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const admin = profile?.role === "administrator";
  const rows = assignments.filter((a) => a.event_id === event.id);
  const externalRows = external.filter((a) => a.event_id === event.id);
  const own = rows.find((a) => a.user_id === profile?.id);
  async function mutate(
    action: () => PromiseLike<{ error: { message: string } | null }>,
  ) {
    if (!supabase || busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await action();
      if (result.error) throw new Error(result.error.message);
      await onSaved();
      setStatus("Razpored je shranjen.");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Shranjevanje ni uspelo. Poskusite znova.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveRegistered(
    form: FormData,
    userId: string,
    exists: boolean,
  ) {
    try {
      const times = assignmentTimes(form);
      await mutate(() =>
        exists
          ? supabase!
              .from("assignments")
              .update(times)
              .eq("event_id", event.id)
              .eq("user_id", userId)
          : supabase!
              .from("assignments")
              .insert({ event_id: event.id, user_id: userId, ...times }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preverite ure.");
    }
  }
  return (
    <section className="staffing" aria-label="Razpored ekipe">
      <h3>Razpored ekipe</h3>
      <p>
        Potrebujemo {event.hostesses_needed} hostes in{" "}
        {event.technicians_needed} tehnikov. Ure osebja so ločene od trajanja
        dogodka.
      </p>
      <p className="time-zone-note">
        Datumi in ure osebja: časovni pas vašega brskalnika (
        {Intl.DateTimeFormat().resolvedOptions().timeZone}).
      </p>
      {(["tehnik", "hostesa"] as const).map((role) => (
        <div key={role}>
          <h4>{role === "tehnik" ? "Tehniki" : "Hostese"}</h4>
          {!rows.some(
            (a) => people.find((p) => p.id === a.user_id)?.role === role,
          ) &&
            !externalRows.some((a) => a.role === role) && (
              <p>Ni razporejenih oseb.</p>
            )}
          {rows
            .filter(
              (a) => people.find((p) => p.id === a.user_id)?.role === role,
            )
            .map((a) => {
              const person = people.find((p) => p.id === a.user_id)!;
              const canEdit =
                admin ||
                (role === "tehnik" &&
                  a.user_id === profile?.id &&
                  profile.role === "tehnik");
              return (
                <article
                  className="staff-card"
                  key={a.user_id}
                  aria-label={person.full_name}
                >
                  <strong>{person.full_name}</strong>
                  {canEdit ? (
                    <form
                      key={`${a.arrives_at}-${a.finishes_at}`}
                      action={(form) => saveRegistered(form, a.user_id, true)}
                    >
                      <fieldset disabled={busy}>
                        <TimeFields
                          arrives={a.arrives_at}
                          finishes={a.finishes_at}
                        />
                        <div className="staff-actions">
                          <button type="submit" className="outline">
                            Shrani ure
                          </button>
                          <button
                            type="button"
                            className="remove-assignment"
                            onClick={() =>
                              void mutate(() =>
                                supabase!
                                  .from("assignments")
                                  .delete()
                                  .eq("event_id", event.id)
                                  .eq("user_id", a.user_id),
                              )
                            }
                          >
                            {admin ? "Odstrani" : "Odjavi se"}
                          </button>
                        </div>
                      </fieldset>
                    </form>
                  ) : (
                    <p>
                      Prihod: {timeLabel(a.arrives_at)}
                      <br />
                      Predvideni zaključek: {timeLabel(a.finishes_at)}
                    </p>
                  )}
                </article>
              );
            })}
          {externalRows
            .filter((a) => a.role === role)
            .map((a) => (
              <article
                className="staff-card"
                key={a.id}
                aria-label={a.full_name}
              >
                <strong>{a.full_name}</strong>
                <span className="external-label">Zunanji sodelavec</span>
                {admin ? (
                  <form
                    key={`${a.arrives_at}-${a.finishes_at}`}
                    action={async (form) => {
                      try {
                        const times = assignmentTimes(form);
                        await mutate(() =>
                          supabase!
                            .from("external_assignments")
                            .update(times)
                            .eq("id", a.id),
                        );
                      } catch (e) {
                        setError(
                          e instanceof Error ? e.message : "Preverite ure.",
                        );
                      }
                    }}
                  >
                    <fieldset disabled={busy}>
                      <TimeFields
                        arrives={a.arrives_at}
                        finishes={a.finishes_at}
                      />
                      <div className="staff-actions">
                        <button className="outline">Shrani ure</button>
                        <button
                          type="button"
                          className="remove-assignment"
                          onClick={() =>
                            void mutate(() =>
                              supabase!
                                .from("external_assignments")
                                .delete()
                                .eq("id", a.id),
                            )
                          }
                        >
                          Odstrani
                        </button>
                      </div>
                    </fieldset>
                  </form>
                ) : (
                  <p>
                    Prihod: {timeLabel(a.arrives_at)}
                    <br />
                    Predvideni zaključek: {timeLabel(a.finishes_at)}
                  </p>
                )}
              </article>
            ))}
        </div>
      ))}
      {profile?.role === "tehnik" && !own && (
        <form
          className="staff-add"
          action={(form) => saveRegistered(form, profile.id, false)}
          aria-label="Samoprijava tehnika"
        >
          <h4>Prijava na dogodek</h4>
          <p>Prijavljate se kot {profile.full_name}.</p>
          <fieldset disabled={busy}>
            <TimeFields arrives={event.starts_at} finishes={event.ends_at} />
            <button className="primary">Prijavi se na dogodek</button>
          </fieldset>
        </form>
      )}
      {admin && (
        <>
          <form
            className="staff-add"
            action={(form) =>
              saveRegistered(form, String(form.get("user_id")), false)
            }
            aria-label="Dodaj člana ekipe"
          >
            <h4>Dodaj člana ekipe</h4>
            <fieldset disabled={busy}>
              <label>
                Oseba
                <select name="user_id" required defaultValue="">
                  <option value="" disabled>
                    Izberite osebo
                  </option>
                  {people
                    .filter(
                      (p) =>
                        p.role !== "administrator" &&
                        p.is_active &&
                        !rows.some((a) => a.user_id === p.id),
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name} · {p.role}
                      </option>
                    ))}
                </select>
              </label>
              <TimeFields arrives={event.starts_at} finishes={event.ends_at} />
              <button className="primary">Dodaj v razpored</button>
            </fieldset>
          </form>
          <form
            className="staff-add"
            aria-label="Dodaj zunanjega sodelavca"
            action={async (form) => {
              try {
                const times = assignmentTimes(form);
                await mutate(() =>
                  supabase!.from("external_assignments").insert({
                    event_id: event.id,
                    full_name: String(form.get("full_name")).trim(),
                    role: form.get("role"),
                    ...times,
                  }),
                );
              } catch (e) {
                setError(e instanceof Error ? e.message : "Preverite podatke.");
              }
            }}
          >
            <h4>Zunanji sodelavec brez računa</h4>
            <fieldset disabled={busy}>
              <label>
                Ime in priimek
                <input
                  name="full_name"
                  maxLength={120}
                  required
                  pattern=".*\S.*"
                />
              </label>
              <label>
                Vloga
                <select name="role">
                  <option value="tehnik">Tehnik</option>
                  <option value="hostesa">Hostesa</option>
                </select>
              </label>
              <TimeFields arrives={event.starts_at} finishes={event.ends_at} />
              <button className="outline">Dodaj zunanjega sodelavca</button>
            </fieldset>
          </form>
        </>
      )}
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
