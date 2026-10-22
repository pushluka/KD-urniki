"use client";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
export function PushAccountGuard() {
  useEffect(() => {
    if (!supabase || !("serviceWorker" in navigator)) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        // Do not call Auth inside its own callback. Revoking the browser subscription
        // also protects logout when the API/session or network is already unavailable.
        setTimeout(() => {
          void navigator.serviceWorker
            .getRegistration("/")
            .then(async (r) => {
              const sub = await r?.pushManager?.getSubscription();
              await sub?.unsubscribe();
            })
            .catch(() => {});
        }, 0);
      }
    });
    return () => subscription.unsubscribe();
  }, []);
  return null;
}
