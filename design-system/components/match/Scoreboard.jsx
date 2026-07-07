import React from "react";

/** لوحة نتيجة كبيرة متدرّجة الأزرق — رأس صفحة المباراة (mp-scoreboard) */
export function Scoreboard({
  homeName,
  awayName,
  homeScore,
  awayScore,
  live,
  minute,
  time,
  homeEmoji = "⚽",
  awayEmoji = "⚽",
}) {
  const hasScore = homeScore != null && awayScore != null;
  return (
    <div className={`mp-scoreboard${live ? " is-live" : ""}`}>
      <div className="mp-team">
        <div className="mp-team-badge">{homeEmoji}</div>
        <div className="mp-team-name">{homeName}</div>
      </div>
      <div>
        {hasScore ? (
          <div className="mp-score">
            {String(homeScore)}
            <span className="sep">-</span>
            {String(awayScore)}
          </div>
        ) : (
          <div className="mp-score time">{time || "×"}</div>
        )}
        {live ? (
          <div className="mp-minute">
            <span className="badge badge-live">
              <span className="dot"></span>
              {minute != null ? `مباشر · ${minute}'` : "مباشر"}
            </span>
          </div>
        ) : null}
      </div>
      <div className="mp-team">
        <div className="mp-team-badge">{awayEmoji}</div>
        <div className="mp-team-name">{awayName}</div>
      </div>
    </div>
  );
}
