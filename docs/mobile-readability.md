# Mobilna berljivost

Spremembe izhajajo iz `main`; veja Google Calendar ni vključena. Spremenjeni so
samo predstavitev, CSS, viewport in testi. Supabase, SQL migracije, prijava,
razporejanje, Web Push in zgodovina obvestil nimajo nove poslovne logike.

## Obnašanje

Pri širini do 760 CSS px je osnovna pisava `1rem` (ob običajni nastavitvi 16 px),
sekundarno besedilo najmanj `0.875rem` (14 px), naslovi in dogodki večji. Mobilni
slogi so združeni v en media query, v relativnih enotah, da spoštujejo uporabnikovo
velikost besedila. Gumbi/povezave imajo vsaj 44 × 44 CSS px, vnosna polja najmanj
44 px višine in pisavo 16 px; ni iOS povečave zaradi premajhne vnosne pisave.
Polja in glavni gumbi imajo izrazitejše obrobe oziroma temnejši oranžni kontrast.

Mobilni koledar pokaže iste dogodke kot seznam po datumih: polni dan in datum,
ura, polni naslov in obstoječa oznaka Delam. Prazni dnevi in namizni naslovi
stolpcev se na telefonu ne izpisujejo. Filtriranje, prejšnji/naslednji mesec,
Danes, odpiranje dogodkov in osebni razpored ostanejo obstoječi. Prazen mesec
še vedno pokaže obstoječe obvestilo in delujoče upravljanje meseca.

Navigacija, statistike in obrazci se prerazporedijo; dolga imena/naslovi se
prelomijo. Podrobnosti dogodka se pomikajo znotraj dialoga, zapiranje ostane
dosegljivo tudi pri dnu. Safe-area je upoštevana v glavi, vsebini, dialogih,
prijavnih in offline zaslonih. Pinch zoom ni omejen; ni maximum-scale ali
user-scalable=no. Vodoravnega prelivanja ne skrivamo z overflow-x:hidden.
Namizje ohrani osnovno pisavo 14 px in sedemstolpčni mesečni koledar.
Različica javnega offline predpomnilnika je povečana na v2, da obstoječi PWA
uporabniki dobijo nov offline videz prek obstoječega potrjevanja posodobitve;
Push obdelava ostaja nespremenjena.

## Avtomatizirano preverjanje

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:mobile
```

Če v okolju že obstaja Chromium, lahko nastavite
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/pot/do/chromium`.
Testni strežnik uporablja port 3100; testov `test:e2e` in `test:mobile` ne
zaganjajte sočasno, ker oba upravljata svoj strežnik na tem portu.

`playwright.mobile.config.ts` preveri širine **320, 375 in 430 px** ter
namizje 1440 px. Pri 320/375 uporablja iPhone user agent, pri 430 Android;
vsi so Chromium emulacija. Preizkusi zajemajo administratorja, tehnika in
hosteso: prijavo, koledar, dolge naslove brez presledkov, podrobnosti, osebne
razporede, ekipo, nastavitve, zgodovino s spremembo prebranosti, osebje,
ustvarjanje računa in dogodka, prvo geslo ter obnovitveni obrazec. Tehnik
lahko tudi shrani svoje ure. Obstoječi funkcionalni E2E testi ostanejo vključeni.

Testi izmerijo dimenzije interaktivnih elementov, kontrast besedila (najmanj 4,5 : 1), pisave polj/sekundarnega
besedila, prelivanje strani/dialogov, dostopnost zapiranja, vidni fokus,
neoomejevanje zooma ter prerazporeditev pri **200 % besedilu**. Vizualne
primerjave uporabljajo pregledane PNG reference v `tests/mobile/__screenshots__`.
Čas obvestil je maskiran, začetno dovoljenje obvestil deterministično nastavljeno na neizbrano, lokalni Next dev indikator skrit samo pri posnetku;
podatki prihajajo iz izoliranih testnih Auth/SQL fixture, ne produkcijskih nadomestkov.

Reference se spreminjajo samo ob namerni vizualni spremembi in po pregledu:

```sh
npm run test:mobile -- --update-snapshots
```

CI po obstoječih testih zažene tudi mobilne primerjave. Za ostale regresije:

```sh
npm test
npm run test:e2e
npm run build
npm run typecheck
npm run test:pwa
```

## Preverjanje na napravah

Chromium emulacija ne nadomesti pravega Safarija. Prenos WebKit v tem delovnem
okolju ni uspel (CDN 403), zato native iOS preverjanje ni označeno kot opravljeno.
Pred objavo na testni namestitvi preverite Android Chrome in iPhone Safari/PWA:

- Vse tri vloge, dolge naslove/imena, več dogodkov istega dne ter prazen mesec.
- Koledar, Moj razpored, podrobnosti in ure; pri drsenju mora biti Zapri dosegljiv.
- Prijavo, pozabljeno/novo/prvo geslo, osebje, obrazce in nastavitve obvestil.
- Fokus datumskih/časovnih polj ob odprti tipkovnici; brez samodejnega zooma zaradi
  majhne pisave in z dosegljivimi gumbi po drsenju.
- Večje sistemsko besedilo, pinch zoom, pokončno/ležeče, izreze in spodnji home indikator.
- Delovanje obstoječih Push dovoljenj, prebranosti in odpiranja povezane prireditve.

SQL migracija in dodatne Supabase/Vercel okoljske spremenljivke niso potrebne.

### Zanesljivo odpiranje obrazca za obnovitev

Napaka Actions pri `forgot-password.png` (pričakovano 296 × 518, prejeto 288 × 450)
ni bila sprememba postavitve: prejeti posnetek je bil še vedno začetna prijava.
Oba zaslona uporabljata `.login`, klik Next Link pa ne zagotavlja, da je počasna
odjemalska navigacija že zaključena. Pred meritvami in posnetkom test zdaj preveri
URL ter naslov in e-poštno polje obnovitvenega obrazca. Obstoječe PNG reference
in prag vizualne primerjave so ohranjeni.

Regresijski test zadrži odgovor navigacije do izrecne sprostitve in preveri, da
stara prijava ne šteje kot odprta obnovitev. Ne uporablja fiksnih čakalnih časov.
Obnovitveni obrazec se dodatno preveri pri 200 % besedilu: velikost pisave vnosov,
vidni fokus, dosegljivost gumba, kontrast in odsotnost horizontalnega prelivanja.

Za CI produkcijsko gradnjo sta javni spremenljivki Supabase nastavljeni na iste
neveljavne testne vrednosti kot pri brskalniških fixture (`e2e.supabase.test`,
`test-public-key`). Next.js ju vgradi ob `npm run build`; nastavitev šele pri
`next start` ne zadostuje. Tako PWA preizkus posodobitve dobi prijavni obrazec
namesto opozorila o manjkajoči konfiguraciji, brez pravih ključev ali dostopa do
produkcijskih podatkov. Vercel produkcija še vedno uporablja svoje nastavitve.
