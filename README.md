# subshift

**Fix out-of-sync subtitles in your browser.** No install and no sign-up. Your file never leaves your computer.

**Live:** https://lawrensesqq.github.io/subshift/

You download a movie and a subtitle file, and the lines appear two seconds late. Or they start fine and slowly drift until they're a minute off by the end. Or every letter is gibberish like `Ďđčâĺň`. subshift fixes all three.

## Features

| Problem | What subshift does |
|---|---|
| Subtitles are early/late by the same amount | **Shift**: constant offset, e.g. `-2.5` s |
| Subtitles drift over time (wrong release / frame rate) | **Two-point sync**: you correct one line near the start and one near the end, and every line in between is fixed |
| You know the frame rates | **Frame rate**: 23.976 / 24 / 25 / 29.97 / 30 fps conversion |
| Text is gibberish (`РџСЂРёРІРµС‚`, `Ďđčâĺň`) | **Encoding detection**: UTF-8, UTF-16, Windows-1251 (Cyrillic), 1250 (Central European), 1252 (Western) |
| Messy files from the internet | Tolerant parser: BOM, CRLF, missing/wrong cue numbers, blank lines, positioning tags, inverted timestamps |

Output is a clean, renumbered `.srt` or `.vtt` (UTF-8).

## How it works

**Two-point sync.** Drift happens because the subtitle timings and the video differ by a linear map `t' = a·t + b`: `a` comes from the frame-rate ratio (e.g. 25/23.976 ≈ 1.0427) and `b` is the constant delay. Two known points (cue time → real time) are enough to solve for both, so one correction fixes every line in the file. Lines pushed before `0:00` are dropped instead of being clamped onto each other.

**Encoding detection.** Single-byte code pages decode *any* byte sequence without errors, so "try until it doesn't fail" doesn't work. subshift first tries strict UTF-8, then decodes the bytes with each legacy code page and scores the result word by word. A real word is written in one script, and in Latin languages accented letters are a minority. Russian text decoded as cp1250 becomes words made almost entirely of accented letters (`Ďđčâĺň`). Polish decoded as cp1251 mixes Latin and Cyrillic inside one word. Both are penalised, and the highest-scoring decoding wins.

## Project layout

```
src/srt.js        parser, serialisers, timing transforms (pure, no DOM)
src/encoding.js   encoding detection
src/app.js        UI
tests/cases.js    test suite, runs in Node (npm test) and in the browser (tests/index.html)
```

No framework, no build step, no dependencies. It's plain ES modules.

## Development

```bash
npm test          # Node 20+
npm start         # serve locally at http://localhost:3000
```

Every push to `main` runs the tests and deploys to GitHub Pages.

## Licence

MIT © lawrensesqq
