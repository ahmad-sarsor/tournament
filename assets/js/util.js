// ============================================================================
//  أدوات مساعدة عامة: بناء عناصر DOM، الهروب من النصوص، الإشعارات، النوافذ
// ============================================================================

// إنشاء عنصر: el("div.card#id", { onclick }, [children])
export function el(spec, props = {}, children = []) {
  const [tagAndId, ...classes] = spec.split(".");
  const [tag, id] = tagAndId.split("#");
  const node = document.createElement(tag || "div");
  if (id) node.id = id;
  if (classes.length) node.className = classes.join(" ");
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in node && k !== "list") { try { node[k] = v; } catch { node.setAttribute(k, v); } }
    else node.setAttribute(k, v);
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  const arr = Array.isArray(children) ? children : [children];
  for (const c of arr) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

export function mount(node, ...children) { clear(node); appendChildren(node, children); return node; }

// الهروب من النصوص لمنع حقن HTML (تُستخدم فقط عند بناء innerHTML)
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// إشعار عابر + منطقتا إعلان للقارئات: polite للعادي وalert للأخطاء (E10)
let toastHost, liveRegion, alertRegion;
export function toast(message, type = "") {
  if (!toastHost) {
    toastHost = el("div.toast-host");
    document.body.appendChild(toastHost);
  }
  if (!liveRegion) {
    liveRegion = el("div.sr-only", { "aria-live": "polite", "aria-atomic": "true" });
    document.body.appendChild(liveRegion);
  }
  if (!alertRegion) {
    alertRegion = el("div.sr-only", { role: "alert", "aria-atomic": "true" });
    document.body.appendChild(alertRegion);
  }
  // الأخطاء تُعلن بإلحاح (role=alert) كي لا تُبتلع أثناء انشغال القارئ
  (type === "err" ? alertRegion : liveRegion).textContent = message;
  const node = el("div.toast" + (type ? "." + type : ""), { text: message });
  toastHost.appendChild(node);
  setTimeout(() => {
    node.style.transition = "opacity .3s";
    node.style.opacity = "0";
    setTimeout(() => node.remove(), 300);
  }, 2600);
}

const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';
let modalUid = 0;
const modalStack = []; // النوافذ المتراكمة — فقط العليا تستجيب للوحة المفاتيح

// (E6) قفل تمرير الصفحة وعزل الخلفية عن القارئات ما دامت نافذة مفتوحة
let bodyOverflowPrev = "";
function setBackgroundLocked(locked) {
  if (locked) {
    bodyOverflowPrev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = bodyOverflowPrev;
  }
  for (const sel of ["#app", ".site-header", ".site-footer"]) {
    const n = document.querySelector(sel);
    if (!n) continue;
    if (locked) n.setAttribute("inert", "");
    else n.removeAttribute("inert");
  }
}

// (D3) زر الرجوع على الجوال يغلق النافذة العليا بدل هدم الصفحة:
// كل نافذة تدفع إدخال history، والرجوع يُغلقها؛ الإغلاق البرمجي يستهلك الإدخال بصمت.
let popHooked = false, suppressPop = 0;
const popClosers = new Map(); // close -> viaPop()
function hookPopstate() {
  if (popHooked) return;
  popHooked = true;
  window.addEventListener("popstate", () => {
    if (suppressPop > 0) { suppressPop--; return; }
    const top = modalStack[modalStack.length - 1];
    const viaPop = top && popClosers.get(top);
    if (viaPop) viaPop();
  });
}

// نافذة منبثقة — تُعيد دالة إغلاق. onDismiss يُستدعى عند الإغلاق بـ Escape/الخلفية/×/رجوع
export function openModal({ title, body, footer, onDismiss }) {
  const prevFocus = document.activeElement;
  const titleId = "modal-title-" + (++modalUid);
  let closed = false, pushedState = false;

  const closeImpl = (fromPop) => {
    if (closed) return; closed = true;
    const si = modalStack.indexOf(close);
    if (si >= 0) modalStack.splice(si, 1);
    popClosers.delete(close);
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
    if (!modalStack.length) setBackgroundLocked(false);
    // نستهلك إدخال history الخاص بنا عند الإغلاق البرمجي (لا عند القدوم من زر الرجوع)
    if (pushedState && !fromPop) { suppressPop++; try { history.back(); } catch {} }
    if (prevFocus && typeof prevFocus.focus === "function") { try { prevFocus.focus(); } catch {} }
  };
  const close = () => closeImpl(false);
  const dismiss = () => { const wasClosed = closed; close(); if (!wasClosed) onDismiss?.(); };

  const dialog = el("div.modal", { role: "dialog", "aria-modal": "true", "aria-labelledby": titleId }, [
    el("div.modal-head", {}, [
      el("h3", { id: titleId, text: title }),
      el("button.icon-btn", { text: "×", "aria-label": "إغلاق", type: "button", onclick: dismiss }),
    ]),
    el("div.modal-body", {}, [body]),
    footer ? el("div.modal-foot", {}, footer) : null,
  ]);
  const backdrop = el("div.modal-backdrop", {
    onclick: (e) => { if (e.target === backdrop) dismiss(); },
  }, [dialog]);

  const onKey = (e) => {
    if (modalStack[modalStack.length - 1] !== close) return; // فقط النافذة العليا تتفاعل
    if (e.key === "Escape") { e.preventDefault(); dismiss(); return; }
    if (e.key === "Tab") {
      const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      // إن هرب التركيز خارج الحوار نعيده لأوله (E6-د)
      if (!dialog.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener("keydown", onKey);
  if (!modalStack.length) setBackgroundLocked(true);
  modalStack.push(close);
  document.body.appendChild(backdrop);

  // تكامل زر الرجوع (الجوال): إدخال history لهذه النافذة
  hookPopstate();
  try {
    history.pushState({ tpModal: titleId }, "");
    pushedState = true;
    popClosers.set(close, () => { const was = closed; closeImpl(true); if (!was) onDismiss?.(); });
  } catch {}

  // ننقل التركيز: أول حقل، وإلا زر الإجراء الرئيسي، وإلا أول عنصر قابل للتركيز
  const firstField = dialog.querySelector("input,select,textarea") ||
    dialog.querySelector(".modal-foot .btn-primary, .modal-foot .btn-danger") ||
    dialog.querySelector(FOCUSABLE);
  if (firstField) firstField.focus();

  return close;
}

// تأكيد بسيط (Promise<boolean>) — الإغلاق بـ Escape/الخلفية = إلغاء
export function confirmDialog(message, { danger = true, confirmText = "تأكيد", cancelText = "إلغاء" } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; close(); resolve(v); };
    const cancelBtn = el("button.btn.btn-outline", { type: "button", text: cancelText, onclick: () => done(false) });
    const close = openModal({
      title: "تأكيد",
      body: el("p", { text: message }),
      onDismiss: () => { if (!settled) { settled = true; resolve(false); } },
      footer: [
        el("button.btn" + (danger ? ".btn-danger" : ".btn-primary"), { type: "button", text: confirmText, onclick: () => done(true) }),
        cancelBtn,
      ],
    });
    // (E6-أ) في حوارات الحذف يبدأ التركيز على «إلغاء» — Enter عفوي لا يحذف
    if (danger) { try { cancelBtn.focus(); } catch {} }
  });
}

// تنزيل جدول كملف CSV (مع BOM كي تفتح Excel العربية بترميز صحيح). rows = مصفوفة صفوف، كل صفّ مصفوفة خلايا.
export function downloadCsv(filename, rows) {
  const cell = (v) => {
    let s = String(v ?? "");
    // تحييد حقن الصيغ (Formula/CSV Injection): خليّة تبدأ بمحرف صيغة تُسبَق بعلامة اقتباس مفردة
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename, style: "display:none" });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

export function spinner() { return el("div.spinner", { role: "status", "aria-label": "جارٍ التحميل" }); }

export function emptyState(icon, text) {
  return el("div.empty", {}, [el("div.icon", { text: icon }), el("div", { text })]);
}
