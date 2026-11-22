// Core subtitle model: parsing, serialisation and timing transforms.
// Pure functions, no DOM — shared by the web app and the test suite.

const TIME_RE = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
const ARROW_RE = /^\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/;

/** "01:02:03,456" -> 3723456 (ms). Accepts "." as separator and 1–3 digit millis. */
export function parseTimestamp(str) {
  const m = TIME_RE.exec(str);
  if (!m) throw new Error(`Invalid timestamp: ${str}`);
  const ms = Number(m[4].padEnd(3, "0"));
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + ms;
}

/** 3723456 -> "01:02:03,456" (SRT) or "01:02:03.456" (VTT). */
export function formatTimestamp(ms, sep = ",") {
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(r, 3)}`;
}

/**
 * Parse SRT (or WebVTT) text into cues. Tolerant of real-world files:
 * BOM, CRLF/CR line endings, missing or wrong cue numbers, extra blank
 * lines inside a cue, trailing positioning data after the timestamps.
 * Returns { cues, warnings }.
 */
export function parse(text) {
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const cues = [];
  const warnings = [];
  let cur = null;

  const flush = () => {
    if (!cur) return;
    while (cur.lines.length && cur.lines[cur.lines.length - 1].trim() === "") cur.lines.pop();
    if (cur.end < cur.start) {
      warnings.push(`Cue at ${formatTimestamp(cur.start)} ends before it starts; end fixed.`);
      cur.end = cur.start;
    }
    cues.push({ start: cur.start, end: cur.end, text: cur.lines.join("\n") });
    cur = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = ARROW_RE.exec(line);
    if (m) {
      // A bare number right before the timing line is the cue index, not text.
      if (cur && cur.lines.length && /^\s*\d+\s*$/.test(cur.lines[cur.lines.length - 1])) {
        cur.lines.pop();
      }
      flush();
      cur = { start: parseTimestamp(m[1]), end: parseTimestamp(m[2]), lines: [] };
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  flush();

  if (!cues.length) throw new Error("No subtitle cues found. Is this an .srt or .vtt file?");
  return { cues, warnings };
}

/** Cues -> SRT text, renumbered from 1. */
export function toSrt(cues) {
  return cues
    .map((c, i) => `${i + 1}\n${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}\n${c.text}\n`)
    .join("\n");
}

/** Cues -> WebVTT text. */
export function toVtt(cues) {
  const body = cues
    .map((c) => `${formatTimestamp(c.start, ".")} --> ${formatTimestamp(c.end, ".")}\n${c.text}\n`)
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

/** Apply any time mapping f(ms) -> ms; drops cues pushed entirely before 0. */
export function mapTimes(cues, f) {
  return cues
    .map((c) => ({ ...c, start: f(c.start), end: f(c.end) }))
    .filter((c) => c.end > 0)
    .map((c) => ({ ...c, start: Math.max(0, Math.round(c.start)), end: Math.round(c.end) }));
}

/** Constant offset: subtitles are early/late by the same amount everywhere. */
export function shift(cues, offsetMs) {
  return mapTimes(cues, (t) => t + offsetMs);
}

/**
 * Frame-rate conversion: subs authored for one fps played against a video
 * at another drift linearly (e.g. 25 -> 23.976 drifts ~4 s per minute).
 */
export function convertFps(cues, fromFps, toFps) {
  if (!(fromFps > 0 && toFps > 0)) throw new Error("Frame rates must be positive.");
  const k = fromFps / toFps;
  return mapTimes(cues, (t) => t * k);
}

/**
 * Two-point sync: the user says "cue A should be at time X, cue B at time Y".
 * Solves the linear map t' = a·t + b through both points, which fixes
 * offset and drift (fps mismatch, PAL speed-up) in one step.
 */
export function twoPointSync(cues, p1, p2) {
  if (p1.from === p2.from) throw new Error("Pick two different cues for two-point sync.");
  const a = (p2.to - p1.to) / (p2.from - p1.from);
  if (!(a > 0)) throw new Error("The two corrected times are in the wrong order.");
  const b = p1.to - a * p1.from;
  return { cues: mapTimes(cues, (t) => a * t + b), scale: a, offset: b };
}

/** Parse user input like "1:02:03,500", "02:03.5", "-2.5" (seconds) -> ms. */
export function parseUserTime(input) {
  const s = String(input).trim();
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 1000);
  const neg = s.startsWith("-");
  const parts = s.replace(/^[+-]/, "").replace(",", ".").split(":");
  if (parts.length > 3 || parts.some((p) => p === "" || isNaN(Number(p)))) {
    throw new Error(`Can't read time "${input}". Use hh:mm:ss,mmm or seconds.`);
  }
  const secs = parts.reduce((acc, p) => acc * 60 + Number(p), 0);
  return Math.round((neg ? -secs : secs) * 1000);
}
