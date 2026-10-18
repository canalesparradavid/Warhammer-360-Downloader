/* ============================================================
 * Warhammer 360 Downloader — ventana (popup) de la extensión
 * ============================================================ */

const $ = (id) => document.getElementById(id);

let tabId = null;
let productTitle = '';
let modelRows = []; // { folder, cb }

document.addEventListener('DOMContentLoaded', init);

function init() {
  $('download').addEventListener('click', onDownload);
  $('clear').addEventListener('click', onClear);
  $('selectAll').addEventListener('click', (e) => { e.preventDefault(); setAllModels(true); });
  $('selectNone').addEventListener('click', (e) => { e.preventDefault(); setAllModels(false); });

  chrome.storage.sync.get({ saveAs: true }, (prefs) => {
    $('saveAs').checked = prefs.saveAs !== false;
  });
  $('saveAs').addEventListener('change', () => {
    chrome.storage.sync.set({ saveAs: $('saveAs').checked });
  });

  // Progreso en vivo del service worker
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg.tabId !== 'number' || msg.tabId !== tabId) return;
    if (msg.type === 'wh360-progress') renderProgress(msg);
    if (msg.type === 'wh360-event' && msg.event === 'cleared') refresh();
  });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    tabId = tab && typeof tab.id === 'number' ? tab.id : null;
    if (tab && tab.title) {
      $('tabTitle').textContent = tab.title;
      productTitle = String(tab.title).split(/\s*[|–—]\s*/)[0].trim();
    }
    refresh();
  });
}

function refresh() {
  if (tabId === null) {
    setStatus('Pestaña no válida.');
    return;
  }
  chrome.runtime.sendMessage({ type: 'getState', tabId }, (resp) => {
    if (chrome.runtime.lastError || !resp || resp.ok !== true) {
      setStatus('No se pudo leer el estado de la extensión.');
      return;
    }
    renderState(resp);
  });
}

function renderState(resp) {
  const count = resp.count || 0;
  $('countBadge').textContent = String(count);
  $('empty').hidden = count > 0;
  $('content').hidden = count === 0;

  if (count === 0) {
    $('barFill').style.width = '0%';
    setStatus('Esperando a que abras la vista 360°…');
    return;
  }

  renderModels(resp.groups || [], Boolean(resp.busy));

  if (resp.busy) {
    $('download').disabled = true;
    $('clear').disabled = true;
    $('download').textContent = 'Descargando…';
    setStatus('Ya hay una descarga en curso…');
  } else {
    $('download').disabled = false;
    $('clear').disabled = false;
    $('download').textContent = 'Descargar ZIP';
    setStatus(count === 1 ? '1 imagen lista para descargar.' : count + ' imágenes listas para descargar.');
  }
}

/* ---------------- selección de modelos ---------------- */

function renderModels(groups, disabled) {
  const wrap = $('models');
  wrap.textContent = '';
  modelRows = [];

  if (!groups.length) {
    $('modelsHead').style.display = 'none';
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Sin grupos de modelos todavía.';
    wrap.appendChild(p);
    return;
  }
  $('modelsHead').style.display = 'flex';

  groups.forEach((g) => {
    const row = document.createElement('div');
    row.className = 'model-row';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = g.selected !== false;
    cb.disabled = disabled;
    cb.addEventListener('change', sendSelection);

    const img = document.createElement('img');
    img.src = g.firstUrl;
    img.alt = '';
    img.loading = 'lazy';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = g.label;
    name.title = g.label;

    const cnt = document.createElement('span');
    cnt.className = 'count';
    cnt.textContent = g.count + ' img';

    row.append(cb, img, name, cnt);
    wrap.appendChild(row);
    modelRows.push({ folder: g.folder, cb: cb });
  });
}

function setAllModels(checked) {
  modelRows.forEach((r) => { r.cb.checked = checked; });
  sendSelection();
}

function sendSelection() {
  if (tabId === null) return;
  const folders = modelRows.filter((r) => r.cb.checked).map((r) => r.folder);
  chrome.runtime.sendMessage({ type: 'setSelection', tabId: tabId, folders: folders }, () => {
    void chrome.runtime.lastError;
  });
}

/* ---------------- descarga ---------------- */

function onDownload() {
  if (tabId === null) return;
  $('download').disabled = true;
  $('clear').disabled = true;
  $('download').textContent = 'Descargando…';

  chrome.runtime.sendMessage(
    { type: 'download', tabId: tabId, title: productTitle, saveAs: $('saveAs').checked },
    (resp) => {
      $('download').textContent = 'Descargar ZIP';
      $('download').disabled = false;
      $('clear').disabled = false;

      if (chrome.runtime.lastError || !resp) {
        setStatus('Error de comunicación con la extensión.');
        return;
      }
      if (!resp.ok) {
        $('barFill').style.width = '0%';
        setStatus('⚠ ' + (resp.error || 'Error desconocido.'));
        return;
      }
      $('barFill').style.width = '100%';
      setStatus(
        '✔ ' + resp.zipName + ' (' + formatBytes(resp.zipSize) + ')' +
        (resp.failures ? ' — ' + resp.failures + ' imágenes fallaron.' : '.')
      );
    }
  );
}

function onClear() {
  if (tabId === null) return;
  chrome.runtime.sendMessage({ type: 'clear', tabId: tabId }, () => refresh());
}

function renderProgress(msg) {
  if (msg.stage === 'downloading') {
    const pct = msg.total ? Math.round((msg.done / msg.total) * 100) : 0;
    $('barFill').style.width = Math.min(pct, 95) + '%';
    setStatus(
      'Descargando imágenes… ' + msg.done + '/' + msg.total +
      (msg.failures ? ' (' + msg.failures + ' fallos)' : '')
    );
  } else if (msg.stage === 'zipping') {
    $('barFill').style.width = '97%';
    setStatus('Comprimiendo el ZIP…');
  } else if (msg.stage === 'done') {
    $('barFill').style.width = '100%';
    setStatus('✔ ZIP guardado: ' + msg.zipName + ' (' + formatBytes(msg.zipSize) + ')');
  }
}

function setStatus(text) {
  $('statusText').textContent = text;
}

function formatBytes(n) {
  if (typeof n !== 'number' || isNaN(n)) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}
