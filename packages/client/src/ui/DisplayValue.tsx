// Output text drawn by a `display` change (see display.ts for what each one
// makes of the text). Anything a display can't read is shown as it is.

import { hostToIso, type Display } from '@veneer/screens';
import type { ScreenSnapshot } from '@veneer/terminal';
import type { CSSProperties } from 'react';
import { code128, qrCode } from './barcode.ts';
import { badgeOf, formatDate, formatNumber, linkHref, progressOf, yesNoOf } from './display.ts';

export function DisplayValue({ text, display, snap }: { text: string; display: Display; snap: ScreenSnapshot }) {
  const plain = text.trim();
  switch (display.type) {
    case 'badge': {
      const badge = badgeOf(text, display);
      if (!badge) return null;
      return badge.known
        ? <span className={`badge badge-${badge.role}`} title={badge.label === plain ? undefined : plain}>{badge.label}</span>
        : <span className={`role-${badge.role}`}>{badge.label}</span>;
    }
    case 'number':
      return <span className="display-number">{formatNumber(text, display) ?? plain}</span>;
    case 'date': {
      const shown = formatDate(text, display);
      return shown ? <time dateTime={hostToIso(text, display.format)} title={plain}>{shown}</time> : <>{plain}</>;
    }
    case 'yesno': {
      const yn = yesNoOf(text, display);
      if (!yn) return <>{plain}</>;
      return <span className={`yesno ${yn}`}><span aria-hidden>{yn === 'yes' ? '✓' : '✗'}</span> {yn === 'yes' ? 'Yes' : 'No'}</span>;
    }
    case 'link': {
      const href = linkHref(text, display, snap);
      if (!href) return <>{plain}</>;
      const web = display.to === 'url';
      return <a className="display-link" href={href} {...(web ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{plain}</a>;
    }
    case 'progress': {
      const p = progressOf(text, display);
      if (!p) return <>{plain}</>;
      return (
        <span className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={display.max} aria-valuenow={p.value} aria-valuetext={plain}>
          <span className="progress-bar" style={{ width: `${p.fraction * 100}%` }} />
          <span className="progress-text">{plain}</span>
        </span>
      );
    }
    case 'barcode':
      return plain ? <Barcode text={plain} display={display} /> : null;
  }
}

function Barcode({ text, display }: { text: string; display: Extract<Display, { type: 'barcode' }> }) {
  const height: CSSProperties = { height: `calc(${display.height} * var(--rh))` };
  if (display.format === 'qr') {
    const m = qrCode(text);
    if (!m) return <>{text}</>;
    const quiet = 2;
    const size = m.length + quiet * 2;
    let d = '';
    m.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + quiet} ${y + quiet}h1v1h-1z`; }));
    return (
      <svg className="barcode qr" style={height} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`QR code: ${text}`} shapeRendering="crispEdges">
        <rect width={size} height={size} fill="#fff" />
        <path d={d} fill="#000" />
      </svg>
    );
  }
  const widths = code128(text);
  if (!widths) return <>{text}</>;
  const quiet = 10;
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  let x = quiet;
  let d = '';
  widths.forEach((w, i) => {
    if (i % 2 === 0) d += `M${x} 0h${w}v1h-${w}z`;
    x += w;
  });
  return (
    <span className="barcode code128" style={height} role="img" aria-label={`Barcode: ${text}`}>
      <svg viewBox={`0 0 ${total} 1`} preserveAspectRatio="none" style={{ width: `calc(${total} * var(--cw) / 4)` }} shapeRendering="crispEdges" aria-hidden>
        <rect width={total} height={1} fill="#fff" />
        <path d={d} fill="#000" />
      </svg>
      {display.height > 1 && <span className="barcode-text" aria-hidden>{text}</span>}
    </span>
  );
}
