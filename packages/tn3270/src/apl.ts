// The 3270's APL character set, which a host reaches with Graphic Escape
// (GE, X'08') before a byte. ISPF draws its lines and pop-up boxes with it,
// so a byte after GE is not a code-page character: X'A2' is a horizontal
// line there, not "s".

/** Line-drawing characters, by their code in the APL set. */
const APL: Record<number, string> = {
  0xa2: '─', // ─
  0x85: '│', // │
  0xc5: '┌', // ┌
  0xd5: '┐', // ┐
  0xc4: '└', // └
  0xd4: '┘', // ┘
  0xc6: '├', // ├
  0xd6: '┤', // ┤
  0xd7: '┬', // ┬
  0xc7: '┴', // ┴
  0xd3: '┼', // ┼
};

/** A character from the APL set, or undefined for one not mapped (shown as the code page has it). */
export function aplChar(byte: number): string | undefined {
  return APL[byte];
}
