// Veneer component: a field with a camera button that types what the camera
// reads (a barcode or QR code), as if the user typed it. For warehouse and
// shipping screens on phones and tablets.
//
// Select the field in the designer and choose Show as: Component ▸ Barcode
// scanner (the component takes the field's place: the box must be on it).
// Options:
//   formats  the barcodes to read, e.g. ["code_128", "ean_13", "qr_code"];
//            default every kind the browser can read
//   enter    true presses Enter after a scan, to send it straight away
//   beep     false turns off the beep (and the buzz, on phones) after a scan
//   camera   "environment" (default: the back camera) or "user" (the front)
//
// The field still takes typing (and a hand scanner that types). Reading
// barcodes needs the browser's BarcodeDetector (Chrome and Edge on Android,
// ChromeOS and macOS; Samsung Internet; not yet Firefox or Safari) and the
// camera needs HTTPS. Without them the camera button is off and says why.
// The camera picture stays in the browser: nothing is sent anywhere.

export const label = 'Barcode scanner';

/** The kinds the BarcodeDetector API names. */
export const FORMATS = Object.freeze(['aztec', 'code_128', 'code_39', 'code_93', 'codabar', 'data_matrix', 'ean_13', 'ean_8', 'itf', 'pdf417', 'qr_code', 'upc_a', 'upc_e']);
/** How often to look at the camera picture, in ms. */
export const SCAN_MS = 150;

/** The options, checked; `error` says what is wrong. */
export function settings(options = {}) {
  const o = options && typeof options === 'object' ? options : {};
  const s = { formats: null, enter: o.enter === true, beep: o.beep !== false, camera: 'environment', error: '' };
  if (o.formats !== undefined) {
    if (!Array.isArray(o.formats) || o.formats.some((f) => !FORMATS.includes(String(f).toLowerCase()))) {
      s.error = `"formats" must be a list of ${FORMATS.join(', ')}`;
    } else s.formats = o.formats.map((f) => String(f).toLowerCase());
  }
  if (o.camera !== undefined) {
    const c = String(o.camera).toLowerCase();
    if (c === 'environment' || c === 'user') s.camera = c;
    else s.error ||= '"camera" must be "environment" or "user"';
  }
  return s;
}

/** Whether this browser can scan: { ok } or { ok: false, reason }. */
export function canScan(win = globalThis) {
  if (!win.isSecureContext) return { ok: false, reason: 'The camera needs the site on HTTPS' };
  if (!win.navigator?.mediaDevices?.getUserMedia) return { ok: false, reason: 'This browser has no camera access' };
  if (typeof win.BarcodeDetector !== 'function') return { ok: false, reason: 'This browser can\'t read barcodes (Chrome or Edge on Android can)' };
  return { ok: true };
}

/** The formats to ask for: those wanted that the browser has (all it has if none are named). */
export function formatsToUse(wanted, available) {
  const have = available.filter((f) => FORMATS.includes(f));
  return wanted ? wanted.filter((f) => have.includes(f)) : have;
}

/** What a scan types: printable characters only, trimmed, cut to the field's length. */
export function scannedText(raw, length) {
  const clean = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return length ? clean.slice(0, length) : clean;
}

const CSS = `
.vc-scanner { height: 100%; display: flex; align-items: stretch; gap: 4px; }
.vc-scanner input { flex: 1; min-width: 0; font: inherit; font-family: var(--mono, monospace); padding: 0 4px; border-radius: var(--radius-small, 6px);
  border: 1px solid var(--border, #ccc); background: var(--surface, #fff); color: var(--text, inherit); }
.vc-scanner input:focus { outline: 2px solid var(--focus, var(--accent, #2563eb)); outline-offset: 0; }
.vc-scanner button { flex: none; display: flex; align-items: center; justify-content: center; padding: 0 6px; border-radius: var(--radius-small, 6px); cursor: pointer;
  border: 1px solid var(--border, #ccc); background: var(--surface-2, #f4f4f5); color: var(--text, inherit); }
.vc-scanner button:hover:not(:disabled) { border-color: var(--accent, #2563eb); }
.vc-scanner button:disabled { opacity: 0.45; cursor: not-allowed; }
.vc-scanner svg { width: 18px; height: 18px; }
.vc-scan-dialog { display: flex; flex-direction: column; gap: 8px; align-items: center; max-width: min(92vw, 520px); }
.vc-scan-dialog video { width: 100%; max-height: 60vh; border-radius: 8px; background: #000; object-fit: cover; }
.vc-scan-dialog .vc-scan-frame { position: relative; width: 100%; }
.vc-scan-dialog .vc-scan-frame::after { content: ''; position: absolute; inset: 20% 12%; border: 2px solid rgb(255 255 255 / 80%); border-radius: 8px; pointer-events: none; }
`;

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M10 8v8M13 8v8M16 8v8"/></svg>';

/** A short beep and buzz: that a scan was read. */
function signal(win) {
  try {
    const Ctx = win.AudioContext || win.webkitAudioContext;
    if (Ctx) {
      const audio = new Ctx();
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 1760;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + 0.08);
      osc.onended = () => audio.close();
    }
    win.navigator.vibrate?.(60);
  } catch { /* no sound: the value still arrives */ }
}

export function mount(element, ctx) {
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  let current = ctx;
  let s = settings(ctx.options);
  const root = doc.createElement('div');
  root.className = 'vc-scanner';
  const style = doc.createElement('style');
  style.textContent = CSS;
  const input = doc.createElement('input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  const scan = doc.createElement('button');
  scan.type = 'button';
  scan.innerHTML = ICON;
  root.append(style, input, scan);
  element.append(root);
  /** The open camera, to close it. */
  let session = null;

  const sync = () => {
    const field = current.field;
    input.value = current.value ?? '';
    input.maxLength = field?.length ?? 524288;
    input.disabled = !field;
    if (field) input.dataset.field = field.id;
    input.setAttribute('aria-label', current.options?.label ?? 'Scanned value');
    const can = s.error ? { ok: false, reason: s.error } : !field ? { ok: false, reason: 'Put the scanner on a field (Show as: Component)' } : canScan(win);
    scan.disabled = !can.ok;
    scan.title = can.ok ? 'Scan with the camera' : can.reason;
    scan.setAttribute('aria-label', can.ok ? 'Scan with the camera' : `Scan with the camera: ${can.reason}`);
  };
  input.addEventListener('input', () => current.setValue?.(input.value));

  const close = () => {
    if (!session) return;
    const { stream, overlay, timer } = session;
    session = null;
    clearTimeout(timer);
    for (const t of stream?.getTracks?.() ?? []) t.stop();
    overlay.remove();
    scan.focus();
  };

  scan.addEventListener('click', async () => {
    if (session || current.design) return;
    const overlay = doc.createElement('div');
    // "overlay": Veneer's own dialogs; keys typed here aren't the host's.
    overlay.className = 'overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Scan a barcode');
    const box = doc.createElement('div');
    box.className = 'dialog vc-scan-dialog';
    const css = doc.createElement('style');
    css.textContent = CSS;
    const frame = doc.createElement('div');
    frame.className = 'vc-scan-frame';
    const video = doc.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    frame.append(video);
    const status = doc.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = 'Starting the camera…';
    const cancel = doc.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ghost';
    cancel.textContent = 'Cancel (Esc)';
    cancel.addEventListener('click', close);
    box.append(css, frame, status, cancel);
    overlay.append(box);
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key === 'Tab') { e.preventDefault(); cancel.focus(); }
    });
    doc.body.append(overlay);
    cancel.focus();
    session = { overlay, stream: null, timer: null };
    const mine = session;
    try {
      const available = await win.BarcodeDetector.getSupportedFormats?.() ?? FORMATS;
      const formats = formatsToUse(s.formats, available);
      if (formats.length === 0) throw new Error(`This browser can't read ${s.formats?.join(', ') ?? 'barcodes'}`);
      const detector = new win.BarcodeDetector({ formats });
      const stream = await win.navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: s.camera } }, audio: false });
      if (session !== mine) { for (const t of stream.getTracks()) t.stop(); return; }
      mine.stream = stream;
      video.srcObject = stream;
      await video.play();
      status.textContent = 'Point the camera at the barcode';
      const look = async () => {
        if (session !== mine) return;
        try {
          const found = video.readyState >= 2 ? await detector.detect(video) : [];
          const text = found.length ? scannedText(found[0].rawValue, current.field?.length) : '';
          if (text && session === mine) {
            if (s.beep) signal(win);
            current.setValue?.(text);
            input.value = text;
            close();
            if (s.enter && current.field) current.press('Enter', { [current.field.id]: text });
            else input.focus();
            return;
          }
        } catch { /* a frame it couldn't read: try the next */ }
        if (session === mine) mine.timer = setTimeout(look, SCAN_MS);
      };
      look();
    } catch (err) {
      if (session !== mine) return;
      const denied = err?.name === 'NotAllowedError';
      status.textContent = denied ? 'The camera wasn\'t allowed. Allow it in the browser\'s site settings, then try again.' : `The camera couldn't start: ${err?.message ?? err}`;
    }
  });

  sync();
  return {
    update(next) {
      current = next;
      s = settings(next.options);
      if (doc.activeElement !== input || input.value !== (next.value ?? '')) sync();
    },
    unmount() {
      close();
      root.remove();
    },
  };
}
