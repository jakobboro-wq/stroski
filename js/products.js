// Izdelki: skupine živil, velikost pakiranja in cena na kg/l.
// Uporabljajo ga scraper akcij (Node) in aplikacija (akcije, računi, zaloga), zato brez brskalnika in brez uvozov.

/** Skupine za filtre in zalogo. food: false = ni hrana. */
export const GROUPS = [
  { id: 'sadje', name: 'Sadje in zelenjava', emoji: '🥦' },
  { id: 'meso', name: 'Meso, ribe in narezki', emoji: '🥩' },
  { id: 'mlecni', name: 'Mlečni izdelki in jajca', emoji: '🧀' },
  { id: 'kruh', name: 'Kruh in pekovsko', emoji: '🥖' },
  { id: 'shramba', name: 'Shramba', emoji: '🥫' },
  { id: 'zajtrk', name: 'Zajtrk, kava in čaj', emoji: '☕' },
  { id: 'sladko', name: 'Sladko in prigrizki', emoji: '🍫' },
  { id: 'zamrznjeno', name: 'Zamrznjeno', emoji: '🧊' },
  { id: 'pripravljeno', name: 'Pripravljene jedi', emoji: '🍕' },
  { id: 'pijace', name: 'Pijače', emoji: '🥤' },
  { id: 'alkohol', name: 'Alkohol', emoji: '🍷' },
  { id: 'drogerija', name: 'Drogerija in čistila', emoji: '🧴', food: false },
  { id: 'zivali', name: 'Hišni ljubljenčki', emoji: '🐾', food: false },
  { id: 'drugo', name: 'Ostalo', emoji: '📦', food: false },
].map(g => ({ food: true, ...g }));
export const GROUP = Object.fromEntries(GROUPS.map(g => [g.id, g]));
export const isFoodGroup = id => GROUP[id]?.food === true;

// Male črke brez šumnikov (enako kot categorize.normalize, a brez uvoza, da dela tudi v scraperju).
export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// Besede se iščejo od začetka besede (\b), da »čajne lučke« ne postanejo čaj.
const re = words => new RegExp(`\\b(?:${words})`);

// 1. Ime, ki zanesljivo ni hrana (gre pred vse ostalo).
const NAME_NONFOOD = [
  ['zivali', re('hrana za (?:pse|psa|mack|ptic|zival)|za pse\\b|za macke\\b|briketi|posip za mack|pasj|macj')],
  ['drogerija', re('sumece tablet|tablete\\b|razmascevalec|prehransko dopolnil|krpic|duda\\b|dude\\b|gobic|cistil|detergent|pralni prasek|prasek za pranje|gel za pranje|mehcalec|pomivaln|tablete za pomivalni|sampon|balzam za lase|gel za tusiranje|tusirni|zobn[ae] (?:pasta|scetk)|ustna voda|toaletni papir|robck|plenic|vlazilni robc|dezodorant|antiperspirant|krema za (?:obraz|roke|telo|soncenje)|losjon|milo\\b|tekoce milo|higienski vlozk|vlozki|tamponi|britvic|brivn|papirnat[ae] brisac|kuhinjske brisac|vreck[ae] za smeti|folija|alu folij|papir za peko|osvezilec|odstranjevalec|wc |kosmetik|maskara|sminka|parfum|lak za nohte')],
  ['drugo', re('zvezek|zvezki|knjig|koledar|pisal|markerj|lepilo|predpraznik|termofor|deznik|ocala|skornj|garnitur|rjuh|servis\\b|servirni|pogrinj|prt\\b|plisast|snezna krogl|krogl[ei]\\b|drevo|venck|spalna vreca|druzabna igra|puncka|kocke\\b|grizalo|steklenick|led-|(?<!sladoledne )lucke|lucka|svetilk|zarnic|led[- ]|grelnik|kamera|termostat|orodj|vrtalnik|izvijac|kabel|polnilec|baterij|zvocnik|slusalk|igrac|lego|sestavljank|regal|klop |omar|stol\\b|stoli\\b|miz[ae]\\b|preprog|zaves|odej|blazin|prevlek|posteljnin|brisac[ae]? za|kopalni plasc|nogavic|majic|hlace|jakn|copat|cevlj|pulover|pizam|rokavic|kapa\\b|sal\\b|torb|nahrbtnik|kovcek|posod[ae]\\b|lonec|ponev|pekac|krozni|kozarc|skodelic|jedilni pribor|nozi?\\b|deska za|termovk|steklenica za|darilna|okrasek|okrasn|svec[ak]|vaza|okvir|ura\\b|budilk|rastlina\\b|rastline\\b|loncnic|cvetj|seme za|zemlja za|gnojil|kolo\\b|celad|smuc|sanke|avto|zascitna|komplet za|pripomoc|mas[aä]zn|tehtnic|sesalnik|likalnik|fen\\b|kuhalnik|mesalnik|sokovnik|cvrtnik|aparat')],
];

// 2. Alkohol po imenu (kis in brezalkoholno gresta drugam).
const ALCOHOL = re('malvazij|refosk|teran\\b|muskat|cabernet|merlot|sauvignon|chardonnay|rebula|cvicek|rizling|pinot|modra frankinja|barbera|chianti|lambrusco|pivo|piva\\b|lager|radler|vino\\b|vina\\b|vinski? (?!kis)|penec[ae] vin|prosecco|sampanj|zganj|slivovk|viljamovk|travaric|borovnicevec|pelinkovec|liker|vodk|viski|whisk|rum\\b|gin\\b|tekil|konjak|brandy|jabolcnik|cider|aperol|spritz|amaro|vermut');
const NOT_ALCOHOL = re('brezalkohol|vinski kis|kis\\b|0[,.]0 ?%');

// 3. Kategorija trgovine (Tuš, Lidl, Mercator). Splošne kategorije (»vse za otroka«, »sezona«) ne odločajo.
const HINTS = [
  ['zivali', re('zival|ljubljenck|hrana za (?:mack|pse|ptic)')],
  ['drogerija', re('kozmetik|nega|higien|cistil|pranje|pralna|papirni|gospodinjstvo nezivila|vzdrzevanje doma|lepota|higienicni papir|cisceni')],
  ['alkohol', re('vino|pivo|zganj|prosecco|liker|penece')],
  ['zamrznjeno', re('zamrzn|mrazen|sladoled')],
  ['shramba', re('konzerv|osnovna zivila|shramba|testenin|riz|juhe|zacimb|omak|olja|sestavine za peko|strocnic|tuja prehrana|hrana tujih')],
  ['meso', re('meso|mesni|ribe|klobas|narezk|svinjin|govej|perutnin')],
  ['mlecni', re('mlecni|mleko|sir\\b|jogurt|jajca|smetan')],
  ['sladko', re('sladkar|cokolad|sladk|bonbon|piskot|prigrizk|slani|slastne|orescki|suho sadje|sladic')],
  ['kruh', re('pekarn|kruh|pecivo|toast')],
  ['zajtrk', re('topli napitki|kava|caj|kakav|zajtrk|zita|musli|namaz|marmelad|med\\b')],
  ['sadje', re('sadje|zelenjav|solat')],
  ['pripravljeno', re('pripravljen|delikates|sveza in pripravljena|pizz|pica')],
  ['pijace', re('pijac|sok|voda|napitk')],
  ['drugo', re('igrac|moda|oblacil|spalnic|dekoracij|orodj|razsvetljav|vrt|cvetje|dnevna soba|kuhinj|aparat|multimedij|sola|pisarn|tekstil|trafika|delavnic|ogrevanje|hodnik|shranjevanje|posoda|sport|oprema')],
];

// 4. Ime izdelka (za Hofer, Eurospin, račune in splošne kategorije). Vrstni red šteje.
const NAME_FOOD = [
  ['zamrznjeno', re('zamrznjen|globoko zamrz|sladoled|sladoledn|mrazen')],
  ['pripravljeno', re('burger|odscipanc|pica\\b|pizza|lazanj|burek|sendvic|tortelin|ravioli|rizot|pripravljena jed|gotova jed|cordon|nugget|falafel|sushi|solata s |kebab')],
  ['sladko', re('pralin|medenjak|mandolat|konfet|penice|kremne rezine|zavitek|strudel|ploscica|cokolad|bonbon|bonbonier|piskot|keks|vaflj|vafelj|napolitank|cips|flips|smoki|krekerj|prigrizek|prigrizk|grickalk|oresk|lesnik|mandelj|arasid|pistacij|indijsk|zelejck|gumi|sladic|tort[ae]\\b|palacink|kremsnit|puding|nutell|marcipan|piskoti|rogljick[ia]? s|kroasan|muffin|krofi?\\b|potic|panetton|lizik|zvecilk')],
  ['shramba', re('kompot|margarin|lutenic|jesprenj|kasa\\b|kase\\b|bazilik|rozmarin|drobnjak|origano|timijan|lovor|mesanica zit|testenin|spaget|peresnik|svedrc|polzk|metuljck|rezanc|mlinc|njok|lazanj|riz\\b|riza\\b|basmati|jasmin|moka\\b|moke\\b|sladkor|sol\\b|olje|oljcn|kis\\b|omak|pesto|kecap|majonez|gorcic|zacimb|vanilj|cimet|poper|paprika mleta|konzerv|fizol|cicerik|lec[ae]?\\b|grah\\b|koruz[ae]? (?:sladk|v)|sladka koruza|paradiznikov[ae] (?:omak|pulp|mezg|koncentr)|pulpa|pelat|juh[ae]?\\b|minestr|bujon|jusn|kumarice|kislo zelje|rdeca pesa|olive|tunin|sardin|kvas\\b|pecilni|zdrob|polent|kus ?kus|ovsen[ie] kosmic|kosmici|zitaric|kokosov[ao] mleko')],
  ['meso', re('meso\\b|mesn|piscan|piscanc|puran|svinjsk|svinin|govej|govedin|telec|jagnj|mlet[oa] meso|zrezek|zrezki|file\\b|fileji|losos|tun\\b|riba\\b|ribj|ribe\\b|kozic|lignj|hobotnic|skamp|salam|sunk|prsut|slanin|panceta|klobas|hrenovk|mortadel|speck|kulen|bresaola|cevapc|pleskavic|surimi|polak|oslic|skus|rebrc|perutnin|stegn|bedr|perutk|krac|narezek|pasteta|jetr')],
  ['mlecni', re('mleko\\b|mleka\\b|mlecn|jogurt|kefir|skyr|sir\\b|siri\\b|sirn|ementalec|ementaler|gavda|gouda|edamec|mocarel|mozzarel|maasdam|grana\\b|parmezan|parmigian|mascarpone|rikot|ricott|feta\\b|skuta|smetan|maslo|jajca|jajce\\b|kislo mleko|pinjenec|puding|kajmak|namaz sirni|burrata|camembert|brie\\b')],
  ['kruh', re('hleb|pletenk|kifelj|kifl|kruh|zemlj|bageta|baget|toast|tortilj|fokac|focacc|rogljic|pecivo|zemljick|zitni|pita\\b|kajzerc|zemlje|zitnice|zitna rezina|prepecenec|grisin|dvopek')],
  ['zajtrk', re('kava\\b|kave\\b|kavn|espresso|cappuccino|kapucin|caj\\b|caja\\b|cajn(?:a|i) (?:mesanic|vrec)|zeliscni|kakav|musli|granola|corn ?flakes|marmelad|dzem|med\\b|lesnikov[ao] krem|namaz|arasidovo maslo')],
  ['sadje', re('sadje|jabolk|banan|pomaranc|mandarin|klementin|limon|limet|grozdj|hrusk|kivi|avokad|ananas\\b|jagod|boronic|malin|robid|ribez|breskv|marelic|sliv[ae]\\b|cesnj|visnj|lubenic|melon|mango|granatn|datlj|smokv|kaki\\b|zelenjav|krompir|cebul|cesen|cesn\\b|korenj|paprik[ae]\\b|paradiznik|kumar[ae]\\b|solat|rukol|motovilec|radic|spinac|brokol|cvetac|zelje\\b|ohrovt|buc[ae]\\b|bucke|jajcevec|gob[ae]?\\b|sampinjon|por\\b|redkev|repa\b|zelena\\b|peteršilj|petersilj|blitva|stročji|strocji|koleraba|ingver|cicerikin')],
  ['pijace', re('pijaca\\b|sok\\b|sokovi|soka\\b|voda\\b|vode\\b|mineraln|napitek|napitk|gazirana|cola\\b|coca|pepsi|fanta|cockta|ledeni caj|limonad|energijsk|sirup|smoothie|nektar|tonik|kokosov napitek|ovseni napitek|sojin napitek|mandljev napitek')],
];

/**
 * Skupina izdelka iz imena, kategorije trgovine (hint) in podatka trgovine, ali je hrana (food).
 * Vrne id skupine ali null, ko ni mogoče presoditi.
 */
export function classify(name, hint = '', food = null) {
  const n = norm(name);
  const h = norm(hint);
  for (const [id, r] of NAME_NONFOOD) if (r.test(n)) return id;
  if (ALCOHOL.test(n) && !NOT_ALCOHOL.test(n)) return 'alkohol';
  if (h && !/vse za otroka|sezona|diabeticn|dietetic|ekolosk|zdrava prehrana|otroska hrana|izbrana kakovost|novo/.test(h)) {
    // Kategorija trgovine je zanesljivejša od imena (»energijski napitek, mango« je pijača, ne sadje).
    for (const [id, r] of HINTS) if (r.test(h)) return id;
  }
  const byName = NAME_FOOD.find(([, r]) => r.test(n))?.[0];
  if (byName) return byName;
  return food === false ? 'drugo' : null;
}

// ---------- Velikost pakiranja in cena na enoto ----------
const num = s => Number(String(s).replace(/\s/g, '').replace(',', '.'));
const UNIT = { g: ['kg', 0.001], dag: ['kg', 0.01], kg: ['kg', 1], ml: ['l', 0.001], cl: ['l', 0.01], dl: ['l', 0.1], l: ['l', 1] };

/** Velikost iz besedila, npr. »2 x 500 g« → { qty: 1, unit: 'kg' }, »1,5 l« → { qty: 1.5, unit: 'l' }. */
export function packSize(text) {
  const t = norm(text);
  const A = '(\\d+(?:[.,]\\d+)?)\\s?(kg|dag|g|ml|cl|dl|l)\\b';
  let count = 1, amount, unit, m;
  if ((m = t.match(new RegExp(`(\\d+)\\s?x\\s?${A}`)))) [, count, amount, unit] = m;        // 2 x 500 g
  else if ((m = t.match(new RegExp(`${A}\\s?x\\s?(\\d+)\\b`)))) [, amount, unit, count] = m; // 500 g x 2
  else if ((m = t.match(new RegExp(A)))) [, amount, unit] = m;                                // 1,5 l
  else return null;
  const [base, factor] = UNIT[unit];
  const qty = Number(count || 1) * num(amount) * factor;
  return qty > 0 ? { qty: Math.round(qty * 1000) / 1000, unit: base } : null;
}

/**
 * Cena na kg ali l: iz zapisa trgovine (»1 kg = 6,98«, »4,88 €/1 kg«) ali iz velikosti v imenu.
 * Vrne { up, uu } ali null.
 */
export function unitPrice({ p, b, q, n }) {
  const s = norm(b);
  let m = s.match(/(\d+(?:[.,]\d+)?)?\s?(kg|l)\s?=\s?(\d+(?:[.,]\d+)?)/);
  if (m) return { up: round2(num(m[3]) / num(m[1] || 1)), uu: m[2] };
  m = s.match(/(\d+(?:[.,]\d+)?)\s?€?\s?\/\s?(\d+(?:[.,]\d+)?)?\s?(kg|l)\b/);
  if (m) return { up: round2(num(m[1]) / num(m[2] || 1)), uu: m[3] };
  const size = packSize(q) ?? packSize(n);
  if (size && p > 0) return { up: round2(p / size.qty), uu: size.unit };
  return null;
}
const round2 = v => Math.round(v * 100) / 100;

/** Akcija s skupino (g), hrana da/ne po skupini in ceno na enoto (up, uu). */
export function enrichDeal(d) {
  const g = classify(d.n, d.c, d.food);
  const u = unitPrice(d);
  return { ...d, g, food: g ? isFoodGroup(g) : d.food ?? null, ...(u ?? {}) };
}
