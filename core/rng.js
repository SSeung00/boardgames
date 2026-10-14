/* 시드가 있는 난수 (mulberry32). 게임 상태 S.rs 에 32비트 상태를 둔다 — 같은 시드면 같은 게임.
   AI 는 상태를 건드리지 않도록 따로 받은 rng() 함수를 쓴다. */

export function rand(S) {
  const a = (S.rs = (S.rs + 0x6D2B79F5) >>> 0);
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const randInt = (S, n) => Math.floor(rand(S) * n);

export function shuffle(S, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(S, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* 상태와 무관한 독립 난수 함수 (테스트에서 AI 에 넘긴다) */
export function makeRng(seed) {
  const S = { rs: seed >>> 0 };
  return () => rand(S);
}

/* rng() 로 배열 섞기 / 고르기 — AI 용 */
export function shuffleWith(rng, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export const pick = (rng, a) => a[Math.floor(rng() * a.length)];
