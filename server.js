const express = require('express');
const path = require('path');
const { URLSearchParams } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// -----------------------------------------------------------------------------
// Utility
// -----------------------------------------------------------------------------

const MONTHS_IT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu',
                   'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

function humanDate(isoDate) {
  if (!isoDate) return { label: isoDate, relative: '' };
  try {
    const d = new Date(isoDate.replace('Z', '+00:00'));
    const now = new Date();
    const deltaDays = Math.floor(
      (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
    );
    const pad = (n) => String(n).padStart(2, '0');
    const label = `${d.getDate()} ${MONTHS_IT[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;

    let rel;
    if (deltaDays === 0) rel = 'oggi';
    else if (deltaDays === 1) rel = 'ieri';
    else if (deltaDays < 0) rel = 'nel futuro';
    else rel = `${deltaDays} giorni fa`;

    return { label, relative: rel };
  } catch {
    return { label: isoDate, relative: '' };
  }
}

function compactDate(date) {
  if (!date) return '—';
  try {
    const d = new Date(date.replace('Z', '+00:00'));
    if (Number.isNaN(d.getTime())) return '—';
    const pad = (n) => String(n).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${yy}`;
  } catch {
    return '—';
  }
}

function extractNameVersion(title, keyword) {
  let t = title.replace(/^Add\s+/i, '');
  const idx = t.indexOf(keyword);
  if (idx !== -1) {
    t = t.slice(0, idx).trim();
  }
  const parts = t.split(/\s+/);
  if (!parts.length) return [null, null];
  const name = parts[0];
  if (!/^[A-Za-z0-9][A-Za-z0-9+_.@-]*$/.test(name)) return [null, null];
  const version = parts.length > 1 ? parts[1] : null;
  return [name, version];
}

// -----------------------------------------------------------------------------
// API calls
// -----------------------------------------------------------------------------

const PACKAGE_CACHE = {};

async function fetchGithub(repo, phrase, perPage, token) {
  const params = new URLSearchParams({
    q: `repo:${repo} "${phrase}"`,
    sort: 'committer-date',
    order: 'desc',
    per_page: String(perPage),
  });

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'brew-new-tracker/2.0',
  };
  const authToken = token || GITHUB_TOKEN;
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const url = `https://api.github.com/search/commits?${params.toString()}`;
  const res = await fetch(url, { headers, timeout: 15000 });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body}`);
  }
  return res.json();
}

async function getPackageInfo(kind, name) {
  // kind: "formula" or "cask"
  const candidates = [name.toLowerCase(), name];
  // dedupe preserving order
  const seen = new Set();
  const uniq = candidates.filter((c) => {
    if (seen.has(c)) return false;
    seen.add(c);
    return true;
  });

  let notFound = false;
  for (const cand of uniq) {
    if (PACKAGE_CACHE[cand]) return PACKAGE_CACHE[cand];
    const url = `https://formulae.brew.sh/api/${kind}/${encodeURIComponent(cand)}.json`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'brew-new-tracker/2.0' },
      });
      if (res.status === 404) { notFound = true; continue; }
      if (!res.ok) continue;
      const data = await res.json();
      const apiVersion = data.version || (data.versions && data.versions.stable) || '';
      const homepage = data.homepage || '';
      const desc = data.desc || '';
      PACKAGE_CACHE[cand] = { version: apiVersion, homepage, desc };
      return PACKAGE_CACHE[cand];
    } catch {
      continue;
    }
  }
  const result = { version: '', homepage: '', desc: '', notFound };
  PACKAGE_CACHE[name] = result;
  return result;
}

async function enrichRows(rows, kind, fetchHomepage, threads) {
  if (!rows.length) return [];

  if (fetchHomepage) {
    const limit = Math.max(1, threads);
    const chunks = [];
    for (let i = 0; i < rows.length; i += limit) {
      chunks.push(rows.slice(i, i + limit));
    }
    const enriched = [];
    for (const chunk of chunks) {
      const results = await Promise.all(
        chunk.map((r) => getPackageInfo(kind, r[0]))
      );
      for (let i = 0; i < chunk.length; i++) {
        const [name, date, version] = chunk[i];
        const { version: apiVersion, homepage, desc, notFound } = results[i];
        enriched.push([name, version || apiVersion, date, homepage, desc, notFound]);
      }
    }
    return enriched;
  }

  // no homepage: only need version fallback
  const enriched = [];
  for (const [name, date, version] of rows) {
    if (version) {
      enriched.push([name, version, date, null, null]);
    } else {
      const { version: apiVersion } = await getPackageInfo(kind, name);
      enriched.push([name, apiVersion, date, null, null]);
    }
  }
  return enriched;
}

// -----------------------------------------------------------------------------
// Core
// -----------------------------------------------------------------------------

async function fetchAndParse(repo, phrase, keyword, limit, fetchHomepage, threads, token) {
  const fetchPage = Math.max(30, limit);
  let data;
  try {
    data = await fetchGithub(repo, phrase, fetchPage, token);
  } catch (err) {
    return { rows: [], warning: err.message };
  }

  const items = data.items || [];
  if (data.message && data.message.toLowerCase().includes('rate limit')) {
    return { rows: [], warning: data.message + ' — imposta GITHUB_TOKEN (o GH_TOKEN) per aumentare il limite.' };
  }

  const seen = {};
  for (const item of items) {
    const msg = item.commit?.message || '';
    const date = item.commit?.committer?.date || '';
    const lines = msg.split('\n').map((l) => l.trim()).filter(Boolean);
    const title = lines.find((l) => l.includes(keyword));
    if (!title) continue;

    const [name, version] = extractNameVersion(title, keyword);
    if (!name) continue;

    if (!seen[name] || date > seen[name][0]) {
      seen[name] = [date, version];
    }
  }

  const rows = Object.entries(seen)
    .map(([name, [date, version]]) => [name, date, version])
    .sort((a, b) => (b[1] > a[1] ? 1 : -1))
    .slice(0, limit);

  return { rows, warning: null };
}

// -----------------------------------------------------------------------------
// API endpoint
// -----------------------------------------------------------------------------

app.get('/api/brew-tracker', async (req, res) => {
  const {
    n = '25',
    only = 'both',
    json = 'true',
    noHomepage = 'false',
    combined = 'false',
    threads = '8',
    token = '',
  } = req.query;

  let perPage = parseInt(n, 10);
  if (isNaN(perPage) || perPage < 1 || perPage > 100) {
    return res.status(400).json({ error: '-n deve essere un intero tra 1 e 100.' });
  }

  const allowedOnly = ['both', 'formula', 'cask', 'font'];
  if (!allowedOnly.includes(only)) {
    return res.status(400).json({ error: `--only accetta solo ${allowedOnly.join(', ')}.` });
  }

  const threadCount = Math.max(1, parseInt(threads, 10) || 8);
  const fetchHomepage = noHomepage !== 'true';
  const outputJson = json === 'true';
  const doCombined = combined === 'true';

  const results = {};
  const warnings = [];

  const tasks = [];
  if (only === 'both' || only === 'formula') {
    tasks.push(
      fetchAndParse('Homebrew/homebrew-core', 'new formula', '(new formula)', perPage, fetchHomepage, threadCount, token)
        .then((r) => {
          results.formulae = r.rows;
          if (r.warning) warnings.push(`formulae.json: ${r.warning}`);
        })
    );
  }
  if (only === 'both' || only === 'cask' || only === 'font') {
    tasks.push(
      fetchAndParse('Homebrew/homebrew-cask', 'new cask', '(new cask)', perPage, fetchHomepage, threadCount, token)
        .then((r) => {
          if (r.warning) warnings.push(`casks.json: ${r.warning}`);
          const fonts = r.rows.filter((row) => row[0].toLowerCase().startsWith('font-'));
          const casks = r.rows.filter((row) => !row[0].toLowerCase().startsWith('font-'));
          if (only === 'both' || only === 'cask') results.casks = casks;
          if (only === 'both' || only === 'font') results.fonts = fonts;
        })
    );
  }

  await Promise.all(tasks);

  const kindFor = { formulae: 'formula', casks: 'cask', fonts: 'cask' };

  const enriched = {};
  for (const [key, rows] of Object.entries(results)) {
    enriched[key] = await enrichRows(rows, kindFor[key], fetchHomepage, threadCount);
  }

  if (outputJson) {
    const out = {};
    for (const [key, rows] of Object.entries(enriched)) {
      out[key] = rows.map(([n, v, d, h, desc, notFound]) => {
        const { label, relative } = humanDate(d);
        const na = notFound ? 'non ancora disponibile' : null;
        return {
          name: n,
          version: v,
          date: d,
          date_human: label,
          date_relative: relative,
          homepage: na || h,
          description: na || desc,
        };
      });
    }
    return res.json({ ...out, combined: doCombined, warnings });
  }

  // Table output (plain text with Unicode box-drawing, matching script)

  const TERM_WIDTH = 100;
  const H = '─';
  const V = '│';

  function shorten(value, width) {
    const val = String(value !== null && value !== undefined ? value : '—');
    if (val.length <= width) return val;
    return val.slice(0, Math.max(1, width - 1)) + '…';
  }

  function cell(text, width, align = 'left') {
    const val = shorten(text, width);
    return align === 'right' ? val.padStart(width) : val.padEnd(width);
  }

  function tableRow(cells) {
    return V + cells.map((c) => ` ${c} `).join(V) + V;
  }

  function hline(left, mid, right, widths) {
    return left + widths.map((w) => H.repeat(w + 2)).join(mid) + right;
  }

  function printTable(title, count, headers, widths, rowData) {
    const lines = [];
    lines.push('');
    lines.push(`${title}  (${count})`);
    if (!rowData || !rowData.length) {
      lines.push('  nessun risultato');
      return lines;
    }
    lines.push(hline('┌', '┬', '┐', widths));
    lines.push(tableRow(headers.map((h, i) => h.padEnd(widths[i]))));
    lines.push(hline('├', '┼', '┤', widths));
    for (const cells of rowData) {
      lines.push(tableRow(cells));
    }
    lines.push(hline('└', '┴', '┘', widths));
    return lines;
  }

  const lines = [];
  const sectionInfo = {
    formulae: { icon: '🍺', label: 'FORMULE' },
    casks: { icon: '🖥 ', label: 'CASK' },
    fonts: { icon: '🔠', label: 'FONT' },
  };

  if (doCombined) {
    const merged = [];
    for (const key of Object.keys(enriched)) {
      const kind = { formulae: 'formula', casks: 'cask', fonts: 'font' }[key];
      for (const r of enriched[key]) {
        merged.push([kind, ...r]);
      }
    }
    merged.sort((a, b) => (b[3] > a[3] ? 1 : -1));

    if (!merged.length) {
      lines.push('', '🍺 🖥 🔠 TUTTI I PACCHETTI  (0)', '  nessun risultato');
    } else {
      const homeW = fetchHomepage ? 30 : 0;
      const typeW = Math.max('TIPO'.length, 'formula'.length, 'cask'.length, 'font'.length);
      const nameW = Math.min(22, Math.max(4, Math.max(...merged.map((t) => t[1].length))));
      const verW = Math.max(3, Math.max(...merged.map((t) => (t[2] || '—').length)));
      const dateW = 11;
      const fixedW = [typeW, nameW, verW, dateW];
      if (homeW) fixedW.push(homeW);
      let descW = TERM_WIDTH - 1 - fixedW.reduce((s, w) => s + w + 3, 0) - 3;
      if (descW < 13) descW = 0;

      const widths = [...fixedW];
      const headers = ['TIPO', 'NOME', 'VER', 'DATA'];
      if (homeW) headers.push('HOMEPAGE');
      if (descW) {
        headers.push('DESC');
        widths.push(descW);
      }

      const rowData = merged.map(([kind, name, version, date, homepage, desc, notFound]) => {
        const na = notFound ? 'non ancora disponibile' : null;
        const cells = [
          cell(kind, typeW),
          cell(name, nameW),
          cell(version || '—', verW),
          cell(compactDate(date), dateW),
        ];
        if (homeW) cells.push(cell(homepage ? homepage.replace(/^https?:\/\//, '').trim() : (na || '—'), homeW));
        if (descW) cells.push(cell(desc || na || '—', descW));
        return cells;
      });

      lines.push(...printTable('🍺 🖥 TUTTI I PACCHETTI', merged.length, headers, widths, rowData));
    }

    lines.push('', `· ${merged.length} pacchetti totali ·`, '');
  } else {
    let total = 0;
    let nameW = 4, verW = 3;
    const homeW = fetchHomepage ? 30 : 0;

    for (const key of Object.keys(enriched)) {
      const rows = enriched[key];
      if (rows && rows.length) {
        nameW = Math.max(nameW, Math.max(...rows.map((r) => r[0].length)));
        verW = Math.max(verW, Math.max(...rows.map((r) => (r[1] || '—').length)));
      }
    }
    nameW = Math.min(22, nameW);
    verW = Math.max(3, verW);

    const fixedW = [nameW, verW, 11];
    if (homeW) fixedW.push(homeW);

    let maxDesc = 0;
    for (const key of ['formulae', 'casks']) {
      if (!enriched[key]) continue;
      for (const r of enriched[key]) {
        if (r[4]) maxDesc = Math.max(maxDesc, r[4].length);
      }
    }
    let descW = TERM_WIDTH - 1 - fixedW.reduce((s, w) => s + w + 3, 0) - 3;
    descW = maxDesc ? Math.min(descW, maxDesc) : descW;
    if (descW < 13) descW = 0;

    for (const key of Object.keys(enriched)) {
      const info = sectionInfo[key];
      const rows = enriched[key];
      if (!rows || !rows.length) continue;

      total += rows.length;

      const widths = [nameW, verW, 11];
      const headers = ['NOME', 'VER', 'DATA'];
      if (homeW) widths.push(homeW), headers.push('HOMEPAGE');
      if (descW) widths.push(descW), headers.push('DESC');

      const rowData = rows.map(([name, version, date, homepage, desc, notFound]) => {
        const na = notFound ? 'non ancora disponibile' : null;
        const cells = [
          cell(name, nameW),
          cell(version || '—', verW),
          cell(compactDate(date), 11),
        ];
        if (homeW) cells.push(cell(homepage ? homepage.replace(/^https?:\/\//, '').trim() : (na || '—'), homeW));
        if (descW) cells.push(cell(desc || na || '—', descW));
        return cells;
      });

      lines.push(...printTable(`${info.icon} ${info.label}`, rows.length, headers, widths, rowData));
    }

    lines.push('', `· ${total} pacchetti totali ·`, '');
  }

  if (warnings.length) {
    lines.push('---');
    for (const w of warnings) lines.push(`Avviso: ${w}`);
  }

  res.type('text/plain').send(lines.join('\n'));
});

app.listen(PORT, () => {
  console.log(`Server avviato su http://localhost:${PORT}`);
});
