# Potisna obvestila – issue #13

## Migracija pred združitvijo PR

V testnem Supabase projektu z že izvedenimi prejšnjimi migracijami najprej naredite
varnostno kopijo in v SQL Editor izvedite **celotno** datoteko
[`202610220001_web_push.sql`](../supabase/migrations/202610220001_web_push.sql).
Izvede se enkrat, v transakciji. Nato preverite testne scenarije spodaj. Enako novo
migracijo izvedite v produkciji pred objavo aplikacije; prejšnjih migracij ne ponavljajte.
Obstoječih uporabnikov, gesel, dogodkov in razporedov ne spreminja.

`push_subscriptions` hrani naročnine več naprav, največ 10 na račun. RLS dovoli
prijavljenemu aktivnemu tehniku/hostesi samo povzetek lastnih naročnin; naslov in
šifrirni ključi so dostopni samo strežniku. Pisanje je možno samo prek preverjenega
strežniškega API. `push_deliveries` je zasebna vrsta brez dostopa iz brskalnika.
RPC za prijavo/prevzem/potrditev ima samo `service_role`. Vlog in uporabnika API
ne prevzame iz telesa zahteve, ampak preveri Supabase Auth in profil ob vsakem klicu.
Začetno geslo mora biti že spremenjeno. Izključevanje RLS ni potrebno.

## VAPID in Vercel

1. V lokalnem zaupanja vrednem okolju izvedite `npm ci`, nato:

   ```sh
   node scripts/generate-vapid.mjs mailto:skrbnik@vasa-dejanska-domena.si
   ```

   Uporabite dejanski kontakt. Skript ustvari `.env.vapid.local` z dovoljenjem 0600;
   ključi se ne izpišejo in obstoječa datoteka se ne prepiše. `.env*` je prezrt v Git.
   Za lokalni preizkus vrednosti prenesite v svojo `.env.local`; Next.js datoteke
   `.env.vapid.local` ne naloži samodejno.
   Datoteke, zasebnega ključa ali CRON skrivnosti ne pošiljajte v GitHub, klepet ali dnevnike.

2. V **Vercel → Project → Settings → Environment Variables** nastavite za Production
   (in ločeno testno okolje po potrebi):

   | Ime                 | Vrednost / vidnost                                                 |
   | ------------------- | ------------------------------------------------------------------ |
   | `VAPID_PUBLIC_KEY`  | javni ključ iz datoteke, strežniška nastavitev brez `NEXT_PUBLIC_` |
   | `VAPID_PRIVATE_KEY` | zasebni ključ, **Secret/Sensitive**, samo strežnik                 |
   | `VAPID_SUBJECT`     | dejanski `mailto:` kontakt ali javni HTTPS naslov                  |
   | `CRON_SECRET`       | naključna skrivnost iz datoteke, **Secret/Sensitive**              |

   Ohranite `SUPABASE_SERVICE_ROLE_KEY` kot zasebnega in pravilen `APP_URL`:
   `https://kd-urniki.vercel.app`. Obstoječa javna Supabase URL/publishable nastavitev
   ostane nespremenjena. Novi Redirect URLs niso potrebni.

3. Izvedite Redeploy. Javni VAPID ključ API vrne samo prijavljenemu sodelavcu;
   zasebni ključ nikoli ni v odjemalskem paketu. Če nastavitve manjkajo, aplikacija
   še vedno deluje; v nastavitvah pove, da obvestila še niso nastavljena.

4. Nastavite **obvezen periodični klic** `GET /api/push/dispatch`, običajno vsako minuto.
   Zahteva potrebuje `Authorization: Bearer <CRON_SECRET>`. Ne dajajte skrivnosti v URL.
   Na Vercel načrtu, ki dovoljuje minutni Cron, dodajte spodnjo konfiguracijo v
   `vercel.json` (združite z morebitno obstoječo konfiguracijo):

   ```json
   { "crons": [{ "path": "/api/push/dispatch", "schedule": "* * * * *" }] }
   ```

   Vercel sam doda glavo za nastavljeni `CRON_SECRET`. Hobby ima omejitve pogostosti;
   tam uporabite zaupanja vreden zunanji razporejevalnik z isto skrivno glavo ali
   ustrezen Vercel načrt. Minutni Cron namenoma ni vključen samodejno, da objava na
   Hobby ne bi odpovedala. Brez razporejevalnika ni zagotovljenih ponovnih poskusov.
   Preverite plan in dokumentacijo Vercel Cron, omejitve ter monitor izvajanja.

Administratorjev brskalnik po shranitvi sproži tudi preverjeni `POST /api/push/dispatch`
za hitro dostavo; za to ne potrebuje CRON skrivnosti. Če zapre zavihek, dostavo
nadaljuje periodični klic. Preverite, da anonimni GET brez skrivnosti vrne 401.
Vsak klic obdela največ 10 dostav; ob večjih količinah spremljajte zaostanek in
prilagodite pogostost razporejevalnika. En Vercel klic ima omejitev 30 sekund.

## Dostava, zasebnost in ponovni poskusi

Sprožilec zazna administratorski INSERT/DELETE razporeditve in dejansko spremembo
prihoda/zaključka. Podvojeno shranjevanje istih ur, samoprijava/samourejanje tehnika,
sprememba opomb/naslova dogodka in zunanji sodelavci brez računa ne sprožijo obvestila.
Sprememba se shrani skupaj z zasebno vrsto; pošiljanje je ločeno. Napaka ponudnika
ne razveljavi razporeditve. Vsaka obstoječa naročena naprava prizadetega sodelavca
dobi svojo dostavo. Novih naprav ne zasujemo s starejšimi obvestili.

Prevzem uporablja vrstično ključavnico in dvominutno dovoljenje. Uspešna dostava
se označi in je naslednji klic ne ponovi; vzporedni klici ne prevzamejo istega opravila.
Za prehodne napake sledijo ponovni poskusi z odmikom, največ 8 poskusov v 24 urah.
HTTP 404/410 odstrani neveljavno naročnino; 400/401/403/413 zaključi neuspešno dostavo
(preverite konfiguracijo VAPID). Ostale začasne napake se ponovijo. Podatki vrste se
po 7 dneh odstranijo ob naslednjem klicu. Rok pri ponudniku Push je največ eno uro.

Web Push nima jamstva »natanko enkrat«: če ponudnik potrdi prejem, proces pa pred
zapisom potrditve odpove, se lahko poskus ponovi. Stabilni `Topic` in oznaka obvestila
`tag` združujeta ponovljeno dostavo istega opravila; absolutne odprave ponovne dostave
po že odpravljenem obvestilu ni mogoče zagotoviti. Obvestila so namig za pregled
trenutnega razporeda, ne njegova avtoritativna kopija.

V zaklenjenem obvestilu ni imen, naslova dogodka, ur ali dokumentov. Šifrirani payload
vsebuje le generično besedilo in nepredvidljive identifikatorje za odpiranje povezave.
Klik po potrebi najprej zahteva prijavo, nato preveri pravi račun in obstoječe RLS.
Odstranjen dogodek prikaže obvestilo, da ni več na voljo. Poljubni zunanji URL se ne odpre.

API sprejme samo HTTPS naročnine standardnih ponudnikov FCM, Mozilla in Apple;
poljubni naslovi/vrata/uporabniška gesla v URL so zavrnjeni zaradi SSRF. Endpointov,
ključev in payloadov ne zapisujemo v dnevnik. Ponudnik Push še vedno obdeluje transportne
metapodatke, zato je uporaba izbirna. Ob deaktivaciji ali prisilni menjavi gesla baza
izbriše naročnine. Po ponovni prijavi/menjavi gesla naj uporabnik obvestila znova vključi.
Odjava v brskalniku prekliče lokalno Push naročnino; strežnik ostanek odstrani ob
naslednji zavrnjeni dostavi. Na skupni napravi se vedno odjavite. Že dostavljenega
obvestila ni mogoče umakniti z vseh naprav za nazaj.

Ključev VAPID ne menjajte ob vsaki objavi. Ob načrtovani rotaciji zamenjajte oba ključa;
razporejevalnik odstrani stare naročnine, uporabniki pa jih morajo na vsaki napravi
ponovno omogočiti. Stari ključi v brskalniku se ob vklopu zamenjajo z novo naročnino.

## Uporabniški potek in preverjanje

Po prvi objavi Web Push naj obstoječi uporabniki najprej potrdijo posodobitev PWA.
Nastavitve preverijo zmožnost aktivnega workerja; staremu workerju ne prijavijo nove
naročnine. Tehnik/hostesa odpre **Nastavitve → Omogoči obvestila**. Dovoljenje se zahteva samo
po kliku. **Izklopi obvestila** velja za trenutno napravo. Za drugo napravo ponovi
prijavo in vklop. Ob zavrnjenem dovoljenju je potrebna sprememba nastavitev brskalnika.
Na iPhonu/iPadu je potreben iOS/iPadOS 16.4+, Safari namestitev na začetni zaslon in
zagon z ikono. Navaden Safari zavihek obvestil ne omogoči. Android Chrome podpira
standardni Push API; obvestila lahko omejujejo sistemske nastavitve/baterija.

Pred produkcijsko uporabo na testnih računih in dejanskih telefonih:

- Brez dovoljenja ni naročnine in prijava/koledar ostaneta uporabna.
- Omogočite na dveh napravah tehnika ter na hostesini napravi.
- Administrator naj dodeli, spremeni prihod/zaključek in odstrani osebo: obvestilo
  dobi samo prizadeta oseba, na vseh njenih naročenih napravah.
- Nespremenjeno shranjevanje ur, sprememba naslova/opomb in lastna samoprijava ne pošljejo ničesar.
- Preverite klik iz zaklenjenega zaslona, prijavo, napačen račun in odstranjen dogodek.
- Izklopite obvestila in ponovite spremembo; na izklopljeni napravi ni več dostave.
- Odjavite/deaktivirajte račun oziroma nastavite začasno geslo; naročnine se prekličejo.
- Preverite ponovni poskus po izpadu ter izvajanje razporejevalnika, tudi z zaprtimi zavihki.
- Cache Storage sme še vedno vsebovati samo javni `/offline.html`.

Avtomatizirano: `npm test`, `npm run test:e2e`, `npm run build`, `npm run typecheck`,
`npm run test:pwa` (po gradnji). Testi preverijo dejanske SQL migracije/RLS, API in
vrsto z emuliranim ponudnikom ter uporabniški potek v Chromiumu na računalniku in
telefonu. Dejanska dostava prek FCM/APNs in sistemskega obvestila na Android/iOS
zahteva konfiguracijo VAPID in preizkus naprav; v tem okolju ni preverjena.
