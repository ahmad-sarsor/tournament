// ============================================================================
//  Service Worker — يجعل المنصّة تعمل كتطبيق (تثبيت + عمل دون إنترنت)
//  الإستراتيجية:
//   • ملفّات الموقع (HTML/CSS/JS): الشبكة أولاً ثم المخزَّن (تظهر التحديثات فوراً)
//   • خطوط + Firebase SDK + الأيقونات: المخزَّن أولاً (ثابتة نادراً ما تتغيّر)
//   • بيانات Firestore/تسجيل الدخول: الشبكة فقط (لا تُخزَّن)
// ============================================================================
const VERSION = "tp-v1";
const SHELL = "shell-" + VERSION;
const RUNTIME = "runtime-" + VERSION;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./admin.html",
  "./manifest.webmanifest",
  "./assets/css/styles.css",
  "./assets/js/config.js",
  "./assets/js/firebase.js",
  "./assets/js/i18n.js",
  "./assets/js/util.js",
  "./assets/js/data.js",
  "./assets/js/render.js",
  "./assets/js/settings.js",
  "./assets/js/app.js",
  "./assets/js/admin.js",
  "./assets/js/seed-data.js",
  "./assets/img/icon-192.png",
  "./assets/img/icon-512.png",
  "./assets/img/apple-touch-icon.png",
];

const CACHE_FIRST_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "www.gstatic.com"];
const NEVER_CACHE_HOSTS = ["firestore.googleapis.com", "identitytoolkit.googleapis.com", "securetoken.googleapis.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (NEVER_CACHE_HOSTS.includes(url.hostname)) return; // بيانات حيّة: الشبكة كما هي

  // ملفّات ثابتة من CDN: المخزَّن أولاً
  if (CACHE_FIRST_HOSTS.includes(url.hostname)) {
    e.respondWith(cacheFirst(req));
    return;
  }

  // نفس المصدر (ملفّات الموقع): الشبكة أولاً ثم المخزَّن
  if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req));
  }
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) (await caches.open(RUNTIME)).put(req, res.clone());
    return res;
  } catch (e) {
    return cached || Response.error();
  }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) (await caches.open(SHELL)).put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await caches.match(req);
    if (cached) return cached;
    // احتياط للتنقّل: أعِد الصفحة الرئيسية من المخزَّن
    if (req.mode === "navigate") return (await caches.match("./index.html")) || Response.error();
    return Response.error();
  }
}
