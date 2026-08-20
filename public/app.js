document.addEventListener('DOMContentLoaded', () => {
  const goBtn = document.getElementById('goBtn');
  const tabs = document.querySelectorAll('.tab-btn');
  const panes = document.querySelectorAll('.tab-pane');

  // Cache dell'output testuale, indicizzata dai parametri della richiesta.
  // La tab "testo grezzo" (e la tab "tabella" quando --json è spento) viene
  // riempita in modo lazy, così un'esecuzione normale colpisce l'API una sola volta.
  let currentParamsKey = '';
  let rawCache = { key: '', text: '' };

  function getToken() {
    const el = document.getElementById('githubToken');
    return el ? el.value.trim() : '';
  }

  // Il token viaggia in un header HTTP, non nella query string (i log del
  // server/proxy non devono registrare il token).
  function apiHeaders() {
    const token = getToken();
    return token ? { 'X-GitHub-Token': token } : {};
  }

  // Badge di stato del token GitHub: server (env var) e/o form.
  async function updateTokenStatus() {
    const el = document.getElementById('tokenStatus');
    if (!el) return;

    let serverSet = false;
    try {
      const resp = await fetch('/api/status');
      if (resp.ok) {
        const data = await resp.json();
        serverSet = !!data.githubTokenSet;
      }
    } catch {
      serverSet = false;
    }

    const formToken = getToken();
    const parts = [];
    if (serverSet) parts.push('token server attivo');
    if (formToken) parts.push('token form attivo');

    el.hidden = false;
    if (!parts.length) {
      el.textContent = '🔑 token GitHub non impostato';
      el.className = 'token-status warn';
    } else {
      el.textContent = `🔑 ${parts.join(' · ')}`;
      el.className = 'token-status ok';
    }
  }

  // Tab switching (il contenuto grezzo viene caricato al primo click)
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach((b) => b.classList.remove('active'));
      panes.forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.getElementById(`${tab}Tab`).classList.add('active');
      if (tab === 'raw') ensureRawTabFilled();
    });
  });

  function getParams() {
    const num = document.getElementById('num').value;
    const onlyRadios = document.querySelectorAll('input[name="only"]:checked');
    const only = onlyRadios.length ? onlyRadios[0].value : 'both';
    const noHomepage = document.getElementById('noHomepage').checked;
    const combined = document.getElementById('combined').checked;
    const jsonOutput = document.getElementById('jsonOutput').checked;
    const threads = document.getElementById('threads').value;

    const params = new URLSearchParams({
      n: num,
      only,
      json: jsonOutput ? 'true' : 'false',
      noHomepage: noHomepage ? 'true' : 'false',
      combined: combined ? 'true' : 'false',
      threads,
    });
    return params;
  }

  // Live preview of the equivalent shell invocation — mirrors the flags
  // of brew-new-tracker-v2.sh so the form always shows "what you'd type".
  function updateCommandPreview() {
    const el = document.getElementById('commandPreview');
    if (!el) return;

    const num = document.getElementById('num').value || '25';
    const threads = document.getElementById('threads').value || '8';
    const onlyRadios = document.querySelectorAll('input[name="only"]:checked');
    const only = onlyRadios.length ? onlyRadios[0].value : 'both';
    const combined = document.getElementById('combined').checked;
    const noHomepage = document.getElementById('noHomepage').checked;
    const jsonOutput = document.getElementById('jsonOutput').checked;
    const hasToken = getToken();

    const parts = ['brew-new-tracker-v2.sh', `-n ${num}`];
    if (only !== 'both') parts.push(`--only ${only}`);
    if (Number(threads) !== 8) parts.push(`--threads ${threads}`);
    if (combined) parts.push('--combined');
    if (noHomepage) parts.push('--no-homepage');
    parts.push(jsonOutput ? '--json' : '--text');
    if (hasToken) parts.push('--token ***');

    el.textContent = parts.join(' ');
  }

  document.querySelectorAll(
    '#num, #threads, #combined, #noHomepage, #jsonOutput, #githubToken, input[name="only"]'
  ).forEach((el) => {
    if (!el) return;
    el.addEventListener('input', updateCommandPreview);
    el.addEventListener('change', updateCommandPreview);
  });
  updateCommandPreview();

  // Aggiorna il badge token anche quando l'utente digita/incolla un token
  const tokenInput = document.getElementById('githubToken');
  if (tokenInput) {
    tokenInput.addEventListener('input', updateTokenStatus);
    tokenInput.addEventListener('change', updateTokenStatus);
  }
  updateTokenStatus();

  function renderWarnings(warnings) {
    const existing = document.querySelector('.warnings');
    if (existing) existing.remove();
    if (warnings && warnings.length) {
      const div = document.createElement('div');
      div.className = 'warnings';
      div.textContent = warnings.map((w) => `⚠ ${w}`).join('\n');
      document.querySelector('.output').appendChild(div);
    }
  }

  async function fetchJson(params) {
    const resp = await fetch(`/api/brew-tracker?${params.toString()}`, {
      headers: apiHeaders(),
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }
    return resp.json();
  }

  async function ensureRawText(params) {
    const key = params.toString();
    if (rawCache.key === key) return rawCache.text;
    const p = new URLSearchParams(params);
    p.set('json', 'false');
    const resp = await fetch(`/api/brew-tracker?${p.toString()}`, {
      headers: apiHeaders(),
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }
    const text = await resp.text();
    rawCache = { key, text };
    return text;
  }

  function renderRaw(text) {
    document.getElementById('rawTab').querySelector('code').textContent = text;
  }

  async function ensureRawTabFilled() {
    const code = document.getElementById('rawTab').querySelector('code');
    if (!currentParamsKey || code.textContent) return;
    const params = getParams();
    if (params.toString() !== currentParamsKey) return;
    try {
      renderRaw(await ensureRawText(params));
    } catch (err) {
      renderRaw(`Errore: ${err.message}`);
    }
  }

  async function fetchResults() {
    const params = getParams();
    const jsonOutput = params.get('json') === 'true';

    goBtn.disabled = true;
    goBtn.innerHTML = 'Eseguo<span class="btn-arrow">▸</span>';

    // Show loading in all tabs
    document.getElementById('tableTab').innerHTML = '<div id="loading">Caricamento...</div>';
    document.getElementById('jsonTab').querySelector('code').textContent = '';
    document.getElementById('rawTab').querySelector('code').textContent = '';

    try {
      currentParamsKey = params.toString();
      const data = await fetchJson(params);

      renderWarnings(data.warnings);

      // JSON tab
      document.getElementById('jsonTab').querySelector('code').textContent =
        JSON.stringify(data, null, 2);

      const combined = params.get('combined') === 'true';

      if (jsonOutput) {
        // --json attivo: la tab "tabella" mostra la tabella HTML
        renderTableFromJSON(data, combined);
      } else {
        // --json spento: la tab "tabella" mostra la vista testo (box drawing)
        const text = await ensureRawText(params);
        document.getElementById('tableTab').innerHTML =
          `<pre class="text-view">${escapeHtml(text)}</pre>`;
        renderRaw(text);
      }
    } catch (err) {
      document.getElementById('tableTab').innerHTML =
        `<div id="loading">Errore: ${err.message}</div>`;
      document.getElementById('jsonTab').querySelector('code').textContent =
        `Errore: ${err.message}`;
      document.getElementById('rawTab').querySelector('code').textContent =
        `Errore: ${err.message}`;
      renderWarnings([]);
    } finally {
      goBtn.disabled = false;
      goBtn.innerHTML = 'Esegui <span class="btn-arrow">▸</span>';
    }
  }

  function renderTableFromJSON(data, combined) {
    const pane = document.getElementById('tableTab');
    if (combined) {
      renderCombinedTable(pane, data);
    } else {
      renderSectionTables(pane, data);
    }
  }

  function renderCombinedTable(pane, data) {
    const sections = ['formulae', 'casks', 'fonts'];
    const rows = [];
    for (const key of sections) {
      if (!data[key]) continue;
      const kind = key === 'formulae' ? 'formula' : key === 'casks' ? 'cask' : 'font';
      for (const r of data[key]) {
        rows.push({ kind, ...r });
      }
    }
    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    if (!rows.length) {
      pane.innerHTML = '<p style="padding:1rem">Nessun risultato</p>';
      return;
    }

    // La colonna HOMEPAGE appare solo se almeno una riga ha una homepage,
    // ma ogni riga emette sempre una cella (link o "—") per tenere le
    // colonne allineate.
    const hasHomepage = rows.some((r) => r.homepage);

    const html = `
      <h2>🍺 🖥 🔠 Tutti i pacchetti (${rows.length})</h2>
      <table>
        <thead><tr>
          <th>TIPO</th><th>NOME</th><th>VER</th><th>DATA</th>
          ${hasHomepage ? '<th>HOMEPAGE</th>' : ''}
          <th>DESC</th>
        </tr></thead>
        <tbody>
        ${rows.map((r) => `
          <tr>
            <td><span class="type-badge ${r.kind === 'formula' ? 'type-formula' : r.kind === 'cask' ? 'type-cask' : 'type-font'}">${r.kind}</span></td>
            <td>${makeNameCell(r.kind, r.name)}</td>
            <td>${escapeHtml(r.version || '—')}</td>
            <td>${escapeHtml(formatDate(r.date))}</td>
            ${hasHomepage
              ? r.homepage
                ? `<td><a href="${escapeHtml(r.homepage)}" target="_blank">${escapeHtml(r.homepage.replace(/^https?:\/\//, ''))}</a></td>`
                : '<td>—</td>'
              : ''}
            <td>${escapeHtml(r.description || '—')}</td>
          </tr>
        `).join('')}
        </tbody>
      </table>
    `;
    pane.innerHTML = html;
  }

  function renderSectionTables(pane, data) {
    const sections = [
      { key: 'formulae', icon: '🍺', label: 'FORMULE' },
      { key: 'casks', icon: '🖥 ', label: 'CASK' },
      { key: 'fonts', icon: '🔠', label: 'FONT' },
    ];

    let html = '';
    let total = 0;

    for (const section of sections) {
      const rows = data[section.key];
      if (!rows || !rows.length) continue;
      total += rows.length;

      const hasHomepage = rows.some((r) => r.homepage);
      const kind = section.key === 'formulae' ? 'formula' : section.key === 'casks' ? 'cask' : 'font';
      html += `<h2>${section.icon} ${section.label} (${rows.length})</h2>`;
      html += '<table><thead><tr>'
        + '<th>NOME</th><th>VER</th><th>DATA</th>'
        + (hasHomepage ? '<th>HOMEPAGE</th>' : '')
        + '<th>DESC</th>'
        + '</tr></thead><tbody>';

      for (const r of rows) {
        html += '<tr>';
        html += `<td>${makeNameCell(kind, r.name)}</td>`;
        html += `<td>${escapeHtml(r.version || '—')}</td>`;
        html += `<td>${escapeHtml(formatDate(r.date))}</td>`;
        if (hasHomepage) {
          html += r.homepage
            ? `<td><a href="${escapeHtml(r.homepage)}" target="_blank">${escapeHtml(r.homepage.replace(/^https?:\/\//, ''))}</a></td>`
            : '<td>—</td>';
        }
        html += `<td>${escapeHtml(r.description || '—')}</td>`;
        html += '</tr>';
      }
      html += '</tbody></table>';
    }

    html += `<p style="margin-top:1rem;color:#8b949e">· ${total} pacchetti totali ·</p>`;
    pane.innerHTML = html;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const pad = (n) => String(n).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${yy}`;
  }

  // ---------------------------------------------------------------------------
  // Copia "brew install ..." al click sul nome di un pacchetto
  // ---------------------------------------------------------------------------

  // Le formule si installano con "brew install <nome>", i cask (e i font,
  // che sono cask) con "brew install --cask <nome>".
  function brewCommand(kind, name) {
    const flag = kind === 'formula' ? '' : ' --cask';
    return `brew install${flag} ${name}`;
  }

  // Cella nome cliccabile: il comando da copiare è salvato in data-cmd.
  function makeNameCell(kind, name) {
    const cmd = brewCommand(kind, name);
    return `<span class="pkg-name" role="button" tabindex="0" title="Copia ${cmd}" data-cmd="${escapeHtml(cmd)}">${escapeHtml(name)}</span>`;
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      return true;
    } catch {
      return false;
    }
  }

  let toastTimer = null;
  function showToast(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  // Delegazione eventi sulla tab "tabella": sopravvive ai re-render
  // (il contenuto di #tableTab viene sostituito a ogni fetch).
  const tablePane = document.getElementById('tableTab');
  tablePane.addEventListener('click', async (e) => {
    const el = e.target.closest('.pkg-name');
    if (!el) return;
    const cmd = el.dataset.cmd;
    const ok = await copyToClipboard(cmd);
    showToast(ok ? `✓ ${cmd}` : `Errore: impossibile copiare "${cmd}"`);
  });
  tablePane.addEventListener('keydown', (e) => {
    const el = e.target.closest('.pkg-name');
    if (!el) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      el.click();
    }
  });

  // Wire up the "Esegui" button
  goBtn.addEventListener('click', fetchResults);

  // Auto-fetch on load
  fetchResults();
});
