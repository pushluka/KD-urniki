# Obvezna sprememba začetnega gesla – issue #7

## Kaj je treba izvesti

Za obstoječo namestitev z že izvedenimi prvimi tremi migracijami:

1. Naredite varnostno kopijo in najprej preverite na testnem Supabase projektu.
2. V **Supabase → SQL Editor** izvedite celotno datoteko
   [`202610210001_first_password_change.sql`](../supabase/migrations/202610210001_first_password_change.sql), enkrat.
   Prejšnjih migracij ne ponavljajte. Pri novi namestitvi izvedite vse po vrstnem redu.
3. Nato objavite novo različico aplikacije. Med migracijo in objavo ne ustvarjajte
   računov ali začasnih gesel s staro aplikacijo.
4. V Vercel ostanejo nastavitve iz issue #5: javni Supabase URL/publishable ključ,
   **zasebni** `SUPABASE_SERVICE_ROLE_KEY` in `APP_URL` z dejanskim javnim izvorom.
   Ni novih skrivnih ključev ali dodatnih Redirect URLs. Po spremembah izvedite Redeploy.

**Obstoječih administratorjev ali sodelavcev ni treba ponovno ustvarjati.** Migracija
obstoječim profilom nastavi `must_change_password=false`; njihovih gesel in razporedov
ne spreminja. Novi računi in naslednja administratorska nastavitev začasnega gesla
zahtevajo obvezno spremembo. Skrbnik ne sme ročno odstranjevati oznake iz profila.

## Potek

Tehnik ali hostesa se prijavi z začetnim/začasnim geslom in nastavi novo geslo na
`/nastavi-geslo`. Novo geslo mora imeti 12–256 znakov, se ujemati s potrditvijo in
biti drugačno od trenutnega gesla. Preverjanje ponovne uporabe izvede Supabase Auth;
aplikacija ne hrani začetnega gesla ali njegovega hasha.

Do uspešnega zaključka RLS zavrne dostop do dogodkov, razporedov in zasebnih PDF-jev.
Osvežitev, neposredna povezava, spreminjanje uporabniških metapodatkov ali neposreden
klic Auth za spremembo gesla ne odpravijo zahteve. Dovoljena sta preverjanje omejene
seje in namenski postopek spremembe gesla. Po uspehu aplikacija namesti svežo sejo
in uporabnika preusmeri v koledar.

Obnovitev prek e-poštne povezave ostane na `/ponastavitev-gesla`. Za označen račun
ta stran uporabi isti preverjeni postopek; za neoznačene račune in administratorja
ostane obstoječa obnova. Če račun nima e-pošte, administrator določi novo začasno geslo.

## Zakaj migracija vsebuje sprožilec na `auth.users`

Spreminjanje gesla prek Auth HTTP API in ločeno brisanje zastavice v javni tabeli
ne bi bilo atomarno. Migracija zato doda sprožilec `kd_staff_password_write` na
`auth.users`. Samo strežnik lahko izda kratkotrajno enkratno dovoljenje, vezano na
uporabnika in različico poverilnic. Sprožilec odstrani zahtevo **v isti transakciji**
kot dejanski zapis novega gesla v Supabase Auth. Ob napaki se razveljavita oba zapisa.
Supabase Auth zapiše geslo in metapodatke zaporedno; odloženi sprožilec preveri
končno stanje ob potrditvi transakcije in ga obdela enkrat. Neposreden zapis gesla
pri označenem računu brez dovoljenja je zavrnjen.

Stanje dovoljenj je zaprto pred `anon` in `authenticated`; ne vsebuje gesel ali kopij
Auth hashov. Vloga se preverja v bazi, uporabniško spremenljivi metapodatki niso vir
pooblastil. Podpisani JWT vsebuje strežniško oznako različice; preveri se tudi čas
nastanka Auth seje. Stare seje pred ponastavitvijo ali zaključkom ostanejo zavrnjene,
tudi če se jim osvežijo metapodatki. Administratorjevi obstoječi računi niso omejeni.

To uporablja standardni Supabase Auth tabeli `auth.users` in `auth.sessions` ter
`auth.jwt()`. Migracijo izvedite kot projektni skrbnik. Če uporabljate lasten Access
Token Hook, mora ohraniti standardni `session_id` in `app_metadata.staff_password_nonce`;
sicer je dostop upravičeno zavrnjen. Zmanjševanje ali izključevanje RLS ni rešitev.

## Preverjanje po objavi

- Ustvarite testnega tehnika in hosteso: oba morata pred dostopom zamenjati geslo.
- Poskusite isto geslo, neujemajočo potrditev, osvežitev in neposredno odpiranje koledarja.
- Po uspehu se prijavite z novim geslom; začetno mora biti zavrnjeno.
- Administrator naj nastavi novo začasno geslo: zahteva se mora ponoviti.
- Preverite nespremenjeno prijavo in obnovitev obstoječega administratorja.

Lokalno: `npm test`, `npm run build`, `npm run typecheck`, `npm run test:e2e`.
Brskalniški testi uporabljajo izolirano PostgreSQL bazo z vsemi migracijami in
emuliran oddaljeni Auth; ne spreminjajo produkcije. Pred produkcijsko uvedbo preverite
še dejanski Supabase Auth tok v testnem projektu, zlasti nove sprožilce na Auth tabeli.

Če administratorska ponastavitev ne uspe, račun ostane zaprt; ponovite ponastavitev.
Če geslo uspešno shranite, sveže prijave pa ni mogoče pridobiti, se ponovno prijavite
z novim geslom. Sočasna ponastavitev razveljavi stare dovolilnice; operacijo ponovite
z najnovejšo prijavo. Obstoječe že prenesene datoteke in prej izdane PDF povezave se
ne umaknejo za nazaj; podpisane povezave ohranijo svojo 60-sekundno veljavnost.
