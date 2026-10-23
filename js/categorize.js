// Kategorije, pravila in samodejno razvrščanje transakcij.

// Kategorije imajo največ dve ravni: glavna kategorija → podkategorija (parentId).
const cat = (id, name, emoji, kind, parentId = null) => ({ id, name, emoji, kind, parentId });
const sub = (parentId, kind = 'expense') => (id, name, emoji) => cat(id, name, emoji, kind, parentId);
const food = sub('food'), transport = sub('transport'), housing = sub('housing'), subscriptions = sub('subscriptions'),
  shopping = sub('shopping'), sport = sub('sport'), fun = sub('fun'), travel = sub('travel'), health = sub('health'), salary = sub('salary', 'income');

export const CATEGORIES_VERSION = 2;
export const DEFAULT_CATEGORIES = [
  cat('food', 'Hrana in pijača', '🍽️', 'expense'),
  food('groceries', 'Trgovina', '🛒'),
  food('dining', 'Restavracije', '🍝'),
  food('delivery', 'Dostava hrane', '🛵'),
  food('cafes', 'Kavarne in bari', '☕'),
  cat('transport', 'Prevoz', '🚗', 'expense'),
  transport('fuel', 'Gorivo', '⛽'),
  transport('parking', 'Parkiranje', '🅿️'),
  transport('public_transport', 'Javni prevoz', '🚌'),
  transport('taxi', 'Taksi in souporaba', '🚕'),
  transport('car', 'Vzdrževanje avta', '🔧'),
  transport('tolls', 'Vinjeta in cestnine', '🛣️'),
  cat('housing', 'Stanovanje', '🏠', 'expense'),
  housing('rent', 'Najemnina', '🔑'),
  housing('utilities', 'Elektrika in ogrevanje', '💡'),
  housing('telecom', 'Internet in telefon', '📶'),
  housing('household', 'Gospodinjstvo', '🧽'),
  cat('subscriptions', 'Naročnine', '📱', 'expense'),
  subscriptions('streaming', 'Filmi in glasba', '🎬'),
  subscriptions('software', 'Aplikacije in oblak', '☁️'),
  cat('shopping', 'Nakupovanje', '🛍️', 'expense'),
  shopping('clothes', 'Oblačila in obutev', '👕'),
  shopping('electronics', 'Elektronika', '💻'),
  shopping('home', 'Dom in oprema', '🛋️'),
  cat('sport', 'Šport', '🚴', 'expense'),
  sport('sport_gear', 'Oprema', '👟'),
  sport('sport_fees', 'Članarine in prijavnine', '🎟️'),
  sport('sport_nutrition', 'Športna prehrana', '🥤'),
  cat('fun', 'Zabava in prosti čas', '🎉', 'expense'),
  fun('events', 'Kino in dogodki', '🎫'),
  fun('games', 'Igre', '🎮'),
  cat('travel', 'Potovanja', '✈️', 'expense'),
  travel('travel_transport', 'Prevoz na potovanju', '🛫'),
  travel('accommodation', 'Nastanitev', '🏨'),
  cat('health', 'Zdravje in nega', '💊', 'expense'),
  health('pharmacy', 'Lekarna', '⚕️'),
  health('care', 'Nega in kozmetika', '🧴'),
  health('doctor', 'Zdravnik', '🩺'),
  cat('education', 'Izobraževanje', '📚', 'expense'),
  cat('gifts', 'Darila', '🎁', 'expense'),
  cat('people', 'Nakazila osebam', '💸', 'expense'),
  cat('cash', 'Dvig gotovine', '💶', 'expense'),
  cat('fees', 'Provizije banke', '🏦', 'expense'),
  cat('other', 'Ostalo', '📦', 'expense'),
  cat('salary', 'Plača in delo', '💰', 'income'),
  salary('student_work', 'Študentsko delo', '🎓'),
  cat('refunds', 'Vračila', '↩️', 'income'),
  cat('income_other', 'Drugi prihodki', '🪙', 'income'),
  cat('transfer', 'Prenos med računi', '🔁', 'transfer'),
];

// Imena iz prve verzije: če jih nisi preimenoval, jih nadgradnja zamenja z novimi.
export const OLD_DEFAULT_NAMES = {
  groceries: 'Živila', dining: 'Restavracije in kavarne', transport: 'Prevoz in gorivo', housing: 'Stanovanje in računi',
};

// Kategorije, ki jih aplikacija potrebuje kot privzete in jih ni mogoče izbrisati.
export const PROTECTED_CATEGORIES = new Set(['other', 'income_other', 'transfer']);
export const FALLBACK_CATEGORY = { expense: 'other', income: 'income_other', transfer: 'transfer' };

// Vgrajena pravila: beseda v opisu → kategorija. Uporabnikova pravila imajo vedno prednost.
// Ob vsaki spremembi pravil povečaj RULES_VERSION, da se ponovno uporabijo na že uvoženih transakcijah.
export const RULES_VERSION = 3;
const BUILTIN = {
  groceries: ['mercator', 'spar', 'interspar', 'hofer', 'lidl', 'tus', 'engrotus', 'eurospin', 'jager', 'leclerc', 'kaufland', 'billa', 'konzum', 'penny', 'pekarna', 'mesnica', 'trgovina', 'specerija', 'plodine', 'carrefour'],
  dining: ['mcdonalds', 'mcdonald', 'burger king', 'kfc', 'subway', 'restavracija', 'gostilna', 'gostilnica', 'pizzeria', 'kebab', 'fast food', 'kozlovna', 'grill', 'cantina', 'trattoria', 'bistro'],
  delivery: ['wolt', 'glovo', 'bolt food'],
  cafes: ['starbucks', 'kavarna', 'caffe', 'cafe', 'kafe', 'bar', 'pub', 'slascicarna', 'sladolednica'],
  fuel: ['petrol', 'omv', 'mol', 'shell'],
  parking: ['parkiranje', 'parking', 'easypark', 'repark'],
  public_transport: ['arriva', 'marprom', 'lpp', 'slovenske zeleznice', 'flixbus', 'nomago', 'jcdecaux'],
  taxi: ['bolt', 'uber', 'avant2go', 'greengo'],
  car: ['avto', 'avtocenter', 'avtopralnica', 'vulkanizer', 'porsche inter auto'],
  tolls: ['dars', 'vinjeta', 'e-vinjeta'],
  rent: ['najemnina', 'studentski dom'],
  utilities: ['elektro', 'energetika', 'plinarna', 'komunala', 'snaga'],
  telecom: ['a1', 'telekom slovenije', 'telemach', 't-2'],
  streaming: ['netflix', 'spotify', 'youtube', 'disney', 'hbo', 'voyo', 'amazon prime', 'prime video', 'twitch', 'patreon'],
  software: ['apple.com', 'icloud', 'google one', 'google play', 'google', 'microsoft', 'chatgpt', 'openai', 'claude', 'claude.ai', 'anthropic', 'adobe', 'notion', 'canva', 'duolingo', 'strava', 'goodnotes'],
  shopping: ['amazon', 'aliexpress', 'alipay', 'temu', 'ebay', 'mimovrste', 'blagovnica', 'pandora', 'pepco', 'tedi'],
  clothes: ['shein', 'zalando', 'h&m', 'zara', 'bershka', 'pull&bear', 'new yorker', 'peek & cloppenburg', 'kik', 'deichmann', 'primark'],
  electronics: ['big bang', 'bambu lab'],
  home: ['ikea', 'jysk', 'merkur', 'obi', 'bauhaus', 'vitapur'],
  sport_gear: ['decathlon', 'intersport', 'hervis'],
  sport_fees: ['fitnes', 'gym'],
  events: ['kino', 'cineplexx', 'kolosej', 'eventim', 'mojekarte', 'eventbrite', 'ticketmaster', 'bowling', 'stuk'],
  games: ['steam', 'innogames', 'xbox', 'playstation'],
  travel_transport: ['ryanair', 'wizz air', 'wizzair', 'easyjet', 'lufthansa', 'trainline'],
  accommodation: ['booking.com', 'airbnb', 'hotel', 'hostel'],
  travel: ['expedia'],
  pharmacy: ['lekarna', 'lekarne'],
  care: ['dm', 'muller', 'bipa'],
  doctor: ['optika', 'zobozdravnik'],
  education: ['udemy', 'coursera', 'knjigarna', 'mladinska knjiga', 'skriptarnica'],
  student_work: ['studentski servis', 'e-studentski servis', 'studentski servis mb'],
};

/** Male črke, brez šumnikov in naglasov, enojni presledki. */
export function normalize(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/\s+/g, ' ').trim();
}

let builtinCache;
export function builtinRules() {
  builtinCache ??= Object.entries(BUILTIN).flatMap(([categoryId, patterns]) =>
    patterns.map(pattern => ({ id: `builtin:${pattern}`, pattern, categoryId, builtin: true })));
  return builtinCache;
}

const regexCache = new Map();
function ruleRegex(pattern) {
  let re = regexCache.get(pattern);
  if (!re) {
    const escaped = normalize(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`);
    regexCache.set(pattern, re);
  }
  return re;
}

/** Vrne prvo pravilo, ki se ujema z opisom: najprej uporabnikova, nato daljši vzorci pred krajšimi. */
export function matchRule(description, rules) {
  const text = normalize(description);
  if (!text) return null;
  const ordered = [...rules].sort((a, b) => (!!a.builtin - !!b.builtin) || b.pattern.length - a.pattern.length);
  return ordered.find(r => r.pattern && ruleRegex(r.pattern).test(text)) ?? null;
}

/** Ugane kategorijo za uvoženo vrstico (Revolut stolpca Type in Product sta neobvezna). */
export function guessCategory({ description, amount, type = '', product = '' }, rules) {
  const t = String(type).toUpperCase();
  const desc = normalize(description);
  // Premiki na varčevalne račune in menjave valut niso ne strošek ne prihodek.
  if (/savings|varcev|deposit|depozit|pocket|vault|trezor/.test(normalize(product))) return { categoryId: 'transfer', source: 'default' };
  if (t === 'TOPUP' || t === 'EXCHANGE') return { categoryId: 'transfer', source: 'default' };

  const own = matchRule(description, rules.filter(r => !r.builtin));
  if (own) return { categoryId: own.categoryId, source: 'rule' };

  if (t === 'TRANSFER') {
    if (/savings|vault|pocket|varcev|trezor|flexible account|investment|portfolio/.test(desc)) return { categoryId: 'transfer', source: 'default' };
    // Revolut: »To X« / »From X« so tvoji računi in žepi, »Transfer to X« / »Payment from X« pa drugi ljudje.
    if (/^(to|from) /.test(desc)) return { categoryId: 'transfer', source: 'default' };
  }

  const hit = matchRule(description, rules);
  if (hit) return { categoryId: hit.categoryId, source: 'rule' };
  const byType = {
    ATM: 'cash',
    FEE: 'fees',
    CARD_REFUND: 'refunds',
    CARD_CREDIT: 'refunds',
    REWARD: 'income_other',
    CASHBACK: 'income_other',
    INTEREST: 'income_other',
    TRANSFER: amount < 0 ? 'people' : 'income_other',
  }[t];
  return { categoryId: byType ?? (amount < 0 ? 'other' : 'income_other'), source: 'default' };
}
