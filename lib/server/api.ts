import { createHmac, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
export const loginError =
  "Prijava ni uspela. Preverite uporabniško ime oziroma e-pošto in geslo.";
class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const generic = "Operacija ni uspela. Poskusite znova ali obvestite skrbnika.";
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export async function endpoint(action: () => Promise<Response>) {
  try {
    return await action();
  } catch (e) {
    return json(
      { error: e instanceof ApiError ? e.message : generic },
      e instanceof ApiError ? e.status : 500,
    );
  }
}
function sameOrigin(req: Request, publicOrigin: string) {
  // Next/Vercel can expose an internal request URL; trust only the configured public origin.
  if (req.headers.get("origin") !== new URL(publicOrigin).origin)
    throw new ApiError(403, "Nedovoljen izvor zahteve.");
}
async function body(req: Request) {
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    throw new ApiError(415, "Zahtevani so podatki JSON.");
  if (Number(req.headers.get("content-length")) > 8192)
    throw new ApiError(413, "Zahteva je prevelika.");
  const text = await req.text();
  if (text.length > 8192) throw new ApiError(413, "Zahteva je prevelika.");
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error();
    return data as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "Neveljavna zahteva.");
  }
}
function text(v: unknown, max: number) {
  return typeof v === "string" && v.length <= max ? v.trim() : "";
}
function password(v: unknown) {
  if (typeof v !== "string" || v.length < 12 || v.length > 256)
    throw new ApiError(400, "Geslo mora imeti med 12 in 256 znaki.");
  return v;
}
function staffFields(data: Record<string, unknown>) {
  const first = text(data.first_name, 60),
    last = text(data.last_name, 60),
    username = text(data.username, 32).toLowerCase();
  if (
    !first ||
    !last ||
    first.length + last.length > 119 ||
    !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username) ||
    !["tehnik", "hostesa"].includes(String(data.role))
  )
    throw new ApiError(
      400,
      "Preverite ime, priimek, uporabniško ime (3–32 znakov: a–z, 0–9, pika, pomišljaj, podčrtaj) in vlogo.",
    );
  return {
    p_username: username,
    p_first_name: first,
    p_last_name: last,
    p_role: data.role as string,
  };
}
function checked(result: { error: { code?: string } | null }) {
  if (result.error)
    throw new ApiError(
      result.error.code === "23505" ? 409 : 500,
      result.error.code === "23505"
        ? "Uporabniško ime je že zasedeno."
        : generic,
    );
}
export function createApi({
  admin,
  auth,
  rateSecret,
  appOrigin,
  minimumLoginMs = 500,
}: {
  admin: SupabaseClient;
  auth: SupabaseClient;
  rateSecret: string;
  appOrigin: string;
  minimumLoginMs?: number;
}) {
  async function requireAdmin(req: Request) {
    const token = req.headers
      .get("authorization")
      ?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) throw new ApiError(401, "Potrebna je prijava.");
    const user = await admin.auth.getUser(token);
    if (user.error || !user.data.user)
      throw new ApiError(401, "Potrebna je prijava.");
    const profile = await admin
      .from("profiles")
      .select("role,is_active")
      .eq("id", user.data.user.id)
      .maybeSingle();
    if (
      profile.error ||
      profile.data?.role !== "administrator" ||
      !profile.data.is_active
    )
      throw new ApiError(
        403,
        "Dostop je dovoljen samo aktivnemu administratorju.",
      );
  }
  async function target(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id))
      throw new ApiError(400, "Neveljavna oseba.");
    const result = await admin
      .from("profiles")
      .select("id,role,is_active")
      .eq("id", id)
      .maybeSingle();
    if (result.error || !result.data || result.data.role === "administrator")
      throw new ApiError(404, "Sodelavec ni najden.");
    return result.data;
  }
  return {
    login: (req: Request) =>
      endpoint(async () => {
        sameOrigin(req, appOrigin);
        const started = Date.now(),
          data = await body(req);
        const identity = text(data.identity, 254).toLowerCase(),
          pass =
            typeof data.password === "string" && data.password.length <= 256
              ? data.password
              : "";
        const digest = (value: string) =>
          createHmac("sha256", rateSecret).update(value).digest("hex");
        // Vercel overwrites x-vercel-forwarded-for. No untrusted header can bypass the per-identity limit.
        const ip =
          req.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() ||
          "unknown";
        for (const [key, limit] of [
          [`ip:${ip}`, 30],
          [`identity:${identity}`, 10],
        ] as const) {
          const r = await admin.rpc("take_login_attempt", {
            p_bucket: digest(key),
            p_limit: limit,
            p_seconds: 900,
          });
          checked(r);
          if (!r.data)
            throw new ApiError(
              429,
              "Preveč poskusov prijave. Poskusite čez 15 minut.",
            );
        }
        let email = identity.includes("@")
          ? identity
          : `unknown-${randomUUID()}@accounts.invalid`;
        if (
          !identity.includes("@") &&
          /^[a-z0-9][a-z0-9._-]{2,31}$/.test(identity)
        ) {
          const mapping = await admin
            .from("staff_accounts")
            .select("user_id")
            .eq("username", identity)
            .maybeSingle();
          checked(mapping);
          // Match the same Auth lookup for unknown names; never expose a mapping endpoint.
          const user = await admin.auth.admin.getUserById(
            mapping.data?.user_id ?? randomUUID(),
          );
          if (!user.error && user.data.user?.email)
            email = user.data.user.email;
        }
        const result = await auth.auth.signInWithPassword({
          email,
          password: pass,
        });
        let active = false;
        if (result.data.session) {
          const profile = await admin
            .from("profiles")
            .select("role,is_active")
            .eq("id", result.data.session.user.id)
            .maybeSingle();
          active =
            !profile.error &&
            !!profile.data?.is_active &&
            ["administrator", "tehnik", "hostesa"].includes(profile.data.role);
        }
        const remaining = minimumLoginMs - (Date.now() - started);
        if (remaining > 0)
          await new Promise((resolve) => setTimeout(resolve, remaining));
        if (result.error || !result.data.session || !active) {
          if (result.data.session) await auth.auth.signOut({ scope: "local" });
          throw new ApiError(401, loginError);
        }
        return json({
          access_token: result.data.session.access_token,
          refresh_token: result.data.session.refresh_token,
        });
      }),
    list: (req: Request) =>
      endpoint(async () => {
        await requireAdmin(req);
        const [profiles, accounts] = await Promise.all([
          admin
            .from("profiles")
            .select("id,full_name,role,is_active")
            .neq("role", "administrator")
            .order("full_name"),
          admin
            .from("staff_accounts")
            .select("user_id,username,first_name,last_name"),
        ]);
        checked(profiles);
        checked(accounts);
        return json({
          staff: profiles.data!.map((p) => ({
            ...p,
            ...accounts.data!.find((a) => a.user_id === p.id),
          })),
        });
      }),
    create: (req: Request) =>
      endpoint(async () => {
        sameOrigin(req, appOrigin);
        await requireAdmin(req);
        const data = await body(req),
          fields = staffFields(data),
          initial = password(data.password);
        const email = text(data.recovery_email, 254).toLowerCase();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          throw new ApiError(400, "Neveljavna e-pošta za obnovitev.");
        const existing = await admin
          .from("staff_accounts")
          .select("user_id")
          .eq("username", fields.p_username)
          .maybeSingle();
        checked(existing);
        if (existing.data)
          throw new ApiError(409, "Uporabniško ime je že zasedeno.");
        const created = await admin.auth.admin.createUser({
          email: email || `kd-${randomUUID()}@accounts.invalid`,
          password: initial,
          email_confirm: true,
          app_metadata: { managed_staff: true },
        });
        if (created.error || !created.data.user)
          throw new ApiError(
            409,
            "Računa ni bilo mogoče ustvariti. Preverite, ali e-pošta že pripada obstoječemu računu, in zahteve za geslo.",
          );
        const result = await admin.rpc("create_staff_profile", {
          p_id: created.data.user.id,
          ...fields,
        });
        if (result.error) {
          // Delete only the new Auth identity from this request; never touch an existing account.
          const cleanup = await admin.auth.admin.deleteUser(
            created.data.user.id,
          );
          if (cleanup.error)
            throw new ApiError(
              500,
              "Profil ni ustvarjen. Skrbnik naj v Supabase Auth preveri nedokončan račun pred ponovitvijo.",
            );
          checked(result);
        }
        return json({ ok: true }, 201);
      }),
    update: (req: Request, id: string) =>
      endpoint(async () => {
        sameOrigin(req, appOrigin);
        await requireAdmin(req);
        await target(id);
        const data = await body(req),
          fields = staffFields(data);
        const user = await admin.auth.admin.getUserById(id);
        if (user.error || !user.data.user)
          throw new ApiError(404, "Prijavni račun ne obstaja.");
        checked(
          await admin.rpc("update_staff_profile", { p_id: id, ...fields }),
        );
        return json({ ok: true });
      }),
    active: (req: Request, id: string) =>
      endpoint(async () => {
        sameOrigin(req, appOrigin);
        await requireAdmin(req);
        await target(id);
        const data = await body(req);
        if (typeof data.is_active !== "boolean")
          throw new ApiError(400, "Neveljavno stanje.");
        if (!data.is_active) {
          checked(
            await admin.rpc("set_staff_active", { p_id: id, p_active: false }),
          );
          const r = await admin.auth.admin.updateUserById(id, {
            ban_duration: "876000h",
          });
          if (r.error)
            throw new ApiError(
              502,
              "Dostop v bazi je onemogočen, blokada Auth pa ni potrjena. Ponovite deaktivacijo.",
            );
        } else {
          const r = await admin.auth.admin.updateUserById(id, {
            ban_duration: "none",
          });
          if (r.error) throw new ApiError(502, generic);
          checked(
            await admin.rpc("set_staff_active", { p_id: id, p_active: true }),
          );
        }
        return json({ ok: true });
      }),
    reset: (req: Request, id: string) =>
      endpoint(async () => {
        sameOrigin(req, appOrigin);
        await requireAdmin(req);
        const profile = await target(id);
        if (!profile.is_active)
          throw new ApiError(400, "Najprej aktivirajte sodelavca.");
        const data = await body(req);
        if (data.mode === "email") {
          const user = await admin.auth.admin.getUserById(id),
            email = user.data.user?.email;
          if (user.error || !email || email.endsWith("@accounts.invalid"))
            throw new ApiError(
              400,
              "Račun nima e-pošte za obnovitev. Nastavite novo začasno geslo.",
            );
          const result = await auth.auth.resetPasswordForEmail(email, {
            redirectTo: new URL("/ponastavitev-gesla", appOrigin).href,
          });
          if (result.error) throw new ApiError(502, generic);
        } else if (data.mode === "password") {
          const next = password(data.password);
          if (data.confirmation !== next)
            throw new ApiError(400, "Gesli se ne ujemata.");
          const result = await admin.auth.admin.updateUserById(id, {
            password: next,
          });
          if (result.error)
            throw new ApiError(
              502,
              "Gesla ni bilo mogoče spremeniti. Preverite zahteve Supabase za gesla.",
            );
        } else throw new ApiError(400, "Neveljavna zahteva.");
        return json({ ok: true });
      }),
  };
}
