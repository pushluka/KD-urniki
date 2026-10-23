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

## Namizni prikaz na telefonu: diagnoza in popravek (mobilni-v3)

Izhodišče je `main` po PR #19 (`be0cb33`); veja Google Calendar ni vključena.
Pregled kode je potrdil en root viewport `width=device-width, initial-scale=1,
viewport-fit=cover`, brez prepovedi zooma. Mobilni breakpoint je 760 **CSS** px,
ne fizičnih pik zaslona. Pri 320–430 CSS px je navigacija zgoraj, glavni del ima
celotno širino, koledar uporablja datirane kartice; desktop ostaja sedemstolpčen.
V korenskih elementih ni `zoom`, `transform: scale` ali desktop `min-width`.
Tudi pregled zgrajenega CSS potrjuje pravilo `@media (max-width:760px)`.
Novi testi preverjajo dejanski `innerWidth`, merilo visualViewport, položaj in
širino navigacije/glavne vsebine ter širino kartice. Samo preverjanje overflowa
ni dovolj: tudi pomanjšana stran s širino 980 px lahko tak test prestane.

**Potrjena vrzel:** PR #19 je spremenil CSS, ni pa spremenil `/sw.js` (ostala je
različica v2). Že odprta PWA ohrani stari dokument in JavaScript/CSS, dokler ni
ponovno naložena. Nespremenjeni worker ne sproži obvestila o novi različici.
Ta popravek spremeni worker na v3 in preveri posodobitve tudi ob vrnitvi v vidno
aplikacijo (`visibilitychange`), ne le ob `focus`. Uporabnik mora potrditi reload;
neshranjeni obrazci se ne zavržejo samodejno. Pri prihodnjih UI izdajah spremenite
različico workerja tudi, če se offline stran ni spremenila. Worker še vedno
shranjuje **samo javni offline dokument**, ne urnikov, prijave, API-jev ali PDF-jev.
Aktivacija dejansko izbriše stare v1/v2 cache; push handlerji ostajajo nespremenjeni.

To ni dokaz, da je bil prav star odprt dokument vzrok uporabnikovega posnetka.
Namizni način brskalnika ali druga objavljena različica lahko povzročita enak
rezultat. Iz tega razvojnega okolja produkcijska domena vrne omrežni CONNECT 403;
fizičen Android/iPhone ni priključen. Zato produkcijske različice in uporabnikovega
viewporta tu ni mogoče neposredno potrditi. Avtomatski Chromium testi emulirajo
mobilne naprave; niso dokaz namestitve ali delovanja na fizičnem telefonu.

### Obvezno preverjanje po objavi na telefonu

1. Preverite, da Vercel produkcijski deployment kaže SHA združenega PR, ne starega
   deploymenta ali druge veje. Odprite `https://kd-urniki.vercel.app/namestitev`.
   V »Preverjanje prikaza« mora pisati **mobilni-v3**. Zapišite širino strani,
   širino zaslona, postavitev, povečavo in način (brskalnik/nameščena aplikacija).
   Meritev ne vsebuje osebnih podatkov in se nikamor ne pošilja.
2. Android Chrome: v meniju ⋮ izključite »Namizno spletno mesto«. Pri običajnem
   prikazu morata biti širina strani in zaslona primerljivi (npr. 393 CSS px),
   postavitev mobilna in začetna povečava 100 %. Vrednost okoli 980 px ob zaslonu
   okoli 393 px kaže na namizni viewport. Ne popravljajte tega z večjimi pisavami.
3. Enako stran odprite iz nameščene ikone PWA. Način mora biti »nameščena
   aplikacija«, različica in širina pa enaki kot v Chromu. Shranite odprte vnose,
   sprejmite »Posodobi aplikacijo«. Če poziva ni (zelo star odprt odjemalec),
   zaprite **vsa** okna PWA in jo z internetno povezavo odprite znova. Ne brišite
   podatkov spletnega mesta: to odjavi uporabnika in lahko prekine push naročnino.
4. S Chrome remote debugging (`chrome://inspect/#devices`, Android USB debugging)
   na dejanskem zavihku/PWA preverite `window.innerWidth`, `screen.width`,
   `visualViewport.scale`, `matchMedia('(max-width: 760px)').matches` in edini
   `meta[name=viewport]`. V Network preverite naloženi CSS (mobilna pravila) in
   `/sw.js` v3 z `Cache-Control: no-store`; Application → Service Workers pokaže
   aktivnega/čakajočega workerja. Cache Storage sme vsebovati le `/offline.html`.
5. Za administratorja, tehnika in hosteso preverite koledar z dolgim naslovom,
   odpiranje/zapiranje dogodka, razpored, ekipo in nastavitve; pri administratorju
   tudi osebje, nov dogodek, obrazce in zgodovino obvestil. Navigacija mora biti
   zgoraj, vsi njeni gumbi dosegljivi, kartice pod datumi in ne sedem ozkih stolpcev.
6. Ponovite pri 320/375/430 CSS px (DevTools device mode za natančne širine),
   povečavi besedila 200 %, pokončno/ležeče ter z Android večjim besedilom.
   Preverite pinch zoom, fokus inputov, tipkovnico, safe-area in odsotnost
   vodoravnega drsenja. Ponovite v Safariju in nameščeni PWA na iPhonu.
7. Ob nadgradnji imejte odprt neshranjen vnos: vrnitev v aplikacijo mora preveriti
   worker, ponuditi posodobitev in ohraniti vnos do uporabnikove potrditve.
   Po potrditvi preverite novo različico ter obstoječa push obvestila. Ne ustvarjajte
   dodatne push naročnine samo zaradi nadgradnje prikaza.

Regresije vključujejo vse tri vloge pri vseh treh širinah, normalne in 200 %
obrazce, dvakratni pinch zoom prek Chromium CDP (`visualViewport.scale = 2` ob
nespremenjenem `innerWidth`), namizno primerjavo, nove posnetke celotne zgornje
mobilne navigacije ter
produkcijsko gradnjo z dejanskim service workerjem. Prag primerjave ostane nespremenjen; obstoječa referenca zgodovine pri 430 px
je popravljena samo zaradi napačne prekrivne maske datuma (opis spodaj).

Pri ponovljenem zagonu se je pokazala tudi nestabilnost obstoječega posnetka
zgodovine: končni PNG je bil identičen referenci, predhodni pa je imel maski
časovnih oznak zamaknjeni za 12 px. Playwright ni dobil dveh zaporednih stabilnih
slik. Slog samo za zajem zdaj isto magenta prekritje datumov izriše na samem DOM
besedilu, namesto s koordinatami Playwright maske pri začasnem povečanju viewporta
za visok element. Test počaka še na omogočen gumb po shranjevanju prebranosti.
Referenca pri 430 px je imela maski napačno zamaknjeni že v izhodišču: del
časovnih oznak je ostal viden. Po vizualnem pregledu je popravljena samo ta
referenca, brez spremembe geometrije panela. Produkcijski CSS in primerjalni
prag ostajata nespremenjena. Preverjanja
širine, reflowa, kontrasta in velikosti kontrol tečejo pred tem na običajnem CSS.
