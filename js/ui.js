// Pomožne funkcije za prikaz: oblikovanje, obvestila, potrditve, namigi.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const formatters = new Map();
function currencyFormat(currency, digits) {
  const key = `${currency}:${digits}`;
  if (!formatters.has(key)) {
    let f;
    try {
      f = new Intl.NumberFormat('sl-SI', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
    } catch {
      f = { format: v => `${v.toFixed(digits)} ${currency}` };
    }
    formatters.set(key, f);
  }
  return formatters.get(key);
}

export const money = (v, currency = 'EUR') => currencyFormat(currency, 2).format(v);
export const money0 = (v, currency = 'EUR') => currencyFormat(currency, 0).format(v);
export const signedMoney = (v, currency = 'EUR') => (v > 0 ? '+' : '') + money(v, currency);

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export function monthLabel(key, month = 'long') {
  const [y, m] = key.split('-').map(Number);
  const opts = month === 'short' ? { month: 'short' } : { month, year: 'numeric' };
  return cap(new Date(y, m - 1, 1).toLocaleDateString('sl-SI', opts));
}

export function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return cap(date.toLocaleDateString('sl-SI', { weekday: 'long', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) }));
}

export function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
export const currentMonth = () => todayISO().slice(0, 7);

/** Slovenska dvojina/množina: plural(3, ['transakcija', 'transakciji', 'transakcije', 'transakcij']) */
export function plural(n, forms) {
  const r = Math.abs(n) % 100;
  return `${n} ${forms[r === 1 ? 0 : r === 2 ? 1 : r === 3 || r === 4 ? 2 : 3]}`;
}
export const TX_FORMS = ['transakcija', 'transakciji', 'transakcije', 'transakcij'];

let toastTimer;
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

/** Potrditveno okno. Vrne Promise<boolean>. */
export function ask(message, { yes = 'Da', no = 'Prekliči', danger = false } = {}) {
  const dlg = document.getElementById('askDialog');
  dlg.querySelector('p').textContent = message;
  const yesBtn = dlg.querySelector('[value=yes]');
  yesBtn.textContent = yes;
  yesBtn.classList.toggle('danger', danger);
  dlg.querySelector('[value=no]').textContent = no;
  // Odziv na klik gumba (submit) ali Escape (cancel), ne na dogodek close, ki ga brskalnik lahko zakasni.
  const form = dlg.querySelector('form');
  return new Promise(resolve => {
    const done = value => {
      form.removeEventListener('submit', onSubmit);
      dlg.removeEventListener('cancel', onCancel);
      resolve(value);
    };
    const onSubmit = e => done(e.submitter?.value === 'yes');
    const onCancel = () => done(false);
    form.addEventListener('submit', onSubmit);
    dlg.addEventListener('cancel', onCancel);
    dlg.showModal();
  });
}

const tip = () => document.getElementById('tooltip');
export function showTip(html, x, y) {
  const el = tip();
  if (html != null) el.innerHTML = html;
  el.hidden = false;
  const r = el.getBoundingClientRect();
  let left = x - r.width / 2;
  let top = y - r.height - 14;
  left = Math.max(8, Math.min(left, innerWidth - r.width - 8));
  if (top < 8) top = y + 18;
  el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}
export const hideTip = () => { tip().hidden = true; };

export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const icons = {
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  chevronLeft: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>',
};
