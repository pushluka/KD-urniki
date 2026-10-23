# Administratorska obvestila in zgodovina

## Uvedba

1. Po vseh prejšnjih migracijah (vključno z Web Push) v testnem Supabase projektu
   izvedite **celotno** datoteko
   [`202610220002_admin_notifications.sql`](../supabase/migrations/202610220002_admin_notifications.sql).
   Nato preverite scenarije spodaj; pred produkcijsko objavo izvedite isto migracijo
   v produkciji. Izvede se enkrat, v transakciji. Obstoječih podatkov osebja ne spreminja.
2. Objavite aplikacijo. Obstoječi uporabniki PWA naj potrdijo posodobitev z gumbom
   »Posodobi aplikacijo«. Nov worker zna povezati push z zapisom zgodovine.
3. **Novi ključi ali nov razporejevalnik niso potrebni.** Uporabljajo se obstoječi
   `VAPID_PUBLIC_KEY`, zasebni `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`,
   `APP_URL` in periodični `GET /api/push/dispatch` iz [navodil Web Push](web-push.md).
   Če periodični klic še ni nastavljen, ga nastavite po teh navodilih; zaprt brskalnik
   ne more nadomestiti strežniškega razporejevalnika.

## Potek za administratorja

Administrator odpre **Nastavitve** in na vsaki želeni napravi izbere **Omogoči obvestila**.
Dovoljenje se zahteva samo po kliku. **Izklopi obvestila** velja za trenutno napravo.
Na iPhonu je potreben iOS/iPadOS 16.4+ in PWA, dodana na začetni zaslon iz Safarija.
Vklop in izklop uporabljata isti preverjeni API kot osebje, z dodano administratorsko vlogo.

**Obvestila** je administratorski zavihek. Prikaže naslov, vsebino, čas (Europe/Ljubljana),
povezani dogodek in stanje prebranosti. Najnovejša obvestila so prva, po 50 na stran;
»Starejša« in »Novejša« omogočata pregled celotnega 14-dnevnega obdobja.
Prebranost se hrani v bazi za račun, zato jo vidijo vse njegove naprave. Stran ob
vrnitvi v zavihek in vsakih 30 sekund osveži podatke. Administrator lahko obvestilo
ročno označi kot prebrano ali neprebrano. Odpiranje povezave/pusha ga označi kot prebrano.
Vsak administrator ima svojo zgodovino in svojo prebranost; ne gre za skupen nabiralnik.

Zgodovina nastane tudi brez vključenih push obvestil in ostane po izklopu naročnine
ali po čiščenju dostavnih zapisov. Za nazaj ne ustvarja izmišljenih obvestil: začne
se z dejanskimi spremembami po uvedbi migracije.

## Sprožilci in dostava brez nove poti pošiljanja

Ob dodelitvi, dejanski spremembi prihoda/zaključka ali odstranitvi registriranega
sodelavca nastane en zapis zgodovine za vsakega aktivnega administratorja.
To vključuje administratorsko urejanje in dovoljene samoprijave/samourejanje tehnikov.
Nespremenjeno shranjevanje istih ur ter sprememba naslova/opomb dogodka ne ustvarita
obvestil. Zunanji sodelavci brez uporabniškega računa niso vključeni v ta sprožilec.

Za vsako naročeno administratorjevo napravo se v **obstoječi** `push_deliveries`
vrsti ustvari ena dostava, povezana z zgodovino. Unikatni indeks prepreči dvojni vnos
iste kombinacije zgodovina/naprava. Ni dodatnega pošiljanja iz zgodovine ali novega
push endpointa. Obstoječi lease, ponovni poskusi in potrditve ostanejo isti.
Za administratorja je `Topic/tag` vezan na isti zapis zgodovine; ponovni dispatch
že uspešno potrjenih opravil ne pošlje znova. Meja Web Push »natanko enkrat« ob
neuspešni potrditvi ponudnika ostaja enaka kot v obstoječih navodilih.

Push na zaklenjenem zaslonu vsebuje samo generično obvestilo o spremembi ekipe.
Ime sodelavca in naslov dogodka sta samo v zaščiteni zgodovini po prijavi.
Klik odpre povezani dogodek in preveri prejemnikov račun; nepravilni račun dogodka
ne odpre samodejno. Če dogodka ni več, se prikaže obstoječe obvestilo, da ni na voljo.
Zgodovina hrani posnetek naslova dogodka tudi po njegovem izbrisu.

Pot za tehnike in hostese ostane nespremenjena: ista pravila dodelitev, naročnine,
besedilo pusha in povezava. Njihove samoprijave še vedno ne ustvarjajo dodatnih
push obvestil osebju. Nova zgodovina je namenjena izključno administratorjem.

## RLS in 14-dnevno fizično čiščenje

`admin_notifications` je zaščitena z RLS: aktiven administrator vidi samo svoje
zapise, tehnik/hostesa/anonimni uporabnik nobenega. Administrator ima neposredno
pravico posodobiti le `read_at` svojih zapisov; vsebine, uporabnika, dogodka in časa
nastanka ne more ponarediti. Strežniški endpoint dodatno preveri Auth, aktivnost,
vlogo, lastništvo in izvor pri spremembah. Zasebni šifrirni ključi niso v zgodovini.

`cleanup_admin_notifications()` izvede **DELETE**, ne samo filtriranja v prikazu:
izbriše vse zapise s `created_at < now() - interval '14 days'`. Povezane stare push
dostave se odstranijo prek FK `ON DELETE CASCADE`; zgodovina ni vezana na življenjsko
dobo sedemdnevnih dostavnih zapisov ali naročnin.

Čiščenje se izvede na začetku vsakega pooblaščenega dispatcha, tudi če ni čakajočih
obvestil ali VAPID trenutno manjka, ter v SQL prevzemu in ob branju zgodovine.
Obstoječi periodični dispatch tako dejansko briše staro zgodovino z intervalom
obstoječega razporejevalnika. Če se razporejevalnik ustavi, se fizično čiščenje
odloži do naslednjega dispatcha ali odpiranja zgodovine; RLS medtem že skrije pretečene
zapise. Spremljajte delovanje obstoječega razporejevalnika.

## Preverjanje

- Administrator na telefonu vključi obvestila. Druga naprava istega računa naj jih
  prav tako vključi; administrator brez pusha naj še vedno vidi zgodovino.
- Dodelite tehnika, spremenite ure in ga odstranite: ena zgodovina na spremembo in
  račun, največ ena običajna push dostava na spremembo in naročeno napravo.
- Ponovite dispatch: uspešno potrjena obvestila se ne pošljejo znova.
- Odprite push z odjavljenim računom; po prijavi se odpre dogodek in označi prebrano.
- Preverite prebranost na drugi napravi ter ločenost zgodovin dveh administratorjev.
- S tehnikom/hosteso preverite nespremenjeno dostavo in prepoved dostopa do zgodovine.
- V testni bazi nastavite čas testnega zapisa na več kot 14 dni nazaj. Sprožite
  pooblaščeni dispatch in kot projektni skrbnik preverite, da vrstice **ni več v tabeli**.
  Preverite tudi prazno vrsto in trenutno manjkajoč VAPID.

Avtomatizirani testi uporabljajo dejanske migracije in RLS v PGlite, preverjajo
lastništvo, fizični DELETE, vrstni red/strani, prebranost, rollback, število dostav
in nespremenjeno osebje. Brskalniški testi preverjajo vklop administratorja,
zgodovino, povezavo po prijavi in mobilno postavitev. Prava dostava FCM/Apple Push
na fizičnem telefonu ostaja obvezen preizkus po konfiguraciji; ni emulirana kot dokaz
produkcijske dostave. Ukazi: `npm test`, `npm run test:e2e`, `npm run build`,
`npm run typecheck`, `npm run test:pwa` po gradnji.
