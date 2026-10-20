# KD Grosuplje – Urniki

Next.js 16, React 19, TypeScript, Tailwind CSS 4 in Supabase. Slovenski odzivni vmesnik brez demonstracijskih podatkov.

## Lokalni razvoj

Zahtevan Node.js 24 in npm. Uporabite obstoječi checkout; novo delovno drevo ni potrebno.

```sh
npm ci --cache /workspace/.npm
cp .env.example .env.local
npm run dev
```

V `.env.local` nastavite `NEXT_PUBLIC_SUPABASE_URL` in `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` iz svojega projekta Supabase (Project Settings → API). Uporabite javni publishable ključ, nikoli service_role ali skrivnega ključa. Spremenljivki sta namenoma javni; podatke varuje RLS. Po spremembi ponovno zaženite razvojni strežnik; produkcijo ponovno zgradite. Brez nastavitev se pokaže obvestilo, podatki se ne simulirajo.

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

Prva različica nima e-poštnih obvestil, samodejnega preprečevanja prekrivanj ali administracijskega vmesnika za ustvarjanje uporabnikov. Razporeditve administrator preveri v koledarju.
