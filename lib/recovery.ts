import type { SupabaseClient } from "@supabase/supabase-js";
export const recoveryPath = "/ponastavitev-gesla";
export const invalidRecovery =
  "Povezava za obnovitev je neveljavna ali je potekla. Zahtevajte novo povezavo.";
type Auth = Pick<
  SupabaseClient["auth"],
  | "setSession"
  | "verifyOtp"
  | "exchangeCodeForSession"
  | "getUser"
  | "getSession"
  | "updateUser"
  | "signOut"
>;
export function isRecoveryLink(url: URL) {
  const hash = new URLSearchParams(url.hash.slice(1));
  return (
    hash.get("type") === "recovery" ||
    url.searchParams.get("type") === "recovery" ||
    url.searchParams.has("code")
  );
}
export function recoveryRedirect(origin: string) {
  return new URL(recoveryPath, origin).href;
}
export function passwordError(password: string, confirmation: string) {
  if (password.length < 12) return "Geslo naj vsebuje vsaj 12 znakov.";
  if (password !== confirmation) return "Gesli se ne ujemata.";
  return null;
}
export async function establishRecovery(auth: Auth, url: URL) {
  const hash = new URLSearchParams(url.hash.slice(1));
  if (
    hash.has("error") ||
    hash.has("error_code") ||
    url.searchParams.has("error") ||
    url.searchParams.has("error_code")
  )
    throw new Error(invalidRecovery);
  let result;
  if (
    url.searchParams.get("token_hash") &&
    url.searchParams.get("type") === "recovery"
  ) {
    result = await auth.verifyOtp({
      token_hash: url.searchParams.get("token_hash")!,
      type: "recovery",
    });
  } else if (url.searchParams.get("code")) {
    const exchange = await auth.exchangeCodeForSession(
      url.searchParams.get("code")!,
    );
    if (
      exchange.error ||
      !("redirectType" in exchange.data) ||
      exchange.data.redirectType !== "recovery"
    )
      throw new Error(invalidRecovery);
    result = exchange;
  } else if (
    hash.get("type") === "recovery" &&
    hash.get("access_token") &&
    hash.get("refresh_token")
  ) {
    result = await auth.setSession({
      access_token: hash.get("access_token")!,
      refresh_token: hash.get("refresh_token")!,
    });
  } else {
    throw new Error(invalidRecovery);
  }
  if (result.error || !result.data.session) throw new Error(invalidRecovery);
  const verified = await auth.getUser();
  if (
    verified.error ||
    !verified.data.user ||
    verified.data.user.id !== result.data.session.user.id
  )
    throw new Error(invalidRecovery);
  return verified.data.user.id;
}
export async function updateRecoveryPassword(
  auth: Auth,
  userId: string,
  password: string,
  confirmation: string,
) {
  const validation = passwordError(password, confirmation);
  if (validation) throw new Error(validation);
  const [session, user] = await Promise.all([
    auth.getSession(),
    auth.getUser(),
  ]);
  if (
    session.error ||
    user.error ||
    !session.data.session ||
    !user.data.user ||
    user.data.user.id !== userId ||
    session.data.session.user.id !== userId
  )
    throw new Error(invalidRecovery);
  const updated = await auth.updateUser({ password });
  if (updated.error)
    throw new Error(
      "Gesla ni bilo mogoče shraniti. Preverite zahteve za geslo ali zahtevajte novo povezavo.",
    );
  const signedOut = await auth.signOut({ scope: "local" });
  if (signedOut.error)
    throw new Error(
      "Geslo je spremenjeno, odjava pa ni uspela. Poskusite se odjaviti in ponovno prijaviti.",
    );
}
