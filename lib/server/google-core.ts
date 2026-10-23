import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  timingSafeEqual,
} from "node:crypto";
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.app.created",
];
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export function tokenVault(encoded: string) {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("Invalid token encryption key");
  return {
    seal(value: string, purpose: string) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(purpose));
      const encrypted = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      return [
        "v1",
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        encrypted.toString("base64url"),
      ].join(".");
    },
    open(value: string, purpose: string) {
      const [version, iv, tag, data] = value.split(".");
      if (version !== "v1" || !data) throw new Error("Invalid encrypted token");
      const cipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(iv, "base64url"),
      );
      cipher.setAAD(Buffer.from(purpose));
      cipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        cipher.update(Buffer.from(data, "base64url")),
        cipher.final(),
      ]).toString("utf8");
    },
  };
}
export function cronMatches(req: Request, secret?: string) {
  const got = Buffer.from(req.headers.get("authorization") ?? ""),
    expected = Buffer.from("Bearer " + secret);
  return (
    !!secret && got.length === expected.length && timingSafeEqual(got, expected)
  );
}
export type WorkEvent = {
  title: string;
  location: string;
  starts_at: string;
  ends_at: string;
  arrives_at: string;
  finishes_at: string;
};
export type GoogleMapping = {
  id: string;
  marker: string;
  google_event_id: string;
  remote_seen: boolean;
  deleted: boolean;
};
export function calendarEvent(work: WorkEvent, map: GoogleMapping) {
  const arrive = new Date(work.arrives_at),
    finish = new Date(work.finishes_at);
  if (
    !Number.isFinite(arrive.getTime()) ||
    !Number.isFinite(finish.getTime()) ||
    finish <= arrive
  )
    throw new Error("Invalid assigned hours");
  const local = (s: string) =>
    new Date(s).toLocaleString("sl-SI", { timeZone: "Europe/Ljubljana" });
  return {
    summary: work.title,
    location: work.location,
    description: `Moje delo – KD Grosuplje – Urniki.\nTermin dogodka: ${local(work.starts_at)} – ${local(work.ends_at)}.\nTa vnos upravlja aplikacija; merodajen je razpored v KD Urniki.`,
    visibility: "private",
    start: { dateTime: arrive.toISOString(), timeZone: "Europe/Ljubljana" },
    end: { dateTime: finish.toISOString(), timeZone: "Europe/Ljubljana" },
    extendedProperties: {
      private: { kdMapping: map.id, kdMarker: map.marker },
    },
  };
}
export function ownsGoogleEvent(
  event: Record<string, unknown>,
  mapping: GoogleMapping,
) {
  const properties = event.extendedProperties as
    { private?: Record<string, string> } | undefined;
  return (
    properties?.private?.kdMapping === mapping.id &&
    properties.private.kdMarker === mapping.marker
  );
}
