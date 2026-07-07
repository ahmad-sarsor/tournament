import React from "react";

/** بطاقة بطولة — اسم + شارة حالة + وصف + بيانات + شريط تقدّم */
export function TournamentCard({
  name,
  emoji = "🏆",
  description,
  status = "active",
  meta = [],
  done,
  total,
  onClick,
}) {
  const pct = total ? Math.round(((done ?? 0) / total) * 100) : 0;
  const statusLabels = { upcoming: "قادمة", active: "جارية", finished: "منتهية" };
  return (
    <a className="t-card" onClick={onClick}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
        <h3><span className="t-emoji">{emoji}</span>{name}</h3>
        <span className={`badge badge-${status}`}>{statusLabels[status] || status}</span>
      </div>
      {description ? <p className="meta" style={{ marginTop: "6px" }}>{description}</p> : null}
      {meta.length ? (
        <div className="meta">
          {meta.map((m, i) => <span key={i} dir="auto" style={{ whiteSpace: "nowrap" }}>{m}</span>)}
        </div>
      ) : null}
      {total ? (
        <div className="t-progress">
          <div className="bar"><i style={{ width: pct + "%" }}></i></div>
          <div className="lbl">{done} / {total} مباراة</div>
        </div>
      ) : null}
    </a>
  );
}
