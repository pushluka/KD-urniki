import Link from "next/link";
export default function Install() {
  return (
    <main className="auth-page">
      <article className="panel install-guide">
        <div className="eyebrow">KD GROSUPLJE · URNIKI</div>
        <h1>Namestitev na telefon</h1>
        <p>
          Aplikacijo lahko dodate na začetni zaslon. Za prijavo, koledar,
          razporede in dokumente potrebujete internetno povezavo.
        </p>
        <h2>Android · Chrome</h2>
        <ol>
          <li>
            Odprite <strong>kd-urniki.vercel.app</strong> v brskalniku Chrome.
          </li>
          <li>
            Odprite meni ⋮ in izberite <strong>Namesti aplikacijo</strong> ali{" "}
            <strong>Dodaj na začetni zaslon</strong>.
          </li>
          <li>Potrdite namestitev in aplikacijo odprite z novo ikono.</li>
        </ol>
        <h2>iPhone · Safari</h2>
        <ol>
          <li>
            Odprite <strong>kd-urniki.vercel.app</strong> v brskalniku Safari.
          </li>
          <li>
            Tapnite <strong>Deli</strong> in nato{" "}
            <strong>Dodaj na začetni zaslon</strong>. Po potrebi se pomaknite
            navzdol.
          </li>
          <li>
            Če je prikazana možnost{" "}
            <strong>Odpri kot spletno aplikacijo</strong>, jo vključite, nato
            tapnite <strong>Dodaj</strong>.
          </li>
        </ol>
        <p>
          Poimenovanje možnosti je odvisno od različice sistema. Če uporabljate
          brskalnik znotraj druge aplikacije, povezavo najprej odprite v Chromu
          oziroma Safariju.
        </p>
        <h2>Prijava in posodobitve</h2>
        <p>
          Po namestitvi se po potrebi znova prijavite. Namestitev ne spremeni
          vaših pravic. Na skupni napravi se po uporabi odjavite.
        </p>
        <p>
          Ko se prikaže obvestilo o novi različici, shranite vnos in izberite
          »Posodobi aplikacijo«. Aplikacija se bo ponovno odprla.
        </p>
        <Link href="/">Nazaj na urnike</Link>
      </article>
    </main>
  );
}
