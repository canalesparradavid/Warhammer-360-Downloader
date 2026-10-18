/* ============================================================
 * Warhammer 360 Downloader — content script
 *
 * Muestra un aviso flotante dentro de la página (abajo a la
 * derecha) cuando se detectan imágenes de la vista 360°, con
 * un botón para descargarlas en ZIP.
 *
 * Los estilos se aplican vía CSSOM (el.style.setProperty) dentro
 * de un shadow DOM, para que no los bloquee la CSP del sitio.
 * ============================================================ */

(() => {
  'use strict';
  if (window.__wh360Loaded) return;
  window.__wh360Loaded = true;

  const state = { count: 0, phase: 'idle', done: 0, total: 0, error: '' };
  let dismissed = false;   // cerrado por el usuario
  let autoHidden = false;  // ocultado solo tras mostrar el éxito
  let hideTimer = null;
  let ui = null;

  /* ---------------- helpers de UI ---------------- */

  function apply(el, styles) {
    for (const key of Object.keys(styles)) el.style.setProperty(key, styles[key]);
    return el;
  }

  function mk(tag, styles, text) {
    const el = document.createElement(tag);
    if (styles) apply(el, styles);
    if (text != null) el.textContent = text;
    return el;
  }

  function btnStyles(primary) {
    const s = {
      border: 'none',
      borderRadius: '8px',
      padding: '8px 10px',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      fontFamily: 'inherit',
      flex: '1'
    };
    if (primary) {
      s.background = 'linear-gradient(180deg,#d21c2c,#98101c)';
      s.color = '#ffffff';
    } else {
      s.background = '#333336';
      s.color = '#dddddd';
    }
    return s;
  }

  function ensureUi() {
    if (ui) return ui;

    const host = mk('div', {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '2147483647',
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      fontSize: '13px',
      lineHeight: '1.45',
      color: '#f1f1f1'
    });
    host.setAttribute('data-wh360', 'toast');
    const shadow = host.attachShadow({ mode: 'open' });

    const card = mk('div', {
      background: 'linear-gradient(180deg,#2b2b2b 0%,#151515 100%)',
      border: '1px solid #7d0d18',
      borderRadius: '12px',
      boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
      width: '300px',
      overflow: 'hidden'
    });

    /* Cabecera */
    const header = mk('div', { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px' });
    const dot = mk('span', { width: '9px', height: '9px', borderRadius: '50%', background: '#C8102E', flex: '0 0 auto' });
    const title = mk('span', { fontWeight: '700', flex: '1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, 'Vista 360° · Warhammer');
    const badge = mk('span', { background: '#C8102E', borderRadius: '999px', padding: '1px 9px', fontSize: '12px', fontWeight: '700', flex: '0 0 auto' }, '0');
    const collapseBtn = mk('button', {
      border: 'none', background: 'transparent', color: '#bbbbbb', cursor: 'pointer',
      fontSize: '16px', lineHeight: '1', width: '20px', height: '20px', borderRadius: '6px', padding: '0', flex: '0 0 auto'
    }, '–');
    const closeBtn = mk('button', {
      border: 'none', background: 'transparent', color: '#bbbbbb', cursor: 'pointer',
      fontSize: '18px', lineHeight: '1', width: '20px', height: '20px', borderRadius: '6px', padding: '0', flex: '0 0 auto'
    }, '×');
    header.append(dot, title, badge, collapseBtn, closeBtn);

    /* Cuerpo */
    const body = mk('div', { padding: '0 12px 12px' });
    const status = mk('div', { color: '#cfcfcf', fontSize: '12px', marginBottom: '8px', minHeight: '17px' }, '');
    const bar = mk('div', { height: '5px', borderRadius: '4px', background: '#3a3a3a', overflow: 'hidden', marginBottom: '10px', display: 'none' });
    const fill = mk('div', { height: '100%', width: '0%', background: 'linear-gradient(90deg,#C8102E,#ef5350)', transition: 'width 0.15s ease' });
    bar.appendChild(fill);
    const actions = mk('div', { display: 'flex', gap: '8px' });
    const downloadBtn = mk('button', btnStyles(true), '⬇ Descargar ZIP');
    const clearBtn = mk('button', btnStyles(false), 'Limpiar');
    actions.append(downloadBtn, clearBtn);
    body.append(status, bar, actions);

    card.append(header, body);
    shadow.appendChild(card);
    (document.documentElement || document.body).appendChild(host);

    ui = { host, dot, badge, status, bar, fill, downloadBtn, clearBtn, collapseBtn, body, collapsed: false };

    collapseBtn.addEventListener('click', () => {
      ui.collapsed = !ui.collapsed;
      body.style.setProperty('display', ui.collapsed ? 'none' : 'block');
      collapseBtn.textContent = ui.collapsed ? '+' : '–';
    });
    closeBtn.addEventListener('click', () => {
      dismissed = true;
      render();
    });
    downloadBtn.addEventListener('click', onDownload);
    clearBtn.addEventListener('click', onClear);

    return ui;
  }

  /* ---------------- comunicación ---------------- */

  function send(msg, cb) {
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        const err = chrome.runtime.lastError;
        cb(err ? { ok: false, error: err.message } : resp);
      });
    } catch (e) {
      cb({ ok: false, error: String((e && e.message) || e) });
    }
  }

  function onDownload() {
    ensureUi();
    ui.downloadBtn.disabled = true;
    send({ type: 'download-from-page' }, (resp) => {
      if (!resp || resp.ok !== true) {
        state.phase = 'error';
        state.error = (resp && resp.error) || 'Error desconocido al generar el ZIP.';
        render();
      }
      // Con éxito, los propios mensajes WH360_STATE actualizan la interfaz.
    });
  }

  function onClear() {
    send({ type: 'clear-from-page' }, () => {});
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== 'WH360_STATE') return;
    state.count = Number(message.count) || 0;
    state.phase = message.state || 'idle';
    state.done = Number(message.done) || 0;
    state.total = Number(message.total) || 0;
    state.error = message.error || '';
    if (state.phase === 'idle' && state.count > 0) autoHidden = false;
    render();
  });

  /* ---------------- pintado ---------------- */

  function render() {
    if (state.count <= 0 || dismissed || autoHidden) {
      if (ui) ui.host.style.setProperty('display', 'none');
      return;
    }
    ensureUi();
    ui.host.style.setProperty('display', 'block');
    ui.badge.textContent = String(state.count);

    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }

    if (state.phase === 'busy') {
      ui.dot.style.setProperty('background', '#E8A33D');
      ui.status.textContent = 'Descargando… ' + state.done + '/' + state.total + ' imágenes';
      ui.bar.style.setProperty('display', 'block');
      ui.fill.style.setProperty('width', (state.total ? Math.round((state.done / state.total) * 100) : 0) + '%');
      ui.downloadBtn.disabled = true;
      ui.downloadBtn.textContent = 'Descargando…';
      ui.clearBtn.disabled = true;
      if (ui.collapsed) ui.collapseBtn.click();
    } else if (state.phase === 'done') {
      ui.dot.style.setProperty('background', '#4CAF50');
      ui.status.textContent = '✔ ZIP generado con ' + state.count + ' imágenes.';
      ui.bar.style.setProperty('display', 'block');
      ui.fill.style.setProperty('width', '100%');
      ui.downloadBtn.disabled = false;
      ui.downloadBtn.textContent = '⬇ Descargar ZIP';
      ui.clearBtn.disabled = false;
      hideTimer = setTimeout(() => {
        autoHidden = true;
        render();
      }, 15000);
    } else if (state.phase === 'error') {
      ui.dot.style.setProperty('background', '#E53935');
      ui.status.textContent = '⚠ ' + (state.error || 'Error al generar el ZIP.');
      ui.bar.style.setProperty('display', 'none');
      ui.downloadBtn.disabled = false;
      ui.downloadBtn.textContent = '⬇ Reintentar';
      ui.clearBtn.disabled = false;
    } else {
      ui.dot.style.setProperty('background', '#C8102E');
      ui.status.textContent =
        state.count === 1 ? '1 imagen de vista 360° detectada.' : state.count + ' imágenes de vista 360° detectadas.';
      ui.bar.style.setProperty('display', 'none');
      ui.fill.style.setProperty('width', '0%');
      ui.downloadBtn.disabled = false;
      ui.downloadBtn.textContent = '⬇ Descargar ZIP';
      ui.clearBtn.disabled = false;
    }
  }

  /* Sincroniza el estado por si ya había imágenes detectadas antes de cargar. */
  send({ type: 'getState' }, (resp) => {
    if (!resp || resp.ok !== true) return;
    state.count = resp.count || 0;
    state.phase = resp.busy ? 'busy' : 'idle';
    render();
  });
})();
