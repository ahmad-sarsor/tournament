// ============================================================================
//  الإعدادات — ضع هنا بيانات مشروع Firebase الخاص بك
//  Configuration — put your Firebase project credentials here.
//
//  من لوحة Firebase:
//    Project settings (⚙️) → General → "Your apps" → Web app (</>)
//    انسخ كائن firebaseConfig وألصقه هنا بالكامل.
//
//  ملاحظة: هذه القيم علنيّة وآمنة للنشر على GitHub — الحماية عبر
//  "قواعد الأمان" في ملف firestore.rules (لا كتابة بدون تسجيل دخول).
// ============================================================================

export const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

// اسم المنصّة (يظهر في الرأس)
export const SITE_NAME = "منصّة البطولات";
