/* ============================================================
 * Warhammer 360 Downloader — Service Worker (Manifest V3)
 *
 * Intercepta (solo lectura, vía chrome.webRequest) todas las
 * peticiones de red cuya URL contiene:
 *   /app/resources/catalog/product/threeSixty
 * Las agrupa por pestaña y, dentro de cada pestaña, por el
 * modelo (la subcarpeta que viene después de threeSixty/).
 * Permite elegir qué modelos descargar y genera un .zip con
 * una carpeta por modelo (deflate nativo con CompressionStream).
 * ============================================================ */

const URL_MARKER = '/app/resources/catalog/product/threeSixty';
const STORAGE_KEY = 'detections_v1';
const SEL_KEY = 'selections_v1';

// Caracteres no permitidos en nombres de carpeta/archivo del ZIP
// (se conservan letras y números de cualquier idioma).
const BAD_CHARS = /[^\p{L}\p{N}._-]+/gu;

// El filtro es amplio (válido como match pattern: el path empieza por "/*")
// y la comprobación exacta del marcador se hace en onRequestCompleted.
const URL_FILTERS = ['*://*/*threeSixty*'];

/** tabId -> { urls: string[], lastSeen: number } */
const detections = new Map();

/** tabId -> Set de carpetas de modelo seleccionadas (ausente = todas) */
const selections = new Map();

/** pestañas con una descarga ZIP en curso */
const busyTabs = new Set();

let persistTimer = null;

/* ------------------------------------------------------------
 * Persistencia (sobrevive a suspensiones del service worker)
 * ------------------------------------------------------------ */

const storageReady = (async () => {
  try {
    const all = await chrome.storage.session.get([STORAGE_KEY, SEL_KEY]);

    const data = all[STORAGE_KEY];
    if (data) {
      for (const key of Object.keys(data)) {
        const entry = data[key];
        if (entry && Array.isArray(entry.urls)) {
          detections.set(Number(key), { urls: entry.urls, lastSeen: entry.lastSeen || 0 });
        }
      }
    }

    const sel = all[SEL_KEY];
    if (sel) {
      for (const key of Object.keys(sel)) {
        if (Array.isArray(sel[key])) selections.set(Number(key), new Set(sel[key]));
      }
    }
  } catch (err) {
    console.warn('[WH360] No se pudo restaurar el estado:', err);
  }
})();

function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const det = {};
    for (const [tabId, entry] of detections) det[tabId] = entry;
    const sel = {};
    for (const [tabId, folders] of selections) sel[tabId] = Array.from(folders);
    chrome.storage.session.set({ [STORAGE_KEY]: det, [SEL_KEY]: sel }).catch(() => {});
  }, 200);
}

/* ------------------------------------------------------------
 * Detección de imágenes de la vista 360°
 * ------------------------------------------------------------ */

chrome.webRequest.onCompleted.addListener(onRequestCompleted, { urls: URL_FILTERS });

function onRequestCompleted(details) {
  if (!details || typeof details.tabId !== 'number' || details.tabId < 0) return;
  if (details.statusCode && details.statusCode >= 400) return;
  if (!details.url || !details.url.includes(URL_MARKER)) return;

  const tabId = details.tabId;

  storageReady.then(() => {
    let entry = detections.get(tabId);
    if (!entry) {
      entry = { urls: [], lastSeen: 0 };
      detections.set(tabId, entry);
    }

    const isNew = !entry.urls.some((u) => pathOf(u) === pathOf(details.url));
    if (isNew) {
      entry.urls.push(details.url);
      entry.lastSeen = Date.now();
      persistSoon();
      updateBadge(tabId);
    }

    // Mientras se genera un ZIP no se toca la interfaz para no pisar el progreso.
    if (!busyTabs.has(tabId)) {
      notifyTab(tabId, statePayload(tabId, 'idle', 0, 0, ''));
    }
  });
}

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch (e) {
    return String(url).split('?')[0];
  }
}

/* ------------------------------------------------------------
 * Agrupación por modelo (subcarpeta tras threeSixty/)
 *   .../threeSixty/modeloA/img_01.jpg  -> grupo "modeloA"
 *   .../threeSixty/img_01.jpg          -> grupo "" (general)
 * ------------------------------------------------------------ */

function groupOf(url) {
  const path = pathOf(url);
  const idx = path.indexOf(URL_MARKER);
  const rest = idx >= 0 ? path.slice(idx + URL_MARKER.length) : path;
  const segments = rest.split('/').filter(Boolean);
  return segments.length > 1 ? segments.slice(0, -1).join('/') : '';
}

function buildGroups(urls) {
  const map = new Map();
  for (const url of urls) {
    const folder = groupOf(url);
    if (!map.has(folder)) map.set(folder, []);
    map.get(folder).push(url);
  }
  map.forEach((arr) =>
    arr.sort((a, b) => pathOf(a).localeCompare(pathOf(b), undefined, { numeric: true, sensitivity: 'base' }))
  );
  return map;
}

/** Lista de grupos lista para la interfaz, con la selección actual. */
function groupsArray(tabId) {
  const entry = detections.get(tabId);
  if (!entry) return [];
  const sel = selections.get(tabId);
  const groupMap = buildGroups(entry.urls);
  const arr = [];
  groupMap.forEach((urls, folder) => {
    arr.push({
      folder: folder,
      label: folder || 'general',
      count: urls.length,
      firstUrl: urls[0],
      selected: !sel || sel.has(folder)
    });
  });
  arr.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
  return arr;
}

function statePayload(tabId, phase, done, total, error) {
  const entry = detections.get(tabId);
  return {
    type: 'WH360_STATE',
    count: entry ? entry.urls.length : 0,
    state: phase,
    done: done || 0,
    total: total || 0,
    error: error || '',
    groups: groupsArray(tabId)
  };
}

/* ------------------------------------------------------------
 * Insignia (badge) del icono por pestaña
 * ------------------------------------------------------------ */

function updateBadge(tabId) {
  const entry = detections.get(tabId);
  const n = entry ? entry.urls.length : 0;
  const text = n === 0 ? '' : (n > 99 ? '99+' : String(n));
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#B3121D' }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  chrome.action
    .setTitle({ tabId, title: 'Warhammer 360 Downloader — ' + n + ' imagen(es) detectada(s)' })
    .catch(() => {});
}

/* ------------------------------------------------------------
 * Limpieza al navegar / cerrar pestañas
 * ------------------------------------------------------------ */

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    storageReady.then(() => {
      const hadSel = selections.delete(tabId);
      if (detections.delete(tabId)) {
        persistSoon();
        updateBadge(tabId);
        broadcast({ type: 'wh360-event', tabId, event: 'cleared' });
      } else if (hadSel) {
        persistSoon();
      }
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  storageReady.then(() => {
    const hadSel = selections.delete(tabId);
    if (detections.delete(tabId) || hadSel) persistSoon();
  });
});

/* ------------------------------------------------------------
 * Mensajes (popup y content script)
 * ------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return;

  // Los mensajes que llegan desde una página usan la pestaña de origen;
  // los que llegan del popup envían explícitamente su tabId.
  const tabId = sender && sender.tab && typeof sender.tab.id === 'number' ? sender.tab.id : message.tabId;

  switch (message.type) {
    case 'getState':
      storageReady.then(() => {
        const entry = typeof tabId === 'number' ? detections.get(tabId) : null;
        sendResponse({
          ok: true,
          count: entry ? entry.urls.length : 0,
          urls: entry ? entry.urls.slice() : [],
          groups: typeof tabId === 'number' ? groupsArray(tabId) : [],
          busy: typeof tabId === 'number' && busyTabs.has(tabId)
        });
      });
      return true; // respuesta asíncrona

    case 'setSelection':
      storageReady.then(() => {
        if (Array.isArray(message.folders)) {
          selections.set(tabId, new Set(message.folders));
          persistSoon();
        }
        sendResponse({ ok: true });
      });
      return true;

    case 'clear':
    case 'clear-from-page':
      storageReady.then(() => {
        selections.delete(tabId);
        if (detections.delete(tabId)) {
          persistSoon();
          updateBadge(tabId);
          broadcast({ type: 'wh360-event', tabId, event: 'cleared' });
        }
        notifyTab(tabId, { type: 'WH360_STATE', count: 0, state: 'idle', done: 0, total: 0, error: '', groups: [] });
        sendResponse({ ok: true });
      });
      return true;

    case 'download':
    case 'download-from-page':
      storageReady
        .then(() => startDownload(tabId, message.title || '', message.saveAs !== false))
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
      return true;
  }
});

function notifyTab(tabId, payload) {
  if (typeof tabId !== 'number' || tabId < 0) return;
  chrome.tabs.sendMessage(tabId, payload).catch(() => {});
}

function broadcast(payload) {
  try {
    chrome.runtime.sendMessage(payload).catch(() => {});
  } catch (e) {
    /* sin oyentes */
  }
}

function setTabState(tabId, state, done, total, error) {
  notifyTab(tabId, statePayload(tabId, state, done, total, error));
}

/* ------------------------------------------------------------
 * Descarga + creación del ZIP (una carpeta por modelo)
 * ------------------------------------------------------------ */

async function startDownload(tabId, titleHint, saveAs) {
  if (typeof tabId !== 'number' || tabId < 0) throw new Error('Pestaña no válida.');
  await storageReady;

  if (busyTabs.has(tabId)) throw new Error('Ya hay una descarga en curso en esta pestaña.');
  const entry = detections.get(tabId);
  if (!entry || !entry.urls.length) throw new Error('No se han detectado imágenes 360° en esta pestaña.');

  const sel = selections.get(tabId);
  const groupMap = buildGroups(entry.urls);
  const chosen = [];
  groupMap.forEach((urls, folder) => {
    if (!sel || sel.has(folder)) chosen.push({ folder: folder, urls: urls });
  });
  chosen.sort((a, b) => a.folder.localeCompare(b.folder, undefined, { numeric: true, sensitivity: 'base' }));
  if (!chosen.length) throw new Error('No has seleccionado ningún modelo para descargar.');

  busyTabs.add(tabId);

  let total = 0;
  for (const group of chosen) total += group.urls.length;

  try {
    const files = [];
    let failures = 0;
    let processed = 0;

    for (const group of chosen) {
      const prefix = zipFolderPrefix(group.folder);
      for (let i = 0; i < group.urls.length; i++) {
        const url = group.urls[i];
        broadcast({ type: 'wh360-progress', tabId: tabId, stage: 'downloading', done: processed, total: total, failures: failures });
        setTabState(tabId, 'busy', processed, total);

        try {
          const res = await fetch(url, { credentials: 'omit', redirect: 'follow' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const bytes = new Uint8Array(await res.arrayBuffer());
          if (!bytes.length) throw new Error('respuesta vacía');
          // La numeración (001_, 002_...) empieza en cada modelo.
          files.push({ name: prefix + fileNameFor(url, bytes, i, res.headers.get('content-type')), data: bytes });
        } catch (err) {
          failures++;
          console.warn('[WH360] Fallo al descargar:', url, err);
        }
        processed++;
      }
    }

    if (!files.length) throw new Error('No se ha podido descargar ninguna imagen (' + failures + ' fallos).');

    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    broadcast({ type: 'wh360-progress', tabId: tabId, stage: 'zipping', done: total, total: total, failures: failures });
    setTabState(tabId, 'busy', total, total);

    const zipBlob = await buildZip(files);
    const b64 = await blobToBase64(zipBlob);
    const filename = 'warhammer-360_' + slugify(titleHint) + '_' + timestamp() + '.zip';

    await chrome.downloads.download({
      url: 'data:application/zip;base64,' + b64,
      filename: filename,
      saveAs: Boolean(saveAs)
    });

    const warn = failures ? failures + ' imágenes fallaron' : '';
    broadcast({
      type: 'wh360-progress', tabId: tabId, stage: 'done',
      done: files.length, total: total, failures: failures, zipName: filename, zipSize: zipBlob.size
    });
    setTabState(tabId, 'done', files.length, total, warn);

    return { ok: true, count: files.length, failures: failures, zipName: filename, zipSize: zipBlob.size };
  } finally {
    busyTabs.delete(tabId);
  }
}

/* ------------------------------------------------------------
 * Nombres de archivo y carpetas dentro del ZIP
 * ------------------------------------------------------------ */

function sanitizePart(part) {
  return String(part)
    .replace(BAD_CHARS, '_')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
}

function zipFolderPrefix(folder) {
  if (!folder) return '';
  const parts = folder.split('/').map(sanitizePart).filter((s) => s && s !== '.' && s !== '..');
  return parts.length ? parts.join('/') + '/' : '';
}

function fileNameFor(url, bytes, index, mime) {
  let base = pathOf(url).split('/').filter(Boolean).pop() || 'imagen-' + (index + 1);
  try {
    base = decodeURIComponent(base);
  } catch (e) {
    /* se queda con el nombre codificado */
  }
  if (!/\.(jpe?g|png|webp|gif|avif)$/i.test(base)) base += extFrom(bytes, mime);
  base = sanitizePart(base);
  if (base.length > 80) {
    const dot = base.lastIndexOf('.');
    base = base.slice(0, 80) + (dot > 0 ? base.slice(dot) : '');
  }
  return String(index + 1).padStart(3, '0') + '_' + base;
}

function extFrom(bytes, mime) {
  if (bytes.length > 11) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return '.jpg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return '.png';
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return '.webp';
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return '.gif';
  }
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return '.png';
  if (m.includes('webp')) return '.webp';
  if (m.includes('gif')) return '.gif';
  if (m.includes('avif')) return '.avif';
  return '.jpg';
}

function slugify(text) {
  const s = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || 'imagenes';
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

/* ------------------------------------------------------------
 * ZIP writer (deflate nativo con CompressionStream, sin libs)
 * ------------------------------------------------------------ */

async function buildZip(files) {
  const encoder = new TextEncoder();
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  const { time, date } = dosDateTime(new Date());

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.data);

    let method = 0;
    let payload = file.data;
    const deflated = await deflateRaw(file.data);
    if (deflated && deflated.length < file.data.length) {
      method = 8;
      payload = deflated;
    }

    // Local file header
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);        // firma
    lv.setUint16(4, 20, true);                // versión mínima
    lv.setUint16(6, 0x0800, true);            // flags: nombres UTF-8
    lv.setUint16(8, method, true);            // método (0 = store, 8 = deflate)
    lv.setUint16(10, time, true);             // hora DOS
    lv.setUint16(12, date, true);             // fecha DOS
    lv.setUint32(14, crc, true);              // CRC32
    lv.setUint32(18, payload.length, true);   // tamaño comprimido
    lv.setUint32(22, file.data.length, true); // tamaño original
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);                // longitud extra
    local.set(nameBytes, 30);
    localChunks.push(local, payload);

    // Central directory header
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);        // firma
    cv.setUint16(4, 20, true);                // hecho por
    cv.setUint16(6, 20, true);                // necesario
    cv.setUint16(8, 0x0800, true);            // flags UTF-8
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, payload.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, nameBytes.length, true); // nombre
    cv.setUint16(30, 0, true);                // extra
    cv.setUint16(32, 0, true);                // comentario
    cv.setUint16(34, 0, true);                // disco
    cv.setUint16(36, 0, true);                // atributos internos
    cv.setUint32(38, 0, true);                // atributos externos
    cv.setUint32(42, offset, true);           // offset del header local
    cd.set(nameBytes, 46);
    centralChunks.push(cd);

    offset += local.length + payload.length;
  }

  const centralSize = centralChunks.reduce((sum, c) => sum + c.length, 0);

  // End of central directory
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);   // firma
  ev.setUint16(4, 0, true);            // disco
  ev.setUint16(6, 0, true);            // disco con CD
  ev.setUint16(8, files.length, true); // entradas en este disco
  ev.setUint16(10, files.length, true);// entradas totales
  ev.setUint32(12, centralSize, true); // tamaño del CD
  ev.setUint32(16, offset, true);      // offset del CD
  ev.setUint16(20, 0, true);           // comentario

  return new Blob(localChunks.concat(centralChunks, [eocd]), { type: 'application/zip' });
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) {
    return null;
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time, date: date };
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
