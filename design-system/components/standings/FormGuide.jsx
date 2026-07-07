import React from "react";

/** دليل الأداء — آخر ٥ نتائج كمربعات ملوّنة ف/ت/خ */
export function FormGuide({ results = [] }) {
  const label = { w: "ف", d: "ت", l: "خ" };
  return (
    <span className="form-guide">
      {results.map((r, i) => (
        <span key={i} className={`form-dot ${r}`}>{label[r] || "؟"}</span>
      ))}
    </span>
  );
}
