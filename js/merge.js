// Združevanje podatkov dveh naprav. Vsak zapis ima id in updatedAt; novejši zmaga.
// Izbrisi so zapisani kot »nagrobniki« (tombstones), da se izbrisan zapis ne vrne z druge naprave.

export const SYNCED_STORES = ['transactions', 'categories', 'rules'];

export function mergeData(a, b, now = Date.now()) {
  const tombstones = {};
  for (const s of SYNCED_STORES) {
    tombstones[s] = { ...(a.tombstones?.[s] ?? {}) };
    for (const [id, ts] of Object.entries(b.tombstones?.[s] ?? {})) tombstones[s][id] = Math.max(tombstones[s][id] ?? 0, ts);
  }

  const out = { tombstones };
  for (const s of SYNCED_STORES) {
    const byId = new Map();
    for (const r of [...(a[s] ?? []), ...(b[s] ?? [])]) {
      const cur = byId.get(r.id);
      if (!cur || (r.updatedAt ?? 0) > (cur.updatedAt ?? 0)) byId.set(r.id, r);
    }
    out[s] = [...byId.values()].filter(r => !((tombstones[s][r.id] ?? -1) >= (r.updatedAt ?? 0)));
  }

  // Isti izpisek, uvožen na dveh napravah pred sinhronizacijo: obdrži eno kopijo.
  const byHash = new Map();
  for (const t of out.transactions) {
    if (!t.importHash) continue;
    const keep = byHash.get(t.importHash);
    if (!keep) { byHash.set(t.importHash, t); continue; }
    const [winner, loser] = (t.updatedAt ?? 0) > (keep.updatedAt ?? 0) || ((t.updatedAt ?? 0) === (keep.updatedAt ?? 0) && t.id < keep.id) ? [t, keep] : [keep, t];
    byHash.set(t.importHash, winner);
    tombstones.transactions[loser.id] = now;
  }
  out.transactions = out.transactions.filter(t => !(tombstones.transactions[t.id] >= (t.updatedAt ?? 0)));
  return out;
}

/** Kratek povzetek stanja: če se ujema, sta podatka enaka. */
export function signature(data) {
  return SYNCED_STORES.map(s => [
    (data[s] ?? []).map(r => `${r.id}:${r.updatedAt ?? 0}`).sort().join(','),
    Object.entries(data.tombstones?.[s] ?? {}).map(([id, ts]) => `${id}:${ts}`).sort().join(','),
  ].join('|')).join('#');
}
