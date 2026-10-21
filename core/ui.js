/* Shared UI parts — storage, sound, vibration, toasts, modals. Game UI modules receive these through ctx. */
import { L } from "./i18n.js";

export const $ = id => document.getElementById(id);
export function el(tag, cls, html) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (html !== undefined) d.innerHTML = html;
  return d;
}
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Storage ---------- */
export const LS = {
  get(k) { try { return localStorage.getItem("bg." + k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem("bg." + k, v); } catch (e) { } },
  json(k, d) { try { const v = LS.get(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  put(k, v) { LS.set(k, JSON.stringify(v)); }
};

export const prefs = Object.assign({ name: "", sound: true }, LS.json("prefs", {}));
export const savePrefs = () => LS.put("prefs", prefs);

/* ---------- Sound (synthesized effects) ---------- */
let actx = null, noiseBuf = null;
function ac() {
  if (!prefs.sound) return null;
  if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; try { actx = new AC(); } catch (e) { return null; } }
  if (actx.state === "suspended") { try { actx.resume(); } catch (e) { } }
  return actx;
}
function tone(f, dur, o = {}) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + (o.delay || 0), osc = c.createOscillator(), g = c.createGain();
  osc.type = o.type || "sine"; osc.frequency.setValueAtTime(f, t);
  if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(50, f + o.slide), t + dur);
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(o.gain || .1, t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  osc.connect(g).connect(c.destination); osc.start(t); osc.stop(t + dur + .03);
}
function hit(dur, o = {}) {
  const c = ac(); if (!c) return;
  if (!noiseBuf) { noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * .4), c.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const t = c.currentTime + (o.delay || 0), s = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
  s.buffer = noiseBuf; bp.type = "bandpass"; bp.frequency.value = o.f || 1600; bp.Q.value = o.q || 1;
  g.gain.setValueAtTime(o.gain || .14, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  s.connect(bp).connect(g).connect(c.destination); s.start(t); s.stop(t + dur + .03);
}
/* A worker timer: keeps ticking even when browsers throttle hidden tabs (the host's game clock, heartbeats). */
export const steadySleep = (() => {
  try {
    const src = "onmessage = e => setTimeout(() => postMessage(e.data), e.data.ms);";
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    const waits = new Map();
    let n = 0;
    w.onmessage = e => { const f = waits.get(e.data.id); if (f) { waits.delete(e.data.id); f(); } };
    return ms => new Promise(r => { const id = ++n; waits.set(id, r); w.postMessage({ id, ms }); });
  } catch (e) { return ms => new Promise(r => setTimeout(r, ms)); }
})();

export const sound = {
  wake() { ac(); },
  deal() { hit(.05, { f: 2400, q: 1.5, gain: .08 }); },
  place() { hit(.07, { f: 1500, q: .9, gain: .15 }); tone(150, .10, { type: "triangle", gain: .09 }); },
  flip() { hit(.06, { f: 3000, q: 1.2, gain: .09 }); },
  pass() { tone(250, .14, { gain: .06, slide: -70 }); },
  chip() { hit(.04, { f: 4200, q: 3, gain: .1 }); hit(.04, { f: 3600, q: 3, gain: .07, delay: .05 }); },
  turn() { tone(659, .14, { gain: .08 }); tone(880, .2, { gain: .06, delay: .1 }); },
  tick() { tone(1200, .05, { gain: .04 }); },
  good() { [659, 784].forEach((f, i) => tone(f, .22, { type: "triangle", gain: .08, delay: i * .09 })); },
  bad() { tone(220, .25, { type: "triangle", gain: .08, slide: -60 }); },
  join() { tone(523, .12, { gain: .06 }); tone(784, .16, { gain: .05, delay: .08 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, .34, { type: "triangle", gain: .1, delay: i * .12 })); },
  lose() { [440, 370, 311].forEach((f, i) => tone(f, .34, { type: "triangle", gain: .07, delay: i * .14 })); }
};
export const buzz = pattern => { try { if (prefs.sound && navigator.vibrate) navigator.vibrate(pattern); } catch (e) { } };

/* ---------- Toasts ---------- */
let toastT = 0;
export function toast(text, ms = 2600) {
  const t = $("toast");
  t.classList.remove("sticky");
  t.textContent = text; t.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => { if (!t.classList.contains("sticky")) t.classList.remove("on"); }, ms);
}
export function stickyToast(text) {
  const t = $("toast");
  if (text) { t.textContent = text; t.classList.add("on", "sticky"); }
  else if (t.classList.contains("sticky")) t.classList.remove("on", "sticky");
}

/* ---------- Modals ----------
   modal((box, close) => { ... }, {dismissible}) — closing with close(value) resolves the promise with value */
const stack = [];
export function modal(build, opt = {}) {
  return new Promise(resolve => {
    const scrim = el("div", "scrim"), box = el("div", "modal");
    scrim.appendChild(box);
    $("modalHost").appendChild(scrim);
    const entry = { dismissible: opt.dismissible !== false, close };
    function close(v) {
      const i = stack.indexOf(entry); if (i < 0) return;
      stack.splice(i, 1); scrim.remove(); resolve(v);
    }
    stack.push(entry);
    if (entry.dismissible) {
      scrim.addEventListener("click", e => { if (e.target === scrim) close(null); });
      const x = el("button", "mclose", "✕"); x.setAttribute("aria-label", L("닫기", "Close")); x.onclick = () => close(null);
      box.appendChild(x);
    }
    build(box, close);
  });
}
export const topModal = () => stack[stack.length - 1];
export function closeAllModals() { while (stack.length) stack[stack.length - 1].close(null); }
export function head(box, eyebrow, title, text) {
  box.insertAdjacentHTML("beforeend", `${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ""}<h2>${title}</h2>${text ? `<p>${text}</p>` : ""}`);
}
export function buttonRow(box, buttons) {
  const row = el("div", "row");
  for (const b of buttons) {
    const x = el("button", "btn" + (b.primary ? " primary" : "") + (b.danger ? " danger" : ""), b.label);
    x.onclick = b.on; if (b.disabled) x.disabled = true;
    row.appendChild(x);
  }
  box.appendChild(row);
  return row;
}
/* Pick one: options [{value, label, note?}] → value */
export function choose(title, text, options, opt = {}) {
  return modal((box, close) => {
    head(box, opt.eyebrow || "", title, text);
    const list = el("div", "choices");
    for (const o of options) {
      const b = el("button", "choice", `<b>${o.label}</b>${o.note ? `<small>${o.note}</small>` : ""}`);
      b.onclick = () => close(o.value);
      list.appendChild(b);
    }
    box.appendChild(list);
  }, { dismissible: opt.dismissible !== false });
}

/* ---------- Avatars ---------- */
const AVATAR_COLORS = ["#c9774a", "#5f9e6e", "#5b84c4", "#b05f9a", "#c4a24a", "#4aa3a8", "#8a6fc4", "#c45b5b", "#7a8a5a", "#a87a4a"];
export const avatarColor = p => AVATAR_COLORS[p % AVATAR_COLORS.length];
export function avatarHTML(name, p, extra = "") {
  return `<span class="av ${extra}" style="--ac:${avatarColor(p)}">${esc([...String(name || "?")][0] || "?")}</span>`;
}
