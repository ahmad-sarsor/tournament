// ============================================================================
//  مُزيل ذاتي (kill-switch): يُلغي أي Service Worker سابق ويمسح مخزّنه،
//  لأنه كان يسبّب عرض نسخ قديمة أثناء التطوير. التثبيت على الآيفون يبقى
//  يعمل عبر manifest دون الحاجة إليه.
// ============================================================================
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((c) => c.navigate(c.url)); // إعادة تحميل لجلب أحدث نسخة
    } catch (e) { /* تجاهل */ }
  })());
});

// لا نعترض الطلبات إطلاقاً — كل شيء يذهب للشبكة مباشرة
