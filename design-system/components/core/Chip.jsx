import React from "react";

/** رقاقة تصفية (فلتر) — تُستخدم في صفوف الفلاتر فوق البرنامج والترتيب */
export function Chip({ active, children, ...rest }) {
  return (
    <button type="button" className={`chip${active ? " active" : ""}`} {...rest}>
      {children}
    </button>
  );
}
