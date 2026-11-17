# Stroški

## Kaj
Osebna aplikacija (PWA, vanilla JS) za stroške, premoženje in ure (RTC). Zavihek Nakupi povezuje slikane račune, akcije trgovin, zalogo, nakupovalni seznam in zgodovino cen. Celotna aplikacija je samo zame; ločena aplikacija **Nakupi** (`nakupi/`, samo Shramba, Akcije, Seznam, računi) je tudi za punco.

## Status
- Končano (17. 11. 2026): scraper akcij (Tuš, Lidl, Hofer, Mercator, Eurospin), zgodovina cen na veji `cene`, Shramba, Seznam (optimizacija po trgovinah), simulacija 12 mesecev v Premoženju.
- Naslednji korak: natančnost branja računov (`js/receipt.js`: `parseReceipt`, `qtyOf`, razvrščanje). Sproti prilagajam na prave račune, ki jih pošlje uporabnik (besedilo »Prebrano besedilo« ali slika).
- Nakupi za punco (17. 11. 2026): ločeni podatki, vsak ima svoj račun in svoj trezor. Pozneje morda skupno gospodinjstvo: skupna Shramba in Seznam (nastavitvi `pantry`, `shoplist` in računi) v ločenem skupnem šifriranem prostoru s svojim geslom, ne v osebnem trezorju.
- Statistika (17. 11. 2026): Pregled → Statistika (`js/statistics.js`, `js/views/statistics.js`).
- Knjižnica izdelkov (17. 11. 2026): Nakupi → Izdelki (`js/catalog.js`, `js/views/catalog.js`). Izdelek združi različna imena po trgovinah (iskalna imena, izločene besede, ročno ✓/✗ po imenu) in pokaže, kje je zdaj najceneje, preračunano na isto velikost. Zgodovina iz `index.json` na veji `cene` (piše ga `scraper/history.mjs`). Namen: nabava sladkarij za hladilnik v službi.
- Cene delnic (17. 11. 2026): delnice in skladi z oznako (ticker) dobijo ceno enkrat na dan prek Supabase funkcije `stock_chart` (`supabase/stock-quotes.sql`, Yahoo Finance; uporabnik jo mora zagnati v SQL Editorju). Oznake ne gredo v javni repozitorij. Volatilnost za simulacijo se izmeri iz zadnjega leta cen; pričakovani donos ostane predpostavka.
- Odprto: Spar ni vključen (API rabi ključ iz njihove kode, tega ne obidemo); možnost je javni PDF »Znižani favoriti«.
- Cikli akcij se pokažejo šele, ko je izdelek vsaj dvakrat v akciji (od ~decembra 2026).

## Orodja
Node (brez odvisnosti, brez builda), ES moduli v brskalniku, Supabase (šifrirana sinhronizacija nastavitev), GitHub Actions, GitHub Pages.

## Kako poženem
- Razvoj: `node dev-server.mjs` → http://localhost:5173 (Nakupi: http://localhost:5173/nakupi/)
- Testi: `node --test` (morajo iti skozi pred vsakim commitom; poganja jih tudi workflow)
- Scraper lokalno: `node scraper/deals.mjs`, zgodovina: `node scraper/history.mjs <mapa> <deals.json> [datum]`

## Poti
- GitHub: `jakobboro-wq/stroski` (**javen**, ker ga streže GitHub Pages: https://jakobboro-wq.github.io/stroski/, Nakupi: https://jakobboro-wq.github.io/stroski/nakupi/)
- Veje: `main` (koda), `akcije` (dnevni `deals.json`, force push), `cene` (zgodovina cen, nikoli ne prepisuj)
- Workflow: `.github/workflows/akcije.yml`, dnevno (dejansko okoli 11:30–12:45 UTC)
- Osebni podatki: samo v brskalniku in v Supabase (šifrirano), nikoli v repozitoriju

## Konvencije
- Repo je javen: osebni podatki (`*.json`, `*.xlsx`, `*.csv`, …) so v `.gitignore`. Testi uporabljajo samo izmišljene podatke, fiksture so sintetične (ne kopije strani trgovin).
- Ob spremembi datotek aplikacije dvigni `CACHE` v `sw.js` in dodaj nove datoteke v seznam `SHELL`.
- Nakupi (`nakupi/index.html`, `js/nakupi.js`, `js/views/shop-settings.js`) uvažajo iste module kot Stroški. Pogledi Nakupov ne smejo uvažati ničesar, kar rabi elemente samo iz glavnega `index.html` (npr. `dialog.js`, `txDialog`).
- Logika brez DOM v `js/*.js` (testirana), prikaz v `js/views/*.js`. Nastavitve, ki naj se sinhronizirajo: `getSetting`/`saveSetting`; `localStorage` samo za stanje UI na napravi.
- Scraper: samo javne strani ali endpointi, ki jih stran sama kliče brez prijave. Zaščit (API ključi, zavrnjeni dostopi) ne obidemo.
- Trgovina, ki pri scrapanju ne uspe ali vrne < 30 % prejšnjega števila, obdrži včerajšnje akcije (`stale: true`).
- Besedila v aplikaciji in komentarji v slovenščini. Denar v EUR, cene na enoto na kg ali l.
- Git identiteta je nastavljena lokalno v repozitoriju.
