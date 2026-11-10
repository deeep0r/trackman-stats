// Saisonwertung: Rechenkern, Verschlüsselung und Darstellung. Wird in die Stats-Seite und in Trackman Live eingebunden.
var TMSeason = (function () {
  'use strict';
  const PLACE_POINTS = { 2: [3, 0], 3: [7, 5, 3], 4: [10, 7, 5, 3] };
  const PAR_BONUS_EVEN = 1, PAR_BONUS_UNDER = 3, BEST_ROUND_BONUS = 10;
  const MP_WIN = 2, MP_DRAW = 1, MP_LOSS = 0;
  const SPLIT_DAY = [2, 1, 0];

  // Anzahl gewerteter Runden: bis 3 alle, bei 4 fällt eine raus, ab 5 kaufmännisch gerundet 60 %
  function countedRounds(n) {
    if (n <= 3) return n;
    if (n === 4) return 3;
    return Math.floor(n * 0.6 + 0.5);
  }

  // Punkte für Plätze mit Gleichstand: Punkte der belegten Plätze addieren und teilen
  function placePoints(values, table) {
    const idx = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
    const out = new Array(values.length).fill(0), rank = new Array(values.length).fill(0);
    let k = 0;
    while (k < idx.length) {
      let j = k; while (j + 1 < idx.length && values[idx[j + 1]] === values[idx[k]]) j++;
      let sum = 0; for (let t = k; t <= j; t++) sum += table[t] || 0;
      for (let t = k; t <= j; t++) { out[idx[t]] = sum / (j - k + 1); rank[idx[t]] = k + 1; }
      k = j + 1;
    }
    return { points: out, rank };
  }

  function holesWon(sA, sB) {
    let a = 0, b = 0, h = 0;
    for (let i = 0; i < sA.length; i++) { if (sA[i] == null || sB[i] == null) continue; if (sA[i] < sB[i]) a++; else if (sA[i] > sB[i]) b++; else h++; }
    return { a, b, h };
  }

  // Split Sixes / American Points: pro Loch 6 Punkte (4/2/0), Gleichstände geteilt
  function splitSixes(scores) {
    const tot = [0, 0, 0], perHole = [];
    for (let i = 0; i < scores[0].length; i++) {
      const v = [scores[0][i], scores[1][i], scores[2][i]];
      if (v.some(x => x == null)) { perHole.push(null); continue; }
      const p = placePoints(v, [4, 2, 0]).points;
      perHole.push(p); p.forEach((x, k) => tot[k] += x);
    }
    return { tot, perHole };
  }

  function dayPointsSplit(tot) {
    // Gesamtwertung Split Sixes: 2/1/0, bei Punktgleichheit die Punkte der besseren Platzierung
    const idx = [0, 1, 2].sort((a, b) => tot[b] - tot[a]);
    const out = [0, 0, 0];
    let k = 0;
    while (k < 3) { let j = k; while (j + 1 < 3 && tot[idx[j + 1]] === tot[idx[k]]) j++; for (let t = k; t <= j; t++) out[idx[t]] = SPLIT_DAY[k]; k = j + 1; }
    return out;
  }

  function localDate(iso) { const d = new Date(iso); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  // ---------- Saison berechnen ----------
  function compute(season) {
    const cfg = season.config || {};
    const parts = new Set(cfg.participants || []);
    const rounds = [...(season.rounds || [])].sort((a, b) => (a.date < b.date ? -1 : 1));
    const R = [];
    for (const r of rounds) {
      const day = localDate(r.date);
      const inWindow = (!cfg.start || day >= cfg.start) && (!cfg.end || day <= cfg.end);
      const holesN = (r.par || []).length;
      const only = r.only || (season.only || {})[r.id] || null;
      const players = (r.projected ? (r.players || []).filter(p => parts.has(p.name) && p.thru > 0)
        : (r.players || []).filter(p => parts.has(p.name) && p.scores && p.scores.length === holesN && p.scores.every(x => x != null)))
        .filter(p => !only || only.includes(p.name));
      const autoOk = inWindow && players.length >= 2;
      const included = r.include === true ? true : r.include === false ? false : autoOk;
      let why = '';
      if (!inWindow) why = 'außerhalb des Saisonzeitraums';
      else if (players.length < 2) why = 'weniger als 2 Teilnehmer mit vollständiger Runde';
      const parTot = (r.par || []).reduce((s, x) => s + x, 0);
      const rr = { only, projected: !!r.projected, id: r.id, date: r.date, day, course: r.course, tee: r.tee, holes: holesN, parTot, par: r.par, include: r.include, auto: autoOk, included, why, players: [], match: null, warn: '' };
      players.forEach(p => { if (r.projected) { rr.players.push({ name: p.name, tee: p.tee, scores: null, gross: p.gross, toPar: p.toPar, thru: p.thru }); return; } const gross = p.scores.reduce((s, x) => s + x, 0); rr.players.push({ name: p.name, tee: p.tee, scores: p.scores, gross, toPar: gross - parTot }); });
      const tees = new Set(rr.players.map(p => p.tee).filter(Boolean));
      const n = rr.players.length;
      if (included && n >= 2) {
        const table = PLACE_POINTS[n];
        if (!table) rr.warn = `Punkte für ${n} Spieler sind im Reglement nicht festgelegt`;
        if (tees.size > 1) rr.warn = (rr.warn ? rr.warn + ' · ' : '') + 'Unterschiedliche Tees: ' + [...tees].join(', ');
        const pp = placePoints(rr.players.map(p => p.toPar), table || []);
        rr.players.forEach((p, i) => {
          p.rank = pp.rank[i]; p.place = table ? pp.points[i] : 0;
          p.bonus = p.toPar < 0 ? PAR_BONUS_UNDER : p.toPar === 0 ? PAR_BONUS_EVEN : 0;
          p.points = p.place + p.bonus; p.mp = 0;
        });
        // Matchplay
        if (r.projected) {
          rr.players.forEach(p => { p.mp = (r.mp || {})[p.name] || 0; if (r.split && r.split[p.name] != null) p.split = r.split[p.name]; });
          rr.match = { type: 'projected', note: r.mpNote || '' };
        } else if (n === 2) {
          const [A, B] = rr.players, w = holesWon(A.scores, B.scores);
          const res = w.a > w.b ? [MP_WIN, MP_LOSS] : w.a < w.b ? [MP_LOSS, MP_WIN] : [MP_DRAW, MP_DRAW];
          A.mp = res[0]; B.mp = res[1];
          rr.match = { type: 'duel', duels: [{ a: A.name, b: B.name, won: w, pts: res }] };
        } else if (n === 4) {
          const pairs = (r.pairings || (season.pairings || {})[r.id] || []).filter(pq => pq && pq.length === 2);
          const names = rr.players.map(p => p.name);
          const valid = pairs.length === 2 && new Set(pairs.flat()).size === 4 && pairs.flat().every(x => names.includes(x));
          if (!valid) rr.match = { type: 'duel', missing: true, duels: [] };
          else {
            const duels = pairs.map(([a, b]) => {
              const A = rr.players.find(p => p.name === a), B = rr.players.find(p => p.name === b), w = holesWon(A.scores, B.scores);
              const res = w.a > w.b ? [MP_WIN, MP_LOSS] : w.a < w.b ? [MP_LOSS, MP_WIN] : [MP_DRAW, MP_DRAW];
              A.mp = res[0]; B.mp = res[1];
              return { a, b, won: w, pts: res };
            });
            rr.match = { type: 'duel', duels };
          }
        } else if (n === 3) {
          const ss = splitSixes(rr.players.map(p => p.scores)), dp = dayPointsSplit(ss.tot);
          rr.players.forEach((p, i) => { p.split = ss.tot[i]; p.mp = dp[i]; });
          rr.match = { type: 'split', tot: ss.tot, pts: dp };
        } else rr.match = { type: 'none' };
      }
      R.push(rr);
    }
    // Spieler aufsummieren
    const P = {};
    (cfg.participants || []).forEach(name => P[name] = { name, rounds: [], mp: 0 });
    const inc = R.filter(r => r.included && r.players.length >= 2);
    inc.forEach(r => r.players.forEach(p => { if (!P[p.name]) P[p.name] = { name: p.name, rounds: [], mp: 0 }; P[p.name].rounds.push({ r, p }); P[p.name].mp += p.mp || 0; }));
    // beste Runde der Saison (gegen Par) – Bonus wandert, bei Gleichstand alle
    let best = null;
    inc.forEach(r => r.players.forEach(p => { if (best === null || p.toPar < best) best = p.toPar; }));
    const bestHolders = new Set(); const bestRounds = [];
    if (best !== null) inc.forEach(r => r.players.forEach(p => { if (p.toPar === best) { bestHolders.add(p.name); bestRounds.push({ name: p.name, day: r.day, course: r.course }); } }));
    const table = Object.values(P).map(pl => {
      const n = pl.rounds.length, k = countedRounds(n);
      // gewertet: höchste Rundenpunkte; bei Gleichheit die bessere Runde gegen Par, dann die frühere
      const sorted = [...pl.rounds].sort((x, y) => y.p.points - x.p.points || x.p.toPar - y.p.toPar || (x.r.date < y.r.date ? -1 : 1));
      const counted = new Set(sorted.slice(0, k).map(x => x.r.id));
      pl.rounds.forEach(x => x.counted = counted.has(x.r.id));
      const c = pl.rounds.filter(x => x.counted);
      const roundPts = c.reduce((s, x) => s + x.p.points, 0);
      const bonus = bestHolders.has(pl.name) ? BEST_ROUND_BONUS : 0;
      const totPar = c.reduce((s, x) => s + x.p.toPar, 0);
      const bestRound = pl.rounds.reduce((m, x) => (m === null || x.p.toPar < m ? x.p.toPar : m), null);
      return { name: pl.name, played: n, counted: k, struck: n - k, roundPts, bonus, einzel: roundPts + bonus, total: roundPts + bonus + pl.mp, mp: pl.mp, totPar: c.length ? totPar : null, avgPar: c.length ? totPar / c.length : null, best: bestRound, rounds: pl.rounds };
    });
    return { config: cfg, rounds: R, included: inc, table, best, bestRounds, rules: { countedRounds } };
  }

  // ---------- Verschlüsselung (AES-GCM, Schlüssel aus Passwort per PBKDF2-SHA256) ----------
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = buf => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function key(pw, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encrypt(obj, pw) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(pw, salt), enc.encode(JSON.stringify(obj)));
    return { format: 'tmseason-1', salt: b64(salt), iv: b64(iv), data: b64(ct) };
  }
  async function decrypt(file, pw) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(file.iv) }, await key(pw, unb64(file.salt)), unb64(file.data));
    return JSON.parse(dec.decode(pt));
  }

  // ---------- Darstellung ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fmtPts = v => v == null ? '–' : (Math.round(v * 10) / 10).toLocaleString('de-DE', { maximumFractionDigits: 1 });
  const fmtPar = v => v == null ? '–' : v === 0 ? 'E' : (v > 0 ? '+' : '') + (Math.round(v * 10) / 10).toLocaleString('de-DE', { maximumFractionDigits: 1 });
  const fmtDay = d => { const [y, m, t] = d.split('-'); return t + '.' + m + '.'; };

  const CSS = `
  .tms { --tms-line: var(--line, #e3e1dc); --tms-muted: var(--muted, #7a7974); --tms-surface: var(--surface, #fcfcfb); --tms-accent: var(--accent, #2a78d6); --tms-text: var(--text, #0b0b0b); --tms-prj:#c4560f; --tms-prj-bg:rgba(235,104,52,.10); --tms-mp:#2a78d6; --tms-pb:#14875f; }
  @media (prefers-color-scheme: dark) { .tms { --tms-prj:#f08a4b; --tms-prj-bg:rgba(240,138,75,.14); --tms-mp:#6aa8f0; --tms-pb:#3cc48f; } }
  .tms table { border-collapse:collapse; width:100%; font-size:13px; font-variant-numeric:tabular-nums; }
  .tms th, .tms td { padding:6px 8px; border-bottom:1px solid var(--tms-line); text-align:right; white-space:nowrap; }
  .tms th:first-child, .tms td:first-child, .tms .l { text-align:left; }
  .tms th.sort { cursor:pointer; user-select:none; } .tms th.sort:hover { color:var(--tms-accent); }
  .tms th.sort::after { content:' ⇅'; opacity:.35; font-size:11px; } .tms th.asc::after { content:' ▲'; opacity:.9; } .tms th.desc::after { content:' ▼'; opacity:.9; }
  .tms .titles { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:10px; margin:6px 0 14px; }
  .tms .titles > div { background:var(--tms-surface); border:1px solid var(--tms-line); border-radius:10px; padding:10px 12px; }
  .tms .titles .k { font-size:12px; color:var(--tms-muted); } .tms .titles .v { font-size:20px; font-weight:650; }
  .tms .cnt { font-weight:650; } .tms .str { color:var(--tms-muted); text-decoration:line-through; } .tms .mpx { color:var(--tms-muted); font-size:12px; }
  .tms .na { color:var(--tms-muted); } .tms .wrap { overflow-x:auto; }
  .tms details.rd { border-top:1px solid var(--tms-line); padding:6px 0; } .tms details.rd summary { cursor:pointer; font-size:14px; }
  .tms .badge { font-size:11px; padding:1px 7px; border-radius:10px; background:var(--tms-surface); border:1px solid var(--tms-line); margin-left:6px; }
  .tms .badge.off { opacity:.7; } .tms .warn { color:#b5541b; font-size:12px; }
  .tms table.st td.rc, .tms table.st th.rc, .tms table.st .rtog ~ .rc { display:none; }
  .tms table.st.ropen td.rc, .tms table.st.ropen th.rc { display:table-cell; }
  .tms table.st th.rtog, .tms table.st td.rtog { padding:0 4px; } .tms .rtgl { font:inherit; font-size:12px; padding:2px 8px; border-radius:6px; border:1px solid var(--tms-line); background:transparent; color:var(--tms-muted); cursor:pointer; white-space:nowrap; }
  .tms th.rc { font-size:11px; font-weight:500; text-align:center; } .tms td.rc { text-align:center; padding:4px 6px; }
  .tms .rcp { background:var(--tms-prj-bg); } .tms th.rcp { color:var(--tms-prj); }
  .tms .rcb { position:relative; display:inline-block; min-width:30px; padding:7px 15px 7px 2px; line-height:1; }
  .tms .rcn { font-size:14px; font-weight:600; } .tms .rmp, .tms .rpb { position:absolute; right:0; font-size:10px; font-weight:600; }
  .tms .rmp { top:0; color:var(--tms-mp); } .tms .rpb { bottom:0; color:var(--tms-pb); } .tms .rmp0 { color:var(--tms-mp); font-weight:600; } .tms .rpb0 { color:var(--tms-pb); font-weight:600; }
  .tms .rpb.str { text-decoration:line-through; color:var(--tms-muted); }
  .tms .prj { color:var(--tms-prj); font-weight:650; } .tms .dlt { color:var(--tms-prj); font-size:11px; font-weight:500; }
  .tms .prjnote { font-size:12px; margin:0 0 8px; padding:6px 10px; border-radius:8px; background:var(--tms-prj-bg); color:var(--tms-text); }
  .tms .rleg { display:flex; gap:12px; align-items:center; font-size:12px; color:var(--tms-muted); margin:6px 0 2px; } .tms .rleg .rcb { border:1px dashed var(--tms-line); border-radius:6px; padding:8px 16px 8px 6px; }
  .tms .hide { display:none; }
  .tms h3 { font-size:15px; margin:18px 0 8px; } .tms .sub { color:var(--tms-muted); font-size:12px; margin:0 0 8px; }`;

  function titlesHTML(S) {
    const t = S.table;
    const lead = (f, better) => { const vals = t.filter(x => f(x) != null); if (!vals.length) return null; const b = vals.reduce((m, x) => (m === null || better(f(x), f(m)) ? x : m), null); return vals.filter(x => f(x) === f(b)); };
    const l1 = lead(x => x.played && x.total > 0 ? x.total : null, (a, b) => a > b), l2 = lead(x => x.played && x.mp > 0 ? x.mp : null, (a, b) => a > b), l3 = lead(x => x.best, (a, b) => a < b);
    const names = a => a ? a.map(x => esc(x.name)).join(', ') : '–';
    return `<div class="titles"><div><div class="k">Winter-Tour-Champion (Gesamtpunkte)</div><div class="v">${names(l1)}</div><div class="k">${l1 ? fmtPts(l1[0].total) + ' Punkte' : ''}</div></div>
      <div><div class="k">Matchplay-Champion</div><div class="v">${names(l2)}</div><div class="k">${l2 ? fmtPts(l2[0].mp) + ' Punkte' : ''}</div></div>
      <div><div class="k">Low-Score-Champion (beste Runde)</div><div class="v">${names(l3)}</div><div class="k">${l3 ? fmtPar(l3[0].best) + ' gegen Par' : ''}</div></div></div>`;
  }

  // Gesamttabelle mit aufklappbaren Punkten je Runde.
  // opts.full: alle Spalten (Saison-Tab); opts.base: offizieller Stand ohne die laufende Runde (dann ist S die Prognose)
  let roundsOpen = false;
  function standingsHTML(S, opts = {}) {
    const t = S.table, B = opts.base || null;
    if (!t.length) return '<p class="sub">Noch keine Teilnehmer.</p>';
    const rankOf = (tab) => { const m = {}; tab.forEach(x => m[x.name] = 1 + tab.filter(y => y.total > x.total).length); return m; };
    const rk = rankOf(t), rk0 = B ? rankOf(B.table) : null, base = n => B ? B.table.find(x => x.name === n) : null;
    const rows = [...t].sort((a, b) => b.total - a.total || b.einzel - a.einzel || (a.best ?? 99) - (b.best ?? 99) || a.name.localeCompare(b.name, 'de'));
    const inc = S.included, proj = inc.find(r => r.projected);
    const fmtD = v => (v > 0 ? '+' : '') + fmtPts(v);
    // Wert mit Prognose-Markierung
    const val = (r, k, f) => { const v = r[k], b0 = base(r.name), d = b0 && b0[k] != null && v != null ? v - b0[k] : 0; return `<span class="${B && d ? 'prj' : ''}">${f(v)}</span>${B && d ? ` <span class="dlt">${fmtD(d)}</span>` : ''}`; };
    const rcell = (r, rd) => {
      const x = r.rounds.find(z => z.r.id === rd.id);
      if (!x) return `<td class="rc${rd.projected ? ' rcp' : ''}" data-v=""><span class="na">–</span></td>`;
      const mp = x.p.mp || 0, pb = x.p.bonus || 0, st = x.counted ? '' : ' str';
      const tt = `${x.p.gross} Schläge (${fmtPar(x.p.toPar)}${rd.projected ? ', Stand jetzt nach ' + x.p.thru + ' Loch' : ''}) · Platz ${x.p.rank}: ${fmtPts(x.p.place)} Punkte · Par-Bonus ${pb} · Matchplay ${fmtPts(mp)}${x.counted ? '' : ' · Rundenpunkte gestrichen'}`;
      return `<td class="rc${rd.projected ? ' rcp' : ''}" data-v="${x.p.points + mp}" title="${esc(tt)}"><span class="rcb"><span class="rcn${st}">${fmtPts(x.p.place)}</span>${mp ? `<span class="rmp">+${fmtPts(mp)}</span>` : ''}${pb ? `<span class="rpb${st}">+${pb}</span>` : ''}</span></td>`;
    };
    const cols = [
      ['#', 'rank', 'n', 'Platz in der Saison', r => `${rk[r.name]}.${rk0 && rk0[r.name] !== rk[r.name] ? ` <span class="dlt">${rk0[r.name] > rk[r.name] ? '▲' : '▼'}${Math.abs(rk0[r.name] - rk[r.name])}</span>` : ''}`, r => rk[r.name]],
      ['Spieler', 'name', 's', 'Name in Trackman', r => esc(r.name), r => r.name],
      ['Gesamt', 'total', 'n', 'Gesamt = Rundenpunkte + Matchplay + Bonus beste Runde', r => `<b>${val(r, 'total', fmtPts)}</b>`, r => r.total],
      ['Rundenpunkte', 'roundPts', 'n', 'Platz- und Par-Punkte der gewerteten Runden (Streicher abgezogen)', r => val(r, 'roundPts', fmtPts), r => r.roundPts],
      ['Matchplay', 'mp', 'n', 'Matchplay- bzw. Split-Sixes-Punkte aller Runden, nie gestrichen', r => val(r, 'mp', fmtPts), r => r.mp],
      ['Bonus beste Runde', 'bonus', 'n', '+10 für die bislang beste Runde der Saison gegen Par (wandert)', r => val(r, 'bonus', fmtPts), r => r.bonus],
      ['Runden', 'played', 'n', 'gespielt (davon gestrichen)', r => `${r.played}${r.struck ? ` <span class="na">(${r.struck} gestr.)</span>` : ''}`, r => r.played],
      ...(opts.full ? [['Total gegen Par', 'totPar', 'n', 'Summe der gewerteten Runden', r => fmtPar(r.totPar), r => r.totPar]] : []),
      ['Ø gegen Par', 'avgPar', 'n', 'Schnitt der gewerteten Runden', r => fmtPar(r.avgPar == null ? null : Math.round(r.avgPar * 10) / 10), r => r.avgPar],
      ['Beste Runde', 'best', 'n', 'beste Runde gegen Par (alle Runden)', r => fmtPar(r.best), r => r.best]];
    const rIdx = 6; // Rundenspalten nach „Bonus beste Runde“
    const head = cols.map(([l, k, ty, tt], i) => `<th class="sort${k === 'name' ? ' l' : ''}${k === 'total' ? ' desc' : ''}" data-k="${k}" data-t="${ty}" title="${esc(tt)}">${l}</th>` + (i === rIdx - 1 ? `<th class="rtog" title="Punkte je Runde ein-/ausblenden"><button class="rtgl" type="button">${roundsOpen ? '◂' : '▸'} je Runde</button></th>` + inc.map(rd => `<th class="sort rc${rd.projected ? ' rcp' : ''}" data-t="n" title="${esc(rd.course)}${rd.projected ? ' – laufende Runde, Stand jetzt' : ''}">${rd.projected ? 'heute' : fmtDay(rd.day)}</th>`).join('') : '')).join('');
    const body = rows.map(r => '<tr>' + cols.map(([l, k, ty, tt, f, v], i) => { const vv = v(r); return `<td class="${k === 'name' ? 'l' : ''}" data-v="${vv == null ? '' : esc(vv)}">${f(r)}</td>` + (i === rIdx - 1 ? '<td class="rtog"></td>' + inc.map(rd => rcell(r, rd)).join('') : ''); }).join('') + '</tr>').join('');
    const legend = `<div class="rleg"><span class="rcb"><span class="rcn">7</span><span class="rmp">+2</span><span class="rpb">+3</span></span><span><b>7</b> Platzpunkte · <span class="rmp0">+2</span> Matchplay · <span class="rpb0">+3</span> Par-Bonus (Par +1, unter Par +3) · <span class="str">durchgestrichen</span> = Rundenpunkte gestrichen, Matchplay zählt trotzdem${proj ? ' · <span class="prj">orange</span> = heutige Runde' : ''}</span></div>`;
    return (opts.titles ? titlesHTML(S) : '') +
      (B && proj ? `<p class="prjnote">So stünde die Saison, wenn die laufende Runde jetzt endete. <span class="prj">Orange</span> = ändert sich durch heute, kleine Zahl = Veränderung zum offiziellen Stand.</p>` : '') +
      `<div class="wrap"><table class="tms-sort st${roundsOpen ? ' ropen' : ''}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <div class="rlegw${roundsOpen ? '' : ' hide'}">${legend}</div>
      <p class="sub">Gesamt = Rundenpunkte der gewerteten Runden + Matchplay-Punkte + Bonus beste Runde. Gestrichen werden nur Rundenpunkte. Spaltenüberschrift anklicken zum Sortieren, „▸ je Runde“ zeigt die Punkte jeder Runde.</p>`;
  }
  function bindStandings(root) {
    bindSort(root);
    root.querySelectorAll('button.rtgl').forEach(b => b.onclick = e => {
      e.stopPropagation(); roundsOpen = !roundsOpen;
      root.querySelectorAll('table.st').forEach(t => t.classList.toggle('ropen', roundsOpen));
      root.querySelectorAll('.rlegw').forEach(x => x.classList.toggle('hide', !roundsOpen));
      root.querySelectorAll('button.rtgl').forEach(x => x.textContent = (roundsOpen ? '◂' : '▸') + ' je Runde');
    });
  }

  function roundsHTML(S, opts = {}) {
    const R = [...S.rounds].reverse().filter(r => opts.all || r.included || r.include === false);
    if (!R.length) return '<p class="sub">Keine Runden im Saisonzeitraum.</p>';
    return R.map(r => {
      const status = r.included ? 'zählt' : 'zählt nicht';
      const src = r.include === true ? 'von Hand aufgenommen' : r.include === false ? 'von Hand ausgeschlossen' : r.auto ? 'automatisch' : r.why;
      let body = '';
      if (r.players.length) {
        const ps = [...r.players].sort((a, b) => a.toPar - b.toPar);
        const struck = name => { const pl = S.table.find(x => x.name === name); const x = pl && pl.rounds.find(z => z.r.id === r.id); return x ? (x.counted ? '<span class="cnt">gewertet</span>' : '<span class="str">gestrichen</span>') : ''; };
        body += `<div class="wrap"><table><tr><th class="l">Spieler</th><th>Schläge</th><th>gegen Par</th><th>Platz</th><th>Platzpunkte</th><th>Par-Bonus</th><th>Rundenpunkte</th><th>Matchplay</th><th>Tag gesamt</th><th class="l">Rundenpunkte in der Saison</th></tr>` +
          ps.map(p => `<tr><td class="l">${esc(p.name)}</td><td>${p.gross}</td><td>${fmtPar(p.toPar)}</td><td>${r.included ? p.rank + '.' : '–'}</td><td>${r.included ? fmtPts(p.place) : '–'}</td><td>${r.included ? p.bonus : '–'}</td><td><b>${r.included ? fmtPts(p.points) : '–'}</b></td><td>${r.included ? fmtPts(p.mp) + (p.split != null ? ' (' + fmtPts(p.split) + ' Split-Sixes-Punkte)' : '') : '–'}</td><td>${r.included ? fmtPts(p.points + (p.mp || 0)) : '–'}</td><td class="l">${r.included ? struck(p.name) : ''}</td></tr>`).join('') + '</table></div>';
        if (r.included && r.match) {
          if (r.match.type === 'duel' && r.match.missing) body += '<p class="warn">Matchplay: Paarungen für diese Runde fehlen noch – in Trackman Live in der Tageswertung oder unter „Saison verwalten“ eintragen.</p>';
          else if (r.match.type === 'duel') body += '<p class="sub">Matchplay: ' + r.match.duels.map(d => `${esc(d.a)} – ${esc(d.b)}: ${d.won.a}:${d.won.b} Löcher (${d.won.h} geteilt) → ${d.pts[0]}:${d.pts[1]} Punkte`).join(' · ') + '</p>';
          else if (r.match.type === 'split') body += '<p class="sub">Split Sixes (4/2/0 pro Loch): ' + r.players.map((p, i) => `${esc(p.name)} ${fmtPts(r.match.tot[i])}`).join(' · ') + ' → Tagespunkte 2/1/0</p>';
        }
        if (r.warn) body += `<p class="warn">${esc(r.warn)}</p>`;
      } else body = '<p class="sub">Keine Teilnehmer mit vollständiger Runde.</p>';
      const extra = opts.editor ? opts.editor(r) : '';
      const isOpen = opts.openIds ? opts.openIds.has(r.id) : opts.open;
      const sumNames = r.players.map(p => esc(p.name)).join(', ') + (r.only ? ' <span class="na">(Auswahl)</span>' : '');
      return `<details class="rd" data-id="${esc(r.id)}"${isOpen ? ' open' : ''}><summary><b>${fmtDay(r.day)}</b> ${esc(r.course)} · ${sumNames || '–'}<span class="badge${r.included ? '' : ' off'}">${status} · ${esc(src)}</span></summary>${extra}${body}</details>`;
    }).join('');
  }

  function rulesHTML() {
    return `<details class="rd"><summary><b>Regeln und Rechenweg</b></summary><ul class="sub" style="font-size:13px;line-height:1.5">
      <li>Es zählen beendete Runden im Saisonzeitraum mit mindestens 2 Teilnehmern, die alle Löcher gespielt haben. Runden lassen sich von Hand aufnehmen oder ausschließen. Spieler außerhalb des Teilnehmerkreises werden ignoriert. Je Runde lässt sich festlegen, wer mitspielt (z. B. nur 3 von 4 für Split Sixes); nicht ausgewählte Spieler bekommen für diese Runde keine Punkte.</li>
      <li>Platzierung nach Brutto gegen Par. Punkte: 2 Spieler 3/0, 3 Spieler 7/5/3, 4 Spieler 10/7/5/3. Gleichstand: Punkte der belegten Plätze addieren und durch die Anzahl der Spieler teilen (z. B. zwei Zweite bei 4 Spielern: (7+5)/2 = je 6).</li>
      <li>Par-Bonus pro Runde: Runde auf Par +1, unter Par +3. Rundenpunkte = Platzpunkte + Par-Bonus.</li>
      <li>Streichergebnisse je Spieler: bis 3 Runden zählen alle, bei 4 Runden zählen 3, ab 5 Runden zählen 60 % kaufmännisch gerundet (5→3, 6→4, 7→4, 8→5, 10→6). Gewertet werden die Runden mit den meisten Punkten; bei gleichen Punkten die bessere Runde gegen Par, dann die frühere.</li>
      <li>Bonus beste Runde des Winters: +10 an den Spieler mit der bislang besten Runde gegen Par über die ganze Saison; wird sie verbessert, wandert der Bonus. Bei Gleichstand bekommen alle Inhaber +10. Der Bonus wird nicht gestrichen.</li>
      <li>Gesamtpunkte = Rundenpunkte der gewerteten Runden + Bonus beste Runde + alle Matchplay-Punkte. Danach wird der Winter-Tour-Champion bestimmt. „Total/Ø gegen Par“ beziehen sich nur auf die gewerteten Runden.</li>
      <li>Matchplay (brutto, Lochwettspiel über alle Löcher): 2 Spieler ein Duell, 4 Spieler zwei ausgeloste Duelle (Paarungen von Hand). Sieg 2, Unentschieden 1, Niederlage 0 Punkte.</li>
      <li>3 Spieler: Split Sixes – pro Loch 4/2/0 Punkte, Gleichstände geteilt (3/3/0, 4/1/1, 2/2/2). Tagessieger 2, Zweiter 1, Letzter 0 Punkte; bei Punktgleichheit die Punkte der besseren Platzierung. Matchplay-Punkte werden nie gestrichen. Matchplay-Champion ist, wer die meisten Matchplay-Punkte hat.</li>
      <li>Joker sind noch nicht umgesetzt.</li></ul></details>`;
  }

  function fullHTML(S, opts = {}) {
    return `<div class="tms">${standingsHTML(S, { full: true, titles: true })}<h3>Runden im Detail</h3>${roundsHTML(S, opts)}${rulesHTML()}</div>`;
  }

  // Sortierbare Tabellen
  function bindSort(root) {
    root.querySelectorAll('table.tms-sort').forEach(tb => {
      const ths = [...tb.querySelectorAll('th.sort')];
      ths.forEach(th => th.onclick = () => {
        const ci = [...th.parentNode.children].indexOf(th);
        const asc = th.classList.contains('desc') ? true : th.classList.contains('asc') ? false : th.dataset.t === 's';
        ths.forEach(x => x.classList.remove('asc', 'desc')); th.classList.add(asc ? 'asc' : 'desc');
        const body = tb.tBodies[0], rows = [...body.rows];
        rows.sort((a, b) => {
          const va = a.cells[ci].dataset.v, vb = b.cells[ci].dataset.v;
          if (va === '' && vb === '') return 0; if (va === '') return 1; if (vb === '') return -1;
          const c = th.dataset.t === 's' ? va.localeCompare(vb, 'de') : Number(va) - Number(vb);
          return asc ? c : -c;
        });
        rows.forEach(r => body.appendChild(r));
      });
    });
  }

  return { compute, countedRounds, placePoints, splitSixes, dayPointsSplit, holesWon, encrypt, decrypt, fullHTML, titlesHTML, standingsHTML, bindStandings, roundsHTML, rulesHTML, bindSort, CSS, localDate, esc, fmtPts, fmtPar };
})();
if (typeof module !== 'undefined') module.exports = TMSeason;
(async () => {
  if (window.__tmLive) { window.__tmLive.toggle(); return; }
  if (!/portal\.trackmangolf\.com$/.test(location.hostname)) { alert('Bitte zuerst portal.trackmangolf.com öffnen und anmelden, dann den Knopf erneut klicken.'); return; }
  const API = 'https://api.trackmangolf.com/graphql';
  const MPH = 2.23694;
  const LS = 'tmLive:v1';
  const store = { get() { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } }, set(o) { try { localStorage.setItem(LS, JSON.stringify(Object.assign(store.get(), o))); } catch (e) {} } };

  // ---------------- Overlay (Shadow DOM, damit das Portal-CSS nicht stört) ----------------
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
  :host { all: initial; }
  .w { --bg:#f6f5f2; --card:#fff; --surface:#fcfcfb; --text:#0b0b0b; --t2:#52514e; --mut:#7a7974; --line:#e3e1dc; --grid:#ecebe7; --pos:#2a78d6; --neg:#eb6834; --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --hl:#fff4e0;
        position:absolute; inset:0; overflow:auto; background:var(--bg); color:var(--text); font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif; }
  @media (prefers-color-scheme: dark) { .w { --bg:#121211; --card:#1d1d1c; --surface:#1a1a19; --text:#f0efec; --t2:#c3c2b7; --mut:#9a998f; --line:#33332f; --grid:#2a2a27; --pos:#3987e5; --neg:#d95926; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --hl:#2e2412; } }
  * { box-sizing:border-box; }
  .top { position:sticky; top:0; z-index:3; display:flex; flex-wrap:wrap; gap:10px 16px; align-items:center; padding:10px 20px; background:var(--card); border-bottom:1px solid var(--line); }
  .top h1 { font-size:17px; margin:0 8px 0 0; }
  .top .meta { color:var(--t2); font-size:13px; }
  .top .sp { flex:1; }
  select, button, input[type=range] { font:inherit; font-size:13px; }
  select, button { padding:4px 9px; border-radius:6px; border:1px solid var(--line); background:var(--surface); color:var(--text); }
  button { cursor:pointer; } button.pri { background:var(--s1); color:#fff; border-color:var(--s1); } button:disabled { opacity:.4; cursor:default; }
  label { color:var(--t2); font-size:13px; display:inline-flex; gap:6px; align-items:center; }
  main { padding:16px 24px 40px; max-width:2200px; margin:0 auto; }
  .row { display:grid; gap:14px; margin-bottom:14px; }
  .cards { grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); }
  .two { grid-template-columns:1.1fr 1fr; } @media (max-width:1100px) { .two { grid-template-columns:1fr; } }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
  .card h2 { font-size:15px; margin:0 0 8px; }
  .sub { color:var(--t2); font-size:12px; margin:0 0 8px; }
  .pc { cursor:pointer; transition:border-color .15s; } .pc.sel { border-color:var(--s1); box-shadow:0 0 0 1px var(--s1); }
  .pc .nm { display:flex; align-items:center; gap:8px; font-weight:600; font-size:15px; }
  .dot { width:10px; height:10px; border-radius:50%; display:inline-block; flex:none; }
  .pc .sc { display:flex; gap:14px; align-items:baseline; margin:6px 0 8px; }
  .pc .big { font-size:28px; font-weight:650; font-variant-numeric:tabular-nums; }
  .pc .k { color:var(--t2); font-size:12px; }
  .badge { font-size:11px; background:var(--hl); color:var(--text); padding:1px 7px; border-radius:10px; font-weight:500; }
  .shot { border-top:1px solid var(--line); padding:6px 0 2px; font-size:13px; font-variant-numeric:tabular-nums; }
  .shot .l1 { display:flex; justify-content:space-between; gap:8px; } .shot .l2 { color:var(--t2); font-size:12px; }
  .pos { color:var(--pos); } .neg { color:var(--neg); }
  .k { color:var(--t2); font-size:12px; font-weight:400; }
  table { border-collapse:collapse; width:100%; font-size:13px; font-variant-numeric:tabular-nums; }
  th, td { padding:6px 8px; text-align:right; border-bottom:1px solid var(--line); white-space:nowrap; }
  th { color:var(--t2); font-weight:600; } th:first-child, td:first-child { text-align:left; }
  td.hm { color:var(--text); }
  svg text { fill:var(--t2); font-size:11px; font-family:inherit; }
  .legend { display:flex; flex-wrap:wrap; gap:14px; font-size:12px; color:var(--t2); margin:2px 0 6px; } .legend span { display:inline-flex; gap:6px; align-items:center; }
  .rec { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:10px; }
  .mp-head { display:flex; flex-wrap:wrap; gap:10px 14px; align-items:center; margin-bottom:10px; }
  .mp-row { display:flex; flex-wrap:wrap; gap:8px 12px; align-items:center; padding:6px 0; border-top:1px solid var(--line); }
  .mp-n { font-weight:600; min-width:62px; } .mp-status { font-size:16px; font-weight:650; min-width:220px; } .mp-status.fin { color:var(--s1); }
  .mp-head .sp { flex:1; } .mp .mpsep td { text-align:left; background:var(--surface); padding-top:8px; } .mp-del { margin-left:auto; }
  .mp table td, .mp table th { text-align:center; padding:5px 4px; min-width:26px; }
  .mp table td:first-child, .mp table th:first-child { text-align:left; min-width:110px; }
  .mp .win { font-weight:700; border-radius:6px; }
  .mp .tot { border-left:2px solid var(--line); }
  .rec > div { background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:8px 10px; }
  .rec .v { font-size:20px; font-weight:650; font-variant-numeric:tabular-nums; } .rec .k { font-size:12px; color:var(--t2); }
  .det-head { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:10px; }
  .det-head .title { font-weight:600; font-size:15px; margin-right:auto; }
  .tabs button.on { background:var(--s1); color:#fff; border-color:var(--s1); }
  .grid3 { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; } @media (max-width:900px) { .grid3 { grid-template-columns:1fr; } }
  .grp { background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:8px 10px; }
  .grp h3 { font-size:12px; margin:0 0 4px; color:var(--t2); text-transform:uppercase; letter-spacing:.04em; }
  .kv { display:flex; justify-content:space-between; font-size:13px; padding:2px 0; font-variant-numeric:tabular-nums; } .kv span:first-child { color:var(--t2); }
  .hero { display:flex; flex-wrap:wrap; gap:18px; margin-bottom:10px; font-variant-numeric:tabular-nums; }
  .hero div { min-width:110px; } .hero .v { font-size:22px; font-weight:650; } .hero .k { font-size:12px; color:var(--t2); }
  .msg { padding:40px; text-align:center; color:var(--t2); }
  .err { background:var(--hl); padding:8px 12px; border-radius:8px; margin-bottom:12px; font-size:13px; }
  .rp { display:none; align-items:center; gap:8px; } .rp.on { display:inline-flex; } .rp input { width:260px; }
  #tip { position:fixed; pointer-events:none; background:var(--text); color:var(--bg); font-size:12px; padding:6px 8px; border-radius:6px; display:none; z-index:10; max-width:280px; }
  .w { --muted:var(--mut); --accent:var(--s1); }
  .vtabs { display:inline-flex; gap:2px; border:1px solid var(--line); border-radius:8px; padding:2px; background:var(--surface); }
  .vtabs button { border:0; background:none; padding:4px 12px; border-radius:6px; } .vtabs button.on { background:var(--s1); color:#fff; }
  .top3 { grid-template-columns:minmax(0,1fr) 260px; } @media (max-width:1100px) { .top3 { grid-template-columns:1fr; } }
  .day { border:2px solid var(--s1); }
  .rec1 { grid-template-columns:1fr; }
  .dt td, .dt th { text-align:center; padding:6px 4px; min-width:30px; } .dt td:first-child, .dt th:first-child { text-align:left; min-width:120px; }
  .dt .dsc { text-align:right; min-width:78px; padding-right:12px; } .dt .dst { text-align:left; min-width:150px; padding-left:14px; }
  .dt .par td { color:var(--t2); font-size:12px; } .dt .win { font-weight:700; border-radius:6px; }
  .dt .mpsep td { text-align:left; color:var(--t2); font-size:12px; background:var(--surface); padding-top:8px; }
  .big2 { font-size:18px; font-weight:650; }
  .mk { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; box-sizing:border-box; font-weight:500; line-height:1; }
  .mk.mk-s { width:20px; height:20px; font-size:11px; } .dt .mk-s { margin-top:2px; }
  .m-bir { border:1px solid currentColor; border-radius:50%; } .m-eag { border:3px double currentColor; border-radius:50%; }
  .m-bog { border:1px solid currentColor; } .m-dbl { border:3px double currentColor; }
  .dt td.ssc { position:relative; padding:9px 6px; } .ssp { position:absolute; top:2px; right:3px; font-size:10px; font-weight:700; line-height:1; color:var(--text); }
  .chips { display:flex; flex-wrap:wrap; gap:6px 8px; align-items:center; margin:0 0 10px; }
  .chip { display:inline-flex; gap:6px; align-items:center; padding:3px 10px; border:1px solid var(--line); border-radius:14px; font-size:13px; color:var(--t2); cursor:pointer; user-select:none; }
  .chip.on { color:var(--text); border-color:var(--s1); background:color-mix(in srgb, var(--s1) 8%, transparent); } .chip input { margin:0; }
  .pbadge { font-size:12px; font-weight:600; color:#c4560f; background:rgba(235,104,52,.12); padding:2px 9px; border-radius:10px; }
  .dmsg { color:var(--text); background:var(--hl); padding:4px 8px; border-radius:6px; display:inline-block; }
  .sed { display:flex; flex-wrap:wrap; gap:8px 14px; align-items:center; margin:8px 0; padding:8px 10px; background:var(--surface); border:1px solid var(--line); border-radius:8px; }
  .sed label, .sub input { font-size:13px; } input[type=password], input[type=date], #sparts { font:inherit; font-size:13px; padding:3px 6px; border-radius:6px; border:1px solid var(--line); background:var(--surface); color:var(--text); }
  .nomeas { background:var(--surface); border:1px dashed var(--line); border-radius:10px; padding:12px; color:var(--t2); font-size:13px; }
  .done { display:flex; flex-wrap:wrap; gap:10px; align-items:center; background:var(--hl); border-radius:10px; padding:10px 14px; margin-bottom:14px; }
  ${TMSeason.CSS}
  details.help summary { cursor:pointer; color:var(--t2); font-size:12px; } details.help p, details.help li { font-size:12px; color:var(--t2); }
  </style>
  <div class="w">
    <div class="top">
      <h1>Trackman Live <span style="font-weight:400;font-size:12px;color:var(--t2)">v1.9.1</span></h1>
      <span class="vtabs"><button data-tab="overview">Übersicht</button><button data-tab="shots">Schlagdaten</button><button data-tab="season">Saison verwalten</button></span>
      <select id="round" title="Runde"></select>
      <label title="Immer die neueste Runde anzeigen"><input type="checkbox" id="follow" checked> neueste</label>
      <span class="meta" id="meta"></span>
      <span class="sp"></span>
      <label id="replayL"><input type="checkbox" id="replay"> Replay</label>
      <span class="rp" id="rp"><button id="rpPlay">▶</button><input type="range" id="rpPos" min="0" max="0" value="0"><span class="meta" id="rpTxt"></span></span>
      <label>alle <select id="ival"><option value="15">15 s</option><option value="30" selected>30 s</option><option value="60">60 s</option></select></label>
      <button id="pause">Pause</button>
      <button class="pri" id="now">Jetzt aktualisieren</button>
      <button id="close" title="Schließen (Knopf erneut klicken öffnet wieder)">✕</button>
    </div>
    <main id="main"><div class="msg">Lade …</div></main>
    <div id="tip"></div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  const main = $('#main'), tip = $('#tip');
  let visible = true;
  window.__tmLive = { toggle() { visible = !visible; host.style.display = visible ? '' : 'none'; if (visible) refresh(); } };
  $('#close').onclick = () => window.__tmLive.toggle();

  // ---------------- Anmeldung ----------------
  const gq = async (token, query, variables = {}) => {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ query, variables }) });
    if (r.status === 401 || r.status === 403) throw new Error('AUTH');
    return r.json();
  };
  const works = async (t) => { try { const r = await gq(t, '{ me { profile { fullName } } }'); return r && r.data && r.data.me ? r.data.me.profile : null; } catch (e) { return null; } };
  let token = null;
  {
    const re = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, cands = new Set();
    for (const s of [localStorage, sessionStorage]) { try { for (let i = 0; i < s.length; i++) ((s.getItem(s.key(i)) || '').match(re) || []).forEach(x => cands.add(x)); } catch (e) {} }
    (document.cookie.match(re) || []).forEach(x => cands.add(x));
    for (const c of cands) if (await works(c)) { token = c; break; }
  }
  if (!token) {
    host.style.display = 'none';
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;background:#1d1d1f;color:#fff;font:14px/1.4 system-ui,sans-serif;padding:14px 16px;border-radius:10px;max-width:340px;box-shadow:0 6px 24px rgba(0,0,0,.35)';
    box.innerHTML = '<b>Trackman Live</b><br>Bitte jetzt im Portal einmal links auf <b>Activities</b> klicken (oder einen Filter wechseln). Danach öffnet sich das Dashboard.';
    document.body.appendChild(box);
    token = await new Promise((resolve) => {
      const grab = (v) => { if (v && /^Bearer /.test(v)) resolve(v.slice(7)); };
      const of = window.fetch;
      window.fetch = function (input, init) {
        try { const h = (init && init.headers) || (input && input.headers); if (h) { if (h.forEach) h.forEach((v, k) => /^authorization$/i.test(k) && grab(v)); else for (const k in h) if (/^authorization$/i.test(k)) grab(h[k]); } } catch (e) {}
        return of.apply(this, arguments);
      };
      const os = XMLHttpRequest.prototype.setRequestHeader;
      XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (/^authorization$/i.test(k)) grab(v); return os.apply(this, arguments); };
    });
    box.remove(); host.style.display = '';
  }

  // ---------------- Strokes-Gained-Baseline (wie Trackman Stats) ----------------
  const P = (c, d) => c.reduce((s, k, i) => s + k * Math.pow(d, i), 0);
  const TEE = [7.93983,-0.234602,0.00435123,-0.0000425027,2.43872e-7,-8.62574e-10,1.91876e-12,-2.66481e-15,2.21264e-18,-9.84428e-22,1.74042e-25];
  const FW = [2.16026,0.0123578,0.0000424827,-3.38111e-6,4.12814e-8,-2.46975e-10,8.68186e-13,-1.89261e-15,2.52923e-18,-1.90226e-21,6.16728e-25];
  const RO = [2.17571,0.0278664,-0.000440868,3.99675e-6,-2.10136e-8,6.9957e-11,-1.5129e-13,2.05905e-16,-1.58967e-19,5.25685e-23];
  const BU = [2.61385,-0.0456996,0.00266142,-0.0000502866,4.84188e-7,-2.7194e-9,9.44406e-12,-2.05711e-14,2.73729e-17,-2.03418e-20,6.46947e-24];
  const RE = [3.67824,-0.0211048,0.000918734,-0.0000157257,1.46762e-7,-8.31403e-10,2.98214e-12,-6.78919e-15,9.48229e-18,-7.39489e-21,2.46192e-24];
  const putt = ft => ft <= 3 ? 1 : 0.409008 - 0.0172927*ft + 0.000137224*ft*ft - 2.59981e-7*ft*ft*ft + 0.583824*Math.log(ft);
  const BASE = { Tee: y => P(TEE, Math.max(y, 80)), Fairway: y => P(FW, y), Rough: y => P(RO, y), Sand: y => P(BU, y), Recovery: y => P(RE, y), Semi: y => (P(FW, y) + P(RO, y)) / 2, Green: y => putt(y * 3) };
  const mapLie = l => ({ Tee: 'Tee', Fairway: 'Fairway', Fringe: 'Fairway', Semirough: 'Semi', Rough: 'Rough', Sand: 'Sand', Green: 'Green', HoleCup: 'Hole' })[l] || 'Recovery';
  const E = (m, lie) => { const b = mapLie(lie); if (b === 'Hole' || !(m > 0.01)) return 0; return BASE[b](m / 0.9144); };
  const CATS = ['Off the Tee', 'Approach', 'Short Game', 'Putting'];
  const SHORT = { 'Off the Tee': 'Tee', 'Approach': 'Approach', 'Short Game': 'Kurzspiel', 'Putting': 'Putting' };
  const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
  const dist = (p, q) => (p && q ? Math.hypot(p.x - q.x, p.z - q.z) : null);

  // ---------------- Daten ----------------
  const M = 'clubSpeed ballSpeed smashFactor carry carryActual total totalActual carrySide carrySideActual clubPath faceAngle faceToPath attackAngle dynamicLoft launchAngle launchDirection spinRate spinAxis spinAxisActual curve curveActual landingAngle landingAngleActual maxHeight impactOffset impactHeight';
  const QSC = `query($id:ID!){ node(id:$id){ ... on Scorecard { id state thruHole startedAt lastUpdatedAt teeName course { displayName } gameSettings { puttingSettings { puttingMode } }
    playersScorecards { id isTeamScorecard teeName player { name hcp } holes { holeNumber par distance grossScore putts pinPosition { x y z }
      shots { shotNumber club launchLie finalLie shotResult shotsToAdd launchTime launchPosition { x y z } finalPosition { x y z } measurement { ${M} } } } } } } }`;
  const QLIST = `{ me { scorecards(take:12) { id state thruHole startedAt lastUpdatedAt course { displayName } playersScorecards { player { name } } } } }`;

  const saved = store.get();
  const S = { view: ['overview', 'shots', 'season'].includes(saved.tab) ? saved.tab : 'overview', dayMsg: '', autoSynced: new Set(), sawLive: new Set(saved.sawLive || []), list: [], id: saved.id || null, follow: saved.follow !== false, data: saved.data || null, ival: saved.ival || 30, paused: false, sel: 0, shotIdx: null, liveShot: true, replay: false, rpPos: 0, rpTimer: null, lastFetch: null, err: '', matches: saved.matches || null };
  $('#follow').checked = S.follow; $('#ival').value = String(S.ival);

  async function loadList() {
    const r = await gq(token, QLIST);
    if (r.errors) throw new Error(r.errors[0].message);
    const tk = s => s.startedAt || s.lastUpdatedAt || '';
    S.list = (r.data.me.scorecards || []).filter(s => s.course).sort((a, b) => tk(b) < tk(a) ? -1 : 1);
    if (S.follow || !S.id || !S.list.some(s => s.id === S.id)) {
      const live = S.list.filter(s => s.state === 'IN_PROGRESS').sort((a, b) => (b.lastUpdatedAt || '') < (a.lastUpdatedAt || '') ? -1 : 1);
      const pick = live[0] || S.list.find(s => s.state !== 'DID_NOT_FINISH') || S.list[0];
      if (pick) S.id = pick.id;
    }
    const fmtT = t => t ? new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–';
    const stateDe = { IN_PROGRESS: 'läuft', COMPLETED: 'fertig', SAVED: 'gespeichert', DID_NOT_FINISH: 'abgebrochen', UNKNOWN: '?' };
    $('#round').innerHTML = S.list.map(s => `<option value="${s.id}"${s.id === S.id ? ' selected' : ''}>${fmtT(s.startedAt || s.lastUpdatedAt)} · ${s.course.displayName.trim()} · ${stateDe[s.state] || s.state}${s.thruHole ? ' · Loch ' + s.thruHole : ''} · ${s.playersScorecards.length} Sp.</option>`).join('');
  }
  async function loadRound() {
    if (!S.id) return;
    const r = await gq(token, QSC, { id: S.id });
    if (r.errors) throw new Error(r.errors[0].message);
    S.data = r.data.node; S.lastFetch = new Date();
    store.set({ id: S.id, follow: S.follow, ival: S.ival, data: S.data });
  }
  let busy = false;
  async function refresh() {
    if (busy) return; busy = true; S.err = '';
    try { await loadList(); await loadRound(); }
    catch (e) { S.err = e.message === 'AUTH' ? 'Anmeldung abgelaufen – Portal neu laden, anmelden und den Knopf erneut klicken.' : 'Aktualisierung fehlgeschlagen: ' + e.message; }
    busy = false; if (S.view !== 'season') render(); seasonAuto();
  }

  // ---------------- Auswertung ----------------
  function analyse(sc) {
    const players = sc.playersScorecards.map((p, pi) => ({ i: pi, name: p.player.name, hcp: p.player.hcp, tee: p.teeName || sc.teeName, holes: [], shots: [] }));
    // alle Schläge mit Zeit für Replay
    const timeline = [];
    sc.playersScorecards.forEach((p, pi) => p.holes.forEach(h => (h.shots || []).forEach(s => timeline.push({ pi, hole: h.holeNumber, n: s.shotNumber, t: s.launchTime || '' }))));
    timeline.sort((a, b) => a.t < b.t ? -1 : a.t > b.t ? 1 : a.hole - b.hole || a.n - b.n);
    const cutoff = S.replay ? new Set(timeline.slice(0, S.rpPos).map(x => x.pi + '|' + x.hole + '|' + x.n)) : null;
    sc.playersScorecards.forEach((p, pi) => {
      const P0 = players[pi];
      for (const h of [...p.holes].sort((a, b) => a.holeNumber - b.holeNumber)) {
        const all = [...(h.shots || [])].sort((a, b) => a.shotNumber - b.shotNumber);
        const shots = cutoff ? all.filter(s => cutoff.has(pi + '|' + h.holeNumber + '|' + s.shotNumber)) : all;
        if (!shots.length) continue;
        const added = all.reduce((s, x) => s + (x.shotsToAdd || 0), 0);
        const allIn = shots.length === all.length;
        const complete = allIn && h.grossScore != null && all.length + added === h.grossScore;
        const excluded = all.some(x => ['Pickup', 'Mulligan'].includes(x.shotResult) || x.launchLie === 'Green');
        const H = { hole: h.holeNumber, par: h.par, score: complete ? h.grossScore : null, complete, excluded, sg: Object.fromEntries(CATS.map(c => [c, 0])), puttDist: null, putts: null };
        shots.forEach((s, i) => {
          const nx = shots[i + 1], m = s.measurement || {}, pin = h.pinPosition;
          const d0 = dist(s.launchPosition, pin), d1 = dist(s.finalPosition, pin);
          const holed = s.finalLie === 'HoleCup' || s.shotResult === 'HoleOut';
          const pen = (s.shotResult === 'Drop' || s.shotResult === 'Rehit') ? (s.shotsToAdd || 0) : 0;
          const eS = E(d0, s.launchLie);
          const eN = nx ? E(dist(nx.launchPosition, pin), nx.launchLie) : (holed ? 0 : (s.finalLie ? E(d1, s.finalLie) : null));
          const cat = (s.launchLie === 'Tee' && h.par >= 4) ? 'Off the Tee' : (d0 / 0.9144 >= 100 ? 'Approach' : 'Short Game');
          const v = (excluded || eN == null || d0 == null) ? null : eS - eN - 1 - pen;
          if (v != null) H.sg[cat] += v;
          const sh = { pi, hole: h.holeNumber, par: h.par, n: s.shotNumber, club: s.club, lie0: s.launchLie, lie1: s.finalLie, res: s.shotResult, add: s.shotsToAdd, t: s.launchTime, d0, d1, travel: dist(s.launchPosition, s.finalPosition), elev: s.launchPosition && s.finalPosition ? s.finalPosition.y - s.launchPosition.y : null, m, sg: v, eS, eN, cat };
          P0.shots.push(sh);
          if (!nx && !holed && (s.shotResult === 'AutoPutt' || s.shotResult === 'AutoChip') && s.finalLie === 'Green' && s.shotsToAdd != null && !excluded) {
            H.puttDist = d1; H.putts = s.shotsToAdd; H.sg['Putting'] += E(d1, 'Green') - s.shotsToAdd;
          } else if (!nx && holed) { H.putts = 0; }
        });
        P0.holes.push(H);
      }
      const done = P0.holes.filter(h => h.complete);
      P0.thru = done.length; P0.score = done.reduce((s, h) => s + h.score, 0); P0.par = done.reduce((s, h) => s + h.par, 0);
      P0.toPar = P0.score - P0.par;
      P0.sg = Object.fromEntries(CATS.map(c => [c, P0.holes.filter(h => !h.excluded).reduce((s, h) => s + h.sg[c], 0)]));
      P0.sgTotal = CATS.reduce((s, c) => s + P0.sg[c], 0);
      P0.lastT = P0.shots.reduce((m, s) => (s.t || '') > m ? s.t : m, '');
    });
    return { players, timeline };
  }

  // ---------------- Hilfen ----------------
  const fmt = (v, d = 1) => v == null || isNaN(v) ? '–' : v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sgn = (v, d = 2) => { if (v == null || isNaN(v)) return '–'; const r = Math.round(v * 10 ** d) / 10 ** d; return r === 0 ? fmt(0, d) : (r > 0 ? '+' : '') + fmt(r, d); };
  const cls = v => v == null ? '' : v > 0.005 ? 'pos' : v < -0.005 ? 'neg' : '';
  const toPar = v => v === 0 ? 'E' : (v > 0 ? '+' : '') + v;
  const mph = v => v == null ? null : v * MPH;
  const lieDe = l => ({ Tee: 'Tee', Fairway: 'Fairway', Fringe: 'Vorgrün', Semirough: 'Semirough', Rough: 'Rough', Deeprough: 'Deep Rough', Sand: 'Bunker', Green: 'Grün', HoleCup: 'Loch' })[l] || l || '–';
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const hover = (node, html) => { node.addEventListener('mousemove', e => { tip.innerHTML = html; tip.style.display = 'block'; tip.style.left = Math.min(e.clientX + 12, innerWidth - 290) + 'px'; tip.style.top = (e.clientY + 12) + 'px'; }); node.addEventListener('mouseleave', () => tip.style.display = 'none'); };
  const shotLine = s => `<div class="shot"><div class="l1"><span>Loch ${s.hole} · ${s.n}. ${s.club || '?'}</span><span class="${cls(s.sg)}">${s.sg == null ? '' : 'SG ' + sgn(s.sg)}</span></div>
    <div class="l2">${lieDe(s.lie0)} ${fmt(s.d0, 0)} m → ${lieDe(s.lie1)} ${s.lie1 === 'HoleCup' ? '' : fmt(s.d1, 1) + ' m'}${s.m.ballSpeed != null ? ` · Ball ${fmt(mph(s.m.ballSpeed), 0)} mph · Carry ${fmt(s.m.carry, 0)}${s.m.carryActual != null && Math.abs(s.m.carryActual - s.m.carry) > 1 ? ' / Spiel ' + fmt(s.m.carryActual, 0) : ''} m` : ''}${s.res === 'AutoPutt' || s.res === 'AutoChip' ? ' · ' + s.add + (s.res === 'AutoPutt' ? ' Putts' : ' Auto-Chip') : ''}</div></div>`;

  // ---------------- Darstellung ----------------
  let A = null;
  const stateDe = { IN_PROGRESS: 'läuft', COMPLETED: 'fertig', SAVED: 'gespeichert', DID_NOT_FINISH: 'abgebrochen' };
  function render() {
    if (S.view === 'season') { renderSeason(); return; }
    const sc = S.data;
    const errHtml = S.err ? `<div class="err">${S.err}</div>` : '';
    if (!sc) { main.innerHTML = errHtml + '<div class="msg">Keine Runde gefunden.</div>'; return; }
    A = analyse(sc);
    if (S.replay) { $('#rpPos').max = A.timeline.length; $('#rpPos').value = S.rpPos; $('#rpTxt').textContent = `Schlag ${S.rpPos} / ${A.timeline.length}`; }
    const P = A.players;
    if (S.sel >= P.length) S.sel = 0;
    const mode = sc.gameSettings && sc.gameSettings.puttingSettings ? sc.gameSettings.puttingSettings.puttingMode : '';
    $('#meta').textContent = `${stateDe[sc.state] || sc.state} · ${S.lastFetch ? S.lastFetch.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : 'Cache'}`;
    $('#meta').title = `${sc.course.displayName.trim()} · Putts: ${mode || '?'} · aktualisiert ${S.lastFetch ? S.lastFetch.toLocaleTimeString('de-DE') : '(Cache)'}`;
    const allShots = P.flatMap(p => p.shots);
    const isLive = sc.state === 'IN_PROGRESS', nMeas = allShots.filter(s => s.m && s.m.ballSpeed != null).length;
    if (isLive && !S.sawLive.has(sc.id)) { S.sawLive.add(sc.id); store.set({ sawLive: [...S.sawLive].slice(-10) }); }
    const best = (arr, f, cmp) => arr.reduce((b, s) => { const v = f(s); return v == null || isNaN(v) ? b : (!b || cmp(v, b.v) ? { s, v } : b); }, null);
    const recBox = (k, r, f) => `<div><div class="k">${k}</div><div class="v">${r ? f(r.v) : '–'}</div><div class="k">${r ? esc(P[r.s.pi].name) + ' · Loch ' + r.s.hole : ''}</div></div>`;
    if (S.view === 'shots') { renderShots(sc, P, allShots, isLive, nMeas, best, recBox, errHtml); return; }

    // Rekorde (positionsbasiert, auch live verfügbar)
    const drv = best(allShots.filter(s => s.lie0 === 'Tee' && s.par >= 4), s => s.travel, (a, b) => a > b);
    const prox = best(allShots.filter(s => s.d0 / 0.9144 >= 100 && (s.lie1 === 'Green' || s.lie1 === 'HoleCup')), s => s.lie1 === 'HoleCup' ? 0 : s.d1, (a, b) => a < b);
    const rec = `<div class="rec rec1">${recBox('Längster Drive', drv, v => fmt(v, 0) + ' m')}${recBox('Nearest to the pin (ab 100 y)', prox, v => fmt(v, 1) + ' m')}</div>`;

    // SG-Matrix inkl. Score und „ohne Putt-Glück“
    const allV = P.flatMap(p => [...CATS.map(c => p.sg[c]), p.sgTotal]);
    const mx = Math.max(1, ...allV.map(Math.abs));
    const cell = v => { const a = Math.min(1, Math.abs(v) / mx) * 0.55; const col = v >= 0 ? '42,120,214' : '235,104,52'; return `<td class="hm" style="background:rgba(${col},${a.toFixed(2)})">${sgn(v)}</td>`; };
    const matrix = `<table><tr><th>Spieler</th>${CATS.map(c => `<th>${SHORT[c]}</th>`).join('')}<th>Gesamt</th><th>Score</th><th title="Score + SG Putting">ohne Putt-Glück</th></tr>` +
      P.map(p => `<tr><td><span class="dot" style="background:${COLORS[p.i % 4]}"></span> ${esc(p.name)}</td>${CATS.map(c => cell(p.sg[c])).join('')}${cell(p.sgTotal)}<td>${p.thru ? p.score + ' (' + toPar(p.toPar) + ')' + (p.thru < 18 ? ' · ' + p.thru + ' L.' : '') : '–'}</td><td><b>${p.thru ? fmt(p.score + p.sg['Putting'], 1) : '–'}</b></td></tr>`).join('') + '</table>';

    const banner = sc.state === 'COMPLETED' && S.sawLive.has(sc.id) && !S.replay ? `<div class="done"><b>Runde beendet.</b><span>Schläger- und Balldaten für ${nMeas} von ${allShots.length} Schlägen da${nMeas < allShots.length ? ' – der Rest kommt meist nach ein paar Minuten' : ''}.</span><button class="pri" id="goShots">Schlagdaten ansehen</button><button id="hideDone">Ausblenden</button></div>` : '';

    main.innerHTML = errHtml + banner + `
      <div class="row top3">
        <div class="card day" id="day">${dayHTML(sc, P)}</div>
        <div class="card" style="align-self:start"><h2>Rekorde der Runde</h2>${rec}</div>
      </div>
      <div class="row two">
        <div class="card"><h2>Strokes Gained dieser Runde</h2><p class="sub">Summe in Schlägen gegen PGA-Tour-Baseline. Blau = gewonnen, orange = verloren. „Ohne Putt-Glück“ = Score + SG Putting, also der Score bei durchschnittlichem Auto-Putt.</p>${matrix}</div>
        <div class="card"><h2>SG-Rennen</h2><div class="legend">${P.map(p => `<span><span class="dot" style="background:${COLORS[p.i % 4]}"></span>${esc(p.name)}</span>`).join('')}</div><div id="race"></div></div>
      </div>
      <div class="row"><div class="card tms" id="sstand">${seasonMiniHTML(sc, P)}</div></div>
      <div class="row"><div class="card"><details class="help"><summary>Wie wird gerechnet?</summary>
        <ul><li>Tageswertung brutto: 2 Spieler ein Matchplay, 4 Spieler zwei Matchplays (ausgeloste Paarungen der Saison), 3 Spieler Split Sixes (pro Loch 4/2/0 Punkte, Gleichstände geteilt). Gewertet werden nur Löcher, die alle Beteiligten fertig gespielt haben. Matchplay entschieden, sobald der Vorsprung größer ist als die verbleibenden Löcher (z. B. 3&2).</li>
        <li>Baseline: Polynom-Fits an Broadies PGA-Tour-Tabellen (Distanz m → Yards; Putting in Fuß, bis 3 ft fix 1,00; Tee unter 80 y = Wert bei 80 y).</li>
        <li>Lagen: Tee, Fairway (auch Vorgrün), Semirough = Mittel aus Fairway und Rough, Rough, Bunker, Grün; Deep Rough und alles andere = Recovery.</li>
        <li>Kategorien: Tee = Abschläge Par 4/5; Approach = übrige Schläge ab 100 y; Kurzspiel = unter 100 y außerhalb des Grüns; Putting = erwartete Putts aus der Distanz − vergebene Auto-Putts.</li>
        <li>SG je Schlag = Erwartung vorher − Erwartung vor dem nächsten Schlag − 1 − Strafschläge. Löcher mit Pickup, Mulligan oder eigenem Schlag vom Grün zählen nicht.</li>
        <li>Rekorde: längster Drive = tatsächlich zurückgelegte Strecke im Spiel (Abschläge Par 4/5); Nearest to the pin = Abstand zur Fahne nach Schlägen aus mindestens 100 y, die auf dem Grün oder im Loch enden.</li></ul></details></div></div>`;
    bindDay(sc, P);
    TMSeason.bindStandings(root.querySelector('#sstand'));
    const ss = root.querySelector('#goSeason'); if (ss) ss.onclick = () => setTab('season');
    const gs = root.querySelector('#goShots'); if (gs) gs.onclick = () => setTab('shots');
    const hd = root.querySelector('#hideDone'); if (hd) hd.onclick = () => { S.sawLive.delete(sc.id); store.set({ sawLive: [...S.sawLive] }); render(); };
    drawRace(P);
  }

  function renderShots(sc, P, allShots, isLive, nMeas, best, recBox, errHtml) {
    const bs = best(allShots, s => mph(s.m.ballSpeed), (a, b) => a > b);
    const sm = best(allShots.filter(s => /driver/i.test(s.club || '') && s.m.smashFactor <= 1.56), s => s.m.smashFactor, (a, b) => a > b);
    const cs = best(allShots, s => mph(s.m.clubSpeed), (a, b) => a > b);
    const info = isLive ? `<div class="nomeas" style="margin-bottom:14px">Runde läuft – Schläger- und Balldaten (Club Speed, Ball Speed, Spin, Carry …) liefert Trackman erst nach Rundenende. Lage, Distanzen und Strokes Gained je Schlag sind schon da.</div>`
      : `<p class="sub">Schläger- und Balldaten für ${nMeas} von ${allShots.length} Schlägen vorhanden${nMeas < allShots.length && sc.state === 'COMPLETED' ? ' – der Rest kommt meist nach ein paar Minuten nach Rundenende' : ''}.</p>`;
    main.innerHTML = errHtml + `${info}
      ${nMeas ? `<div class="row"><div class="card"><h2>Rekorde (Messwerte)</h2><div class="rec">${recBox('Höchste Ball Speed', bs, v => fmt(v, 1) + ' mph')}${recBox('Höchste Club Speed', cs, v => fmt(v, 1) + ' mph')}${recBox('Bester Smash (Driver)', sm, v => fmt(v, 2))}</div></div></div>` : ''}
      <div class="row"><div class="card" id="detail"></div></div>`;
    renderDetail();
  }

  // ---------- Tageswertung (Matchplay / Split Sixes, brutto) ----------
  const PAIRS = n => [[[n[0], n[1]], [n[2], n[3]]], [[n[0], n[2]], [n[1], n[3]]], [[n[0], n[3]], [n[1], n[2]]]];
  const pairKey = pp => JSON.stringify(pp.map(p => [...p].sort()).sort());
  function basePlayers(P) {
    const parts = SE.season && SE.season.config ? new Set(SE.season.config.participants || []) : null;
    const inSeason = parts ? P.filter(p => parts.has(p.name)) : P;
    return inSeason.length >= 2 ? inSeason : P;
  }
  function getOnly(sc) {
    if (SE.season) { const rr = (SE.season.rounds || []).find(x => x.id === sc.id); const o = (rr && rr.only) || (SE.season.only || {})[sc.id]; if (o) return o; }
    return (store.get().localOnly || {})[sc.id] || null;
  }
  // Spieler der Tageswertung: Teilnehmer der Saison, eingeschränkt auf die Auswahl „Spielen mit“
  function dayPlayers(P) {
    const base = basePlayers(P), only = getOnly(S.data || {});
    const sel = only ? base.filter(p => only.includes(p.name)) : base;
    return sel.length >= 2 ? sel : base;
  }
  function getPairs(sc) {
    if (SE.season) { const rr = (SE.season.rounds || []).find(x => x.id === sc.id); const pp = (rr && rr.pairings) || (SE.season.pairings || {})[sc.id]; if (pp) return { pairs: pp, src: 'season' }; }
    const loc = (store.get().localPairs || {})[sc.id]; if (loc) return { pairs: loc, src: 'local' };
    return { pairs: null, src: null };
  }
  // Festlegung je Runde speichern: field 'pairings' (Paarungen) oder 'only' (wer spielt mit); in der Saison, sonst nur lokal
  async function setRoundField(sc, field, value, what) {
    if (SE.season) {
      const rr = (SE.season.rounds || []).find(x => x.id === sc.id);
      if (rr) rr[field] = value || undefined; else { SE.season[field] = SE.season[field] || {}; if (value) SE.season[field][sc.id] = value; else delete SE.season[field][sc.id]; }
      SE.dirty = true;
      if (sstore.get().gh) { S.dayMsg = `Speichere ${what} …`; render(); try { await seasonSave(); S.dayMsg = `${what} in der Saison gespeichert.`; } catch (e) { S.dayMsg = e.message; } }
      else S.dayMsg = `${what} geändert, aber nicht gespeichert: Unter „Saison verwalten“ fehlt der GitHub-Token.`;
    } else {
      const key = field === 'pairings' ? 'localPairs' : 'localOnly', lp = store.get()[key] || {};
      if (value) lp[sc.id] = value; else delete lp[sc.id]; store.set({ [key]: lp });
      S.dayMsg = `${what} nur in diesem Browser gemerkt – für die Saison unter „Saison verwalten“ das Passwort eingeben.`;
    }
    render();
  }
  const setPairs = (sc, pairs) => setRoundField(sc, 'pairings', pairs, 'Paarungen');
  const scoreOfP = p => { const o = {}; p.holes.forEach(h => { if (h.complete) o[h.hole] = h.score; }); return o; };
  const holeCount = sc => Math.max(...sc.playersScorecards.map(ps => Math.max(0, ...ps.holes.map(h => h.holeNumber))), 9) > 9 ? 18 : 9;
  function splitCalc(DP, holes) {
    const sc3 = DP.map(scoreOfP), tot = [0, 0, 0], pts = {};
    holes.forEach(h => { const v = sc3.map(o => o[h]); if (v.some(x => x == null)) return; const p3 = TMSeason.placePoints(v, [4, 2, 0]).points; pts[h] = p3; p3.forEach((x, k) => tot[k] += x); });
    const played = Object.keys(pts).length;
    return { sc3, tot, pts, played, day: TMSeason.dayPointsSplit(tot) };
  }
  // Laufende Runde als Prognose für die Saison: Platz/Par-Bonus nach aktuellem Score, Matchplay nach aktuellem Stand
  function projRound(sc, P) {
    if (!SE.season || !sc || S.replay) return null;
    if (!['IN_PROGRESS', 'COMPLETED'].includes(sc.state) || (SE.season.rounds || []).some(r => r.id === sc.id)) return null;
    const parts = new Set(SE.season.config.participants || []);
    const DP = dayPlayers(P).filter(p => parts.has(p.name) && p.thru > 0);
    if (DP.length < 2) return null;
    const nHoles = holeCount(sc), holes = Array.from({ length: nHoles }, (_, i) => i + 1), mp = {}, split = {};
    let mpNote = '';
    if (DP.length === 3) { const c = splitCalc(DP, holes); if (c.played) DP.forEach((p, k) => { mp[p.name] = c.day[k]; split[p.name] = c.tot[k]; }); }
    else if (DP.length === 2 || DP.length === 4) {
      const pairs = DP.length === 2 ? [[DP[0].name, DP[1].name]] : getPairs(sc).pairs;
      if (!pairs) mpNote = 'Paarungen fehlen';
      else pairs.forEach(([a, b]) => { const A = DP.find(p => p.name === a), Bp = DP.find(p => p.name === b); if (!A || !Bp) return; const r = mpCalc(A, Bp, nHoles); if (!r.played) return; mp[a] = r.diff > 0 ? 2 : r.diff < 0 ? 0 : 1; mp[b] = 2 - mp[a]; });
    }
    return { projected: true, id: sc.id, date: sc.startedAt || new Date().toISOString(), course: sc.course.displayName.trim(), tee: sc.teeName, par: [],
      players: DP.map(p => ({ name: p.name, tee: p.tee, gross: p.score, toPar: p.toPar, thru: p.thru })), mp, split, mpNote };
  }
  function dayHTML(sc, P) {
    const DP = dayPlayers(P), n = DP.length;
    const nHoles = holeCount(sc);
    const holes = Array.from({ length: nHoles }, (_, i) => i + 1);
    const par = {}; sc.playersScorecards.forEach(ps => ps.holes.forEach(h => { if (par[h.holeNumber] == null) par[h.holeNumber] = h.par; }));
    const mk = (v, h, small) => { if (v == null) return ''; const d = par[h] ? v - par[h] : 0; const c = d <= -2 ? 'm-eag' : d === -1 ? 'm-bir' : d === 1 ? 'm-bog' : d >= 2 ? 'm-dbl' : 'm-par'; return `<span class="mk ${c}${small ? ' mk-s' : ''}">${v}</span>`; };
    const scoreOf = scoreOfP;
    const name = p => `<span class="dot" style="background:${COLORS[p.i % 4]}"></span> ${esc(p.name)}`;
    const scoreTd = p => `<td class="dsc">${p.thru ? `<b>${toPar(p.toPar)}</b> <span class="k">${p.thru < nHoles ? p.thru + ' L.' : p.score}</span>` : '–'}</td>`;
    const head = `<tr><th>Spieler</th><th class="dsc">Score</th>${holes.map(h => `<th>${h}</th>`).join('')}<th class="dst">Stand</th></tr><tr class="par"><td class="k">Par</td><td></td>${holes.map(h => `<td class="k">${par[h] ?? ''}</td>`).join('')}<td></td></tr>`;
    const LEG = `Zeichen: <span class="mk m-eag mk-s">3</span> Eagle oder besser, <span class="mk m-bir mk-s">3</span> Birdie, <span class="mk m-par mk-s">4</span> Par, <span class="mk m-bog mk-s">5</span> Bogey, <span class="mk m-dbl mk-s">6</span> Doppelbogey oder schlechter.`;
    const BP = basePlayers(P), selNames = new Set(DP.map(p => p.name));
    const chips = BP.length > 2 ? `<div class="chips"><span class="k">Spielen mit:</span>${BP.map(p => `<label class="chip${selNames.has(p.name) ? ' on' : ''}"><input type="checkbox" data-only="${esc(p.name)}"${selNames.has(p.name) ? ' checked' : ''}><span class="dot" style="background:${COLORS[p.i % 4]}"></span>${esc(p.name)}</label>`).join('')}<span class="k">2 = Matchplay · 3 = Split Sixes · 4 = zwei Matches</span></div>` : '';
    const msg = S.dayMsg ? `<p class="sub dmsg">${esc(S.dayMsg)}</p>` : '';
    const seasonHint = !SE.season ? `<p class="sub">Saison nicht geladen – Paarungen gelten nur in diesem Browser. Unter „Saison verwalten“ das Saison-Passwort eingeben.</p>` : '';
    if (n === 3) {
      const { sc3, tot, pts, played, day } = splitCalc(DP, holes);
      const rank = [0, 1, 2].map(k => 1 + tot.filter(t => t > tot[k]).length);
      const fp = v => TMSeason.fmtPts(v);
      const order = [0, 1, 2].sort((a, b) => tot[b] - tot[a] || a - b);
      const rows = order.map(k => [DP[k], k]).map(([p, k]) => `<tr>${'<td>' + name(p) + '</td>'}${scoreTd(p)}${holes.map(h => { const v = pts[h]; if (!v) return `<td class="ssc">${mk(sc3[k][h], h)}</td>`; const top = v[k] === Math.max(...v) && !v.every(x => x === v[0]); return `<td class="ssc${top ? ' win' : ''}" style="${top ? 'background:color-mix(in srgb, ' + COLORS[p.i % 4] + ' 35%, transparent)' : ''}" title="${sc3[k][h]} Schläge, ${fp(v[k])} Punkte">${mk(sc3[k][h], h)}<span class="ssp">${fp(v[k])}</span></td>`; }).join('')}<td class="dst"><span class="big2">${fp(tot[k])}</span> <span class="k">${played ? rank[k] + '. Platz · ' + day[k] + ' Pkt.' : ''}</span></td></tr>`).join('');
      return chips + `<div class="mp-head"><h2 style="margin:0">Tageswertung · Split Sixes</h2><span class="sub" style="margin:0">pro Loch 4/2/0 Punkte, Gleichstand geteilt · Tagessieger 2, Zweiter 1, Letzter 0 Saisonpunkte${played < nHoles ? ' (vorläufig)' : ''}</span></div>
        <div style="overflow-x:auto"><table class="dt">${head}${rows}</table></div><p class="sub">Mitte: Schläge · klein oben rechts: Split-Sixes-Punkte am Loch · in Spielerfarbe: meiste Punkte am Loch (nicht, wenn alle gleich). Sortiert nach aktuellem Punktestand. ${LEG}</p>${msg}`;
    }
    if (n !== 2 && n !== 4) return chips + `<h2>Tageswertung</h2><p class="sub">Matchplay gibt es bei 2 oder 4 Spielern, Split Sixes bei 3 – ausgewählt sind ${n} Spieler. Oben auswählen, wer mitspielt.</p>${msg}`;
    let pairs, sel = '';
    if (n === 2) pairs = [[DP[0].name, DP[1].name]];
    else {
      const g = getPairs(sc), names = DP.map(p => p.name), opts = PAIRS(names);
      pairs = g.pairs && g.pairs.flat().every(x => names.includes(x)) ? g.pairs : null;
      const idx = pairs ? opts.findIndex(o => pairKey(o) === pairKey(pairs)) : -1;
      sel = `<label>Paarungen <select id="dayPair"><option value="">– noch nicht festgelegt –</option>${opts.map((o, k) => `<option value="${k}"${k === idx ? ' selected' : ''}>${esc(o[0].join(' – '))} · ${esc(o[1].join(' – '))}</option>`).join('')}</select></label> <button id="dayDraw">Auslosen</button>`;
    }
    const byName = nm => DP.find(p => p.name === nm);
    let rows = '';
    if (!pairs) rows = DP.map(p => { const o = scoreOf(p); return `<tr><td>${name(p)}</td>${scoreTd(p)}${holes.map(h => `<td>${mk(o[h], h)}</td>`).join('')}<td class="dst"></td></tr>`; }).join('');
    else pairs.forEach(([an, bn], k) => {
      const Pa = byName(an), Pb = byName(bn); if (!Pa || !Pb) return;
      const r = mpCalc(Pa, Pb, nHoles);
      const cellM = (h, s0, me, col) => { const w = r.res[h] === me; return `<td class="${w ? 'win' : ''}" style="${w ? 'background:color-mix(in srgb, ' + col + ' 35%, transparent)' : ''}">${mk(s0[h], h)}</td>`; };
      const st = r.st;
      if (pairs.length > 1) rows += `<tr class="mpsep"><td colspan="${nHoles + 3}">Match ${k + 1}</td></tr>`;
      rows += `<tr><td>${name(Pa)}</td>${scoreTd(Pa)}${holes.map(h => cellM(h, r.sA, 'A', COLORS[Pa.i % 4])).join('')}<td class="dst">${st.A}</td></tr>
        <tr><td>${name(Pb)}</td>${scoreTd(Pb)}${holes.map(h => cellM(h, r.sB, 'B', COLORS[Pb.i % 4])).join('')}<td class="dst">${st.B}</td></tr>`;
    });
    return chips + `<div class="mp-head"><h2 style="margin:0">Tageswertung · Matchplay</h2><span class="sp"></span>${sel}</div>
      <div style="overflow-x:auto"><table class="dt">${head}${rows}</table></div>
      ${!pairs ? '<p class="sub">Paarungen auslosen oder auswählen – dann zeigt die Tabelle die beiden Matches.</p>' : `<p class="sub">In Spielerfarbe = Loch gewonnen. Sieg 2, Unentschieden 1, Niederlage 0 Saisonpunkte. ${LEG}</p>`}${n === 4 ? seasonHint : ''}${msg}`;
  }
  function bindDay(sc, P) {
    const BP = basePlayers(P);
    root.querySelectorAll('#day input[data-only]').forEach(cb => cb.onchange = () => {
      const on = [...root.querySelectorAll('#day input[data-only]')].filter(x => x.checked).map(x => x.dataset.only);
      if (on.length < 2) { cb.checked = true; S.dayMsg = 'Mindestens 2 Spieler auswählen.'; render(); return; }
      setRoundField(sc, 'only', on.length === BP.length ? null : on, 'Spielerauswahl');
    });
    const DP = dayPlayers(P); if (DP.length !== 4) return;
    const names = DP.map(p => p.name), sel = root.querySelector('#dayPair'), dr = root.querySelector('#dayDraw');
    if (sel) sel.onchange = () => { if (sel.value === '') return; setPairs(sc, PAIRS(names)[+sel.value]); };
    if (dr) dr.onclick = () => { if (getPairs(sc).pairs && !confirm('Paarungen neu auslosen? Die bisherigen werden ersetzt.')) return; setPairs(sc, PAIRS(names)[Math.floor(Math.random() * 3)]); };
  }

  // Matchplay brutto: Loch an den Spieler mit weniger Schlägen, gleich = geteilt
  function mpCalc(A, B, nHoles) {
    const sA = {}, sB = {};
    A.holes.forEach(h => { if (h.complete) sA[h.hole] = h.score; });
    B.holes.forEach(h => { if (h.complete) sB[h.hole] = h.score; });
    let diff = 0, played = 0, decided = null; const res = {};
    for (let h = 1; h <= nHoles; h++) {
      if (sA[h] == null || sB[h] == null || decided) continue;
      played++;
      res[h] = sA[h] < sB[h] ? 'A' : sA[h] > sB[h] ? 'B' : 'H';
      diff += res[h] === 'A' ? 1 : res[h] === 'B' ? -1 : 0;
      if (Math.abs(diff) > nHoles - h) decided = { h, left: nHoles - h };
    }
    const up = Math.abs(diff), left = nHoles - played, lead = diff > 0 ? 'A' : 'B';
    const big = t => `<span class="big2">${t}</span>`;
    const st = { A: '', B: '' };
    if (!played) { st.A = st.B = '<span class="k">–</span>'; }
    else if (decided) st[lead] = big(`gewinnt ${decided.left ? up + '&' + decided.left : up + ' up'}`);
    else if (left === 0) { if (diff === 0) st.A = st.B = big('geteilt'); else st[lead] = big(`gewinnt ${up} up`); }
    else if (diff === 0) st.A = st.B = big('AS');
    else st[lead] = big(`${up} up`) + (up === left ? ' <span class="k">Dormie</span>' : '');
    return { sA, sB, res, st, diff, played, done: !!decided || (played > 0 && left === 0) };
  }

  function seasonMiniHTML(sc, P) {
    if (!SE.season) return `<h2>Saisonstand</h2><p class="sub">${sstore.get().pw ? (SE.msg ? esc(SE.msg) : 'Lade Saison …') : 'Für den Saisonstand einmal unter „Saison verwalten“ das Saison-Passwort eingeben.'}</p>`;
    const R0 = TMSeason.compute(SE.season), pr = projRound(sc, P);
    const R1 = pr ? TMSeason.compute(Object.assign({}, SE.season, { rounds: [...(SE.season.rounds || []), pr] })) : null;
    return `<div class="mp-head"><h2 style="margin:0">Saisonstand · ${esc(SE.season.config.name || '')}</h2>${R1 ? '<span class="pbadge">Projected inkl. heute</span>' : ''}<span class="sp"></span><span class="sub" style="margin:0">${R0.included.length} ${R0.included.length === 1 ? 'Runde' : 'Runden'} gewertet${pr && pr.mpNote ? ' · heute: ' + esc(pr.mpNote) + ', Matchplay noch ohne Punkte' : ''}</span><button id="goSeason">Details und Pflege</button></div>
      ${TMSeason.standingsHTML(R1 || R0, { base: R1 ? R0 : null })}`;
  }


  function drawRace(P) {
    const box = root.querySelector('#race'); if (!box) return; box.innerHTML = '';
    const w = Math.max(320, box.clientWidth || 500), h = 230, l = 40, r = 70, t = 10, b = 26;
    const svg = el('svg', { width: w, height: h }, box);
    const series = P.map(p => { let c = 0; const pts = [[0, 0]]; p.holes.filter(x => x.complete).forEach(x => { if (!x.excluded) c += CATS.reduce((s, k) => s + x.sg[k], 0); pts.push([x.hole, c]); }); return pts; });
    const maxH = Math.max(18, ...series.flatMap(s => s.map(q => q[0])));
    const vals = series.flatMap(s => s.map(q => q[1])); let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals); const sp = (hi - lo) || 1; lo -= sp * .08; hi += sp * .08;
    const X = x => l + x / maxH * (w - l - r), Y = v => t + (hi - v) / (hi - lo) * (h - t - b);
    const step = (hi - lo) > 16 ? 5 : (hi - lo) > 6 ? 2 : 1;
    for (let g = Math.ceil(lo / step) * step; g <= hi; g += step) { el('line', { x1: l, x2: w - r, y1: Y(g), y2: Y(g), stroke: g === 0 ? 'var(--mut)' : 'var(--grid)' }, svg); const tx = el('text', { x: l - 6, y: Y(g) + 4, 'text-anchor': 'end' }, svg); tx.textContent = (g > 0 ? '+' : '') + g; }
    [1, 6, 9, 12, 18].forEach(x => { if (x <= maxH) { const tx = el('text', { x: X(x), y: h - 8, 'text-anchor': 'middle' }, svg); tx.textContent = x; } });
    series.forEach((pts, i) => {
      if (pts.length < 2) return;
      el('path', { d: pts.map((q, k) => (k ? 'L' : 'M') + X(q[0]) + ',' + Y(q[1])).join(''), fill: 'none', stroke: COLORS[i % 4], 'stroke-width': 2 }, svg);
      pts.slice(1).forEach(q => { const c = el('circle', { cx: X(q[0]), cy: Y(q[1]), r: 4, fill: COLORS[i % 4], stroke: 'var(--card)', 'stroke-width': 2 }, svg); hover(c, `<b>${P[i].name}</b> nach Loch ${q[0]}<br>SG kumuliert ${sgn(q[1])}`); });
    });
    // Namen am Linienende, ohne Überlappung
    const ends = series.map((pts, i) => ({ i, x: X(pts[pts.length - 1][0]), y: Y(pts[pts.length - 1][1]) })).filter((e, k) => series[k].length > 1).sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13;
    ends.forEach(e => { const tx = el('text', { x: e.x + 8, y: e.y + 4 }, svg); tx.textContent = P[e.i].name.slice(0, 10); });
  }

  function renderDetail() {
    const box = root.querySelector('#detail'); if (!box || !A) return;
    const P = A.players, p = P[S.sel]; if (!p) { box.innerHTML = ''; return; }
    const shots = [...p.shots].sort((a, b) => a.hole - b.hole || a.n - b.n);
    if (S.liveShot || S.shotIdx == null || S.shotIdx >= shots.length) {
      const lastT = shots.reduce((m, s) => (s.t || '') > (m ? m.t || '' : '') ? s : m, null);
      S.shotIdx = lastT ? shots.indexOf(lastT) : shots.length - 1;
    }
    const s = shots[S.shotIdx];
    const tabs = `<span class="tabs">${P.map((q, i) => `<button data-p="${i}" class="${i === S.sel ? 'on' : ''}">${q.name}</button>`).join(' ')}</span>`;
    if (!s) { box.innerHTML = `<div class="det-head"><span class="title">Schlagdetail</span>${tabs}</div><p class="sub">Noch keine Schläge.</p>`; bindDetail(); return; }
    const m = s.m;
    const kv = (k, v) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`;
    const lieEff = m.carry && m.carryActual != null ? (m.carryActual / m.carry - 1) * 100 : null;
    box.innerHTML = `<div class="det-head"><span class="title">Schlagdetail · ${p.name}</span>${tabs}
        <button id="prev"${S.shotIdx <= 0 ? ' disabled' : ''}>←</button><span class="sub" style="margin:0">${S.shotIdx + 1} / ${shots.length}</span><button id="next"${S.shotIdx >= shots.length - 1 ? ' disabled' : ''}>→</button>
        <label><input type="checkbox" id="liveShot"${S.liveShot ? ' checked' : ''}> letztem Schlag folgen</label></div>
      <div class="hero">
        <div><div class="k">Loch ${s.hole} · Par ${s.par} · Schlag ${s.n}</div><div class="v">${s.club || '?'}</div></div>
        <div><div class="k">Lage vorher → nachher</div><div class="v" style="font-size:16px">${lieDe(s.lie0)} → ${lieDe(s.lie1)}</div></div>
        <div><div class="k">Zur Fahne vorher → nachher</div><div class="v">${fmt(s.d0, 0)} → ${s.lie1 === 'HoleCup' ? '0' : fmt(s.d1, 1)} m</div></div>
        <div><div class="k">Strokes Gained (${s.cat})</div><div class="v ${cls(s.sg)}">${sgn(s.sg)}</div></div>
        <div><div class="k">Erwartung vorher → danach</div><div class="v" style="font-size:16px">${fmt(s.eS, 2)} → ${fmt(s.eN, 2)}</div></div>
        ${s.res && s.res !== 'NormalShot' ? `<div><div class="k">Ergebnis</div><div class="v" style="font-size:16px">${s.res}${s.add ? ' (+' + s.add + ')' : ''}</div></div>` : ''}
      </div>
      ${m.ballSpeed == null && m.clubSpeed == null ? `<div class="nomeas">${S.data && S.data.state === 'IN_PROGRESS' ? 'Schläger- und Balldaten liefert Trackman erst nach Rundenende. Bis dahin sind Lage, Distanzen und Strokes Gained live.' : 'Für diesen Schlag liegen (noch) keine Messwerte vor.'} Strecke im Spiel: ${fmt(s.travel, 0)} m, Höhenunterschied ${sgn(s.elev, 1)} m.</div>` : `<div class="grid3">
        <div class="grp"><h3>Schläger</h3>${kv('Club Speed', fmt(mph(m.clubSpeed), 1) + ' mph')}${kv('Smash Factor', fmt(m.smashFactor, 2))}${kv('Club Path', fmt(m.clubPath) + '°')}${kv('Face Angle', fmt(m.faceAngle) + '°')}${kv('Face to Path', fmt(m.faceToPath) + '°')}${kv('Attack Angle', fmt(m.attackAngle) + '°')}${kv('Dynamic Loft', fmt(m.dynamicLoft) + '°')}${kv('Impact Offset', m.impactOffset != null ? fmt(m.impactOffset * 1000) + ' mm' : '–')}${kv('Impact Height', m.impactHeight != null ? fmt(m.impactHeight * 1000) + ' mm' : '–')}</div>
        <div class="grp"><h3>Ball (gemessen)</h3>${kv('Ball Speed', fmt(mph(m.ballSpeed), 1) + ' mph')}${kv('Abflugwinkel', fmt(m.launchAngle) + '°')}${kv('Startrichtung', fmt(m.launchDirection) + '°')}${kv('Spin', fmt(m.spinRate, 0) + ' rpm')}${kv('Spinachse', fmt(m.spinAxis) + '°')}${kv('Max. Höhe', fmt(m.maxHeight) + ' m')}</div>
        <div class="grp"><h3>Ergebnis: Matte | Spiel</h3>${kv('Carry', fmt(m.carry, 1) + ' | ' + fmt(m.carryActual, 1) + ' m')}${kv('Total', fmt(m.total, 1) + ' | ' + fmt(m.totalActual, 1) + ' m')}${kv('Seitlich (Carry)', fmt(m.carrySide) + ' | ' + fmt(m.carrySideActual) + ' m')}${kv('Kurve', fmt(m.curve) + ' | ' + fmt(m.curveActual) + ' m')}${kv('Landewinkel', fmt(m.landingAngle) + ' | ' + fmt(m.landingAngleActual) + '°')}${kv('Spinachse', fmt(m.spinAxis) + ' | ' + fmt(m.spinAxisActual) + '°')}${kv('Lage-/Spiel-Effekt Carry', lieEff == null ? '–' : sgn(lieEff, 0) + ' %')}${kv('Strecke im Spiel / Höhe', fmt(s.travel, 0) + ' m / ' + sgn(s.elev, 1) + ' m')}</div>
      </div>`}
      <p class="sub" style="margin-top:8px">Pfeiltasten ← → blättern. „Matte“ = gemessener Flug auf ebenem Boden; „Spiel“ = von Trackman mit Lage, Gefälle und Wind simuliert. Ball Speed, Spin und Abflugwinkel simuliert Trackman nicht – sie sind immer die gemessenen Werte.</p>`;
    bindDetail(shots.length);
  }
  function bindDetail(n) {
    root.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { S.sel = +b.dataset.p; S.liveShot = true; render(); });
    const pv = root.querySelector('#prev'), nx = root.querySelector('#next'), ls = root.querySelector('#liveShot');
    if (pv) pv.onclick = () => { S.liveShot = false; S.shotIdx = Math.max(0, S.shotIdx - 1); renderDetail(); };
    if (nx) nx.onclick = () => { S.liveShot = false; S.shotIdx = Math.min(n - 1, S.shotIdx + 1); renderDetail(); };
    if (ls) ls.onchange = () => { S.liveShot = ls.checked; renderDetail(); };
  }
  document.addEventListener('keydown', e => {
    if (!visible || !A || S.view !== 'shots') return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const b = root.querySelector(e.key === 'ArrowLeft' ? '#prev' : '#next'); if (b && !b.disabled) { b.click(); e.preventDefault(); } }
  });

  // ---------------- Saisonwertung (Datei season.json im GitHub-Repository, verschlüsselt) ----------------
  const REPO = 'deeep0r/trackman-stats', SPATH = 'season.json';
  const SLS = 'tmSeason:v1';
  const sstore = { get() { try { return JSON.parse(localStorage.getItem(SLS) || '{}'); } catch (e) { return {}; } }, set(o) { try { localStorage.setItem(SLS, JSON.stringify(Object.assign(sstore.get(), o))); } catch (e) {} } };
  const SE = { season: null, sha: null, dirty: false, msg: '', busy: false, loaded: false, openIds: new Set() };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const utf8b64 = str => { const b = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); };
  const b64utf8 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));
  const newSeason = () => ({ format: 1, config: { name: 'Home Improvement Winter Challenge 2026/2027', participants: ['Ollipelli', 'Deepy', 'JD1903', 'MitchCB'], start: '2026-11-03', end: '' }, rounds: [] });
  const ghHeaders = () => { const t = sstore.get().gh; return Object.assign({ Accept: 'application/vnd.github+json' }, t ? { Authorization: 'Bearer ' + t } : {}); };
  async function seasonLoad() {
    const cfg = sstore.get();
    if (!cfg.pw) throw new Error('PW');
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${SPATH}?ref=main&_=${Date.now()}`, { headers: ghHeaders(), cache: 'no-store' });
    if (r.status === 404) { SE.season = newSeason(); SE.sha = null; SE.dirty = true; SE.loaded = true; return; }
    if (!r.ok) throw new Error('GitHub antwortet ' + r.status + (r.status === 401 ? ' (Token ungültig?)' : ''));
    const j = await r.json();
    let data;
    try { data = await TMSeason.decrypt(JSON.parse(b64utf8(j.content)), cfg.pw); } catch (e) { throw new Error('DECRYPT'); }
    SE.season = data; SE.sha = j.sha; SE.dirty = false; SE.loaded = true;
  }
  async function seasonSave() {
    const cfg = sstore.get();
    if (!cfg.gh) throw new Error('Zum Speichern fehlt der GitHub-Token (unten unter „Einstellungen“).');
    SE.season.updated = new Date().toISOString();
    const file = await TMSeason.encrypt(SE.season, cfg.pw);
    const body = { message: 'Saisonwertung aktualisiert', content: utf8b64(JSON.stringify(file)), branch: 'main' };
    if (SE.sha) body.sha = SE.sha;
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${SPATH}`, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders()), body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) throw new Error('Die Datei wurde inzwischen woanders geändert. Bitte „Neu laden“ und die Änderung wiederholen.');
    if (r.status === 401 || r.status === 403) throw new Error('GitHub lehnt den Token ab (' + r.status + '). Token prüfen: nur Repository trackman-stats, Berechtigung Contents: Read and write.');
    if (!r.ok) throw new Error('Speichern fehlgeschlagen: GitHub ' + r.status);
    const j = await r.json(); SE.sha = j.content.sha; SE.dirty = false;
  }
  const QS_LIST = `{ me { scorecards(take:60) { id state startedAt lastUpdatedAt } } }`;
  const QS_ROUND = `query($id:ID!){ node(id:$id){ ... on Scorecard { id state startedAt lastUpdatedAt teeName course { displayName } playersScorecards { isTeamScorecard teeName player { name } holes { holeNumber par grossScore } } } } }`;
  async function seasonSync() {
    const cfg = SE.season.config, r = await gq(token, QS_LIST);
    if (r.errors) throw new Error(r.errors[0].message);
    const inWin = s => { const d = TMSeason.localDate(s.startedAt); return d >= cfg.start && (!cfg.end || d <= cfg.end); };
    const list = (r.data.me.scorecards || []).filter(s => s.state === 'COMPLETED' && s.startedAt && inWin(s));
    let added = 0, updated = 0;
    for (const s of list) {
      const ex = SE.season.rounds.find(x => x.id === s.id);
      if (ex && ex.updated === s.lastUpdatedAt) continue;
      const q = await gq(token, QS_ROUND, { id: s.id });
      const sc = q.data && q.data.node; if (!sc) continue;
      const ps = sc.playersScorecards.filter(p => !p.isTeamScorecard);
      const nos = [...new Set(ps.flatMap(p => p.holes.map(h => h.holeNumber)))].sort((a, b) => a - b);
      const parOf = n => { for (const p of ps) { const h = p.holes.find(x => x.holeNumber === n); if (h && h.par) return h.par; } return null; };
      const round = { id: sc.id, date: sc.startedAt, updated: sc.lastUpdatedAt, course: sc.course.displayName.trim(), tee: sc.teeName, holeNos: nos, par: nos.map(parOf),
        players: ps.map(p => ({ name: p.player.name, tee: p.teeName || sc.teeName, scores: nos.map(n => { const h = p.holes.find(x => x.holeNumber === n); return h && h.grossScore != null ? h.grossScore : null; }) })) };
      if (round.players.length < 2) continue;
      const pre = (SE.season.pairings || {})[s.id], preOnly = (SE.season.only || {})[s.id];
      if (ex) { round.include = ex.include; round.pairings = ex.pairings || pre; round.only = ex.only || preOnly; Object.assign(ex, round); updated++; } else { if (pre) round.pairings = pre; if (preOnly) round.only = preOnly; SE.season.rounds.push(round); added++; }
      if (pre && SE.season.pairings) delete SE.season.pairings[s.id];
      if (preOnly && SE.season.only) delete SE.season.only[s.id];
    }
    if (added || updated) SE.dirty = true;
    return { added, updated, checked: list.length };
  }
  async function seasonRun(fn, okMsg) {
    if (SE.busy) return; SE.busy = true; SE.msg = 'Arbeite …'; renderSeason();
    try { const m = await fn(); SE.msg = typeof okMsg === 'function' ? okMsg(m) : okMsg || ''; }
    catch (e) {
      SE.msg = e.message === 'PW' ? '' : e.message === 'DECRYPT' ? 'Das Saison-Passwort passt nicht zur Datei.' : e.message === 'AUTH' ? 'Anmeldung im Portal abgelaufen – Portal neu laden.' : e.message;
      if (e.message === 'DECRYPT') sstore.set({ pw: '' });
    }
    SE.busy = false; renderSeason();
  }
  async function seasonOpen() {
    if (!sstore.get().pw) { renderSeason(); return; }
    await seasonRun(async () => { await seasonLoad(); return await seasonSync(); }, m => m.added || m.updated ? `${m.added} neue, ${m.updated} geänderte Runde(n) aus dem Portal übernommen – bitte speichern.` : 'Aktuell: keine neuen Runden im Portal.');
    if (SE.dirty && sstore.get().gh && SE.season && SE.season.rounds.length && SE.sha) await seasonRun(seasonSave, 'Neue Runden übernommen und gespeichert.');
  }
  function renderSeason() {
    main.querySelectorAll('details.rd[data-id]').forEach(d => d.open ? SE.openIds.add(d.dataset.id) : SE.openIds.delete(d.dataset.id));
    const cfg = sstore.get();
    $('#meta').textContent = 'Saisonwertung';
    const settings = `<details class="help" id="sset"${!cfg.pw || !cfg.gh ? ' open' : ''}><summary>Einstellungen (Passwort, GitHub-Token)</summary>
      <p>Saison-Passwort (wie für die Stats-Seite): <input type="password" id="spw" placeholder="${cfg.pw ? 'gespeichert' : 'Passwort'}" style="width:160px"> 
      GitHub-Token zum Speichern: <input type="password" id="sgh" placeholder="${cfg.gh ? 'gespeichert' : 'github_pat_…'}" style="width:260px"> <button id="ssetSave">Übernehmen</button> ${cfg.gh ? '<button id="sghDel">Token löschen</button>' : ''}</p>
      <p>Den Token legst du selbst bei GitHub an: Settings → Developer settings → Personal access tokens → Fine-grained tokens → „Generate new token“. Repository access: <b>Only select repositories → trackman-stats</b>, Permissions → Repository → <b>Contents: Read and write</b>, Ablaufdatum z. B. Mai 2027. Token und Passwort bleiben nur in diesem Browser. Ohne Token kann man die Saison ansehen, aber nicht speichern.</p></details>`;
    if (!cfg.pw) { main.innerHTML = `<div class="card">${SE.msg ? `<div class="err">${esc(SE.msg)}</div>` : ''}<h2>Saisonwertung</h2><p class="sub">Einmal das Saison-Passwort eingeben (dasselbe wie für die Stats-Seite).</p>${settings}</div>`; bindSeasonSettings(); return; }
    if (!SE.season) { main.innerHTML = `<div class="card">${SE.msg ? `<div class="err">${esc(SE.msg)}</div>` : '<div class="msg">Lade Saison …</div>'}${settings}</div>`; bindSeasonSettings(); return; }
    const c = SE.season.config;
    const R = TMSeason.compute(SE.season);
    const raw = id => SE.season.rounds.find(x => x.id === id);
    const editor = r => {
      const rr = raw(r.id); const inc = rr.include === true ? 'yes' : rr.include === false ? 'no' : 'auto';
      let h = `<div class="sed"><label>Zählt <select data-inc="${esc(r.id)}"><option value="auto"${inc === 'auto' ? ' selected' : ''}>automatisch (${r.auto ? 'ja' : 'nein'})</option><option value="yes"${inc === 'yes' ? ' selected' : ''}>ja</option><option value="no"${inc === 'no' ? ' selected' : ''}>nein</option></select></label>`;
      const cand = (rr.players || []).filter(p => c.participants.includes(p.name) && p.scores && p.scores.every(x => x != null)).map(p => p.name);
      if (cand.length > 2) h += ` <span class="k">Spielen mit:</span> ${cand.map(nm => `<label class="chip${!rr.only || rr.only.includes(nm) ? ' on' : ''}"><input type="checkbox" data-sonly="${esc(r.id)}" value="${esc(nm)}"${!rr.only || rr.only.includes(nm) ? ' checked' : ''}>${esc(nm)}</label>`).join('')}`;
      if (r.included && r.players.length === 4) {
        const n = r.players.map(p => p.name), opts = PAIRS(n), cur = JSON.stringify((rr.pairings || []).map(p => [...p].sort()).sort());
        const idx = opts.findIndex(o => JSON.stringify(o.map(p => [...p].sort()).sort()) === cur);
        h += ` <label>Matchplay-Paarungen <select data-pair="${esc(r.id)}"><option value="">– noch nicht festgelegt –</option>${opts.map((o, k) => `<option value="${k}"${k === idx ? ' selected' : ''}>${esc(o[0].join(' – '))} · ${esc(o[1].join(' – '))}</option>`).join('')}</select></label> <button data-draw="${esc(r.id)}">Auslosen</button>`;
      }
      return h + '</div>';
    };
    main.innerHTML = `<div class="card">
      <div class="mp-head"><h2 style="margin:0">${esc(c.name)}</h2><span class="sp"></span>
        <button id="ssync"${SE.busy ? ' disabled' : ''}>Runden aus dem Portal holen</button>
        <button id="sreload"${SE.busy ? ' disabled' : ''}>Neu laden</button>
        <button class="pri" id="ssave"${SE.busy || !SE.dirty ? ' disabled' : ''}>${SE.dirty ? 'Speichern' : 'Gespeichert'}</button></div>
      ${SE.msg ? `<div class="err">${esc(SE.msg)}</div>` : ''}
      <p class="sub">Teilnehmer <input id="sparts" value="${esc(c.participants.join(', '))}" style="width:300px"> · Saison von <input type="date" id="sstart" value="${esc(c.start)}"> bis <input type="date" id="send" value="${esc(c.end || '')}"> (leer = offen)
        ${SE.season.updated ? ' · zuletzt gespeichert ' + new Date(SE.season.updated).toLocaleString('de-DE') : ''}</p>
      <p class="sub">Geholt werden beendete Runden deines Trackman-Kontos (in denen du mitgespielt hast). Eine Runde zählt automatisch, wenn mindestens zwei Teilnehmer sie komplett gespielt haben; das lässt sich je Runde ändern. Bei vier Spielern die ausgelosten Matchplay-Paarungen eintragen. Änderungen erst mit „Speichern“ ins Repository schreiben – danach sieht sie jeder auf der Stats-Seite (nach etwa einer Minute).</p>
      ${TMSeason.fullHTML(R, { editor, all: true, openIds: SE.openIds })}
      ${settings}</div>`;
    TMSeason.bindStandings(main);
    bindSeasonSettings();
    const mark = () => { SE.dirty = true; renderSeason(); };
    main.querySelectorAll('select[data-inc]').forEach(el => el.onchange = () => { const rr = raw(el.dataset.inc); rr.include = el.value === 'yes' ? true : el.value === 'no' ? false : undefined; mark(); });
    main.querySelectorAll('input[data-sonly]').forEach(el => el.onchange = () => {
      const rr = raw(el.dataset.sonly), boxes = [...main.querySelectorAll('input[data-sonly]')].filter(x => x.dataset.sonly === el.dataset.sonly), on = boxes.filter(x => x.checked).map(x => x.value);
      if (on.length < 2) { el.checked = true; return; }
      rr.only = on.length === boxes.length ? undefined : on; SE.openIds.add(rr.id); mark(); });
    main.querySelectorAll('select[data-pair]').forEach(el => el.onchange = () => { const rr = raw(el.dataset.pair), r = R.rounds.find(x => x.id === rr.id); rr.pairings = el.value === '' ? undefined : PAIRS(r.players.map(p => p.name))[+el.value]; mark(); });
    main.querySelectorAll('button[data-draw]').forEach(el => el.onclick = () => { const rr = raw(el.dataset.draw), r = R.rounds.find(x => x.id === rr.id); rr.pairings = PAIRS(r.players.map(p => p.name))[Math.floor(Math.random() * 3)]; SE.openIds.add(rr.id); mark(); });
    main.querySelectorAll('.sed').forEach(el => el.addEventListener('click', e => e.stopPropagation()));
    const pt = $('#sparts'); if (pt) pt.onchange = () => { c.participants = pt.value.split(',').map(x => x.trim()).filter(Boolean); mark(); };
    const st = $('#sstart'); if (st) st.onchange = () => { c.start = st.value; mark(); };
    const en = $('#send'); if (en) en.onchange = () => { c.end = en.value; mark(); };
    $('#ssync').onclick = () => seasonRun(seasonSync, m => m.added || m.updated ? `${m.added} neue, ${m.updated} geänderte Runde(n) übernommen – bitte speichern.` : `Keine neuen Runden (${m.checked} beendete Runden im Zeitraum geprüft).`);
    $('#sreload').onclick = () => { if (SE.dirty && !confirm('Ungespeicherte Änderungen verwerfen?')) return; seasonRun(seasonLoad, 'Neu geladen.'); };
    $('#ssave').onclick = () => seasonRun(seasonSave, 'Gespeichert. Die Stats-Seite zeigt den Stand in etwa einer Minute.');
  }
  function bindSeasonSettings() {
    const b = $('#ssetSave'); if (b) b.onclick = () => { const pw = $('#spw').value, gh = $('#sgh').value.trim(); const o = {}; if (pw) o.pw = pw; if (gh) o.gh = gh; sstore.set(o); SE.msg = ''; if (pw) { SE.season = null; seasonOpen(); } else renderSeason(); };
    const d = $('#sghDel'); if (d) d.onclick = () => { sstore.set({ gh: '' }); renderSeason(); };
  }

  // ---------------- Steuerung ----------------
  function setTab(t) {
    S.view = t; store.set({ tab: t });
    root.querySelectorAll('.vtabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    ['#round', '#replayL', '#rp'].forEach(q => $(q).style.visibility = t === 'season' ? 'hidden' : '');
    main.scrollTop = 0;
    if (t === 'season') { if (SE.dirty || SE.busy) renderSeason(); else seasonOpen(); } else render();
  }
  root.querySelectorAll('.vtabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  // Saison im Hintergrund laden (für Übersicht und Paarungen)
  async function seasonBackground() {
    if (!sstore.get().pw || SE.season || SE.busy) return;
    try { await seasonLoad(); } catch (e) { SE.msg = e.message === 'DECRYPT' ? 'Das Saison-Passwort passt nicht zur Datei.' : 'Saison konnte nicht geladen werden: ' + e.message; }
    if (S.view === 'overview') render();
    seasonAuto();
  }
  // Nach Rundenende die Runde automatisch in die Saison übernehmen (mit Token gleich speichern)
  async function seasonAuto() {
    const sc = S.data;
    if (!SE.season || SE.busy || SE.dirty || !sc || sc.state !== 'COMPLETED' || S.replay) return;
    if ((SE.season.rounds || []).some(r => r.id === sc.id) || S.autoSynced.has(sc.id)) return;
    S.autoSynced.add(sc.id); SE.busy = true;
    try {
      const m = await seasonSync();
      if (m.added && sstore.get().gh) { await seasonSave(); S.dayMsg = 'Runde in die Saisonwertung übernommen und gespeichert.'; }
      else if (m.added) S.dayMsg = 'Runde in die Saisonwertung übernommen – zum Speichern fehlt der GitHub-Token (Saison verwalten).';
    } catch (e) { S.dayMsg = 'Saison: ' + e.message; }
    SE.busy = false; if (S.view === 'overview') render();
  }
  $('#round').onchange = () => { S.id = $('#round').value; S.follow = false; $('#follow').checked = false; S.sel = 0; S.liveShot = true; store.set({ id: S.id, follow: false }); refresh(); };
  $('#follow').onchange = () => { S.follow = $('#follow').checked; store.set({ follow: S.follow }); if (S.follow) refresh(); };
  $('#now').onclick = () => refresh();
  $('#ival').onchange = () => { S.ival = +$('#ival').value; store.set({ ival: S.ival }); schedule(); };
  $('#pause').onclick = () => { S.paused = !S.paused; $('#pause').textContent = S.paused ? 'Fortsetzen' : 'Pause'; schedule(); };
  $('#replay').onchange = () => {
    S.replay = $('#replay').checked; $('#rp').classList.toggle('on', S.replay);
    if (S.replay) { S.paused = true; $('#pause').textContent = 'Fortsetzen'; S.rpPos = 0; } else { clearInterval(S.rpTimer); S.rpTimer = null; $('#rpPlay').textContent = '▶'; }
    S.liveShot = true; schedule(); render();
  };
  $('#rpPos').oninput = () => { S.rpPos = +$('#rpPos').value; S.liveShot = true; render(); };
  $('#rpPlay').onclick = () => {
    if (S.rpTimer) { clearInterval(S.rpTimer); S.rpTimer = null; $('#rpPlay').textContent = '▶'; return; }
    $('#rpPlay').textContent = '❚❚';
    S.rpTimer = setInterval(() => { if (!A || S.rpPos >= A.timeline.length) { clearInterval(S.rpTimer); S.rpTimer = null; $('#rpPlay').textContent = '▶'; return; } S.rpPos++; S.liveShot = true; render(); }, 1200);
  };
  let timer = null;
  function schedule() { clearInterval(timer); if (!S.paused) timer = setInterval(() => { if (visible && !document.hidden) refresh(); }, S.ival * 1000); }
  window.addEventListener('resize', () => { if (visible && A) render(); });

  setTab(S.view === 'season' ? 'overview' : S.view);
  seasonBackground();
  await refresh();
  schedule();
})();
