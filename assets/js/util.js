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

// إشعار عابر + منطقة حيّة للقارئات الشاشية
let toastHost, liveRegion;
export function toast(message, type = "") {
  if (!toastHost) {
    toastHost = el("div.toast-host");
    document.body.appendChild(toastHost);
  }
  if (!liveRegion) {
    liveRegion = el("div.sr-only", { "aria-live": "polite", "aria-atomic": "true" });
    document.body.appendChild(liveRegion);
  }
  liveRegion.textContent = message; // إعلان مختصر للقارئات الشاشية
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

// نافذة منبثقة — تُعيد دالة إغلاق. onDismiss يُستدعى عند الإغلاق بـ Escape/الخلفية/×
export function openModal({ title, body, footer, onDismiss }) {
  const prevFocus = document.activeElement;
  const titleId = "modal-title-" + (++modalUid);
  let closed = false;

  const close = () => {
    if (closed) return; closed = true;
    const si = modalStack.indexOf(close);
    if (si >= 0) modalStack.splice(si, 1);
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
    if (prevFocus && typeof prevFocus.focus === "function") prevFocus.focus();
  };
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
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener("keydown", onKey);
  modalStack.push(close);
  document.body.appendChild(backdrop);

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
    const close = openModal({
      title: "تأكيد",
      body: el("p", { text: message }),
      onDismiss: () => { if (!settled) { settled = true; resolve(false); } },
      footer: [
        el("button.btn" + (danger ? ".btn-danger" : ".btn-primary"), { type: "button", text: confirmText, onclick: () => done(true) }),
        el("button.btn.btn-outline", { type: "button", text: cancelText, onclick: () => done(false) }),
      ],
    });
  });
}

export function spinner() { return el("div.spinner", { "aria-label": "جارٍ التحميل" }); }

export function emptyState(icon, text) {
  return el("div.empty", {}, [el("div.icon", { text: icon }), el("div", { text })]);
}
