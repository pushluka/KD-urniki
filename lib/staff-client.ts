import { supabase } from "./supabase";
export async function staffRequest(
  path: string,
  method = "GET",
  body?: unknown,
) {
  if (!supabase) throw new Error("Povezava Supabase ni nastavljena.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session)
    throw new Error("Za dostop se prijavite kot administrator.");
  const response = await fetch(path, {
    method,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Zahteva ni uspela.");
  return result;
}
