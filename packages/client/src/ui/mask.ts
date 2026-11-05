// Masked input: typing into a fixed pattern such as 999-99-9999. In a mask,
// 9 takes a digit, A a letter and X any character (MASK_SLOTS); every other
// character is a separator the box adds by itself. The host field holds
// either the typed characters alone or, with `literals`, the separators too.

import { MASK_SLOTS, type Widget } from '@veneer/screens';

type Mask = Extract<Widget, { type: 'mask' }>;

const isSlot = (c: string): c is keyof typeof MASK_SLOTS => c in MASK_SLOTS;

/** Whether a character may go in a slot. */
export function slotTakes(slot: string, c: string): boolean {
  if (slot === '9') return /^\d$/.test(c);
  if (slot === 'A') return /^\p{L}$/u.test(c);
  return slot === 'X' && c !== '';
}

/** How many characters a mask takes (its slots). */
export const slotCount = (mask: string) => [...mask].filter(isSlot).length;

/** The host field's length the mask needs: its slots, or with separators, the whole mask. */
export const maskLength = (w: Mask) => (w.literals ? [...w.mask].length : slotCount(w.mask));

/**
 * Put typed characters into the mask's slots, in order. A character a slot
 * won't take is dropped (a letter where a digit goes), and so is a separator
 * typed by hand where the mask has one. Returns what the box shows (the
 * separators up to the last character placed) and the host's value.
 */
export function applyMask(typed: string, w: Mask): { shown: string; host: string } {
  const mask = [...w.mask];
  const separators = new Set(mask.filter((c) => !isSlot(c)));
  const chars = [...typed];
  const placed: string[] = [];
  let shown = '';
  let pending = '';
  let k = 0;
  for (let m = 0; m < mask.length; m++) {
    const slot = mask[m]!;
    if (!isSlot(slot)) {
      pending += slot;
      continue;
    }
    let c: string | undefined;
    while (k < chars.length) {
      const next = chars[k++]!;
      if (slotTakes(slot, next) && !(slot === 'X' && separators.has(next))) { c = next; break; }
    }
    if (c === undefined) break;
    shown += pending + c;
    pending = '';
    placed.push(c);
  }
  return { shown, host: w.literals ? shown : placed.join('') };
}

/** What the box shows for the host's value: the value with the separators put in. */
export function maskedText(value: string, w: Mask): string {
  return applyMask(value.trimEnd(), w).shown;
}

/** Whether every slot is filled. */
export function maskComplete(shown: string, w: Mask): boolean {
  return [...shown].length === [...w.mask].length;
}

/** How many of the typed characters before a point would land in slots (the caret's place, ignoring separators). */
export function slotsBefore(typedBefore: string, w: Mask): number {
  return [...applyMask(typedBefore, w).shown].filter((_, i) => isSlot([...w.mask][i]!)).length;
}

/** Where the caret goes in the shown text: after `count` placed characters (and none of the separators after them). */
export function caretAfter(shown: string, count: number, w: Mask): number {
  if (count === 0) return 0;
  const mask = [...w.mask];
  let seen = 0;
  const chars = [...shown];
  for (let i = 0; i < chars.length; i++) {
    if (isSlot(mask[i]!) && ++seen === count) return i + 1;
  }
  return chars.length;
}
