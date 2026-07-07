import React from "react";

/** صف مباراة — وقت | مضيف — نتيجة — ضيف | سهم (نفس بنية matchCard في render.js) */
export function MatchRow({
  time,
  group,
  homeName,
  awayName,
  homeScore,
  awayScore,
  status = "scheduled",
  onClick,
}) {
  const finished = status === "finished" && homeScore != null && awayScore != null;
  const live = status === "live";
  const hasScore = finished || (live && homeScore != null);
  const homeWin = finished && homeScore > awayScore;
  const awayWin = finished && awayScore > homeScore;
  const Tag = onClick ? "a" : "div";
  return (
    <Tag
      className={`match${onClick ? " tappable" : ""}${live ? " is-live" : ""}`}
      onClick={onClick}
    >
      <div className="time">
        {time || "×"}
        {group ? <span className="grp">{group}</span> : null}
        {live ? (
          <span className="grp">
            <span className="badge badge-live"><span className="dot"></span>مباشر</span>
          </span>
        ) : null}
      </div>
      <div className="match-center">
        <div className={`team home${homeWin ? " winner" : ""}`}>
          <span className="name">{homeName}</span>
        </div>
        {hasScore ? (
          <div className="score">
            {String(homeScore ?? 0)}
            <span className="sep">-</span>
            {String(awayScore ?? 0)}
          </div>
        ) : (
          <div className="score pending">–</div>
        )}
        <div className={`team away${awayWin ? " winner" : ""}`}>
          <span className="name">{awayName}</span>
        </div>
      </div>
      {onClick ? <span className="match-go" aria-hidden="true">‹</span> : null}
    </Tag>
  );
}
