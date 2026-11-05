// How output text is shown by a `display` change: what each display makes of
// the host's text. The text is only read, never sent back. Each function
// returns undefined when the text isn't what the display expects, and the
// text is then shown as it is.

import { fillLink, hostToIso, readNumber, type Display, type Role } from '@veneer/screens';
import type { ScreenSnapshot } from '@veneer/terminal';

type Of<T extends Display['type']> = Extract<Display, { type: T }>;

/** The badge for a value: its label (the value itself if none) and style. Blank text has none. */
export function badgeOf(text: string, d: Of<'badge'>): { label: string; role: Role; known: boolean } | undefined {
  const value = text.trim();
  if (value === '') return undefined;
  const hit = d.values.find((v) => v.value.trim().toLowerCase() === value.toLowerCase());
  if (hit) return { label: hit.label ?? value, role: hit.role, known: true };
  return { label: value, role: d.otherwise ?? 'normal', known: false };
}

/**
 * A number in the user's format, such as "1,234.50" or "$1,234.50". The host
 * shows negatives as "12.50-" or "12.50 CR" too. `implied` decimals are placed
 * only when the text has no decimal point.
 */
export function formatNumber(text: string, d: Of<'number'>, locale?: string): string | undefined {
  const read = readNumber(text);
  if (!read) return undefined;
  let { value, decimals } = read;
  if (d.implied && decimals === 0 && !/[.,]/.test(text)) {
    value /= 10 ** d.implied;
    decimals = d.implied;
  }
  const places = d.decimals ?? decimals;
  try {
    return new Intl.NumberFormat(locale, {
      ...(d.currency ? { style: 'currency', currency: d.currency } : {}),
      minimumFractionDigits: places,
      maximumFractionDigits: places,
    }).format(value === 0 ? 0 : value);
  } catch {
    return undefined; // A currency code the browser doesn't know.
  }
}

/** A date in the host's format, in the user's own way ("Mar 4, 2026" in the US). */
export function formatDate(text: string, d: Of<'date'>, locale?: string): string | undefined {
  const iso = hostToIso(text, d.format);
  if (!iso) return undefined;
  return new Intl.DateTimeFormat(locale, { dateStyle: d.style ?? 'medium', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}

/** Whether the text is the yes value or the no value (ignoring case and blanks). */
export function yesNoOf(text: string, d: Of<'yesno'>): 'yes' | 'no' | undefined {
  const value = text.trim().toLowerCase();
  if (value === d.yes.trim().toLowerCase()) return 'yes';
  if (value === d.no.trim().toLowerCase()) return 'no';
  return undefined;
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

/**
 * Where a link goes: mailto: for an email address, tel: for a phone number
 * (its digits, and a leading +), or a web address. Undefined when the text
 * isn't one, or a template's result isn't an http(s) address.
 */
export function linkHref(text: string, d: Of<'link'>, snap: ScreenSnapshot): string | undefined {
  const value = text.trim();
  if (value === '') return undefined;
  switch (d.to) {
    case 'email':
      return EMAIL.test(value) ? `mailto:${value}` : undefined;
    case 'phone': {
      const digits = value.replace(/[\s().-]/g, '');
      return /^\+?\d{3,20}$/.test(digits) ? `tel:${digits}` : undefined;
    }
    case 'url': {
      if (d.url) return fillLink(d.url, value, snap);
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
      } catch {
        return undefined;
      }
    }
  }
}

/** How full a progress bar is, 0 to 1, with the number read. Over max is full; under 0 is empty. */
export function progressOf(text: string, d: Of<'progress'>): { value: number; fraction: number } | undefined {
  const read = readNumber(text);
  if (!read) return undefined;
  return { value: read.value, fraction: Math.min(1, Math.max(0, read.value / d.max)) };
}

/** Rows a display draws over: a barcode its height, the rest one. */
export const displayHeight = (d: Display | undefined) => (d?.type === 'barcode' ? d.height : 1);

/** What the user reads for a display, as plain text (for copying and for screen readers). */
export function displayText(text: string, d: Display): string {
  switch (d.type) {
    case 'badge': return badgeOf(text, d)?.label ?? '';
    case 'number': return formatNumber(text, d) ?? text.trim();
    case 'date': return formatDate(text, d) ?? text.trim();
    case 'yesno': {
      const yn = yesNoOf(text, d);
      return yn === 'yes' ? 'Yes' : yn === 'no' ? 'No' : text.trim();
    }
    case 'link':
    case 'progress':
    case 'barcode':
      return text.trim();
  }
}
