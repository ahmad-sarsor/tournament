import React from "react";

/** قائمة منسدلة للتصفية — «كل البيوت / كل الفرق / كل الأيام» */
export function Select({ options = [], value, onChange, ...rest }) {
  return (
    <select
      className="select filter-select"
      value={value}
      onChange={(e) => onChange && onChange(e.target.value)}
      {...rest}
    >
      {options.map((o) => {
        const opt = typeof o === "string" ? { value: o, label: o } : o;
        return (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        );
      })}
    </select>
  );
}
