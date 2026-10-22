// Kategorije, pravila in samodejno razvrščanje transakcij.

export const DEFAULT_CATEGORIES = [
  { id: 'groceries', name: 'Živila', emoji: '🛒', kind: 'expense' },
  { id: 'dining', name: 'Restavracije in kavarne', emoji: '🍽️', kind: 'expense' },
  { id: 'transport', name: 'Prevoz in gorivo', emoji: '🚗', kind: 'expense' },
  { id: 'housing', name: 'Stanovanje in računi', emoji: '🏠', kind: 'expense' },
  { id: 'subscriptions', name: 'Naročnine', emoji: '📱', kind: 'expense' },
  { id: 'shopping', name: 'Nakupovanje', emoji: '🛍️', kind: 'expense' },
  { id: 'fun', name: 'Zabava in prosti čas', emoji: '🎉', kind: 'expense' },
  { id: 'travel', name: 'Potovanja', emoji: '✈️', kind: 'expense' },
  { id: 'health', name: 'Zdravje in nega', emoji: '💊', kind: 'expense' },
  { id: 'education', name: 'Izobraževanje', emoji: '📚', kind: 'expense' },
  { id: 'gifts', name: 'Darila', emoji: '🎁', kind: 'expense' },
  { id: 'people', name: 'Nakazila osebam', emoji: '💸', kind: 'expense' },
  { id: 'cash', name: 'Dvig gotovine', emoji: '💶', kind: 'expense' },
  { id: 'fees', name: 'Provizije banke', emoji: '🏦', kind: 'expense' },
  { id: 'other', name: 'Ostalo', emoji: '📦', kind: 'expense' },
  { id: 'salary', name: 'Plača in delo', emoji: '💰', kind: 'income' },
  { id: 'refunds', name: 'Vračila', emoji: '↩️', kind: 'income' },
  { id: 'income_other', name: 'Drugi prihodki', emoji: '🪙', kind: 'income' },
  { id: 'transfer', name: 'Prenos med računi', emoji: '🔁', kind: 'transfer' },
];

// Kategorije, ki jih aplikacija potrebuje kot privzete in jih ni mogoče izbrisati.
export const PROTECTED_CATEGORIES = new Set(['other', 'income_other', 'transfer']);
export const FALLBACK_CATEGORY = { expense: 'other', income: 'income_other', transfer: 'transfer' };

// Vgrajena pravila: beseda v opisu → kategorija. Uporabnikova pravila imajo vedno prednost.
// Ob vsaki spremembi pravil povečaj RULES_VERSION, da se ponovno uporabijo na že uvoženih transakcijah.
export const RULES_VERSION = 2;
const BUILTIN = {
  groceries: ['mercator', 'spar', 'interspar', 'hofer', 'lidl', 'tus', 'engrotus', 'eurospin', 'jager', 'leclerc', 'kaufland', 'billa', 'konzum', 'penny', 'pekarna', 'mesnica', 'trgovina', 'specerija', 'plodine', 'carrefour'],
  dining: ['wolt', 'glovo', 'bolt food', 'mcdonalds', 'mcdonald', 'burger king', 'kfc', 'subway', 'starbucks', 'restavracija', 'gostilna', 'pizzeria', 'kavarna', 'caffe', 'cafe', 'kafe', 'bar', 'pub', 'kebab', 'slascicarna', 'sladolednica', 'fast food', 'kozlovna', 'gostilnica', 'grill', 'cantina', 'trattoria', 'bistro'],
  transport: ['petrol', 'omv', 'mol', 'shell', 'bolt', 'uber', 'dars', 'parkiranje', 'parking', 'easypark', 'repark', 'arriva', 'marprom', 'lpp', 'slovenske zeleznice', 'flixbus', 'nomago', 'avant2go', 'greengo', 'jcdecaux', 'avto', 'avtocenter', 'avtopralnica', 'vulkanizer', 'porsche inter auto', 'vinjeta', 'e-vinjeta'],
  housing: ['najemnina', 'elektro', 'energetika', 'plinarna', 'komunala', 'snaga', 'a1', 'telekom slovenije', 'telemach', 't-2', 'studentski dom'],
  subscriptions: ['netflix', 'spotify', 'youtube', 'disney', 'hbo', 'apple.com', 'icloud', 'google one', 'google play', 'google', 'microsoft', 'xbox', 'playstation', 'chatgpt', 'openai', 'claude', 'claude.ai', 'anthropic', 'patreon', 'twitch', 'voyo', 'amazon prime', 'prime video', 'adobe', 'notion', 'canva', 'duolingo', 'strava', 'goodnotes'],
  shopping: ['amazon', 'aliexpress', 'alipay', 'temu', 'shein', 'zalando', 'h&m', 'zara', 'bershka', 'pull&bear', 'new yorker', 'peek & cloppenburg', 'kik', 'deichmann', 'decathlon', 'intersport', 'hervis', 'ikea', 'jysk', 'merkur', 'obi', 'bauhaus', 'big bang', 'mimovrste', 'ebay', 'primark', 'pepco', 'tedi', 'pandora', 'vitapur', 'blagovnica', 'bambu lab'],
  fun: ['kino', 'cineplexx', 'kolosej', 'steam', 'innogames', 'eventim', 'mojekarte', 'eventbrite', 'ticketmaster', 'fitnes', 'gym', 'bowling', 'stuk'],
  travel: ['ryanair', 'wizz air', 'wizzair', 'easyjet', 'lufthansa', 'booking.com', 'airbnb', 'hotel', 'hostel', 'trainline', 'expedia'],
  health: ['lekarna', 'lekarne', 'dm', 'muller', 'bipa', 'optika', 'zobozdravnik'],
  education: ['udemy', 'coursera', 'knjigarna', 'mladinska knjiga', 'skriptarnica'],
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
