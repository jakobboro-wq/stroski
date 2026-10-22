import { state, category, kindOf, BASE_CURRENCY } from '../store.js';
import { normalize } from '../categorize.js';
import { buildIndex, addMonths, average, spendOf, incomeOf, catSpendOf, daysInMonth } from '../stats.js';
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

  // Napoved do konca meseca (linearno), le za tekoči mesec.
  const projection = isCurrent && today >= 3 && today < dim ? (spend / today) * dim : null;

  // Kategorije
  const catRows = [...(cur?.byCat ?? new Map()).entries()]
    .filter(([, v]) => v > 0.004)
    .map(([id, v]) => ({ c: category(id), v, avg: average(idx, month, catSpendOf(id)), prev: catSpendOf(id)(idx.months.get(prevKey)) }))
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
      ${projection ? `<p class="muted small">Če nadaljuješ s tem tempom: približno <b>${money0(projection)}</b> do konca meseca.</p>` : ''}
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
          return `
            <a class="cat-row" data-i="${i}" href="#/transakcije?m=${month}&c=${encodeURIComponent(r.c.id)}">
              <span class="emoji-badge">${esc(r.c.emoji)}</span>
              <span class="cat-main">
                <span class="cat-top"><span class="cat-name">${esc(r.c.name)}</span><span class="cat-amt">${money(r.v)}</span></span>
                <span class="cat-bar"><i style="width:${(r.v / catMax) * 100}%"></i>${r.avg ? `<b style="left:${(r.avg / catMax) * 100}%"></b>` : ''}</span>
                <span class="cat-sub">${Math.round(share * 100)} % porabe${note}</span>
              </span>
            </a>`;
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

  // Namig nad kategorijo (miška): ta mesec, prejšnji mesec, povprečje.
  view.querySelectorAll('.cat-row').forEach(el => {
    const r = catRows[el.dataset.i];
    const html = `<div class="tip-title">${esc(r.c.emoji)} ${esc(r.c.name)}</div>
      <div class="tip-row"><span>Ta mesec</span><b>${money(r.v)}</b></div>
      <div class="tip-row"><span>Prejšnji mesec</span><b>${money(r.prev)}</b></div>
      ${r.avg != null ? `<div class="tip-row"><span>Povprečje</span><b>${money(r.avg)}</b></div>` : ''}`;
    el.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') showTip(html, e.clientX, e.clientY); });
    el.addEventListener('pointerleave', hideTip);
  });
}
