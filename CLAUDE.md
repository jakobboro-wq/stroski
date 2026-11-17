# Stroški

## Kaj
Osebna aplikacija (PWA, vanilla JS) za stroške, premoženje in ure (RTC). Zavihek Nakupi povezuje slikane račune, akcije trgovin, zalogo, nakupovalni seznam in zgodovino cen. Samo zame.

## Status
- Končano (17. 11. 2026): scraper akcij (Tuš, Lidl, Hofer, Mercator, Eurospin), zgodovina cen na veji `cene`, Shramba, Seznam (optimizacija po trgovinah), simulacija 12 mesecev v Premoženju.
- Naslednji korak: natančnost branja računov (`js/receipt.js`: `parseReceipt`, `qtyOf`, razvrščanje). Sproti prilagajam na prave račune, ki jih pošlje uporabnik (besedilo »Prebrano besedilo« ali slika).
- Odprto: Spar ni vključen (API rabi ključ iz njihove kode, tega ne obidemo); možnost je javni PDF »Znižani favoriti«.
- Cikli akcij se pokažejo šele, ko je izdelek vsaj dvakrat v akciji (od ~decembra 2026).

## Orodja
Node (brez odvisnosti, brez builda), ES moduli v brskalniku, Supabase (šifrirana sinhronizacija nastavitev), GitHub Actions, GitHub Pages.

## Kako poženem
- Razvoj: `node dev-server.mjs` → http://localhost:5173
- Testi: `node --test` (morajo iti skozi pred vsakim commitom; poganja jih tudi workflow)
- Scraper lokalno: `node scraper/deals.mjs`, zgodovina: `node scraper/history.mjs <mapa> <deals.json> [datum]`

## Poti
- GitHub: `jakobboro-wq/stroski` (**javen**, ker ga streže GitHub Pages: https://jakobboro-wq.github.io/stroski/)
- Veje: `main` (koda), `akcije` (dnevni `deals.json`, force push), `cene` (zgodovina cen, nikoli ne prepisuj)
- Workflow: `.github/workflows/akcije.yml`, dnevno (dejansko okoli 11:30–12:45 UTC)
- Osebni podatki: samo v brskalniku in v Supabase (šifrirano), nikoli v repozitoriju

## Konvencije
- Repo je javen: osebni podatki (`*.json`, `*.xlsx`, `*.csv`, …) so v `.gitignore`. Testi uporabljajo samo izmišljene podatke, fiksture so sintetične (ne kopije strani trgovin).
- Ob spremembi datotek aplikacije dvigni `CACHE` v `sw.js` (zdaj `stroski-v27`) in dodaj nove datoteke v seznam `SHELL`.
- Logika brez DOM v `js/*.js` (testirana), prikaz v `js/views/*.js`. Nastavitve, ki naj se sinhronizirajo: `getSetting`/`saveSetting`; `localStorage` samo za stanje UI na napravi.
- Scraper: samo javne strani ali endpointi, ki jih stran sama kliče brez prijave. Zaščit (API ključi, zavrnjeni dostopi) ne obidemo.
- Trgovina, ki pri scrapanju ne uspe ali vrne < 30 % prejšnjega števila, obdrži včerajšnje akcije (`stale: true`).
- Besedila v aplikaciji in komentarji v slovenščini. Denar v EUR, cene na enoto na kg ali l.
- Git identiteta je nastavljena lokalno v repozitoriju.
