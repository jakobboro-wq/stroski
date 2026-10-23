// Evidenca ur: izračun ur in zaslužka, uvoz iz Excela, pretvorba dogodkov prihod/odhod v delovne dni.
// Izračun sledi tabeli »RTC evidenca ur«: ure = odhod − prihod (odmor je plačan), zaslužek po dnevih zaokrožen na cent.

// rounding: zaokroževanje časa prihoda/odhoda (min); hoursStep/hoursMode: zaokroževanje opravljenih ur (min, nearest|down|up)
export const DEFAULT_PAY = { id: 'pay', employer: 'RTC', netRate: 11, piz: 0.155, tax: 0, rounding: 5, hoursStep: 30, hoursMode: 'nearest' };

const pad = n => String(n).padStart(2, '0');
const round2 = n => Math.round(n * 100) / 100;

export const toMin = hhmm => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const fromMin = min => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
export const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Dejansko trajanje v minutah, null če manjka prihod ali odhod. Čez polnoč se šteje pravilno. */
export function minutesOf(s) {
  const a = toMin(s.start), b = toMin(s.end);
  if (a == null || b == null) return null;
  return (((b - a) % 1440) + 1440) % 1440;
}

/** Obračunane ure dneva: trajanje, zaokroženo po nastavitvi (npr. na pol ure), na 2 decimalki. */
export function hoursOf(s, p = DEFAULT_PAY) {
  const min = minutesOf(s);
  if (min == null) return null;
  const step = p.hoursStep ?? 0;
  if (!step) return round2(min / 60);
  const fn = { down: Math.floor, up: Math.ceil }[p.hoursMode] ?? Math.round;
  return round2((fn(min / step) * step) / 60);
}

/** Bruto urna postavka iz neto: neto / (1 − PIZ − dohodnina), na 4 decimalke kot v Excelu. */
export const grossRate = p => Math.round((p.netRate / (1 - p.piz - p.tax)) * 10000) / 10000;

export function payOf(hours, p) {
  return { net: round2(hours * p.netRate), gross: round2(hours * grossRate(p)) };
}

/** Seštevek mesec "YYYY-MM": ure, neto, bruto, število dni in odprtih (nedokončanih) vnosov. */
export function monthTotals(sessions, month, p) {
  const t = { hours: 0, net: 0, gross: 0, days: new Set(), open: 0 };
  for (const s of sessions) {
    if (!s.date.startsWith(month)) continue;
    const h = hoursOf(s, p);
    if (h == null) { t.open++; continue; }
    const pay = payOf(h, p);
    t.hours += h;
    t.net += pay.net;
    t.gross += pay.gross;
    t.days.add(s.date);
  }
  return { hours: round2(t.hours), net: round2(t.net), gross: round2(t.gross), days: t.days.size, open: t.open };
}

/** Čas iz Date, zaokrožen na `step` minut. */
export function roundTime(date, step = 5) {
  const min = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  return fromMin(Math.min(1439, Math.round(min / step) * step));
}

/**
 * Dogodki iz telefona ({ kind: 'in'|'out', at: ISO }) → novi ali spremenjeni delovni dnevi.
 * - prihod, ko je dan že odprt, se prezre (dvojni signal),
 * - prihod do 20 min po odhodu istega dne nadaljuje isti vnos (kratek izhod iz območja),
 * - odhod brez prihoda ustvari vnos brez prihoda, da ga dopolniš.
 */
export function applyEvents(sessions, events, step = 5) {
  const work = sessions.map(s => ({ ...s }));
  const touched = new Set();
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    const d = new Date(e.at);
    const date = localDate(d);
    const time = roundTime(d, step);
    const day = work.filter(s => s.date === date).sort((a, b) => (toMin(a.start) ?? 0) - (toMin(b.start) ?? 0));
    const open = day.find(s => s.start && !s.end);
    if (e.kind === 'in') {
      if (open) continue;
      const last = day.at(-1);
      if (last?.end && toMin(time) - toMin(last.end) <= 20 && toMin(time) >= toMin(last.end)) {
        last.end = null;
        touched.add(last.id);
        continue;
      }
      const s = { id: `auto:${date}:${time}`, date, start: time, end: null, note: '', source: 'auto' };
      work.push(s);
      touched.add(s.id);
    } else {
      if (open) {
        open.end = toMin(time) > toMin(open.start) ? time : open.start;
        touched.add(open.id);
      } else if (!day.some(s => s.end && toMin(s.end) >= toMin(time) - 1)) {
        const s = { id: `auto:${date}:out:${time}`, date, start: '', end: time, note: 'Manjka prihod', source: 'auto' };
        work.push(s);
        touched.add(s.id);
      }
    }
  }
  return work.filter(s => touched.has(s.id));
}

// ---------- Uvoz iz Excela (RTC evidenca ur) ----------

const serialToDate = v => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
};
const fractionToTime = v => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0 && n < 1) return fromMin(Math.round(n * 1440) % 1440);
  const m = String(v).match(/^(\d{1,2})[:.](\d{2})/);
  return m ? `${pad(+m[1])}:${m[2]}` : null;
};

/** Iz listov Excela prebere delovne dni (listi z glavo Datum/Prihod/Odhod) in nastavitve obračuna (list »Obračun«). */
export function parseWorkbook(sheets) {
  const sessions = [];
  let pay = null;
  for (const { name, rows } of sheets) {
    const hi = rows.findIndex(r => r.some(c => /^datum$/i.test(String(c).trim())) && r.some(c => /prihod/i.test(c)));
    if (hi >= 0) {
      const head = rows[hi];
      const col = re => head.findIndex(c => re.test(String(c).trim()));
      const cDate = col(/^datum$/i), cIn = col(/prihod/i), cOut = col(/odhod/i), cNote = col(/opomba/i);
      for (const r of rows.slice(hi + 1)) {
        const date = serialToDate(r[cDate]);
        const start = fractionToTime(r[cIn]);
        const end = fractionToTime(r[cOut]);
        if (!date || (!start && !end)) continue;
        sessions.push({ date, start: start ?? '', end, note: cNote >= 0 ? String(r[cNote] ?? '').trim() : '', source: 'import' });
      }
    }
    if (/obra[cč]un/i.test(name)) {
      const value = re => {
        const r = rows.find(row => re.test(String(row[1] ?? '')));
        const n = Number(r?.[2]);
        return Number.isFinite(n) ? n : null;
      };
      const netRate = value(/neto urna postavka/i);
      if (netRate) pay = { netRate, piz: value(/prispevek za piz/i) ?? DEFAULT_PAY.piz, tax: value(/akontacija dohodnine/i) ?? 0 };
    }
  }
  return { sessions, pay };
}

/** CSV za Excel (ločilo ;) za izbrani mesec. */
export function monthCSV(sessions, month, p) {
  const num = v => (v == null || v === '' ? '' : String(v).replace('.', ','));
  const lines = [['Datum', 'Prihod', 'Odhod', 'Ure', 'Bruto (€)', 'Neto (€)', 'Opomba']];
  for (const s of sessions.filter(x => x.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? ''))) {
    const h = hoursOf(s, p);
    const pay = h == null ? null : payOf(h, p);
    const [y, m, d] = s.date.split('-');
    lines.push([`${+d}. ${+m}. ${y}`, s.start ?? '', s.end ?? '', num(h), num(pay?.gross), num(pay?.net), s.note ?? '']);
  }
  const t = monthTotals(sessions, month, p);
  lines.push(['Skupaj', '', '', num(t.hours), num(t.gross), num(t.net), '']);
  return '﻿' + lines.map(l => l.map(v => /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(';')).join('\r\n');
}
