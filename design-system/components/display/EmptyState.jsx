import React from "react";

/** حالة فارغة — إيموجي كبير + رسالة (📅 لا مباريات، 🎯 لا مشاركين…) */
export function EmptyState({ icon = "📅", children }) {
  return (
    <div className="empty">
      <div className="icon">{icon}</div>
      <div>{children}</div>
    </div>
  );
}
