// ============================================================================
//  الإعدادات — بيانات مشروع Firebase (علنيّة وآمنة للنشر؛ الحماية عبر firestore.rules)
//  Configuration — Firebase project credentials.
// ============================================================================

export const firebaseConfig = {
  apiKey:            "AIzaSyBDq_sFXKJDVh_S34iVxW1ymotq3Ki1-uM",
  authDomain:        "tournament-8cd0a.firebaseapp.com",
  projectId:         "tournament-8cd0a",
  storageBucket:     "tournament-8cd0a.firebasestorage.app",
  messagingSenderId: "160237416206",
  appId:             "1:160237416206:web:101e67423fd6430a42b15f",
  measurementId:     "G-1QP0E5RKL1",
};

// اسم المنصّة (يظهر في الرأس)
export const SITE_NAME = "منصّة البطولات";

// بريد/بُرد «المالك»: الوحيد القادر على تعيين/إزالة المدراء (يطابق ownerEmails في firestore.rules)
export const OWNER_EMAILS = ["ahmad.kefah11sar@gmail.com"];

// ---- توثيق هاتف المتوقّعين (OTP عبر SMS) -----------------------------------
// رمز الدولة الافتراضي لتحويل الأرقام المحلية (05xxxxxxxx) إلى الصيغة الدولية
export const PHONE_DEFAULT_CC = "+972";
// "auto": يُستخدم توثيق الهاتف متى كان مزوّد Phone مفعّلاً في Firebase Authentication،
//         ويتراجع تلقائياً للتسجيل المجهول إن لم يكن مفعّلاً (لا يكسر الموقع).
// "off":  تعطيل توثيق الهاتف كلياً (الوضع القديم — تسجيل مجهول فقط).
export const PHONE_OTP = "auto";

// ---- App Check (حماية من السبام واستنزاف الحصّة) ----------------------------
// مفتاح موقع reCAPTCHA v3 من Firebase Console → App Check → تسجيل تطبيق الويب.
// اتركه فارغاً حتى تُسجّل الموقع (التفعيل الفعلي للفرض يتمّ من الكونسول لاحقاً).
export const APP_CHECK_SITE_KEY = "";
