// Uppercasing for monocase fields. A character is uppercased only when its
// uppercase is one Latin-1 character, as a terminal's code page has it:
// ß (SS in Unicode), ÿ and µ stay as they are, so the text keeps its length.

/** text with each character uppercased, where the uppercase is one Latin-1 character. */
export function monocase(text: string): string {
  let out = '';
  for (const ch of text) {
    const up = ch.toUpperCase();
    out += up.length === 1 && up.charCodeAt(0) <= 0xff ? up : ch;
  }
  return out;
}
