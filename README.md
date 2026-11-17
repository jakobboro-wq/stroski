# Stroški

Osebna aplikacija za sledenje stroškom (PWA): uvoz Revolut izpiskov (Excel/CSV), samodejno razvrščanje, pregled po mesecih in kategorijah.

Podatki se hranijo samo v brskalniku na napravi; v tem repozitoriju je samo koda.

Razvoj: `node dev-server.mjs` → http://localhost:5173

Ločena aplikacija **Nakupi** (`/nakupi/`): samo Shramba, Akcije, Seznam, Izdelki in slikanje računov, z lastno ikono in lastnim računom za sinhronizacijo.

Testi: `node --test` (pred vsakim jutranjim zagonom jih požene tudi workflow).

## Nakupi: akcije, zgodovina cen

Workflow `.github/workflows/akcije.yml` vsak dan:

1. `scraper/deals.mjs` pobere akcije (Tuš, Lidl, Hofer, Mercator Online, Eurospin), doda skupino živila in ceno na kg/l (`js/products.js`). Trgovina, ki ne uspe, obdrži včerajšnje akcije.
2. `scraper/history.mjs` doda dnevni posnetek na vejo `cene` (`days/`, `products.json`) in izračuna `stats.json` (cikli akcij, napoved naslednje) ter `index.json` (vsi izdelki z najnižjo in redno ceno, za Izdelki).
3. `deals.json` (z opombami iz zgodovine) gre na vejo `akcije`.

Cene delnic in skladov z oznako: funkciji `stock_chart` in `stock_search` v Supabase (`supabase/stock-quotes.sql`, enkrat zaženi v SQL Editorju). Brskalnik do Yahoo Finance ne more neposredno (CORS), oznake pa ne smejo v javni repozitorij, zato ne gre prek GitHub Actions.

Aplikacija bere `akcije/deals.json`, `cene/stats.json` in `cene/index.json` z raw.githubusercontent.com. Shramba, seznam in simulacija tečejo samo na napravi (`js/pantry.js`, `js/shoplist.js`, `js/catalog.js`, `js/simulate.js`).
