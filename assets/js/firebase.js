// ============================================================================
//  تهيئة Firebase — تُحمّل من CDN كوحدات ES (لا حاجة لأي بناء/تجميع)
// ============================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { firebaseConfig } from "./config.js";

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
  db = getFirestore(app);
  auth = getAuth(app);
}

export { app, db, auth };
