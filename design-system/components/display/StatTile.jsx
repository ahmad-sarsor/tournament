import React from "react";

/** مربّع إحصائية — رقم كبير بخط العرض فوق تسمية صغيرة */
export function StatTile({ icon, value, label }) {
  return (
    <div className="stat-tile">
      {icon ? <div className="stat-ico">{icon}</div> : null}
      <div className="stat-val">{value}</div>
      <div className="stat-lbl">{label}</div>
    </div>
  );
}
