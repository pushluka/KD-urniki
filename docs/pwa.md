# Namestitev PWA – issue #11

Aplikacija ima manifest, običajni ikoni PNG 192/512, maskable ikono 512,
Apple touch ikono 180 ter prikaz `standalone`. Izvor ikon je `public/icons/source.svg`.
Slovenska navodila za uporabnike so na `/namestitev`, dosegljiva prek povezave
»Namestitev na telefon« na dnu aplikacije.

## Varnost in povezljivost

Service worker `/sw.js` shrani **samo** javni `/offline.html` v lasten predpomnilnik
`kd-urniki-pwa-v1`. Ne shrani aplikacijskega ogrodja, HTML koledarja, RSC odgovorov,
prijave, sej, Auth/REST odgovorov, razporedov, osebnih podatkov ali PDF-jev.
Zahteve, ki jih obdeluje worker, gredo na omrežje z `cache: no-store`, tudi
zahteve na Supabase.
Ob napaki navigacije istega izvora se pokaže samo javno obvestilo. API ali PDF
napaka nikoli ne postane navidezno uspešen odgovor iz predpomnilnika.

Obstoječe shranjevanje seje Supabase Auth se ne spreminja; ni del predpomnilnika PWA.
Namestitev ne doda dovoljenj in ne spremeni RLS. Na skupni napravi je potrebna odjava.
Podatki, ki so že odprti v pomnilniku strani, lahko ostanejo vidni ob prekinitvi
povezave, vendar aplikacija ne obljublja dela ali shranjevanja brez interneta.
Zaščitenih podatkov in mutacij ne postavlja v čakalno vrsto za poznejšo oddajo.

## Posodobitve

Registracija uporablja `updateViaCache: none`; strežnik za `/sw.js` pošilja
`Cache-Control: no-store`. Ob vrnitvi v zavihek se preveri nova različica,
preverjanje izvede tudi brskalnik ob obisku. Nov worker čaka, dokler uporabnik
ne izbere »Posodobi aplikacijo« ali zapre vseh starih oken aplikacije.
Samodejnega ponovnega nalaganja med vnosom ni. Pred potrditvijo shranite vnos.
Drug odprt zavihek se ob prevzemu novega workerja samodejno ne naloži ponovno.

Ob spremembi javne offline strani zvišajte `CACHE` v `public/sw.js`.
Aktivacija odstrani le stare predpomnilnike s predpono `kd-urniki-pwa-`;
ne briše drugih aplikacijskih podatkov, sej ali tujih predpomnilnikov.
Če je potrebna odstranitev PWA, najprej odjavite račun; razvijalec lahko v
DevTools → Application → Service Workers odregistrira worker.

## Pred objavo

- Objavite vejo prek običajnega Vercel builda. Novi ključi, SQL migracija in
  spremembe Supabase Redirect URLs niso potrebni. HTTPS je obvezen (localhost je izjema).
- Preverite javno dostopnost `/manifest.webmanifest`, `/sw.js`, `/offline.html` in
  `/icons/*.png`. Proxy/CDN ne sme predpomniti workerja ali zaščitenih odgovorov.
- Na dejanskem Androidu v Chromu preverite namestitev in zagon iz ikone.
- Na dejanskem iPhonu v Safariju preverite Deli → Dodaj na začetni zaslon in zagon.
  Namestljiva spletna aplikacija lahko zahteva ponovno prijavo.
- V nameščeni aplikaciji preverite prijavo, obvezno spremembo začetnega gesla,
  obnovitev gesla ter pravice vseh treh vlog. Preverite spletne povezave iz e-pošte;
  operacijski sistem jih lahko odpre v ločenem brskalniku.
- V letalskem načinu mora ponovna navigacija pokazati samo javno obvestilo;
  Cache Storage mora vsebovati samo `/offline.html`. Po ponovni povezavi preverite prijavo/urnike.
- Z novo objavo preverite obvestilo o posodobitvi: neshranjen vnos se ne sme izgubiti
  pred uporabnikovo potrditvijo. Pri spremembi offline strani zvišajte različico predpomnilnika.

## Avtomatizirano preverjanje

```
npm test
npm run build
npm run typecheck
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:e2e
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:pwa
```

PWA testi uporabljajo produkcijsko gradnjo in pravi service worker: manifest,
metapodatke, velikosti PNG, Cache Storage, odklop/povezavo in javni fallback.
Preverjajo tudi ročno potrditev posodobitve z emuliranim življenjskim ciklom workerja.
Izvedejo se v Chromiumu na računalniku ter v Android/iPhone mobilnih postavitvah;
to ne nadomesti preizkusa dejanske namestitve v Safariju/iOS.
Obstoječi testi prijave/razporedov blokirajo worker samo zaradi emuliranega Auth
in omrežnih prestreznikov; novi PWA testi ga izrecno omogočijo. Produkcijski podatki
se med testi ne spreminjajo.
