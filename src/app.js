import { parse, toSrt, toVtt, shift, convertFps, twoPointSync, parseUserTime, formatTimestamp } from "./srt.js";
import { decode } from "./encoding.js";

const $ = (id) => document.getElementById(id);
const FPS = [["23.976", 24000 / 1001], ["24", 24], ["25", 25], ["29.97", 30000 / 1001], ["30", 30]];

let state = { name: "", cues: [], mode: "shift", result: [] };

for (const id of ["fpsFrom", "fpsTo"]) {
  $(id).innerHTML = FPS.map(([label, v]) => `<option value="${v}">${label}</option>`).join("");
}
$("fpsFrom").value = 25;
$("fpsTo").value = 24000 / 1001;

// ---- loading -----------------------------------------------------------
async function load(file) {
  $("error").textContent = "";
  try {
    const { text, encoding } = decode(await file.arrayBuffer());
    const { cues, warnings } = parse(text);
    state = { ...state, name: file.name.replace(/\.(srt|vtt|txt)$/i, ""), cues };
    $("fileinfo").textContent =
      `${file.name} · ${cues.length} lines · read as ${encoding}` + (warnings.length ? ` · ${warnings.length} fixed` : "");
    const opts = cues.map((c, i) =>
      `<option value="${i}">${i + 1}. [${formatTimestamp(c.start)}] ${escape(c.text.split("\n")[0].slice(0, 50))}</option>`).join("");
    $("c1").innerHTML = $("c2").innerHTML = opts;
    $("c1").value = 0;
    $("c2").value = cues.length - 1;
    $("t1").value = formatTimestamp(cues[0].start);
    $("t2").value = formatTimestamp(cues[cues.length - 1].start);
    $("tools").hidden = false;
    update();
  } catch (e) {
    $("error").textContent = e.message;
  }
}

const drop = $("drop");
$("file").addEventListener("change", (e) => e.target.files[0] && load(e.target.files[0]));
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]);
});
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") $("file").click(); });

// ---- modes -------------------------------------------------------------
document.querySelectorAll(".tabs button").forEach((btn) =>
  btn.addEventListener("click", () => {
    state.mode = btn.dataset.mode;
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b === btn));
    document.querySelectorAll(".panel").forEach((p) => (p.hidden = p.dataset.panel !== state.mode));
    update();
  }));

["offset", "t1", "t2", "c1", "c2", "fpsFrom", "fpsTo"].forEach((id) => $(id).addEventListener("input", update));

function update() {
  if (!state.cues.length) return;
  $("error").textContent = "";
  try {
    const { cues, mode } = state;
    let summary = "";
    if (mode === "shift") {
      const off = parseUserTime($("offset").value || "0");
      state.result = shift(cues, off);
      summary = `Moving every line ${off >= 0 ? "later" : "earlier"} by ${Math.abs(off) / 1000} s.`;
    } else if (mode === "sync") {
      const i1 = Number($("c1").value), i2 = Number($("c2").value);
      const r = twoPointSync(cues,
        { from: cues[i1].start, to: parseUserTime($("t1").value) },
        { from: cues[i2].start, to: parseUserTime($("t2").value) });
      state.result = r.cues;
      summary = `Speed ×${r.scale.toFixed(5)}, offset ${(r.offset / 1000).toFixed(3)} s.`;
    } else {
      const from = Number($("fpsFrom").value), to = Number($("fpsTo").value);
      state.result = convertFps(cues, from, to);
      summary = `Stretching timings by ×${(from / to).toFixed(5)}.`;
    }
    const dropped = cues.length - state.result.length;
    if (dropped) summary += ` ${dropped} line(s) would land before 0:00 and are removed.`;
    $("summary").textContent = summary;
    renderPreview();
  } catch (e) {
    $("error").textContent = e.message;
    state.result = [];
  }
}

function renderPreview() {
  const { cues, result } = state;
  const offset = cues.length - result.length; // dropped cues are always at the start
  const idx = [0, 1, 2, Math.floor(cues.length / 2), cues.length - 2, cues.length - 1]
    .filter((i, k, a) => i >= offset && i < cues.length && a.indexOf(i) === k);
  $("preview").querySelector("tbody").innerHTML = idx.map((i) => {
    const before = cues[i].start, after = result[i - offset].start;
    return `<tr><td>${i + 1}</td><td>${formatTimestamp(before)}</td>` +
      `<td class="${before !== after ? "changed" : ""}">${formatTimestamp(after)}</td>` +
      `<td>${escape(cues[i].text).replace(/\n/g, "<br>")}</td></tr>`;
  }).join("");
}

// ---- export ------------------------------------------------------------
function download(text, ext, type) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${state.name}.synced.${ext}` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("dlSrt").addEventListener("click", () => state.result.length && download(toSrt(state.result), "srt", "application/x-subrip"));
$("dlVtt").addEventListener("click", () => state.result.length && download(toVtt(state.result), "vtt", "text/vtt"));

function escape(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
