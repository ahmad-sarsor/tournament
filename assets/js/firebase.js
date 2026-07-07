// ============================================================================
//  تهيئة Firebase — تُحمّل من CDN كوحدات ES (لا حاجة لأي بناء/تجميع)
// ============================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app-check.js";
import { firebaseConfig, APP_CHECK_SITE_KEY } from "./config.js";

// هل تمّت تهيئة الإعدادات فعلاً؟
export const isConfigured =
  !!firebaseConfig &&
  typeof firebaseConfig.apiKey === "string" &&
  firebaseConfig.apiKey.length > 10 &&
  !firebaseConfig.apiKey.includes("YOUR_") &&
  typeof firebaseConfig.projectId === "string" &&
  !firebaseConfig.projectId.includes("YOUR_");

let app = null, db = null, auth = null;
if (isConfigured) {
  app = initializeApp(firebaseConfig);
  // App Check (اختياري): يعمل فقط بعد وضع مفتاح reCAPTCHA v3 في config.js.
  // الفرض (Enforcement) يُفعَّل لاحقاً من الكونسول بعد التأكد من سلامة المقاييس.
  if (APP_CHECK_SITE_KEY) {
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (e) { console.warn("App Check init failed:", e); }
  }
  db = getFirestore(app);
  auth = getAuth(app);
}

export { app, db, auth };
