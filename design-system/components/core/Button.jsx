import React from "react";

/** زر المنصّة — الأساسي «قابل للكبس» بظل صلب */
export function Button({ variant = "default", size, block, children, ...rest }) {
  const cls = [
    "btn",
    variant === "primary" && "btn-primary",
    variant === "sun" && "btn-sun",
    variant === "outline" && "btn-outline",
    variant === "danger" && "btn-danger",
    size === "sm" && "btn-sm",
    block && "btn-block",
  ].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}
