/* 게임 목록. 새 게임: games/<id>/engine.js · ui.js · style.css 를 만들고 여기에 한 줄 추가. */
import oldmaid from "./oldmaid/engine.js";
import onecard from "./onecard/engine.js";
import poker from "./poker/engine.js";
import gems from "./gems/engine.js";
import mine from "./mine/engine.js";
import gostop from "./gostop/engine.js";
import dalmuti from "./dalmuti/engine.js";

const base = new URL(".", import.meta.url).href;
const entry = engine => ({ id: engine.id, engine, ui: `${base}${engine.id}/ui.js`, css: `${base}${engine.id}/style.css` });

export const GAMES = [dalmuti, oldmaid, onecard, poker, gostop, gems, mine].map(entry);
export const gameById = id => GAMES.find(g => g.id === id);
