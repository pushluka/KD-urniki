# Google Koledar – samo moje delo

## Obseg in uporabniški potek

Aktiven tehnik ali hostesa po spremembi začetnega gesla v **Nastavitvah** prostovoljno
izbere **Poveži Google Koledar**. Prijava v KD Urniki še vedno uporablja Supabase;
Google povezava je ločena integracija in ne zamenja prijave. Administrator nima
Google povezave. Nepovezani uporabniki nimajo opravil niti prenosov v Google.

Po soglasju uporabnik potrdi namenski sekundarni koledar **KD Urniki – Moje delo**.
Aplikacija zahteva samo `https://www.googleapis.com/auth/calendar.app.created`.
Ne zahteva dostopa do vseh koledarjev, e-pošte ali osebnega profila in ne kliče
`calendarList.list`. Namenski koledar je uporabnikova izbrana destinacija; izbire
osebnih obstoječih koledarjev namenoma ni.

Začetna uskladitev zajame trenutne dodelitve. Vsak vnos vsebuje naslov in lokacijo
(Kulturni dom, Družbeni dom, Druga lokacija) ter **uporabnikov prihod in zaključek**.
Termin predstave je samo pojasnilo v opisu. Baza hrani `timestamptz`, Google prejme
natančna UTC trenutka z `timeZone: Europe/Ljubljana`; poletni/zimski čas se ne računa
z ročnim prištevanjem ur. Ne prenašamo razporedov drugih ljudi ali PDF dokumentov.

Sprememba lastnih ur ali naslova/lokacije/termina posodobi isti vnos. Odstranitev
razporeditve ali dogodka odstrani samo preslikani aplikacijski vnos z ustreznima
zasebnima označevalcema. Tuji ali ročno zamenjani vnos ostane nedotaknjen in povzroči
`event_conflict`. Ročno izbrisani aplikacijski vnos se ob naslednji uskladitvi obnovi
z novim ID; Google tombstone se ne uporablja znova.

**Prekini Google Koledar** najprej lokalno ustavi sinhronizacijo, izbriše žetone in
opravila, nato poskusi preklicati dovoljenje pri Googlu. Že ustvarjeni vnosi ostanejo;
to jasno pove UI pred odklopom. Zahteva, ki jo je Google že prejel pred odklopom,
se lahko še zaključi. Ponovna povezava z istim Google računom ponovno uporabi
namenski koledar in uskladi sedanje dodelitve ter stare preslikave (tudi odstranitve
med odklopom). Pri drugem Google računu stari vnosi v prejšnjem računu ostanejo.
Gumb **Ponovno uskladi moje dodelitve** omogoči ročno ponovno uskladitev.

## Supabase migracija

1. Najprej varnostna kopija in ločen testni Supabase projekt z vsemi dosedanjimi
   migracijami iz `main`.
2. V SQL Editor izvedite **celotno**
   [`202610230001_google_calendar.sql`](../supabase/migrations/202610230001_google_calendar.sql)
   enkrat, v transakciji; ali uporabite običajni Supabase CLI migration deploy.
   Prejšnjih migracij ne ponavljajte.
3. Migracija doda štiri zasebne tabele `google_calendar_*`, RLS, privilegirane RPC
   in dodatne sprožilce na dodelitvah/dogodkih/profilih. Ne spreminja obstoječih
   računov, gesel, vlog, delovnih razporedov, Push vrste ali zgodovine obvestil.
4. Iz brskalnika nimata `anon` in `authenticated` niti dostopa do tabel niti pravice
   klicati RPC. API vsakič preveri Supabase Auth, veljavnost prijave, aktiven profil,
   prvo geslo in vlogo; uporabniški ID vedno vzame iz preverjene prijave.
5. Po uspešnem preizkusu izvedite novo migracijo v produkciji **pred objavo kode**.
   RLS ostane vklopljen. Migracije nismo izvedli v vašem produkcijskem projektu.

## Google Cloud in soglasje

1. V Google Cloud ustvarite namenski projekt in omogočite **Google Calendar API**.
2. Google Auth Platform → Branding/Audience/Data Access: nastavite resnično ime
   aplikacije, podporni kontakt, domeno, domačo stran in javno politiko zasebnosti
   `https://kd-urniki.vercel.app/zasebnost/google`. Pred javno uvedbo objavite dejanskega
   upravljavca in kontakt; pripravljena stran ni nadomestilo za vaše pravne podatke.
   Domena mora biti pod vašim nadzorom; za verifikacijo je lahko potrebna lastna
   preverjena domena namesto skupne domene `vercel.app`.
3. Izberite Internal samo za upravičeno Google Workspace organizacijo; sicer External.
   Za varno testiranje pustite **Testing** in dodajte le namenski testni Google račun.
   Nastavite izključno scope `calendar.app.created`. Ne dodajajte `calendar`,
   `calendar.events.owned` ali dovoljenja za seznam koledarjev.
4. Credentials → OAuth Client ID → **Web application**. Authorized redirect URI:
   `https://kd-urniki.vercel.app/api/google/callback` (natančno, brez končne poševnice).
   Za lokalno testiranje dodajte `http://localhost:3000/api/google/callback` v ločenem
   testnem OAuth klientu. Redirect URI se vedno izpelje iz strežniškega `APP_URL`.
   Preview ne deluje z naključno domeno brez posebej registriranega URI in APP_URL;
   uporabite stalno testno domeno ter ločen Supabase projekt in OAuth klient.
5. Shranite Client ID in Client Secret samo v strežniško konfiguracijo. Ni potrebe
   po vklopu Google ponudnika v Supabase Auth ali dodatnem Supabase Redirect URL:
   to je samostojen OAuth potek, ne Supabase social login.

**Ali je potrebna Google verifikacija?** Izbrani `calendar.app.created` je ožji scope
za koledarje aplikacije; pred javno objavo preverite njegovo trenutno klasifikacijo
v Google Auth Platform → Data Access. Google zahteva preverjanje dostopa pri zunanjih
produkcijskih aplikacijah, če so uporabljeni scopes označeni Sensitive/Restricted;
za obseg, označen Non-sensitive, samo preverjanje občutljivega dostopa ni potrebno.
Ločeno lahko zahteva branding/domain verification. Končno zahtevo prikaže konzola;
ta PR ne pomeni opravljene Googlove verifikacije. Uporabite
[uradno tabelo obsegov](https://developers.google.com/workspace/calendar/api/auth)
in [zahteve OAuth verification](https://support.google.com/cloud/answer/9110914).

V External Testing so dostopni samo dodani testni uporabniki (običajno največ 100).
Refresh žetoni pri koledarskih scopes v testnem režimu praviloma potečejo po sedmih
dneh; to ni napaka vrste in zahteva ponovno povezavo. Za javno uporabo zaključite
Googlov produkcijski postopek. Testirajte s testnimi Google in KD računi brez resničnih
službenih/osebnih podatkov; preverite odklop in preklic dovoljenja v Google Security.

## Vercel in šifriranje

V varnem lokalnem okolju izvedite:

```sh
node scripts/generate-google-key.mjs
```

Skript ustvari prezrto `.env.google.local` (0600) in ne izpiše skrivnosti oziroma ne
prepiše obstoječega ključa. Next.js je ne naloži samodejno; za lokalni razvoj vrednost
varno prenesite v `.env.local`. Na Vercelu nastavite Production (ločeno tudi testno okolje):

| Spremenljivka                 | Nastavitev                                               |
| ----------------------------- | -------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`            | Google Web OAuth Client ID, samo strežniška nastavitev   |
| `GOOGLE_CLIENT_SECRET`        | Google Client Secret, Secret/Sensitive                   |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Base64 32 naključnih bajtov iz skripta, Secret/Sensitive |
| `APP_URL`                     | `https://kd-urniki.vercel.app`, brez poti                |
| `CRON_SECRET`                 | obstoječa zasebna skrivnost periodičnega izvajanja       |
| `SUPABASE_SERVICE_ROLE_KEY`   | obstoječa zasebna strežniška nastavitev                  |
| `PRIVACY_CONTACT_EMAIL`       | dejanski javni kontakt za zasebnost                      |

Nobena Google spremenljivka ne uporablja `NEXT_PUBLIC_`. Objavite z Redeploy po
migraciji. Brez Google nastavitev so Nastavitve jasne, ostale funkcije delujejo.
Access/refresh žetoni in kratkotrajni OAuth kode/PKCE so v bazi šifrirani AES-256-GCM
z naključnim IV in vezavo na uporabnika/namen. OAuth state je naključen, zgoščen v bazi,
vezan na HttpOnly SameSite cookie, prijavljenega uporabnika, generacijo povezave in
trenutno stanje začetnega gesla; velja deset minut in je enkraten. Povratna stran
ne dobi Google žetonov ali kode. Odgovori so no-store, referer se ne pošilja, API
ne zapisuje Googlovih teles napak/žetonov v dnevnike. PWA jih ne predpomni.

Šifrirni ključ varno varnostno kopirajte ločeno od baze. Ne menjajte ga ob redeployu.
Za rotacijo je potrebna nadzorovana ponovna enkripcija ali odklop vseh povezav in
ponovno soglasje; samo zamenjava spremenljivke onemogoči branje obstoječih žetonov.
Deaktivacija, prisilna menjava gesla ali sprememba vloge v administratorja prekliče
lokalno povezavo. Navadna odjava ne ustavi prostovoljno vključene strežniške sinhronizacije.
Preslikave (ID, označevalci) in zadnje stanje opravil ostanejo za ponovno povezavo;
ni kopije vsebine vseh Google dogodkov. Izbris profila kaskadno izbriše podatke
integracije; Google vnosi ostanejo. Administrator lahko na zahtevo najprej izvede
`google_disconnect(user_id)` in nato izbriše uporabnikove preslikave/povezavo prek
zaupanja vredne administracije; to lahko ob kasnejši povezavi ustvari nov namenski
koledar. Ne brišite preslikav med aktivno povezavo.

## Zanesljivo izvajanje tudi ob zaprti PWA

Uporabimo **obstoječi** `GET /api/push/dispatch` z `Authorization: Bearer <CRON_SECRET>`.
Dodaten Cron ni potreben, mora pa obstoječi zares teči vsako minuto. Konfiguracija
je opisana v [Web Push navodilih](web-push.md#vapid-in-vercel): Vercel načrt z minutnim
Cron ali zaupanja vreden zunanji razporejevalnik. Hobby dnevni Cron za ta cilj ni
primeren. Brez periodičnega izvajanja ni zagotovljene sinhronizacije pri zaprti aplikaciji.
Po objavi preverite uspešne klice in dejansko praznjenje vrste; zgolj odprt brskalnik
ni preizkus samodejnega izvajanja. Obstoječi administratorski POST je dodatna pospešitev.

Google in Push se izvajata neodvisno, vsak s svojo preverjeno avtorizacijo. Google
napaka ne blokira Push dostave/14-dnevnega čiščenja zgodovine. Odgovor skupnega
endpointa ostaja Push odgovor, zato Google spremljajte tudi prek lastnega stanja/vrste.
Omejitev skupne funkcije je zdaj 60 sekund. Vsak klic prevzame do tri uporabnike in
po eno opravilo za vsakega; pri večjem obsegu spremljajte zaostanek ter povečajte
pogostost/kapaciteto. SQL `FOR UPDATE SKIP LOCKED` in dvominutni lease preprečita
prekrivanje; posamezne Google zahteve imajo šestsekundni timeout. Opravila se združujejo
po uporabniku/dogodku z revizijami, ne kopirajo zastarelih vsebin dodelitev.

Ponovni poskusi imajo eksponentni odmik od 60 sekund do ene ure, največ 15 poskusov.
Po izčrpanju preverite `last_error` in število `attempts` v zasebni vrsti ter odpravite
vzrok; uporabnik lahko ponovno uskladi svoje dodelitve. Novi urejeni podatki prav tako
ponovno odprejo opravilo. `invalid_grant` odstrani žetone in zahteva ponovno povezavo;
403 dovoljenja ali manjkajoč koledar ustavijo vrsto do uporabniškega ukrepa. Omejitve
kvote, 429, 5xx in omrežne napake se ponovijo. Potekli OAuth zapisi se čistijo ob dispatchu.

ID Google dogodka in zasebni označevalci se shranijo **pred** prvim insertom. Izgubljeno
potrdilo zato naslednji poskus razreši z GET istega ID, brez novega vnosa. Pred PATCH
ali DELETE se preverita oba označevalca, pogoj If-Match varuje pred sočasnim prepisom.

Google `calendars.insert` pa nima uporabniško izbranega ID/idempotency ključa. Zato
je **ustvarjanje namenskega koledarja enkraten poskus** z vnaprej shranjenim namenom.
Če odgovor izgine, ne ponavljamo ustvarjanja. UI pokaže obnovitev: v Google Koledarju
odprite nastavitve »KD Urniki – Moje delo« → Integrate calendar → Calendar ID in ga
vnesite. Strežnik preveri lastništvo in zasebni namenski označevalec v opisu koledarja.
Drugi koledarji so zavrnjeni. Če koledar ni nastal, naj administrator najprej preveri
Google UI z uporabnikom in šele nato v zaupanja vrednem SQL Editor ponastavi
`provision_started_at=null` za to povezavo; ne naredite tega na slepo, saj lahko
povzroči dvojnik. To je tudi varen postopek po odstranitvi ali spremembi opisa koledarja.

## Sprejemni preizkusi pred produkcijo

Avtomatizirano: `npm test`, `npm run typecheck`, `npm run build`, `npm run test:e2e`
(Chromium računalnik/telefon), `npm run test:pwa` (dejanski service worker po gradnji).
Google transport in Supabase Auth v testih sta emulirana; SQL migracije/RLS so dejanske.
Brez produkcijskih Google poverilnic in soglasja nismo preverili pravega Google računa
ali sistemskega delovanja na iPhonu/Androidu. To preverite na testni namestitvi:

1. Nepovezan tehnik: dodelitev ne ustvari opravila; administrator nima gumba Google.
2. Povežite testnega tehnika in hosteso z različnima Google računoma. Vsak vidi samo
   svoje dodelitve v svojem namenskem koledarju; seznam osebnih koledarjev ni zahtevan.
3. Dodelite, spremenite ime/lokacijo/termin/lastne ure in odstranite osebo. Število
   vnosov ostaja eno; posodobljen je isti ID; osebni Google vnosi ostanejo nedotaknjeni.
4. Ponovite dispatch, ponovno začetno uskladitev, prekinitev/povezavo in izgubljeni
   odgovor. Preverite, da ni dvojnikov in da zamujena odstranitev dobi pravo brisanje.
5. Zaprite vse zavihke/PWA. Spremenite dodelitev in počakajte na dejanski Cron.
   Preverite Google vnos, lastna obvestila in administratorsko zgodovino z vseh naprav.
6. Preverite datume pozimi/poleti ter prehod 29. 3. in 25. 10. 2026. Google prikaže
   dejanske osebne ure v Europe/Ljubljana, tudi kadar se razlikujejo od predstave.
7. Prekličite soglasje v Google računu; UI zahteva ponovno povezavo, žetoni se izbrišejo.
   Preverite CSRF/napačen račun/ponovitev callbacka ter nedostopnost vseh zasebnih tabel.

Ti koraki ne vključujejo samodejne združitve v main, produkcijske migracije ali prenosa skrivnosti.

### Povezovanje iz nameščene PWA na iPhonu

OAuth odpre Googlov prijavni zaslon. iOS lahko preusmeritev iz nameščene PWA odpre
v ločenem Safariju, ki ne deli prijave/piškotka s PWA. Če se zato povezava ne potrdi,
v Safariju odprite KD Urniki, prijavite se z istim KD računom in začnite povezovanje
v njegovih Nastavitvah. Po potrditvi se vrnite v PWA; povezava je shranjena na strežniku
in se pokaže ob osvežitvi Nastavitev. Ne izklapljajte zaščite state/piškotka in ne
prenašajte Supabase ali Google žetonov prek URL. Po začetni povezavi delovanje Cron
ni vezano na odprt Safari ali PWA. Ta povratni potek je treba preveriti na dejanskem iPhonu.
