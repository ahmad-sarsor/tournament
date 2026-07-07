import React from "react";

const LABELS = { upcoming: "قادمة", active: "جارية", finished: "منتهية", live: "مباشر" };

/** شارة حالة — بطولة (قادمة/جارية/منتهية) أو مباراة مباشرة (نابضة) أو ذهبية */
export function Badge({ status = "upcoming", children, dot }) {
  const showDot = dot ?? status === "live";
  return (
    <span className={`badge badge-${status}`}>
      {showDot ? <span className="dot"></span> : null}
      {children ?? LABELS[status] ?? status}
    </span>
  );
}
