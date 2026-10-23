import Link from "next/link";
export default function GooglePrivacy() {
  const contact = process.env.PRIVACY_CONTACT_EMAIL;
  return (
    <main className="auth-page">
      <article className="panel install-guide">
        <h1>Google Koledar – podatki in dovoljenja</h1>
        <p>
          Povezava z Google Koledarjem je prostovoljna in namenjena samo
          tehnikom ter hostesam KD Urniki. Brez povezave lahko uporabljate vse
          obstoječe funkcije aplikacije.
        </p>
        <p>
          Aplikacija ustvari ločen koledar »KD Urniki – Moje delo« in upravlja
          samo svoje označene vnose za dogodke, na katerih ste razporejeni.
          Prenese naziv, lokacijo in vaše ure dela. Ne prenaša razporedov drugih
          oseb, dokumentov ali seznamov gostov.
        </p>
        <p>
          Uporablja samo dovoljenje calendar.app.created za koledarje, ki jih
          ustvari aplikacija. Ne bere seznama osebnih koledarjev. Google
          podatkov ne uporabljamo za oglaševanje, prodajo ali učenje modelov.
          Uporaba prejetih podatkov upošteva Google API Services User Data
          Policy, vključno z zahtevami Limited Use.
        </p>
        <p>
          OAuth žetoni so šifrirani in shranjeni samo na strežniku. Preslikave
          in vrsta opravil omogočajo zanesljivo sinhronizacijo, tudi ko je
          aplikacija zaprta. Podatki povezave niso dostopni drugim uporabnikom.
        </p>
        <p>
          Z izbiro »Prekini Google Koledar« ustavite prihodnjo sinhronizacijo in
          odstranite shranjene žetone. Že ustvarjeni vnosi ostanejo v Googlu.
          Preslikave aplikacijskih vnosov se ohranijo za varno ponovno povezavo;
          ne vsebujejo vsebine drugih Google dogodkov. Ob izbrisu računa se
          odstranijo iz baze KD Urniki. Za izbris podatkov povezave in preslikav
          se obrnite na administratorja. Dovoljenje lahko kadarkoli prekličete
          tudi v varnostnih nastavitvah Google računa.
        </p>
        <p>
          Upravljavec naj pred javno uvedbo objavi popolne podatke o upravljavcu
          in veljavne pogoje zasebnosti KD Urniki.
        </p>
        <p>
          Kontakt:{" "}
          {contact && /^[^\s@]+@[^\s@]+$/.test(contact) ? (
            <a href={`mailto:${contact}`}>{contact}</a>
          ) : (
            "administrator KD Urniki (kontakt mora biti objavljen pred javno uvedbo)"
          )}
          .
        </p>
        <Link href="/nastavitve">Nazaj v Nastavitve</Link>
      </article>
    </main>
  );
}
