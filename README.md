# 🏆 منصّة إدارة البطولات — Tournament Platform

אתר לניהול טורנירים (בערבית, RTL) — לוח משחקים + טבלאות דירוג שמתעדכנות אוטומטית, פאנל ניהול להזנת תוצאות, ותמיכה בכמה טורנירים.
מתארח **חינם** ב‑GitHub Pages, עם **Firebase (Firestore + Authentication)** כמסד נתונים חינמי.

> אין צורך בשלב build. זה אתר סטטי טהור (HTML/CSS/JS) — עולה ישירות ל‑GitHub Pages.

---

## מבנה הקבצים

| קובץ | תיאור |
|------|-------|
| `index.html` | האתר הציבורי — רשימת טורנירים, לוח משחקים, דירוג (עדכון חי) |
| `admin.html` | פאנל ניהול — התחברות, הזנת תוצאות, ניהול טורנירים/בתים/פרקים |
| `assets/js/config.js` | **כאן מדביקים את פרטי Firebase** |
| `firestore.rules` | חוקי אבטחה — קריאה לכולם, כתיבה רק למנהל (לפי אימייל) |
| `assets/` | שאר קוד ה‑CSS/JS (הנתונים של האקסל שמורים ב‑`seed-data.js`) |

---

## התקנה — שלב אחר שלב

### 1) יצירת פרויקט Firebase (חינם)

1. היכנס ל‑<https://console.firebase.google.com> → **Add project** → תן שם (למשל `tournament`) → אפשר לכבות Google Analytics.
2. בתפריט הצד: **Build → Firestore Database** → **Create database** → בחר **Production mode** → בחר location קרוב (למשל `eur3`) → Enable.
3. בתפריט הצד: **Build → Authentication** → **Get started** → בכרטיסייה **Sign-in method** הפעל את **Email/Password** → Save.

### 2) יצירת משתמש מנהל

1. ב‑**Authentication → Users → Add user** → הזן **אימייל + סיסמה** של המנהל → Add user.
2. זכור את האימייל הזה — צריך אותו בשלב הבא (חוקי האבטחה) וגם כדי להתחבר ל‑`admin.html`.

### 3) הגדרת חוקי האבטחה (חשוב לאבטחה!)

1. פתח את הקובץ [`firestore.rules`](firestore.rules) והחלף את `admin@example.com` **באימייל המנהל שיצרת** (אפשר כמה, מופרדים בפסיק):
   ```
   function adminEmails() {
     return ['ahmad.kefah11sar@gmail.com'];   // ← האימייל שלך
   }
   ```
2. ב‑Firebase → **Firestore Database → Rules** → הדבק את כל תוכן הקובץ → **Publish**.

> 🔒 **למה זה קריטי:** בלי זה, כל מי שיצליח ליצור חשבון יוכל למחוק את כל הנתונים. החוקים מתירים כתיבה **רק** לאימייל/ים ברשימה, ולכן פרטי Firebase שב‑`config.js` בטוחים לפרסום ב‑GitHub.

### 4) חיבור האתר ל‑Firebase

1. ב‑Firebase → **Project settings** (⚙️) → תחת **Your apps** לחץ על אייקון הweb **`</>`** → תן כינוי → Register app.
2. יוצג לך אובייקט `firebaseConfig`. העתק את הערכים והדבק ב‑[`assets/js/config.js`](assets/js/config.js):
   ```js
   export const firebaseConfig = {
     apiKey:            "AIza…",
     authDomain:        "tournament-xxxx.firebaseapp.com",
     projectId:         "tournament-xxxx",
     storageBucket:     "tournament-xxxx.appspot.com",
     messagingSenderId: "1234567890",
     appId:             "1:1234567890:web:abcd…",
   };
   export const SITE_NAME = "منصّة البطولات";   // אפשר לשנות את שם האתר
   ```

### 5) העלאה ל‑GitHub Pages (הריפו שלך: `ahmad-sarsor/tournament`)

**דרך A — דרך הדפדפן (בלי git, הכי פשוט):**
1. פתח <https://github.com/ahmad-sarsor/tournament> → **Add file → Upload files**.
2. גרור את **כל** התוכן של תיקיית הפרויקט (index.html, admin.html, assets/, firestore.rules, README.md) → **Commit changes**.
3. **Settings → Pages** → *Deploy from a branch* → ענף `main`, תיקייה `/ (root)` → **Save**.
4. אחרי דקה האתר יהיה זמין ב: **`https://ahmad-sarsor.github.io/tournament/`**
   - פאנל הניהול: `https://ahmad-sarsor.github.io/tournament/admin.html`

**דרך B — דרך git (אם מותקן git):**
```bash
git init
git add .
git commit -m "منصة البطولات"
git branch -M main
git remote add origin https://github.com/ahmad-sarsor/tournament.git
git push -u origin main
```
ואז Settings → Pages כמו בשלב 3.

### 6) הרשאת הדומיין ב‑Firebase (אם ההתחברות לא עובדת)
ב‑Firebase → **Authentication → Settings → Authorized domains** → **Add domain** → הוסף `ahmad-sarsor.github.io`.

### 7) טעינת הטורניר מהאקסל
היכנס ל‑`admin.html` → התחבר → לחץ **«تحميل بطولة تجريبية»**. זה יוצר את «بطولة الأحياء» עם כל 19 הקבוצות ו‑36 המשחקים מהאקסל. (או צור טורניר חדש מאפס עם **«بطولة جديدة»**.)

---

## שימוש

- **צופים**: נכנסים לכתובת הראשית → בוחרים טורניר → מדפדפים בין **البرنامج** (לוח) ל‑**الترتيب** (דירוג). תוצאות מתעדכנות **חי** בלי לרענן.
- **מנהל** (`admin.html`):
  - **הזנת תוצאה**: כפתור «إدخال النتيجة» ליד כל משחק → הדירוג מתעדכן אוטומטית.
  - **ניהול**: יצירה/עריכה של טורנירים, בתים (مجموعات), קבוצות ומשחקים.
  - **توليد المباريات تلقائياً**: מחולל ליגה מלאה (כל אחד נגד כולם) בכל בית — ומדלג על משחקים שכבר קיימים (בלי כפילויות).

---

## איך הדירוג מחושב
- ניצחון = `win_points` (ברירת מחדל 3), תיקו = `draw_points` (1), הפסד = 0 — ניתן לשינוי לכל טורניר.
- נספרים **רק משחקים שסומנו «منتهية» עם תוצאה**.
- **סדר הדירוג**: נקודות → הפרש שערים → שערים שהובקעו → מפגש ישיר → שם.
- מספר המתאهّلים המודגשים לכל בית: השדה `عدد المتأهّلين من كل بيت` (ברירת מחדל 2).

## התאמה אישית
- **שם האתר**: `SITE_NAME` ב‑`config.js`.
- **צבעים/עיצוב**: משתני CSS בראש [`assets/css/styles.css`](assets/css/styles.css) (למשל `--brand`).
- **טקסטים**: כל המחרוזות מרוכזות ב‑[`assets/js/i18n.js`](assets/js/i18n.js).

## פתרון תקלות

| בעיה | פתרון |
|------|-------|
| «المنصّة غير مُهيّأة» | לא מולא `firebaseConfig` ב‑`config.js` (שלב 4). |
| התחברות נכשלת / `auth/...` | ודא ש‑Email/Password מופעל (שלב 1.3) ושהדומיין מורשה (שלב 6). |
| הזנת תוצאה נכשלת (`permission-denied`) | האימייל שלך לא ברשימה ב‑`firestore.rules`, או שהחוקים לא פורסמו (שלב 3). |
| הדירוג לא מתעדכן | ודא שהמשחק סומן **«منتهية»** ויש תוצאה לשני הצדדים. |

---

<div dir="rtl" lang="ar">

## بالعربية (باختصار)
منصّة لإدارة البطولات: البرنامج + جداول الترتيب تُحدَّث تلقائياً، ولوحة إدارة لإدخال النتائج.
الإعداد: أنشئ مشروع Firebase، فعّل Firestore و Authentication (Email/Password)، أنشئ مستخدم مدير، ضع بريده في `firestore.rules` وانشر القواعد، ثم ألصق `firebaseConfig` في `assets/js/config.js`، وانشر المجلد على GitHub Pages. بعدها من لوحة الإدارة اضغط «تحميل بطولة تجريبية». التفاصيل بالأعلى.

</div>
