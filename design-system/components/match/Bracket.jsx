import React from "react";

/** شجرة خروج المغلوب — أعمدة لكل جولة، النهائي ذهبي متوَّج 🏆 */
export function Bracket({ rounds = [] }) {
  const winner = (m) =>
    m.status === "finished" && m.hs != null && m.as != null && m.hs !== m.as
      ? (m.hs > m.as ? "home" : "away")
      : null;
  const side = (m, who) => {
    const name = who === "home" ? m.home : m.away;
    const score = who === "home" ? m.hs : m.as;
    const w = winner(m);
    return (
      <div className={`bk-side${w === who ? " bk-win" : ""}`}>
        <span className={`bk-team${name ? "" : " tbd"}`}>{name || "يُحدَّد لاحقاً"}</span>
        <span className="bk-score">{m.hs != null && score != null ? String(score) : ""}</span>
      </div>
    );
  };
  return (
    <div className="bracket-scroll">
      <div className="bracket">
        {rounds.map((r, ri) => {
          const isFinal = ri === rounds.length - 1;
          return (
            <div className={`bracket-col${isFinal ? " bk-final-col" : ""}`} key={ri}>
              <div>
                {isFinal ? <div className="bk-trophy">🏆</div> : null}
                <div className="bracket-round-title">{r.title}</div>
              </div>
              {r.matches.map((m, mi) => (
                <div className={`bk-match${m.status === "live" ? " is-live" : ""}${isFinal ? " bk-final" : ""}`} key={mi}>
                  {side(m, "home")}
                  {side(m, "away")}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
