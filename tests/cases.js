// Test cases shared by the Node runner (run.test.js) and the browser runner (index.html).
import { parse, toSrt, toVtt, shift, convertFps, twoPointSync, parseTimestamp, formatTimestamp, parseUserTime } from "../src/srt.js";
import { decode } from "../src/encoding.js";

function eq(actual, expected, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  got      ${a}`);
}
function throws(fn, msg) {
  try { fn(); } catch { return; }
  throw new Error(`expected to throw: ${msg}`);
}

const SAMPLE = `1
00:00:01,000 --> 00:00:02,500
Hello.

2
00:00:03,000 --> 00:00:04,000
Two
lines.
`;

// Single-byte encoders for building legacy-encoded fixtures.
const cp1251 = (s) => Uint8Array.from([...s].map((ch) => {
  const c = ch.codePointAt(0);
  if (c < 0x80) return c;
  if (c >= 0x410 && c <= 0x44f) return 0xc0 + (c - 0x410);
  return { "ё": 0xb8, "Ё": 0xa8 }[ch];
}));
const cp1250 = (s) => Uint8Array.from([...s].map((ch) => {
  const c = ch.codePointAt(0);
  return c < 0x80 ? c : { "ę": 0xea, "ń": 0xf1, "ó": 0xf3, "ł": 0xb3, "ś": 0x9c, "ą": 0xb9, "ż": 0xbf, "ć": 0xe6 }[ch];
}));

export const cases = [
  ["timestamps round-trip", () => {
    eq(parseTimestamp("01:02:03,456"), 3723456);
    eq(parseTimestamp("00:00:01.5"), 1500, "short millis are padded, '.' accepted");
    eq(formatTimestamp(3723456), "01:02:03,456");
    eq(formatTimestamp(3723456, "."), "01:02:03.456");
    eq(formatTimestamp(-50), "00:00:00,000", "negative clamps to zero");
  }],

  ["parses a clean SRT", () => {
    const { cues, warnings } = parse(SAMPLE);
    eq(cues, [
      { start: 1000, end: 2500, text: "Hello." },
      { start: 3000, end: 4000, text: "Two\nlines." },
    ]);
    eq(warnings, []);
  }],

  ["round-trips SRT", () => eq(toSrt(parse(SAMPLE).cues), SAMPLE)],

  ["tolerates BOM, CRLF, missing numbers and junk spacing", () => {
    const messy = "﻿\r\n\r\n00:00:01,000 --> 00:00:02,000 X1:10 X2:20\r\nA\r\n\r\n\r\n7\r\n00:00:03,000-->00:00:04,000\r\nB\r\n";
    eq(parse(messy).cues.map((c) => [c.start, c.text]), [[1000, "A"], [3000, "B"]]);
  }],

  ["reads WebVTT input", () => {
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n";
    eq(parse(vtt).cues, [{ start: 1000, end: 2000, text: "Hi" }]);
    eq(toVtt(parse(vtt).cues), vtt);
  }],

  ["fixes cues that end before they start", () => {
    const { cues, warnings } = parse("1\n00:00:05,000 --> 00:00:04,000\nX\n");
    eq(cues[0].end, 5000);
    eq(warnings.length, 1);
  }],

  ["rejects non-subtitle input", () => throws(() => parse("just some text"), "no cues")],

  ["shift moves all cues and drops ones before zero", () => {
    const { cues } = parse(SAMPLE);
    eq(shift(cues, 500).map((c) => c.start), [1500, 3500]);
    eq(shift(cues, -3000).map((c) => [c.start, c.end]), [[0, 1000]], "first cue ends at -500 and is dropped");
  }],

  ["fps conversion 25 -> 23.976 stretches time", () => {
    const cues = [{ start: 60000, end: 61000, text: "x" }];
    const out = convertFps(cues, 25, 24000 / 1001);
    eq(out[0].start, 62563, "one minute at 25fps lasts 62.56 s at 23.976fps");
  }],

  ["two-point sync solves offset and drift together", () => {
    // Real subs were made for 25fps and also start 2 s late.
    const truth = (t) => t * (25 / (24000 / 1001)) + 2000;
    const cues = [10000, 600000, 3000000].map((t) => ({ start: t, end: t + 1000, text: "" }));
    const r = twoPointSync(cues, { from: 10000, to: truth(10000) }, { from: 3000000, to: truth(3000000) });
    eq(r.cues[1].start, Math.round(truth(600000)), "a line in the middle lands exactly right");
  }],

  ["two-point sync rejects bad input", () => {
    const cues = parse(SAMPLE).cues;
    throws(() => twoPointSync(cues, { from: 1000, to: 1 }, { from: 1000, to: 2 }), "same cue twice");
    throws(() => twoPointSync(cues, { from: 1000, to: 5000 }, { from: 3000, to: 4000 }), "reversed times");
  }],

  ["parses user-typed times", () => {
    eq(parseUserTime("-2.5"), -2500);
    eq(parseUserTime("1:02:03,5"), 3723500);
    eq(parseUserTime("02:03"), 123000);
    eq(parseUserTime("-0:01"), -1000);
    throws(() => parseUserTime("abc"), "garbage");
  }],

  ["decodes UTF-8 and UTF-8 with BOM", () => {
    const bytes = new TextEncoder().encode("﻿Привет");
    eq(decode(bytes.buffer).encoding, "utf-8");
  }],

  ["detects Russian in windows-1251", () => {
    const text = "Привет, как дела? Всё хорошо, спасибо.";
    const r = decode(cp1251(text).buffer);
    eq([r.encoding, r.text], ["windows-1251", text]);
  }],

  ["detects Polish in windows-1250", () => {
    const text = "Dzień dobry, jak się masz? Dziękuję, wszystko w porządku.";
    const r = decode(cp1250(text).buffer);
    eq([r.encoding, r.text], ["windows-1250", text]);
  }],
];
