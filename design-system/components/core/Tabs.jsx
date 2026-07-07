import React from "react";

/** تبويبات مقسّمة (Segmented) — البرنامج / الترتيب / الفرق… */
export function Tabs({ items = [], active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => {
        const item = typeof it === "string" ? { id: it, label: it } : it;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active === item.id}
            className={`tab${active === item.id ? " active" : ""}`}
            onClick={() => onChange && onChange(item.id)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
