import { state, category, kindOf, topOf, BASE_CURRENCY } from '../store.js';
import { normalize } from '../categorize.js';
import { buildIndex, addMonths, average, spendOf, incomeOf, variableOf, daysInMonth } from '../stats.js';
import { EVERY, occurrencesBetween, amountInMonth, nextOccurrence } from '../recurring.js';
import { openTxDialog } from '../dialog.js';

const dayShort = iso => { const [, m, d] = iso.split('-'); return `${+d}. ${+m}.`; };
import { columnChart } from '../charts.js';
import { loadDemo } from '../demo.js';
import { esc, money, money0, signedMoney, monthLabel, currentMonth, todayISO, plural, TX_FORMS, showTip, hideTip, icons, toast } from '../ui.js';

/** "▲ 12 % več kot prejšnji mesec". Za porabo je več slabo, za prihodke dobro. */
function delta(value, ref, label, upIsGood = false) {
  if (ref == null || ref <= 0) return '';
  const d = (value - ref) / ref;
  if (Math.abs(d) < 0.01) return `<span class="delta flat">≈ enako kot ${label}</span>`;
  const up = d > 0;
  const tone = up === upIsGood ? 'good' : 'bad';
  return `<span class="delta ${tone}">${up ? '▲' : '▼'} ${Math.round(Math.abs(d) * 100)} % ${up ? 'več' : 'manj'} kot ${label}</span>`;
}

function welcome(view) {
  view.innerHTML = `
    <section class="card welcome">
      <h1>Živjo! 👋</h1>
      <p>Tu vidiš, kam gre tvoj denar. Začneš lahko na tri načine:</p>
      <div class="welcome-actions">
        <a class="btn primary" href="#/uvoz">${icons.upload} Uvozi Revolut izpisek</a>
        <button class="btn" id="welcomeAdd">+ Dodaj strošek ročno</button>
        <button class="btn ghost" id="welcomeDemo">Preizkusi s primer podatki</button>
      </div>
      <p class="muted small">Podatki so shranjeni samo na tej napravi. Primer podatkov lahko kasneje odstraniš v Nastavitvah.</p>
    </section>`;
  view.querySelector('#welcomeAdd').onclick = () => document.getElementById('addBtn').click();
  view.querySelector('#welcomeDemo').onclick = async () => { await loadDemo(); toast('Primer podatkov naložen'); };
}

export function renderOverview(view, params) {
  if (!state.transactions.length) return welcome(view);

  const idx = buildIndex(state.transactions, kindOf, BASE_CURRENCY);
  const now = currentMonth();
  const dataMonths = [...idx.months.keys()].sort();
  let month = params.get('m');
  if (!/^\d{4}-\d{2}$/.test(month ?? '')) month = idx.months.has(now) || !dataMonths.length ? now : dataMonths.at(-1);

  const cur = idx.months.get(month);
  const spend = spendOf(cur);
  const income = incomeOf(cur);
  const prevKey = addMonths(month, -1);
  const prevSpend = idx.months.has(prevKey) ? spendOf(idx.months.get(prevKey)) : null;
  const avgSpend = average(idx, month, spendOf);
  const isCurrent = month === now;
  const today = Number(todayISO().slice(8, 10));
  const dim = daysInMonth(month);
  const daysCounted = isCurrent ? today : dim;

  // Napoved do konca meseca: dosedanja poraba + ponavljajoči, ki še pridejo + ostala poraba po dosedanjem tempu.
  const expenseSeries = state.recurring.filter(s => kindOf(s.categoryId) === 'expense' && s.currency === BASE_CURRENCY);
  const incomeSeries = state.recurring.filter(s => kindOf(s.categoryId) === 'income' && s.currency === BASE_CURRENCY);
  const [ty, tm, td] = todayISO().split('-').map(Number);
  const tomorrow = new Date(Date.UTC(ty, tm - 1, td + 1)).toISOString().slice(0, 10);
  const upcomingFixed = isCurrent
    ? expenseSeries.reduce((sum, s) => sum - occurrencesBetween(s, tomorrow, `${month}-${String(dim).padStart(2, '0')}`).length * s.amount, 0)
    : 0;
  const projection = isCurrent && today < dim && (today >= 3 || upcomingFixed > 0)
    ? spend + upcomingFixed + (today >= 3 ? (variableOf(cur) / today) * (dim - today) : 0)
    : null;

  // Napoved za naslednje mesece: ponavljajoči + povprečje ostale porabe zadnjih (do) 3 polnih mesecev
  const pastVariable = [1, 2, 3].map(i => addMonths(now, -i)).filter(k => idx.first && k >= idx.first).map(k => variableOf(idx.months.get(k)));
  const curDay = Number(todayISO().slice(8, 10));
  const variableAvg = pastVariable.length
    ? pastVariable.reduce((a, b) => a + b, 0) / pastVariable.length
    : curDay >= 7 && idx.months.has(now) ? (variableOf(idx.months.get(now)) / curDay) * daysInMonth(now) : null;
  const forecast = [1, 2, 3, 4, 5, 6].map(i => {
    const k = addMonths(now, i);
    const fixed = expenseSeries.reduce((sum, s) => sum - amountInMonth(s, k), 0);
    const inc = incomeSeries.reduce((sum, s) => sum + amountInMonth(s, k), 0);
    return { k, fixed, variable: variableAvg ?? 0, total: fixed + (variableAvg ?? 0), income: inc };
  });
  const forecastMax = Math.max(1, ...forecast.map(r => r.total));

  // Seznam ponavljajočih
  const seriesRows = state.recurring
    .map(s => ({ s, c: category(s.categoryId), perMonth: Math.abs(s.amount) * EVERY[s.every].perMonth, next: nextOccurrence(s, todayISO()) }))
    .sort((a, b) => b.perMonth - a.perMonth);
  const fixedPerMonth = seriesRows.filter(r => r.c.kind === 'expense').reduce((sum, r) => sum + r.perMonth, 0);

  // Kategorije: seštevek po glavnih kategorijah, s podkategorijami pod njimi
  const spendInTop = topId => e => {
    let s = 0;
    for (const [id, v] of e?.byCat ?? []) if (topOf(id) === topId) s += v;
    return s;
  };
  const tops = new Map();
  for (const [id, v] of cur?.byCat ?? []) {
    const t = topOf(id);
    const e = tops.get(t) ?? { v: 0, subs: new Map() };
    e.v += v;
    e.subs.set(id, (e.subs.get(id) ?? 0) + v);
    tops.set(t, e);
  }
  const catRows = [...tops.entries()]
    .filter(([, e]) => e.v > 0.004)
    .map(([id, e]) => ({
      c: category(id),
      v: e.v,
      avg: average(idx, month, spendInTop(id)),
      prev: spendInTop(id)(idx.months.get(prevKey)),
      // Razčlenitev pokažemo le, če je vsaj ena podkategorija (ne samo glavna kategorija)
      subs: [...e.subs.entries()].some(([sid]) => sid !== id)
        ? [...e.subs.entries()].filter(([, v]) => v > 0.004).sort((a, b) => b[1] - a[1]).map(([sid, v]) => ({ c: category(sid), v, isTop: sid === id }))
        : [],
    }))
    .sort((a, b) => b.v - a.v);
  const catMax = Math.max(1, ...catRows.map(r => Math.max(r.v, r.avg ?? 0)));
  const hasAvg = catRows.some(r => r.avg != null);

  // Največji trgovci
  const monthTx = state.transactions.filter(t => t.date.startsWith(month) && t.currency === BASE_CURRENCY);
  const merchants = new Map();
  for (const t of monthTx) {
    if (kindOf(t.categoryId) !== 'expense' || t.amount >= 0) continue;
    const key = normalize(t.description) || '—';
    const e = merchants.get(key) ?? { name: t.description || 'Brez opisa', sum: 0, count: 0, c: category(t.categoryId) };
    e.sum -= t.amount;
    e.count++;
    merchants.set(key, e);
  }
  const topMerchants = [...merchants.values()].sort((a, b) => b.sum - a.sum).slice(0, 5);
  const uncategorized = monthTx.filter(t => t.categoryId === 'other').length;

  // Graf: do 12 mesecev, vsaj 6
  let start = addMonths(month, -11);
  if (idx.first && idx.first > start) start = idx.first;
  if (start > addMonths(month, -5)) start = addMonths(month, -5);
  const chartData = [];
  for (let k = start; k <= month; k = addMonths(k, 1)) {
    chartData.push({ key: k, label: monthLabel(k, 'short').replace('.', ''), tooltipLabel: monthLabel(k), value: spendOf(idx.months.get(k)), selected: k === month });
  }

  const balance = income - spend;

  view.innerHTML = `
    <header class="page-head month-head">
      <a class="icon-btn" href="#/pregled?m=${addMonths(month, -1)}" aria-label="Prejšnji mesec">${icons.chevronLeft}</a>
      <h1>${esc(monthLabel(month))}</h1>
      ${month < now ? `<a class="icon-btn" href="#/pregled?m=${addMonths(month, 1)}" aria-label="Naslednji mesec">${icons.chevronRight}</a>` : '<span class="icon-btn disabled"></span>'}
    </header>

    <section class="card hero">
      <div class="hero-label">Porabljeno ${isCurrent ? 'ta mesec' : `v mesecu ${esc(monthLabel(month, 'long').toLowerCase())}`}</div>
      <div class="hero-value">${money(spend)}</div>
      <div class="deltas">
        ${delta(spend, prevSpend, 'prejšnji mesec')}
        ${delta(spend, avgSpend, 'povprečje zadnjih mesecev')}
      </div>
      ${projection ? `<p class="muted small">Napoved do konca meseca: približno <b>${money0(projection)}</b>${upcomingFixed > 0 ? ` (od tega še ${money0(upcomingFixed)} ponavljajočih stroškov)` : ''}.</p>` : ''}
    </section>

    <div class="tiles">
      <div class="tile"><div class="tile-label">Prihodki</div><div class="tile-value">${money(income)}</div></div>
      <div class="tile"><div class="tile-label">Bilanca</div><div class="tile-value ${balance >= 0 ? 'good' : 'bad'}">${signedMoney(balance)}</div></div>
      <div class="tile"><div class="tile-label">Povprečno na dan</div><div class="tile-value">${money(spend / daysCounted)}</div></div>
    </div>

    ${uncategorized ? `<a class="card hint" href="#/transakcije?m=${month}&c=other">📦 ${plural(uncategorized, TX_FORMS)} v kategoriji »Ostalo« · <b>razvrsti</b> in aplikacija si bo zapomnila →</a>` : ''}

    <section class="card">
      <h2>Poraba po mesecih</h2>
      <div class="chart" id="monthChart"></div>
    </section>

    ${isCurrent ? `
    <div class="two-col">
      <section class="card">
        <div class="card-head">
          <h2>Napoved</h2>
          ${variableAvg != null && seriesRows.length ? '<div class="legend"><span><i class="key-bar"></i>ponavljajoči</span><span><i class="key-bar soft"></i>ostalo (ocena)</span></div>' : ''}
        </div>
        ${variableAvg == null && !seriesRows.length
          ? '<p class="muted small">Napoved za naslednje mesece se pokaže, ko bo dovolj podatkov (približno teden dni) ali ko označiš ponavljajoče stroške.</p>'
          : `<div class="forecast">${forecast.map(r => `
              <div class="fc-row" title="Ponavljajoči ${money0(r.fixed)}${variableAvg != null ? ` · ostalo ~${money0(r.variable)}` : ''}">
                <span class="fc-month">${esc(monthLabel(r.k, 'short').replace('.', ''))}</span>
                <span class="fc-bar"><i style="width:${(r.fixed / forecastMax) * 100}%"></i><i class="soft" style="width:${(r.variable / forecastMax) * 100}%"></i></span>
                <span class="fc-amt">${variableAvg != null ? '~' : ''}${money0(r.total)}</span>
              </div>`).join('')}</div>
            <p class="muted small">${variableAvg != null
              ? `Ponavljajoči stroški + povprečje ostale porabe${pastVariable.length ? ` zadnjih ${pastVariable.length === 1 ? 'mesec' : `${pastVariable.length} mesecev`}` : ' ta mesec'} (~${money0(variableAvg)}/mesec).`
              : 'Zaenkrat samo ponavljajoči stroški. Ocena ostale porabe se doda, ko bo dovolj podatkov.'}
              ${forecast.some(r => r.income) ? ` Pričakovani ponavljajoči prihodki: ~${money0(forecast[0].income)}/mesec.` : ''}</p>`}
      </section>

      <section class="card">
        <h2>Ponavljajoči stroški</h2>
        ${seriesRows.length ? `
          <div class="series-list">${seriesRows.map(r => `
            <button class="tx-row" data-series="${esc(r.s.id)}">
              <span class="emoji-badge">${esc(r.c.emoji)}</span>
              <span class="tx-main">
                <span class="tx-desc">${esc(r.s.description || r.c.name)}</span>
                <span class="tx-meta">${esc(EVERY[r.s.every].short)}${r.next ? ` · naslednjič ${esc(dayShort(r.next))}` : ''}</span>
              </span>
              <span class="tx-amt${r.s.amount > 0 ? ' income' : ''}">${signedMoney(r.s.amount, r.s.currency)}</span>
            </button>`).join('')}</div>
          <p class="series-total">Skupaj <b>${money(fixedPerMonth)}</b> na mesec · <b>${money0(fixedPerMonth * 12)}</b> na leto</p>`
        : '<p class="muted small">Pri vnosu stroška izberi <b>Ponavljanje</b> (npr. naročnina vsak mesec, zavarovanje vsako leto). Aplikacija ga bo nato dodajala sama in upoštevala v napovedi.</p>'}
      </section>
    </div>` : ''}

    <div class="two-col">
      <section class="card">
        <div class="card-head">
          <h2>Po kategorijah</h2>
          ${hasAvg ? '<div class="legend"><span><i class="key-bar"></i>ta mesec</span><span><i class="key-tick"></i>povprečje</span></div>' : ''}
        </div>
        ${catRows.length ? `<div class="cat-list">${catRows.map((r, i) => {
          const share = spend > 0 ? r.v / spend : 0;
          let note = '';
          if (r.avg != null && r.avg > 0) {
            const d = (r.v - r.avg) / r.avg;
            // Majhne razlike (pod 10 % ali pod 10 €) niso vredne opozorila.
            if (Math.abs(d) >= 0.1 && Math.abs(r.v - r.avg) >= 10) note = ` · <span class="delta ${d > 0 ? 'bad' : 'good'}">${d > 0 ? '▲' : '▼'} ${Math.round(Math.abs(d) * 100)} % ${d > 0 ? 'nad' : 'pod'} povprečjem</span>`;
          } else if (r.avg === 0) note = ' · <span class="muted">novo ta mesec</span>';
          const href = c => `#/transakcije?m=${month}&c=${encodeURIComponent(c.id)}`;
          return `
            <div class="cat-row" data-i="${i}" data-href="${href(r.c)}">
              <span class="emoji-badge">${esc(r.c.emoji)}</span>
              <span class="cat-main">
                <a class="cat-top" href="${href(r.c)}"><span class="cat-name">${esc(r.c.name)}</span><span class="cat-amt">${money(r.v)}</span></a>
                <span class="cat-bar"><i style="width:${(r.v / catMax) * 100}%"></i>${r.avg ? `<b style="left:${(r.avg / catMax) * 100}%"></b>` : ''}</span>
                <span class="cat-sub">${Math.round(share * 100)} % porabe${note}</span>
                ${r.subs.length ? `<span class="sub-pills">${r.subs.map(s => `<a href="${href(s.c)}">${esc(s.isTop ? '—' : s.c.emoji)} ${esc(s.isTop ? 'brez podkategorije' : s.c.name)} <b>${money0(s.v)}</b></a>`).join('')}</span>` : ''}
              </span>
            </div>`;
        }).join('')}</div>` : '<p class="muted">Ta mesec še ni stroškov.</p>'}
      </section>

      <section class="card">
        <h2>Kje največ porabiš</h2>
        ${topMerchants.length ? `<ol class="merchants">${topMerchants.map(m => `
          <li><a href="#/transakcije?m=${month}&q=${encodeURIComponent(m.name)}">
            <span class="emoji-badge">${esc(m.c.emoji)}</span>
            <span class="tx-main"><span class="tx-desc">${esc(m.name)}</span><span class="tx-meta">${m.count}× · ${esc(m.c.name)}</span></span>
            <span class="tx-amt">${money(m.sum)}</span>
          </a></li>`).join('')}</ol>` : '<p class="muted">Ni podatkov.</p>'}
      </section>
    </div>

    ${idx.otherCurrency ? `<p class="muted small">${plural(idx.otherCurrency, TX_FORMS)} v tujih valutah ni vštetih v seštevke.</p>` : ''}`;

  columnChart(view.querySelector('#monthChart'), chartData, {
    format: v => money(v),
    axisFormat: v => money0(v),
    ariaLabel: 'Poraba po mesecih',
    onSelect: key => { location.hash = `#/pregled?m=${key}`; },
  });

  // Klik na ponavljajoči strošek odpre njegovo zadnjo transakcijo (sprememba zneska velja za naprej).
  view.querySelectorAll('[data-series]').forEach(btn => btn.addEventListener('click', () => {
    const latest = state.transactions.filter(t => t.seriesId === btn.dataset.series).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (latest) openTxDialog(latest);
  }));

  // Namig nad kategorijo (miška): ta mesec, prejšnji mesec, povprečje.
  view.querySelectorAll('.cat-row').forEach(el => {
    const r = catRows[el.dataset.i];
    const html = `<div class="tip-title">${esc(r.c.emoji)} ${esc(r.c.name)}</div>
      <div class="tip-row"><span>Ta mesec</span><b>${money(r.v)}</b></div>
      <div class="tip-row"><span>Prejšnji mesec</span><b>${money(r.prev)}</b></div>
      ${r.avg != null ? `<div class="tip-row"><span>Povprečje</span><b>${money(r.avg)}</b></div>` : ''}`;
    el.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      if (e.target.closest('.sub-pills')) hideTip();
      else showTip(html, e.clientX, e.clientY);
    });
    el.addEventListener('pointerleave', hideTip);
    el.addEventListener('click', e => { if (!e.target.closest('a')) location.hash = el.dataset.href; });
  });
}
