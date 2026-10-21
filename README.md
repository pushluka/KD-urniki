# KD Grosuplje – Urniki

Next.js 16, React 19, TypeScript, Tailwind CSS 4 in Supabase. Slovenski odzivni vmesnik brez demonstracijskih podatkov.

## Lokalni razvoj

Zahtevan Node.js 24 in npm. Uporabite obstoječi checkout; novo delovno drevo ni potrebno.

```sh
npm ci --cache /workspace/.npm
cp .env.example .env.local
npm run dev
```

V `.env.local` nastavite `NEXT_PUBLIC_SUPABASE_URL` in `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` iz svojega projekta Supabase (Project Settings → API). V javni spremenljivki uporabite samo publishable ključ, nikoli service-role ali skrivnega ključa. Za strežniško prijavo in Osebje nastavite tudi zasebni `SUPABASE_SERVICE_ROLE_KEY` ter `APP_URL`, kot je opisano spodaj v razdelku za issue #5. Spremenljivki sta namenoma javni; podatke varuje RLS. Po spremembi ponovno zaženite razvojni strežnik; produkcijo ponovno zgradite. Brez nastavitev se pokaže obvestilo, podatki se ne simulirajo.

## Supabase

1. V svojem projektu izvedite `supabase/migrations/202610200001_initial.sql` prek SQL Editor ali Supabase CLI migracij. Migracija se izvede enkrat, v transakciji.
2. V Authentication ustvarite uporabnike (e-pošta in geslo). Javna registracija ni del aplikacije; za interni sistem onemogočite samostojno registracijo v nastavitvah Auth.
3. Za vsakega uporabnika ustvarite profil z dejanskim Auth UUID prek zaupanja vrednega SQL Editor:

```sql
insert into public.profiles (id, full_name, role)
values ('AUTH-UUID-UPORABNIKA', 'Ime Priimek', 'administrator');
-- Ostali vlogi: hostesa, tehnik. Vloge upravljajte le prek zaupanja vredne administracije.
```

4. Prijavite se. Administrator ustvarja, ureja in briše dogodke, določa potrebno osebje, razporeja hostese/tehnike ter nalaga PDF-je. Uporabniki pregledujejo koledar, ekipo in osebni razpored.

Vsi računi s profilom vidijo koledar, imena in razporede ekipe. Neprepoznani uporabniki nimajo dostopa. Vloge niso povzete iz uporabniško spremenljivih metapodatkov. Profili nimajo dovoljenj za pisanje iz brskalnika. Samo administrator spreminja dogodke in razporede. Zasebni bucket `technical-documents` sprejema samo PDF, do 20 MB; administrator bere vse dokumente, tehnik samo za svoje dodeljene dogodke, hostesa nobenega. Povezave potečejo po 60 sekundah. Brisanje dogodka odstrani razporeditve, morebitni dokumenti ostanejo zasebni in nedostopni; za sprostitev prostora jih izbrišite v Storage administraciji. MIME omejitev ni protivirusni pregled; nalaganje je omejeno na zaupanja vredne administratorje.

Datumi v koledarju in vnosna polja uporabljajo lokalni čas brskalnika; za delo v Sloveniji nastavite časovni pas Europe/Ljubljana. Podrobnosti dogodka se prikazujejo v Europe/Ljubljana, baza hrani timestamptz.

## Preverjanje

```sh
npm test
npm run typecheck
npm run build
npm start
```

Testi zaženejo migracijo v izoliranem PostgreSQL (PGlite) z minimalnima Auth/Storage shemama ter preverijo RLS in omejitve. Ne nadomestijo integracijskega preizkusa v vašem Supabase projektu. Po konfiguraciji preverite prijavo z vsemi tremi vlogami, shranjevanje dogodka, dodelitev tehnika, nalaganje in odpiranje PDF ter zavrnitev dostopa za drugega tehnika in hosteso. Nikoli ne izključite RLS.

GitHub Actions ob push/PR preveri tipe, RLS teste in produkcijsko gradnjo. Za gostovanje nastavite javni spremenljivki v okolju ponudnika (npr. Vercel), brez vključevanja `.env.local` v Git.

Aplikacija nima e-poštnih obvestil o dogodkih ali samodejnega preprečevanja prekrivanj. Razporeditve administrator preveri v koledarju, prijavne račune pa upravlja v podstrani Osebje.

## Obnovitev gesla (produkcija)

Na prijavi izberite **Pozabljeno geslo**. Aplikacija pokliče `resetPasswordForEmail` s preusmeritvijo na `/ponastavitev-gesla` na trenutni domeni. Obnovitvena stran sprejme implicitno povezavo `#type=recovery&access_token=…&refresh_token=…`, recovery PKCE `?code=…` ali `?type=recovery&token_hash=…`. Navadna prijavna seja brez obnovitvene povezave ne odpre obrazca. Veljavnost uporabnika preveri prek Supabase Auth, pred spremembo ponovno preveri sejo, nato uporabi `updateUser({ password })`, se lokalno odjavi in preusmeri na prijavo. Enkratni podatki se odstranijo iz naslovne vrstice. Ob osvežitvi strani zahtevajte novo povezavo.

V **Supabase Dashboard → Authentication → URL Configuration** preverite:

- **Site URL:** `https://kd-urniki.vercel.app`
- **Redirect URLs:** dodajte točno `https://kd-urniki.vercel.app/ponastavitev-gesla`.
- Za lokalni razvoj po potrebi dodajte `http://localhost:3000/ponastavitev-gesla`. Preview domene dodajte ločeno; v produkciji ne uporabljajte splošne dovoljene preusmeritve na vse domene.

V **Authentication → Email Templates → Reset Password** naj povezava uporablja `{{ .ConfirmationURL }}`. Ne zamenjajte je s samo `{{ .SiteURL }}`, ker tako izgubite obnovitvene podatke. Če uporabljate svojo predlogo s token hash, uporabite `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery` (RedirectTo v tem postopku nima drugih query parametrov). Stare povezave lahko še vedno kažejo na začetno stran; aplikacija jih preusmeri na obrazec z ohranjenimi obnovitvenimi podatki. PKCE povezava potrebuje isti brskalnik, v katerem je bila zahteva ustvarjena. Trenutni klient uporablja implicitni tok, zato je standardno e-poštno povezavo mogoče odpreti tudi v drugem brskalniku.

Po objavi te veje v Vercel preverite na produkciji z dejanskim testnim računom:

1. Zahtevajte obnovitev in preverite, da povezava v prejetem sporočilu kaže na pravilni Supabase projekt ter vsebuje pravilni `redirect_to`.
2. Odprite povezavo, vnesite in potrdite novo geslo (vsaj 12 znakov). Preverite tudi neusklajeni gesli.
3. Preverite vrnitev na prijavo in prijavo z novim geslom; staro geslo mora biti zavrnjeno.
4. Preverite pretečeno in ponovno uporabljeno povezavo ter neposreden obisk obnovitvene strani brez povezave. Obrazec ne sme biti na voljo.

Nastavitve v Supabase Dashboard niso del migracij SQL in jih ta veja ne spremeni. Avtomatizirani testi preverijo obdelavo povezav in Auth klice z nadomestnim testnim odjemalcem; dejanski e-poštni tok potrebuje dostop do testnega računa in njegovega nabiralnika. Skrivnih ključev in obnovitvenih povezav ne vpisujte v Git, dnevnike ali pogovor.

## Nadgradnja dogodkov in razporedov (issue #3)

Pred uporabo nove različice mora skrbnik baze izvesti **novo** migracijo
`supabase/migrations/202610200002_event_staffing.sql`. Produkcijska baza s tem
repozitorijem ni bila samodejno spremenjena.

1. Naredite varnostno kopijo baze in najprej preverite nadgradnjo na testnem projektu.
2. Če začetna shema še ni nameščena, najprej izvedite `202610200001_initial.sql`.
   Na obstoječi bazi začetne migracije **ne zaganjajte ponovno**.
3. V Supabase → SQL Editor prilepite **celotno** datoteko
   `202610200002_event_staffing.sql` in izvedite enkrat; ali uporabite običajni
   Supabase CLI `supabase db push` za že povezan projekt s pravilno zgodovino migracij.
   Migracija je transakcijska: ob napaki se spremembe razveljavijo.
4. Migracija ohrani stare dogodke in razporeditve. Starim razporeditvam začetno
   nastavi prihod/zaključek na začetek/konec dogodka. Administrator naj te ure
   preveri in po potrebi popravi. Starim dogodkom postavka ostane nedoločena;
   ni varno ugibati med 110 in 111. Pri ustvarjanju in urejanju v aplikaciji
   je izbira obvezna. Baza zavrne druge vrednosti in odstranitev že določene postavke.
5. Po migraciji in pregledu PR objavite novo različico aplikacije. Med nadgradnjo
   ne urejajte razporedov s staro različico: ta še ne pošilja obveznih individualnih ur.
   Nova različica potrebuje tudi tabelo `external_assignments`, zato migracijo izvedite
   pred njeno uporabo. Migracija in objava nista izvedeni samodejno.
6. Preverite spodnje scenarije z administratorjem, tehnikom in hosteso.

Administrator v podrobnostih dogodka doda člana po imenu ter za vsakega določi
**datum in uro prihoda** in **predvidenega zaključka**. Datum omogoča tudi delo
čez polnoč. Ure se lahko razlikujejo med osebami in so lahko zunaj trajanja dogodka.
Shranijo se kot `timestamptz`; vnosna polja in razpored uporabljajo časovni pas
brskalnika, izpisan nad razporedom. Za delo v Sloveniji nastavite Europe/Ljubljana.
Urejanje ur dogodka ne prepiše že shranjenih individualnih ur.

Tehnik se lahko sam prijavi, popravi lastne ure ali odjavi. RLS preveri
`auth.uid()` in vlogo iz zaupanja vrednega profila; tehnik ne more prijaviti
hostese ali drugega tehnika, spreminjati tujih ur ali računovodske postavke.
Hostese razporeja samo administrator. Vsi člani ekipe še vedno berejo poimenski
razpored, zasebne PDF-je pa le administrator in dejansko dodeljeni tehniki.
Samoprijava tehnika omogoči dosedanji dostop do PDF-jev za ta dogodek; odjava ga odvzame.

Zunanji sodelavec ima ime, vlogo in individualne ure v ločeni tabeli
`external_assignments`. Vnaša, ureja in odstranjuje ga samo administrator.
Vnos ne ustvari uporabniškega računa ali pravice do zasebnih dokumentov.
Izračun delovnih ur in mesečni seštevki niso vključeni.

### Preverjanje nadgradnje

```sh
npm test
npm run build
npm run typecheck
npx playwright install chromium
npm run test:e2e
```

Če je Chromium že nameščen v sistemu, lahko namesto prenosa uporabite:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:e2e
```

Brskalniški testi pokrijejo namizni prikaz 1440 × 1000 in mobilni prikaz Pixel 7:
klik/dotik dogodka, odpiranje/zapiranje pogovornega okna, zanesljivo začetno nalaganje
pri drugačnem datumu v brskalniku, ohranitev postavke ter
individualnih ur po osvežitvi, zunanje sodelavce in dovoljene obrazce za vsako vlogo.
Uporabljajo izključno testne podatke in lokalni Auth/REST adapter z izolirano
PostgreSQL bazo PGlite, v kateri se izvedejo vse dejanske migracije in RLS.
To preveri UI ter pravice brez poseganja v produkcijo; ni preizkus živega Supabase
omrežja ali fizičnih telefonov. Testni odjemalec ni del produkcijske aplikacije.

Po objavi ročno preverite tudi v svojem Supabase projektu: ustvarite dogodek s 110,
ga uredite v 111 in osvežite stran; dodajte dve osebi z različnimi urami in enega
zunanjega sodelavca; preverite samoprijavo tehnika in da hostesa nima možnosti
urejanja. Preverite tudi, da sprememba ur dogodka ne spremeni ur osebja.

## Osebje in prijava z uporabniškim imenom (issue #5)

### Vrstni red nadgradnje

1. Naredite varnostno kopijo in preverite nadgradnjo na ločenem testnem Supabase projektu.
2. Na obstoječi bazi z migracijama `001` in `002` izvedite samo celotno novo datoteko
   `supabase/migrations/202610200003_staff_accounts.sql` v Supabase SQL Editor (enkrat).
   Pri novi namestitvi izvedite vse tri migracije po vrstnem redu. Če uporabljate Supabase CLI,
   uporabite `supabase db push` samo s pravilno zgodovino že izvedenih migracij.
3. Nastavite spodnje spremenljivke v Vercel in ponovno objavite aplikacijo iz pregledanega PR.
   Med migracijo in objavo se izognite upravljanju osebja s starejšo aplikacijo.
4. Prijavite se z **obstoječo administratorsko e-pošto in geslom**. Ta migracija ne ustvari,
   ne podvoji in ne spremeni nobenega Auth računa, administratorjevega ID ali gesla.
5. Odprite **Osebje**. Pri že obstoječih tehnikih/hostesah izberite **Uredi** in določite ime,
   priimek ter uporabniško ime. To poveže njihov obstoječi Auth račun z uporabniškim imenom;
   ne ustvarjajte jih ponovno z možnostjo Dodaj sodelavca. Obstoječa gesla in razporeditve ostanejo.

Migracija je transakcijska in ohrani dogodke, postavki 110/111, individualne ure in zasebne PDF-je.
Starim profilom nastavi `is_active=true`. Uporabniških imen ne ugiba ali izpeljuje iz zasebnih e-pošt.

### Vercel → Project → Settings → Environment Variables

| Ime                                    | Vrsta in vrednost                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | Javni naslov **istega** Supabase projekta.                                                                         |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Javni publishable ključ tega projekta.                                                                             |
| `SUPABASE_SERVICE_ROLE_KEY`            | **Secret**, strežniški service-role ključ istega projekta. Brez predpone `NEXT_PUBLIC_`. Nikoli v Git ali pogovor. |
| `APP_URL`                              | Config: `https://kd-urniki.vercel.app` (samo vaš zaupanja vreden izvor).                                           |

Nastavite za **Production** in za tiste **Preview** namestitve, ki jih nameravate uporabljati.
Za Preview raje uporabite ločen testni Supabase projekt in njegovo domeno v `APP_URL`,
saj ima strežniški ključ polna pooblastila v svojem projektu. Brez vseh štirih nastavitev
strežniška prijava in upravljanje osebja vrneta 503, brez razkrivanja ključev.
Po spremembi nastavitev izvedite **Redeploy**; javni spremenljivki se vključita ob gradnji.
Lokalno uporabite ignorirano `.env.local` in `APP_URL=http://localhost:3000`.
Za API-je je potreben Next.js strežnik/Vercel Functions (Node.js), ne statični izvoz.

Strežniški modul je zaščiten z `server-only`. Service-role ključ nikoli ne gre v brskalnik,
v odgovor API ali v SQL parametre. Gesla se pošljejo neposredno v Supabase Auth prek TLS;
ni stolpcev z gesli v `profiles`, `staff_accounts` ali drugih javnih tabelah. Ne omogočajte
beleženja teles zahtev na `/api/auth/login` in `/api/staff/**` v zunanjih orodjih.

### Supabase Auth in obnova

- V Authentication → Providers → Email ohranite prijavo z geslom in **onemogočite javno registracijo**.
  Račune ustvarja samo preverjeni aktivni administrator prek strežniškega Auth Admin API.
- V Authentication → URL Configuration ohranite Site URL `https://kd-urniki.vercel.app`
  in Redirect URL `https://kd-urniki.vercel.app/ponastavitev-gesla`.
- Predloga Reset Password naj uporablja `{{ .ConfirmationURL }}`. Za dostavo nastavite produkcijski SMTP
  ter preverite omejitve pošiljanja v Supabase. Sprememba uporabniškega imena ne spremeni e-pošte Auth.
- Pri novem sodelavcu lahko vnesete zasebno **e-pošto za obnovitev**. Shrani se samo v Supabase Auth,
  ne v javni profil ali seznam uporabniških imen. Ne vnašajte e-pošte, ki že pripada drugemu računu;
  tak primer je zavrnjen, obstoječi račun pa ni spremenjen.
- Če sodelavec nima e-pošte, dobi interno naključno identiteto `…@accounts.invalid`, ki ni namenjena
  pošiljanju. Prijavi se z uporabniškim imenom. Administrator lahko v Osebje → Ponastavi geslo določi
  novo začasno geslo s potrditvijo; predajte ga po varni poti. Geslo se po ustvarjanju ne prikaže.
  Če potrebujete e-poštno obnovo za tak obstoječi račun, skrbnik najprej preveri identiteto in
  nastavi pravi naslov v Supabase Auth. Ne ustvarjajte drugega računa.
- Obstoječi administrator še naprej uporablja svojo e-pošto, geslo in Pozabljeno geslo na prijavi.
  Administratorjeve vloge, imena in prijavnih podatkov podstran Osebje namenoma ne ureja.

### Pravice in varnost

Vsak API za Osebje preveri Bearer sejo z `auth.getUser` in nato **trenutno aktivno** vlogo v bazi.
Vloge iz uporabniško spremenljivih metapodatkov ali podatkov obrazca ne dajejo pooblastil.
Dovoljeni vlogi pri ustvarjanju in urejanju sta samo `tehnik` in `hostesa`; ni poti za dvig v administratorja.
Spremembe zahtevajo isti izvor, odgovori niso predpomnjeni. Prijava z uporabniškim imenom poteka
na strežniku; brskalnik nima dostopa do preslikav `staff_accounts`, zasebnih e-pošt drugih uporabnikov
ali API-ja za preverjanje obstoja uporabniškega imena. Napačno geslo, neobstoječe ime in neaktiven račun
imajo enako sporočilo. Strežnik izenači Auth poizvedbe za veljavna neznana imena in uporablja minimalni
čas odgovora, da zmanjša tudi časovne razlike. Le uspešna prijava vrne sejo prijavljenega uporabnika.

Poskusi prijave so omejeni v PostgreSQL, zato omejitev velja čez več Vercel instanc:
10 poskusov na normalizirano prijavno ime in 30 na izvorni IP v 15 minutah (tudi uspešni poskusi štejejo).
Tabela vsebuje samo HMAC izvlečke, ne surovih imen, e-pošt, IP-jev ali gesel; stare vrstice se čistijo.
Na Vercel se uporablja `x-vercel-forwarded-for`; drugje brez zaupanja vrednega IP vsi zahtevki delijo
skupno omejitev IP. Pri testiranju po 429 počakajte 15 minut. Gesla še vedno preverja Supabase Auth,
ki ohrani tudi svoje omejitve in nastavitve varnosti gesel.

Deaktivacija najprej izklopi dostop v bazi prek `current_role()` in RLS, nato blokira Auth.
Tako tudi že izdana seja ne more spreminjati ali na novo brati zaščitenih podatkov.
Če blokada Auth ne uspe, UI to jasno pove; ponovite deaktivacijo v Osebje. Baza vmes ostane zaprta.
Ponovna aktivacija najprej odblokira Auth in šele nato omogoči profil. Stare dodelitve se ne brišejo;
novih dodelitev neaktivni osebi ni mogoče ustvariti. Že prenesenih podatkov ni mogoče umakniti,
že izdana PDF povezava pa ostane veljavna do svoje obstoječe 60-sekundne omejitve.

Tehnik še vedno ureja samo svojo prijavo in ure, hostese dodeljuje samo administrator;
prikaz Moj razpored in skupni koledar ohranita obstoječe pravice. Zunanji sodelavci brez računa
ostanejo ločeni od prijavnih računov. Ob napaki ustvarjanja profila se izbriše samo novi Auth račun,
ustvarjen s to zahtevo; obstoječih računov se ne prepisuje. Če tudi ta popravek ne uspe,
UI opozori na nedokončan račun: pred ponovitvijo preverite nove vnose v Supabase Auth in
morebitne pripadajoče profile. Nedokončan Auth račun brez aktivnega profila nima pravic prek RLS.

### Preverjanje

```sh
npm test
npm run build
npm run typecheck
npx playwright install chromium
npm run test:e2e
```

Testi pokrijejo vse tri vloge, zavrnitev ponarejenih/neaktivnih sej, prepoved dviga privilegijev,
unikatnost uporabniških imen, prijavo, obnovo, omejevanje poskusov, vrnitev po napaki ustvarjanja
in RLS po deaktivaciji tudi ob napaki Auth. Brskalniški testi na računalniškem in mobilnem prikazu
uporabijo iste strežniške obdelovalce in vse migracije v PGlite; samo oddaljeni Auth je testno emuliran.
V produkcijo ne dodajajo testnih računov. Pred uporabo še preverite dejansko ustvarjanje računa,
prijavo z uporabniškim imenom ter dostavo obnovitvenega e-sporočila v svojem testnem Supabase projektu.

## Obvezna sprememba začetnega gesla (issue #7)

Za to nadgradnjo izvedite samo novo migracijo
[`202610210001_first_password_change.sql`](supabase/migrations/202610210001_first_password_change.sql)
in nato objavite novo različico. Obstoječih računov ne ustvarjajte ponovno;
administratorji in računi brez oznake ohranijo svoja gesla.
[Navodila za izvedbo in preverjanje](docs/first-password-change.md).

## Osebne oznake na koledarju (issue #9)

Tehnik in hostesa vidita svoje razporejene dogodke zeleno z oznako **Delam**;
ostali dogodki ostanejo sivi. Enako velja za Moj razpored in seznam naslednjih
dogodkov. Administratorske barve lokacij ostanejo nespremenjene. Lastne spremembe
razporeda se osvežijo takoj, spremembe v drugem odjemalcu ob vrnitvi v zavihek
in vsakih 30 sekund v vidnem zavihku. Dodatna SQL migracija, Realtime ali nove
Vercel nastavitve niso potrebni; podatki se še vedno berejo z uporabnikovo sejo prek RLS.
