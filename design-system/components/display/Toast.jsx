import React from "react";

/** إشعار عائم (Toast) — كبسولة داكنة، أو خضراء ok / حمراء err */
export function Toast({ kind, children }) {
  return (
    <div className={`toast${kind ? " " + kind : ""}`}>{children}</div>
  );
}
