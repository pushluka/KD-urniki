"use client";
import { useEffect, useState } from "react";

// Public presentation version only. Never include account, token or API details.
export function DisplayDiagnostics() {
  const [display, setDisplay] = useState<{
    width: number;
    screen: number;
    mobile: boolean;
    standalone: boolean;
    scale: number;
  } | null>(null);
  useEffect(() => {
    const measure = () =>
      setDisplay({
        width: window.innerWidth,
        screen: window.screen.width,
        mobile: matchMedia("(max-width: 760px)").matches,
        standalone:
          matchMedia("(display-mode: standalone)").matches ||
          Boolean(
            (navigator as Navigator & { standalone?: boolean }).standalone,
          ),
        scale: Math.round((window.visualViewport?.scale ?? 1) * 100),
      });
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, []);
  return (
    <section aria-label="Preverjanje prikaza">
      <h2>Preverjanje prikaza</h2>
      <p>Različica prikaza: mobilni-v3.</p>
      {display && (
        <>
          <p>
            Širina strani: {display.width} CSS px. Širina zaslona:{" "}
            {display.screen} CSS px. Postavitev:{" "}
            {display.mobile ? "mobilna" : "namizna"}. Način:{" "}
            {display.standalone ? "nameščena aplikacija" : "brskalnik"}.{" "}
            Povečava: {display.scale} %.
          </p>
          {!display.mobile && display.screen <= 600 && (
            <p role="alert">
              Telefon uporablja namizno širino strani. V meniju brskalnika
              izključite »Namizno spletno mesto« in znova odprite aplikacijo.
            </p>
          )}
        </>
      )}
      <p>
        Če na telefonu vidite levi meni in sedem stolpcev koledarja, shranite
        spremembe in zaprite vsa okna aplikacije. Nato jo ponovno odprite z
        internetno povezavo. V Chromu preverite tudi možnost »Namizno spletno
        mesto«. Za posodobitev ni treba izbrisati podatkov ali ponovno dovoliti
        obvestil.
      </p>
    </section>
  );
}
