import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const supabase =
  url && key
    ? createClient(url, key, { auth: { detectSessionInUrl: false } })
    : null;
export type Role = "administrator" | "hostesa" | "tehnik";
export type Profile = { id: string; full_name: string; role: Role };
export type Event = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string;
  notes: string;
  hostesses_needed: number;
  technicians_needed: number;
  accounting_code: "110" | "111" | null;
};
export type Assignment = {
  event_id: string;
  user_id: string;
  arrives_at: string;
  finishes_at: string;
};
export type ExternalAssignment = {
  id: string;
  event_id: string;
  full_name: string;
  role: "hostesa" | "tehnik";
  arrives_at: string;
  finishes_at: string;
};
