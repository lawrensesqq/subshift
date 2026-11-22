// Detect the text encoding of a subtitle file. Many older subtitles —
// especially Russian, Ukrainian, Polish, Czech — are not UTF-8 but legacy
// Windows code pages. Opened as the wrong one they turn into "Ďđčâĺň"-style junk.
//
// Every single-byte code page decodes *any* bytes "successfully", so we can't
// just try them. Instead we decode with each candidate and score how much the
// result looks like real words.

const CANDIDATES = ["windows-1251", "windows-1250", "windows-1252"];

const isAsciiLetter = (c) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
const isLatinAccent = (c) => c >= 0x00c0 && c <= 0x024f && c !== 0xd7 && c !== 0xf7;
const isCyrillic = (c) => c >= 0x0400 && c <= 0x04ff;

/**
 * Word-level plausibility score. A real word is written in one script, and in
 * Latin languages accented letters are a minority. Cyrillic text mis-decoded as
 * cp1250 gives words made almost entirely of accented letters; Polish decoded
 * as cp1251 gives words mixing Latin and Cyrillic. Both get penalised.
 */
export function plausibility(text) {
  let total = 0;
  for (const word of text.split(/[^\p{L}]+/u)) {
    if (word.length < 2) continue;
    let ascii = 0, accent = 0, cyr = 0, other = 0;
    for (const ch of word) {
      const c = ch.codePointAt(0);
      if (isAsciiLetter(c)) ascii++;
      else if (isLatinAccent(c)) accent++;
      else if (isCyrillic(c)) cyr++;
      else other++;
    }
    const n = word.length;
    const natural =
      (cyr === n) ||
      (cyr === 0 && other === 0 && accent <= Math.max(1, (ascii + accent) / 3));
    total += natural ? n : -n;
  }
  return total;
}

/**
 * Decode bytes to string. Returns { text, encoding }.
 * Order: BOMs -> strict UTF-8 -> best-scoring legacy code page.
 */
export function decode(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(bytes), encoding: "utf-16le" };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(bytes), encoding: "utf-16be" };

  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    /* not valid UTF-8 -> fall through to legacy code pages */
  }

  let best = null;
  for (const encoding of CANDIDATES) {
    const text = new TextDecoder(encoding).decode(bytes);
    const s = plausibility(text);
    if (!best || s > best.s) best = { text, encoding, s };
  }
  return { text: best.text, encoding: best.encoding };
}
