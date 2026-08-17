document.addEventListener('DOMContentLoaded', () => {
  const goBtn = document.getElementById('goBtn');
  const tabs = document.querySelectorAll('.tab-btn');
  const panes = document.querySelectorAll('.tab-pane');

  // Tab switching
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach((b) => b.classList.remove('active'));
      panes.forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.getElementById(`${tab}Tab`).classList.add('active');
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
    const token = document.getElementById('githubToken') ? document.getElementById('githubToken').value : '';

    const params = new URLSearchParams({
      n: num,
      only,
      json: jsonOutput ? 'true' : 'false',
      noHomepage: noHomepage ? 'true' : 'false',
      combined: combined ? 'true' : 'false',
      threads,
    });
    if (token) params.set('token', token);
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
    const hasToken = document.getElementById('githubToken') && document.getElementById('githubToken').value;

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
      // Fetch JSON data always (for table rendering and JSON tab)
      params.set('json', 'true');
      const resp = await fetch(`/api/brew-tracker?${params.toString()}`);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      const data = await resp.json();

      renderWarnings(data.warnings);

      // JSON tab
      document.getElementById('jsonTab').querySelector('code').textContent =
        JSON.stringify(data, null, 2);

      // Table tab
      const tablePane = document.getElementById('tableTab');
      if (jsonOutput) {
        renderTableFromJSON(data, jsonOutput, params.get('combined') === 'true');
      } else {
        renderTableFromJSON(data, jsonOutput, params.get('combined') === 'true');
      }

      // Raw text tab: fetch plain text version
      params.set('json', 'false');
      const respRaw = await fetch(`/api/brew-tracker?${params.toString()}`);
      const rawText = await respRaw.text();
      document.getElementById('rawTab').querySelector('code').textContent = rawText;
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

  function renderTableFromJSON(data, jsonOutput, combined) {
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
    rows.sort((a, b) => (b.date > a.date ? 1 : -1));

    if (!rows.length) {
      pane.innerHTML = '<p style="padding:1rem">Nessun risultato</p>';
      return;
    }

    const html = `
      <h2>🍺 🖥 🔠 Tutti i pacchetti (${rows.length})</h2>
      <table>
        <thead><tr>
          <th>TIPO</th><th>NOME</th><th>VER</th><th>DATA</th>
          ${data.formulae && data.formulae[0] && data.formulae[0].homepage ? '<th>HOMEPAGE</th>' : ''}
          <th>DESC</th>
        </tr></thead>
        <tbody>
        ${rows.map((r) => `
          <tr>
            <td><span class="type-badge ${r.kind === 'formula' ? 'type-formula' : r.kind === 'cask' ? 'type-cask' : 'type-font'}">${r.kind}</span></td>
            <td><strong>${escapeHtml(r.name)}</strong></td>
            <td>${escapeHtml(r.version || '—')}</td>
            <td>${escapeHtml(formatDate(r.date))}</td>
            ${r.homepage ? `<td><a href="${escapeHtml(r.homepage)}" target="_blank">${escapeHtml(r.homepage.replace(/^https?:\/\//, ''))}</a></td>` : ''}
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
      html += `<h2>${section.icon} ${section.label} (${rows.length})</h2>`;
      html += '<table><thead><tr>'
        + '<th>NOME</th><th>VER</th><th>DATA</th>'
        + (hasHomepage ? '<th>HOMEPAGE</th>' : '')
        + '<th>DESC</th>'
        + '</tr></thead><tbody>';

      for (const r of rows) {
        html += '<tr>';
        html += `<td><strong>${escapeHtml(r.name)}</strong></td>`;
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

  // Wire up the "Esegui" button
  goBtn.addEventListener('click', fetchResults);

  // Auto-fetch on load
  fetchResults();
});
