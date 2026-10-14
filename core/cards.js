/* Playing cards (shared by Old Maid, One Card and Poker).
   Card code: one suit letter + a number. S spades · H hearts · D diamonds · C clubs, 1=A … 11=J 12=Q 13=K.
   Jokers: "JB" black-and-white joker, "JC" colour joker. */
import { L, tx, loc } from "./i18n.js";

export const SUITS = ["S", "H", "D", "C"];
export const SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣" };
export const SUIT_NAME = { S: tx("스페이드", "Spades"), H: tx("하트", "Hearts"), D: tx("다이아", "Diamonds"), C: tx("클럽", "Clubs") };
export const RANK_LABEL = { 1: "A", 11: "J", 12: "Q", 13: "K" };

export const suitOf = c => c[0];
export const rankOf = c => (c[0] === "J" && (c[1] === "B" || c[1] === "C") ? 0 : +c.slice(1));
export const isJoker = c => c === "JB" || c === "JC";
export const isRed = c => c[0] === "H" || c[0] === "D" || c === "JC";
export const rankLabel = r => RANK_LABEL[r] || String(r);

export function deck52() {
  const d = [];
  for (const s of SUITS) for (let r = 1; r <= 13; r++) d.push(s + r);
  return d;
}

/* Bilingual card name for engine texts: {ko, en} */
export function cardNameTx(c) {
  if (c === "JB") return tx("흑백 조커", "black joker");
  if (c === "JC") return tx("컬러 조커", "colour joker");
  const n = SUIT_SYMBOL[c[0]] + rankLabel(rankOf(c));
  return tx(n, n);
}
/* Card name in the viewer's language (UI code) */
export function cardName(c) {
  if (c === "JB" || c === "JC") return loc(cardNameTx(c));
  return SUIT_SYMBOL[c[0]] + rankLabel(rankOf(c));
}

/* HTML for the screen — browser only. extra: additional classes ("sm" | "lg" for size, "sel" | "dim" | "can" for state) */
export function cardHTML(c, extra = "") {
  if (!c) return `<div class="pc back ${extra}"></div>`;
  if (isJoker(c)) {
    return `<div class="pc joker ${c === "JC" ? "red" : "black"} ${extra}" data-c="${c}">` +
      `<span class="pc-mid">🃏</span><span class="pc-sub">JOKER<small>${c === "JC" ? L("컬러", "colour") : L("흑백", "b/w")}</small></span></div>`;
  }
  const s = c[0], r = rankOf(c);
  return `<div class="pc ${isRed(c) ? "red" : "black"} ${extra}" data-c="${c}">` +
    `<span class="pc-corner">${rankLabel(r)}<i>${SUIT_SYMBOL[s]}</i></span>` +
    `<span class="pc-mid">${SUIT_SYMBOL[s]}</span>` +
    `<span class="pc-corner br">${rankLabel(r)}<i>${SUIT_SYMBOL[s]}</i></span></div>`;
}

export function cardEl(c, extra) {
  const t = document.createElement("template");
  t.innerHTML = cardHTML(c, extra);
  return t.content.firstChild;
}
