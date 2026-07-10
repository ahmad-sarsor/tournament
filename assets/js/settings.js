// ============================================================================
//  الإعدادات: المظهر (تلقائي/فاتح/داكن) + حجم الخطّ + تثبيت التطبيق
//  تُطبَّق فوراً وتُحفظ في المتصفّح.
// ============================================================================
import { el, openModal, toast } from "./util.js";
import { t } from "./i18n.js";
import { createSuggestion } from "./data.js";

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
  if (meta) meta.setAttribute("content", dark ? "#0a1120" : "#2f6bff");
}

// دعم تثبيت التطبيق
let deferredPrompt = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; });
}

export function openSettings({ isAdmin = false, session = null, onSignOut = null } = {}) {
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
  if (!isAdmin) footer.push(el("button.btn.btn-outline.btn-block", { type: "button", text: "💡 " + t.suggestBox, onclick: openSuggestionModal }));
  // مسجَّل الدخول: عرض هويته + زر تسجيل الخروج
  if (session && onSignOut) {
    // (D7) حساب اسم المستخدم بلا بريد: نعرض اسمه لا البريد الاصطناعي القبيح
    const email = session.user?.email || "";
    const synthetic = email.endsWith("@no-email.tournament.local");
    const label = synthetic
      ? (session.user?.displayName || "@" + email.split("@")[0])
      : (email || session.user?.displayName || "");
    footer.push(el("div.set-hint", { style: "text-align:center;margin-top:6px", text: label }));
    footer.push(el("button.btn.btn-outline.btn-block", {
      type: "button", text: "🚪 " + t.logout,
      onclick: async () => { try { await onSignOut(); } catch {} },
    }));
  }

  openModal({
    title: "⚙️ " + t.settings,
    body: el("div", {}, [
      ...rows,
      el("p.set-hint", { text: t.settingsHint }),
      ...(footer.length ? [el("div", { style: "margin-top:14px" }, footer)] : []),
    ]),
  });
}

// نافذة صندوق الاقتراحات (متاحة لأي زائر) — تُخزَّن في Firestore ويطّلع عليها المدير
export function openSuggestionModal() {
  const name = el("input.input", { type: "text", maxlength: "80", placeholder: t.suggestNamePlaceholder, autocomplete: "name" });
  const text = el("textarea.input", { rows: "5", maxlength: "1000", required: true, placeholder: t.suggestTextPlaceholder });
  const err = el("div.alert.alert-error", { hidden: true, role: "alert" });
  const send = el("button.btn.btn-primary.btn-block", { type: "submit", text: t.suggestSend });

  const form = el("form", {}, [
    el("div.field", {}, [el("label", { text: t.suggestName }), name]),
    el("div.field", {}, [el("label", { text: t.suggestText }), text]),
    err, send,
  ]);

  const close = openModal({ title: "💡 " + t.suggestBox, body: form });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const val = text.value.trim();
    if (!val) { err.hidden = false; err.textContent = t.suggestEmpty; return; }
    err.hidden = true; send.disabled = true; send.textContent = t.loading;
    try {
      await createSuggestion({ text: val, name: name.value.trim() || undefined, context: location.hash || undefined });
      close();
      toast(t.suggestThanks, "ok");
    } catch (err2) {
      console.error(err2);
      err.hidden = false; err.textContent = t.suggestError;
      send.disabled = false; send.textContent = t.suggestSend;
    }
  });
}

// تحديث لون الشريط عند تغيّر تفضيل النظام (وضع تلقائي)
if (typeof window !== "undefined" && window.matchMedia) {
  try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeColor); } catch {}
}
