// ============================================================================
//  الإعدادات: المظهر (تلقائي/فاتح/داكن) + حجم الخطّ + تثبيت التطبيق
//  تُطبَّق فوراً وتُحفظ في المتصفّح.
// ============================================================================
import { el, openModal } from "./util.js";
import { t } from "./i18n.js";

const KEY_THEME = "tp_theme";     // auto | light | dark
const KEY_FONT = "tp_fontscale";  // 0.9 | 1 | 1.12 | 1.25

// حجم الخطّ: ١٠ مستويات (١ الأصغر … ١٠ الأكبر)، والافتراضي المستوى ٣
const FONT_SCALES = ["0.72", "0.8", "0.88", "0.96", "1.05", "1.15", "1.26", "1.38", "1.5", "1.65"];
const DEFAULT_FONT = FONT_SCALES[2]; // المستوى ٣

export function getTheme() { try { return localStorage.getItem(KEY_THEME) || "auto"; } catch { return "auto"; } }
export function getFont() { try { return localStorage.getItem(KEY_FONT) || DEFAULT_FONT; } catch { return DEFAULT_FONT; } }

export function applyPrefs() {
  const theme = getTheme();
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.setProperty("--font-scale", getFont());
  syncThemeColor();
}

function syncThemeColor() {
  // نُحدّث لون شريط المتصفّح حسب المظهر الفعلي
  const dark = document.documentElement.getAttribute("data-theme") === "dark" ||
    (getTheme() === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#0a0f1c" : "#2563eb");
}

// دعم تثبيت التطبيق
let deferredPrompt = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; });
}

export function openSettings({ isAdmin = false } = {}) {
  const seg = (options, current, onPick) => {
    const wrap = el("div.seg");
    options.forEach((o) => {
      const b = el("button.seg-btn" + (o.value === current ? ".active" : ""), {
        type: "button", text: o.label,
        onclick: () => { [...wrap.children].forEach((c) => c.classList.toggle("active", c === b)); onPick(o.value); },
      });
      wrap.appendChild(b);
    });
    return wrap;
  };

  const themeSeg = seg(
    [{ value: "auto", label: t.themeAuto }, { value: "light", label: t.themeLight }, { value: "dark", label: t.themeDark }],
    getTheme(),
    (v) => { try { localStorage.setItem(KEY_THEME, v); } catch {} applyPrefs(); }
  );

  const fontSeg = seg(
    FONT_SCALES.map((v, i) => ({ value: v, label: String(i + 1) })),
    getFont(),
    (v) => { try { localStorage.setItem(KEY_FONT, v); } catch {} applyPrefs(); }
  );
  fontSeg.classList.add("seg-nums");

  const rows = [
    el("div.set-row", {}, [el("div.set-label", { text: t.appearance }), themeSeg]),
    el("div.set-row.set-row-col", {}, [
      el("div.set-label", {}, [t.fontSize, el("span.set-sub", { text: " (١ الأصغر · ١٠ الأكبر)" })]),
      fontSeg,
    ]),
  ];

  // زرّ التثبيت (يظهر فقط إن كان المتصفّح يدعمه)
  if (deferredPrompt) {
    rows.push(el("div.set-row", {}, [
      el("div.set-label", { text: t.installApp }),
      el("button.btn.btn-primary.btn-sm", { type: "button", text: "⬇ " + t.installApp, onclick: async () => {
        const p = deferredPrompt; deferredPrompt = null;
        try { await p.prompt(); } catch {}
      } }),
    ]));
  }

  const footer = [];
  if (!isAdmin) footer.push(el("a.btn.btn-outline.btn-block", { href: "./admin.html", text: "🔒 " + t.organizerPanel }));

  openModal({
    title: "⚙️ " + t.settings,
    body: el("div", {}, [
      ...rows,
      el("p.set-hint", { text: t.settingsHint }),
      ...(footer.length ? [el("div", { style: "margin-top:14px" }, footer)] : []),
    ]),
  });
}

// تحديث لون الشريط عند تغيّر تفضيل النظام (وضع تلقائي)
if (typeof window !== "undefined" && window.matchMedia) {
  try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeColor); } catch {}
}
