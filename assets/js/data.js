// ============================================================================
//  طبقة الوصول للبيانات (Firebase/Firestore) + حساب الترتيب + المصادقة + التوليد
//  الأسماء المُصدَّرة ثابتة كي تبقى بقية الواجهة كما هي.
// ============================================================================
import { db, auth } from "./firebase.js";
import { OWNER_EMAILS } from "./config.js";
import {
  collection, doc, getDoc, getDocs, query, where,
  addDoc, setDoc, updateDoc, deleteDoc, writeBatch, onSnapshot, increment,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile,
  signOut as fbSignOut, onAuthStateChanged,
  sendEmailVerification, sendPasswordResetEmail,
  GoogleAuthProvider, signInWithPopup,
  updatePassword, EmailAuthProvider, reauthenticateWithCredential,
  linkWithCredential, deleteUser,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { SAMPLE } from "./seed-data.js";

function requireDb() {
  if (!db) throw new Error("Firebase not configured");
  return db;
}

const mapDocs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

// يزيل الحقول undefined (Firestore يرفضها)؛ null مسموح
function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

// ترتيب المباريات: التاريخ ثم الوقت ثم sort_order (غير المجدولة في الآخر)
function byMatchOrder(a, b) {
  const da = a.match_date || "9999-99-99", dbb = b.match_date || "9999-99-99";
  if (da !== dbb) return da < dbb ? -1 : 1;
  const ta = a.match_time || "99:99", tb = b.match_time || "99:99";
  if (ta !== tb) return ta < tb ? -1 : 1;
  return (a.sort_order ?? 0) - (b.sort_order ?? 0);
}

// ---- القراءة (عامّة) -------------------------------------------------------

const byTournamentOrder = (a, b) =>
  (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
  String(b.start_date || "").localeCompare(String(a.start_date || ""));

export async function fetchTournaments() {
  const snap = await getDocs(collection(requireDb(), "tournaments"));
  return mapDocs(snap).sort(byTournamentOrder);
}

// التورنيرات المرتبطة بالبريد: يملكها، أو مدير فيها، أو مسجِّل نتائج فيها
export async function fetchMyTournaments(email) {
  const u = currentUser;
  if (!email && !u?.uid) return [];
  const d = requireDb();
  const low = (email && !isNoEmailAuthEmail(email)) ? String(email).toLowerCase() : "";
  // مفاتيح الطاقم: البريد و/أو اسم المستخدم (كلاهما مقبول في القوائم)
  const uname = (currentUserDoc?.id === u?.uid && currentUserDoc?.username) ? currentUserDoc.username : "";
  const staffKeys = [low, uname].filter(Boolean);
  const none = Promise.resolve({ docs: [] });
  const jobs = [
    low ? getDocs(query(collection(d, "tournaments"), where("owner_email", "==", low))) : none,
    u?.uid ? getDocs(query(collection(d, "tournaments"), where("owner_uid", "==", u.uid))) : none,
    ...staffKeys.map((k) => getDocs(query(collection(d, "tournaments"), where("admin_emails", "array-contains", k)))),
    ...staffKeys.map((k) => getDocs(query(collection(d, "tournaments"), where("scorer_emails", "array-contains", k)))),
  ];
  const snaps = await Promise.all(jobs);
  const byId = new Map();
  for (const s of snaps) for (const doc of mapDocs(s)) byId.set(doc.id, doc);
  return [...byId.values()].sort(byTournamentOrder);
}

export async function fetchTournament(id) {
  const cached = bundleCache.get(id);   // وثيقة البطولة تبقى محدَّثة عبر onSnapshot
  if (cached && cached.ready && cached.tournament) return { ...cached.tournament };
  const s = await getDoc(doc(requireDb(), "tournaments", id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

// كاش حيّ يُغذّيه subscribeTournament من الـ onSnapshot — يجنّبنا إعادة جلب كامل عند كل تغيير
const bundleCache = new Map(); // tid -> { groups, teams, matches, players, events, tournament, ready }
const cloneBundle = (c) => ({
  groups: [...(c.groups || [])], teams: [...(c.teams || [])], matches: [...(c.matches || [])],
  players: [...(c.players || [])], events: [...(c.events || [])],
});

export async function fetchTournamentBundle(tid) {
  const cached = bundleCache.get(tid);
  if (cached && cached.ready) return cloneBundle(cached);   // من الاشتراك الحيّ: صفر قراءات
  const d = requireDb();
  const [g, tm, mt, pl, ev] = await Promise.all([
    getDocs(query(collection(d, "groups"), where("tournament_id", "==", tid))),
    getDocs(query(collection(d, "teams"), where("tournament_id", "==", tid))),
    getDocs(query(collection(d, "matches"), where("tournament_id", "==", tid))),
    getDocs(query(collection(d, "players"), where("tournament_id", "==", tid))),
    getDocs(query(collection(d, "events"), where("tournament_id", "==", tid))),
  ]);
  return {
    groups: mapDocs(g).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    teams: mapDocs(tm).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    matches: mapDocs(mt).map(withLock).sort(byMatchOrder),
    players: mapDocs(pl).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    events: mapDocs(ev).sort(byEventOrder),
  };
}

// ترتيب الأحداث: حسب الدقيقة ثم وقت الإنشاء (بدون دقيقة => في الآخر)
export function byEventOrder(a, b) {
  const ma = a.minute == null ? 1e9 : a.minute;
  const mb = b.minute == null ? 1e9 : b.minute;
  if (ma !== mb) return ma - mb;
  return (a.created_at ?? 0) - (b.created_at ?? 0);
}

// ---- حساب الترتيب (دوال صرفة) ---------------------------------------------

export function isCounted(m) {
  return m.status === "finished" && m.home_score != null && m.away_score != null;
}

export function computeGroupStandings(teams, matches, points) {
  const P = { win: 3, draw: 1, loss: 0 };
  if (points) for (const k of ["win", "draw", "loss"]) if (points[k] != null) P[k] = points[k];
  const rows = new Map();
  for (const tm of teams) {
    rows.set(tm.id, { team: tm, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 });
  }

  // مباريات خروج المغلوب لا تُحتسب في ترتيب البيوت (قد يكون طرفاها من البيت نفسه فتُفسِد الجدول)
  const counted = matches.filter(
    (m) => isCounted(m) && m.stage !== "knockout" && rows.has(m.home_team_id) && rows.has(m.away_team_id)
  );

  for (const m of counted) {
    const h = rows.get(m.home_team_id);
    const a = rows.get(m.away_team_id);
    const hs = m.home_score, as = m.away_score;
    h.played++; a.played++;
    h.gf += hs; h.ga += as; a.gf += as; a.ga += hs;
    if (hs > as) { h.won++; a.lost++; }
    else if (hs < as) { a.won++; h.lost++; }
    else { h.drawn++; a.drawn++; }
  }

  for (const r of rows.values()) {
    r.gd = r.gf - r.ga;
    r.points = r.won * P.win + r.drawn * P.draw + r.lost * P.loss;
  }

  const list = [...rows.values()];
  list.sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf);

  // كسر التعادل بالمواجهة المباشرة بين المتساوين تماماً
  const key = (r) => `${r.points}|${r.gd}|${r.gf}`;
  let i = 0;
  while (i < list.length) {
    let j = i + 1;
    while (j < list.length && key(list[j]) === key(list[i])) j++;
    if (j - i > 1) {
      const cluster = list.slice(i, j);
      const ids = new Set(cluster.map((r) => r.team.id));
      const h2h = headToHead(cluster, counted, ids, P);
      cluster.sort((a, b) =>
        (h2h.get(b.team.id).pts - h2h.get(a.team.id).pts) ||
        (h2h.get(b.team.id).gd - h2h.get(a.team.id).gd) ||
        (h2h.get(b.team.id).gf - h2h.get(a.team.id).gf) ||
        a.team.name.localeCompare(b.team.name, "ar")
      );
      for (let k = 0; k < cluster.length; k++) list[i + k] = cluster[k];
    }
    i = j;
  }

  return list.map((r, idx) => ({ ...r, rank: idx + 1 }));
}

function headToHead(cluster, matches, ids, P) {
  const mini = new Map();
  for (const r of cluster) mini.set(r.team.id, { pts: 0, gd: 0, gf: 0 });
  for (const m of matches) {
    if (!ids.has(m.home_team_id) || !ids.has(m.away_team_id)) continue;
    const h = mini.get(m.home_team_id), a = mini.get(m.away_team_id);
    const hs = m.home_score, as = m.away_score;
    h.gf += hs; a.gf += as; h.gd += hs - as; a.gd += as - hs;
    if (hs > as) { h.pts += P.win; a.pts += P.loss; }
    else if (hs < as) { a.pts += P.win; h.pts += P.loss; }
    else { h.pts += P.draw; a.pts += P.draw; }
  }
  return mini;
}

// ---- المصادقة (الإدارة) ----------------------------------------------------

let currentUser = null;
let currentUserDoc = null;
const authCbs = new Set();
let markReady;
const authReady = new Promise((r) => (markReady = r));
if (auth) {
  onAuthStateChanged(auth, (u) => {
    currentUser = u;
    if (!u) currentUserDoc = null;
    if (markReady) { markReady(); markReady = null; }
    const session = u ? { user: u } : null;
    authCbs.forEach((cb) => { try { cb(session); } catch (e) { console.error(e); } });
  });
} else if (markReady) { markReady(); markReady = null; }

export async function getSession() {
  if (!auth) return null;
  await authReady;
  return currentUser ? { user: currentUser } : null;
}

const NO_EMAIL_DOMAIN = "no-email.tournament.local";
// اسم المستخدم: يبدأ بحرف إنجليزي، ثم حروف صغيرة/أرقام/-/_ (3–24 محرفاً)
const usernameRe = /^[a-z][a-z0-9_-]{2,23}$/;

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

export function usernameValid(username) {
  const uname = normalizeUsername(username);
  return uname.length >= 3 && uname.length <= 24 && usernameRe.test(uname);
}

export function isNoEmailAuthEmail(email) {
  return String(email || "").toLowerCase().endsWith("@" + NO_EMAIL_DOMAIN);
}

function usernameAuthEmail(username) {
  return `${normalizeUsername(username)}@${NO_EMAIL_DOMAIN}`;
}

function usernameBaseFrom(...parts) {
  let raw = parts.filter(Boolean).join("-").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-");
  if (!/^[a-z]/.test(raw)) raw = "u" + raw;   // يبدأ بحرف
  const base = raw || "user";
  return base.slice(0, 18).replace(/[-_]+$/g, "") || "user";
}

function usernameBaseCandidates(u, preferred, realEmail) {
  return [
    usernameBaseFrom(preferred),
    realEmail ? usernameBaseFrom(realEmail.split("@")[0]) : "",
    usernameBaseFrom(u?.displayName),
    "user",
  ].filter(Boolean);
}

async function reserveUsernameForUser(u, preferred, authEmail, realEmail) {
  const bases = usernameBaseCandidates(u, preferred, realEmail);
  for (const base0 of bases) {
    const base = base0.slice(0, 24).replace(/[-_]+$/g, "");
    // نجرّب الأساس ثم بلاحقة رقمية عند التعارض (ممكنة الآن لأن الأرقام مسموحة)
    for (let n = 0; n <= 30; n++) {
      const candidate = (n === 0 ? base : base.slice(0, 22) + n).slice(0, 24);
      if (!usernameValid(candidate)) continue;
      const ref = doc(requireDb(), "usernames", candidate);
      const existing = await getDoc(ref).catch(() => null);
      if (!existing?.exists() || existing.data()?.uid === u.uid) {
        await setDoc(ref, clean({
          uid: u.uid, username: candidate, auth_email: authEmail,
          email: realEmail || null, created_at: Date.now(),
        }));
        return candidate;
      }
    }
  }
  const err = new Error("username exists");
  err.code = "app/username-exists";
  throw err;
}

async function resolveLoginIdentifier(identifier) {
  const raw = String(identifier || "").trim();
  if (raw.includes("@")) return raw.toLowerCase();
  const username = normalizeUsername(raw);
  if (!usernameValid(username)) return raw;
  const s = await getDoc(doc(requireDb(), "usernames", username)).catch(() => null);
  if (s?.exists()) return String(s.data().auth_email || "").toLowerCase();
  return usernameAuthEmail(username);
}

export async function signIn(identifier, password) {
  const login = await resolveLoginIdentifier(identifier);
  const cred = await signInWithEmailAndPassword(auth, login, password);
  try { await syncMyUserDoc(cred.user); } catch {}
  return { user: cred.user };
}

// معرّف جهاز محلي — يكشف تعدّد الحسابات من نفس المتصفّح (علامة للمالك، ليس حظراً آلياً)
export function deviceId() {
  try {
    let d = localStorage.getItem("tp_device");
    if (!d) { d = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("tp_device", d); }
    return d;
  } catch { return null; }
}

// حظر/فكّ حظر مستخدم — للمالك فقط (تفرضه القواعد). المحظور لا يشارك في المسابقات.
export async function setUserBanned(uid, on) {
  await updateDoc(doc(requireDb(), "users", uid), { banned: !!on });
}
// استعادة مستخدم مُزال: فكّ الحظر وإلغاء «مُزال» معاً
export async function restoreUser(uid) {
  await updateDoc(doc(requireDb(), "users", uid), { banned: false, removed: false });
}

// تسجيل جديد: اسم مستخدم + كلمة مرور (+هاتف اختياري) — الحساب فعّال فوراً
export async function signUp(email, password, username, personName, phone) {
  const realEmail = String(email || "").trim().toLowerCase();
  const uname = normalizeUsername(username);
  const displayName = String(personName || "").trim().slice(0, 60) || uname;
  if (!usernameValid(uname)) {
    const err = new Error("invalid username");
    err.code = "app/invalid-username";
    throw err;
  }
  const existingUsername = await getDoc(doc(requireDb(), "usernames", uname));
  if (existingUsername.exists()) {
    const err = new Error("username exists");
    err.code = "app/username-exists";
    throw err;
  }
  const addr = realEmail || usernameAuthEmail(uname);
  // توافق رجعي: لو على هذا المتصفّح حساب Firebase قديم بلا بريد، نربط البريد
  // بالحساب نفسه بدل إنشاء حساب جديد — فيبقى uid كما هو.
  let cred;
  const cur = auth.currentUser;
  const linkedToExisting = !!(cur && !cur.email);   // (B11) لتمييز التراجع الآمن عند الفشل
  if (linkedToExisting) {
    cred = await linkWithCredential(cur, EmailAuthProvider.credential(addr, password));
  } else {
    cred = await createUserWithEmailAndPassword(auth, addr, password);
  }
  try { if (displayName) await updateProfile(cred.user, { displayName }); } catch {}
  if (realEmail) {
    try { await sendEmailVerification(cred.user); } catch (e) { console.warn(e); }
  }
  const d = requireDb();
  const base = clean({
    email: realEmail,
    auth_email: addr.toLowerCase(),
    username: uname,
    name: displayName,
    phone: phone ? String(phone).trim().slice(0, 40) : null,
    device_id: deviceId() || undefined,
    created_at: Date.now(),
    verified: !!(realEmail && cred.user.emailVerified),
    no_email: !realEmail,
    banned: false,                  // فعّال فوراً — الحظر بيد المالك فقط
  });
  try {
    const b = writeBatch(d);
    b.set(doc(d, "users", cred.user.uid), clean(base));
    b.set(doc(d, "usernames", uname), clean({
      uid: cred.user.uid, username: uname, auth_email: addr.toLowerCase(),
      email: realEmail || null, created_at: Date.now(),
    }));
    await b.commit();
    currentUserDoc = { id: cred.user.uid, ...base };
  } catch (e) {
    // (B11) نحذف الحساب فقط إن كان جديداً؛ حساب قديم رُبط به البريد لا يُحذف
    // (حذفه كان يُيتّم مشاركاته القديمة إلى الأبد)
    if (!linkedToExisting) { try { await deleteUser(cred.user); } catch {} }
    throw e;
  }
  return { user: cred.user };
}

// دخول بحساب Google — البريد مُوثَّق تلقائياً
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const cred = await signInWithPopup(auth, provider);
  try { await syncMyUserDoc(cred.user); } catch (e) { console.warn(e); }
  return { user: cred.user };
}

// «نسيت كلمة المرور» — رسالة إعادة تعيين إلى البريد
export async function sendReset(email) {
  await sendPasswordResetEmail(auth, String(email || "").trim());
}

// إعادة إرسال رسالة تأكيد البريد للمستخدم الحالي
export async function resendVerification() {
  if (auth?.currentUser) await sendEmailVerification(auth.currentUser);
}

// إعادة تحميل حالة المستخدم (بعد الضغط على رابط التأكيد) وإخطار الواجهة
export async function refreshSession() {
  if (auth?.currentUser) { try { await auth.currentUser.reload(); } catch {} }
  currentUser = auth?.currentUser || null;
  if (currentUser) await syncMyUserDoc(currentUser).catch(() => {});
  const s = currentUser ? { user: currentUser } : null;
  authCbs.forEach((cb) => { try { cb(s); } catch (e) { console.error(e); } });
  return s;
}

// مزامنة وثيقة المستخدم (الاسم/حالة التوثيق) — تُنشأ أيضاً عند أول دخول Google
export async function syncMyUserDoc(u = currentUser) {
  if (!u || !db || u.isAnonymous) return;   // الحسابات المجهولة القديمة ليست أعضاء منصة
  const ref = doc(requireDb(), "users", u.uid);
  let snap = null;
  try { snap = await getDoc(ref); } catch { return; } // قبل نشر القواعد الجديدة قد تُرفض القراءة
  const authEmail = (u.email || "").toLowerCase();
  const noEmail = isNoEmailAuthEmail(authEmail);
  const email = noEmail ? "" : authEmail;
  const username = normalizeUsername(u.displayName || (noEmail ? authEmail.split("@")[0] : ""));
  if (!snap.exists()) {
    const uname = await reserveUsernameForUser(u, username, authEmail, email).catch(() => username);
    const data = clean({
      email,
      auth_email: authEmail,
      username: usernameValid(uname) ? uname : null,
      name: (u.displayName || email || uname || "").slice(0, 60),
      created_at: Date.now(),
      verified: !!(email && u.emailVerified),
      no_email: noEmail,
      banned: false,
    });
    try {
      await setDoc(ref, data);
      currentUserDoc = { id: u.uid, ...data };
    } catch (e) { console.warn(e); }
    return;
  }
  const cur = snap.data() || {};
  const patch = {};
  const verified = !!(email && u.emailVerified);
  if (!!cur.verified !== verified) patch.verified = verified;
  if ((cur.auth_email || "") !== authEmail) patch.auth_email = authEmail;
  if ((cur.email || "") !== email) patch.email = email;
  if (!!cur.no_email !== noEmail) patch.no_email = noEmail;
  const nm = (u.displayName || "").trim().slice(0, 60);
  if (nm && nm !== cur.name) patch.name = nm;
  if (Object.keys(patch).length) {
    try { await updateDoc(ref, patch); } catch (e) { console.warn(e); }
  }
  currentUserDoc = { id: u.uid, ...cur, ...patch };
}

// هل دخل المستخدم ببريد/كلمة مرور؟ (تغيير كلمة المرور متاح لهؤلاء فقط)
export function passwordProvider() {
  return !!auth?.currentUser?.providerData?.some((p) => p.providerId === "password");
}

export async function fetchMyUserDoc(uid = currentUser?.uid) {
  if (!uid) return null;
  if (currentUserDoc && currentUserDoc.id === uid) return currentUserDoc;
  try {
    const s = await getDoc(doc(requireDb(), "users", uid));
    currentUserDoc = s.exists() ? { id: s.id, ...s.data() } : null;
    return currentUserDoc;
  } catch { return null; }
}

// مفتاح البريد لمالك التورنير: بريد مؤكّد فقط؛ حساب اسم المستخدم يعتمد owner_uid
function accountKeyOf(u = currentUser) {
  if (!u) return "";
  return (u.email && !isNoEmailAuthEmail(u.email) && u.emailVerified) ? u.email.toLowerCase() : "";
}

// تغيير الاسم الظاهر (في الحساب وفي وثيقة users)
export async function updateMyName(name) {
  const u = auth?.currentUser;
  if (!u) throw new Error("no user");
  const nm = String(name || "").trim().slice(0, 60);
  await updateProfile(u, { displayName: nm });
  try { await updateDoc(doc(requireDb(), "users", u.uid), { name: nm || (u.email || "") }); } catch {}
  return nm;
}

// تغيير كلمة المرور (بعد إعادة التحقق بكلمة المرور الحالية)
export async function changeMyPassword(currentPass, nextPass) {
  const u = auth?.currentUser;
  if (!u || !u.email) throw new Error("no user");
  const cred = EmailAuthProvider.credential(u.email, currentPass);
  await reauthenticateWithCredential(u, cred);
  await updatePassword(u, nextPass);
}

export async function signOut() { if (auth) await fbSignOut(auth); }

export function onAuthChange(cb) {
  authCbs.add(cb);
  return () => authCbs.delete(cb);
}

// ---- الأدوار: مالك / مدير منصّة / عضو معتمَد (المالك وحده يعتمد ويمنح) -------

export function isOwnerEmail(email) {
  const e = String(email || "").toLowerCase();
  return OWNER_EMAILS.some((o) => String(o).toLowerCase() === e);
}

async function hasDoc(coll, id) {
  try { return (await getDoc(doc(requireDb(), coll, id))).exists(); }
  catch { return false; }
}

// مدير منصّة: المالك دائماً، أو بريده/اسم مستخدمه في admins (صلاحيات على كل التورنيرات)
export async function amIPlatformAdmin() {
  const u = currentUser;
  if (!u || u.isAnonymous) return false;
  if (u.email && !isNoEmailAuthEmail(u.email) && u.emailVerified) {
    if (isOwnerEmail(u.email) || await hasDoc("admins", u.email.toLowerCase())) return true;
  }
  const docu = await fetchMyUserDoc(u.uid);
  return !!(docu?.username && await hasDoc("admins", docu.username));
}

// عضو معتمَد (يُنشئ تورنيرات): منحة من المالك حصراً — بريده أو اسم مستخدمه في members.
// المشترك العادي يشاهد كل شيء ويشارك في المسابقات لكنه لا يُنشئ بطولات.
export async function isInMembers() {
  const u = currentUser;
  if (!u || u.isAnonymous) return false;
  if (u.email && !isNoEmailAuthEmail(u.email) && u.emailVerified) {
    if (await hasDoc("members", u.email.toLowerCase())) return true;
  }
  const docu = await fetchMyUserDoc(u.uid);
  return !!(docu?.username && await hasDoc("members", docu.username));
}

export async function fetchUsers() {
  const snap = await getDocs(collection(requireDb(), "users"));
  return mapDocs(snap).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function fetchAdminEmails() {
  const snap = await getDocs(collection(requireDb(), "admins"));
  return new Set(snap.docs.map((d) => d.id));
}
export async function fetchMemberEmails() {
  const snap = await getDocs(collection(requireDb(), "members"));
  return new Set(snap.docs.map((d) => d.id));
}
// هل اسم المستخدم مسجَّل فعلاً؟ (قراءة عامّة — للتحقّق قبل تعيينه في طاقم بطولة)
export async function usernameExists(username) {
  const uname = normalizeUsername(username);
  if (!usernameValid(uname)) return false;
  try { return (await getDoc(doc(requireDb(), "usernames", uname))).exists(); }
  catch { return false; }
}

// «حذف» مستخدم = حظر دائم لا يُعاد تفعيله (لا يمكن حذف حساب Firebase من المتصفّح،
// فلو حذفنا سجلّه لأعاد النظام إنشاءه نظيفاً عند أول دخول). نضع banned+removed
// (يبقى عبر إعادة الدخول)، ونحرّر اسمه ونلغي صلاحياته ونزيل آثاره من المسابقات.
export async function deletePlatformUser(user) {
  const d = requireDb();
  const uid = String(user?.id || "").trim();
  if (!uid) throw new Error("Missing user id");
  const email = String(user?.email || "").trim().toLowerCase();
  const username = normalizeUsername(user?.username);
  await updateDoc(doc(d, "users", uid), { banned: true, removed: true });
  const b = writeBatch(d);
  if (usernameValid(username)) b.delete(doc(d, "usernames", username));
  if (email && !isNoEmailAuthEmail(email)) { b.delete(doc(d, "admins", email)); b.delete(doc(d, "members", email)); }
  if (usernameValid(username)) { b.delete(doc(d, "admins", username)); b.delete(doc(d, "members", username)); }
  await b.commit();
  // إزالة آثاره من المسابقات كي لا يظهر في جداول الترتيب
  for (const coll of ["predictions", "predictorContacts", "predictors"]) {
    try { await deleteWhere(coll, "uid", uid); } catch (e) { console.warn(e); }
  }
}

// المفتاح هو البريد بحروف صغيرة (كما تقارنه القواعد بـ uemail() المُصغَّر)
export async function setAdmin(email, on) {
  const key = String(email || "").trim().toLowerCase();
  const ref = doc(requireDb(), "admins", key);
  if (on) await setDoc(ref, clean({ email: key, added_at: Date.now() }));
  else await deleteDoc(ref);
}
export async function setMember(email, on) {
  const key = String(email || "").trim().toLowerCase();
  const ref = doc(requireDb(), "members", key);
  if (on) await setDoc(ref, clean({ email: key, added_at: Date.now() }));
  else await deleteDoc(ref);
}

// ---- الكتابة (محمية بقواعد الأمان) ----------------------------------------

async function batchOp(refs, fn) {
  for (let i = 0; i < refs.length; i += 450) {
    const b = writeBatch(requireDb());
    for (const r of refs.slice(i, i + 450)) fn(b, r);
    await b.commit();
  }
}
async function deleteWhere(coll, field, value) {
  const snap = await getDocs(query(collection(requireDb(), coll), where(field, "==", value)));
  await batchOp(snap.docs.map((x) => x.ref), (b, ref) => b.delete(ref));
}
async function nullifyWhere(coll, field, value) {
  const snap = await getDocs(query(collection(requireDb(), coll), where(field, "==", value)));
  await batchOp(snap.docs.map((x) => x.ref), (b, ref) => b.update(ref, { [field]: null }));
}

export async function createTournament(p) {
  // منشئ التورنير = مالكه (بريد مؤكد أو uid لحساب بلا بريد وافق عليه المالك)
  const userDoc = await fetchMyUserDoc(currentUser?.uid);
  const ownerKey = accountKeyOf(currentUser, userDoc);
  const data = { ...p };
  data.owner_uid = currentUser?.uid || null;
  if (!data.owner_email && ownerKey && !ownerKey.startsWith("uid:")) data.owner_email = ownerKey;
  if (data.owner_email) data.owner_email = String(data.owner_email).toLowerCase();
  const ref = await addDoc(collection(requireDb(), "tournaments"), clean(data));
  return { id: ref.id, ...data };
}
export async function updateTournament(id, patch) {
  await updateDoc(doc(requireDb(), "tournaments", id), clean(patch));
  return { id, ...patch };
}
export async function deleteTournament(id) {
  // احذف مسابقات التوقّعات وكل بياناتها الشخصيّة أوّلًا (توقّعات/متوقّعين/بيانات تواصل) وإلّا بقيت يتيمة للأبد
  const comps = await fetchCompetitionsByTournament(id);
  for (const c of comps) await deleteCompetition(c.id);
  await deleteWhere("events", "tournament_id", id);
  await deleteWhere("players", "tournament_id", id);
  await deleteWhere("matches", "tournament_id", id);
  await deleteWhere("teams", "tournament_id", id);
  await deleteWhere("groups", "tournament_id", id);
  await deleteDoc(doc(requireDb(), "tournaments", id));
}

export async function createGroup(p) {
  const ref = await addDoc(collection(requireDb(), "groups"), clean(p));
  return { id: ref.id, ...p };
}
export async function updateGroup(id, patch) {
  await updateDoc(doc(requireDb(), "groups", id), clean(patch));
  return { id, ...patch };
}
export async function deleteGroup(id) {
  await nullifyWhere("teams", "group_id", id);
  await nullifyWhere("matches", "group_id", id);
  await deleteDoc(doc(requireDb(), "groups", id));
}

export async function createTeam(p) {
  const ref = await addDoc(collection(requireDb(), "teams"), clean(p));
  return { id: ref.id, ...p };
}
export async function updateTeam(id, patch) {
  await updateDoc(doc(requireDb(), "teams", id), clean(patch));
  return { id, ...patch };
}
// عند حذف فريق: نُفرِغ مبارياته (نُلغي الطرف، ونمسح النتيجة والأحداث ونعيدها لمجدولة)
async function resetMatchesForDeletedTeam(teamId) {
  const d = requireDb();
  const affected = new Map();
  for (const side of ["home_team_id", "away_team_id"]) {
    const snap = await getDocs(query(collection(d, "matches"), where(side, "==", teamId)));
    for (const s of snap.docs) affected.set(s.id, { ref: s.ref, side });
  }
  for (const { ref, side } of affected.values()) {
    await deleteWhere("events", "match_id", ref.id);
    await updateDoc(ref, { [side]: null, home_score: null, away_score: null, status: "scheduled" });
  }
}

export async function deleteTeam(id) {
  await deleteWhere("players", "team_id", id);
  await resetMatchesForDeletedTeam(id);
  await deleteWhere("events", "team_id", id); // احتياط لأي أحداث متبقّية
  await deleteDoc(doc(requireDb(), "teams", id));
}

// مهلة القفل قبل انطلاق المباراة: تُقفل التوقّعات قبل بدء المباراة بساعة
export const PRED_LOCK_LEAD_MS = 60 * 60 * 1000;

// موعد قفل التوقّع = لحظة بدء المباراة ناقص المهلة (تاريخ+وقت محلّيان) بالمللي ثانية، أو null إن نقص أحدهما
export function matchLockMillis(date, time) {
  if (!date || !time) return null;
  const [y, m, d] = String(date).split("-").map(Number);
  if (!y || !m || !d) return null;
  const [hh, mm] = String(time).split(":").map(Number);
  const ms = new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0).getTime();
  return Number.isFinite(ms) ? ms - PRED_LOCK_LEAD_MS : null;
}

// إعادة اشتقاق موعد القفل من التاريخ/الوقت عند القراءة — كي يُطبَّق تعديل المهلة
// فوراً على كل المباريات (حتى القديمة) لدى كل من يعرض الصفحة بلا انتظار مزامنة
function withLock(m) {
  return { ...m, locks_at: matchLockMillis(m.match_date, m.match_time) };
}

export async function createMatch(p) {
  const data = { ...p };
  // ختم لحظة البدء عند إنشاء مباراة مباشرة مباشرةً (نادر لكن للاكتمال)
  if (data.status === "live" && data.live_started_at === undefined) data.live_started_at = Date.now();
  data.locks_at = matchLockMillis(data.match_date, data.match_time);   // موعد قفل التوقّع
  const ref = await addDoc(collection(requireDb(), "matches"), clean(data));
  return { id: ref.id, ...data };
}
export async function updateMatch(id, patch) {
  const p = { ...patch };
  // عند أي انتقال إلى «مباشر» نختم لحظة البدء (يغطّي زر البدء، إعادة الفتح، أول هدف، نموذج التعديل)
  if (p.status === "live" && p.live_started_at === undefined) p.live_started_at = Date.now();
  // إن مسّ التعديل التاريخ/الوقت نعيد حساب موعد قفل التوقّع.
  // (B13) باتش جزئي (أحد الحقلين فقط) كان يمسح locks_at — ندمج مع القيمة المخزّنة.
  const touchesDate = "match_date" in p, touchesTime = "match_time" in p;
  if (touchesDate || touchesTime) {
    let date = p.match_date, time = p.match_time;
    if (touchesDate !== touchesTime) {
      try {
        const cur = (await getDoc(doc(requireDb(), "matches", id))).data() || {};
        if (!touchesDate) date = cur.match_date;
        if (!touchesTime) time = cur.match_time;
      } catch {}
    }
    p.locks_at = matchLockMillis(date, time);
  }
  await updateDoc(doc(requireDb(), "matches", id), clean(p));
  // ختم لحظة الانتهاء الفعلية (للتدقيق): مرّة واحدة عند أول انتهاء فقط، فلا يُطمَس الوقت
  // الأصلي عند تعديل مباراة منتهية لاحقاً. كتابة منفصلة «أفضل جهد»: لو لم تُنشر قواعد
  // finished_at بعد تُرفض وحدها ويبقى إنهاء المباراة سليماً (لا نُدرجها في الكتابة الأساسية)
  if (p.status === "finished") {
    let already;
    try { already = (await getDoc(doc(requireDb(), "matches", id))).data()?.finished_at; } catch (e) { console.warn(e); }
    if (already == null) {
      const fa = Date.now();
      try { await updateDoc(doc(requireDb(), "matches", id), { finished_at: fa }); p.finished_at = fa; }
      catch (e) { console.warn("finished_at — انشر قواعد Firestore لتفعيل وقت الانتهاء", e); }
    } else {
      p.finished_at = already;   // احتفظ بالوقت الأصلي في القيمة المُعادة دون إعادة ختم
    }
  }
  return { id, ...p };
}

// المباريات المباشرة حالياً (لفحص الإنهاء التلقائي في لوحة الإدارة)
export async function fetchLiveMatches() {
  const snap = await getDocs(query(collection(requireDb(), "matches"), where("status", "==", "live")));
  return mapDocs(snap);
}
export async function deleteMatch(id) {
  await deleteWhere("events", "match_id", id);
  await deleteDoc(doc(requireDb(), "matches", id));
}

// ---- اللاعبون -------------------------------------------------------------

export async function createPlayer(p) {
  const ref = await addDoc(collection(requireDb(), "players"), clean(p));
  return { id: ref.id, ...p };
}
export async function updatePlayer(id, patch) {
  await updateDoc(doc(requireDb(), "players", id), clean(patch));
  return { id, ...patch };
}
export async function deletePlayer(id) {
  await nullifyWhere("events", "player_id", id); // نُبقي الأحداث لكن بلاعب غير محدَّد
  await deleteDoc(doc(requireDb(), "players", id));
}

// ---- صندوق الاقتراحات (إضافة عامّة للزوّار، قراءة/حذف للمدير) ----------------

// يضيفها أي زائر بلا تسجيل — القاعدة في firestore.rules تتحقّق من الصلاحية
export async function createSuggestion({ text, name, context } = {}) {
  const payload = clean({
    text: String(text || "").trim().slice(0, 1000),
    name: name ? String(name).trim().slice(0, 80) : undefined,
    context: context ? String(context).slice(0, 200) : undefined,
    created_at: Date.now(),
  });
  const ref = await addDoc(collection(requireDb(), "suggestions"), payload);
  return { id: ref.id, ...payload };
}

// للمدير فقط: أحدث الاقتراحات أولاً
export async function fetchSuggestions() {
  const snap = await getDocs(collection(requireDb(), "suggestions"));
  return mapDocs(snap).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

export async function deleteSuggestion(id) {
  await deleteDoc(doc(requireDb(), "suggestions", id));
}

// ---- أحداث المباراة (أهداف/إنذارات) + مزامنة النتيجة ------------------------

async function createEvent(payload) {
  const ref = await addDoc(collection(requireDb(), "events"), clean({ ...payload, created_at: Date.now() }));
  return { id: ref.id, ...payload };
}

// تسجيل هدف بمُسجِّل. teamGoalEvents = عدد أهداف الفريق المُسجَّلة بأسماء حالياً.
// إن كانت النتيجة أكبر من عدد المسجّلين (أهداف بلا اسم) => ننسب فقط دون زيادة النتيجة؛
// وإلا فهو هدف جديد => نزيد النتيجة. هكذا يمكن تعديل مباراة منتهية دون مضاعفة النتيجة.
export async function addGoal(match, teamId, playerId, minute, teamGoalEvents = 0) {
  const isHome = match.home_team_id === teamId;
  const home = match.home_score ?? 0, away = match.away_score ?? 0;
  const curScore = isHome ? home : away;
  const patch = {};
  if (teamGoalEvents >= curScore) {
    // هدف جديد — increment ذرّي على الخادم (B5): مسجّلان متزامنان لا يُضيعان هدفاً.
    // نضمن أولاً أن النتيجتين رقميتان (قد تكونان null قبل أول هدف).
    if (home === 0 && match.home_score == null) patch.home_score = 0;
    if (away === 0 && match.away_score == null) patch.away_score = 0;
    if (Object.keys(patch).length) await updateMatch(match.id, patch);
    const incPatch = { [isHome ? "home_score" : "away_score"]: increment(1) };
    if (match.status === "scheduled") incPatch.status = "live";
    await updateMatch(match.id, incPatch);
  } else if (match.status === "scheduled") {
    await updateMatch(match.id, { status: "live", home_score: home, away_score: away });
  }
  return createEvent({
    tournament_id: match.tournament_id, match_id: match.id,
    team_id: teamId, player_id: playerId || null, type: "goal", minute: minute ?? null,
  });
}

// إنذار/طرد: حدث فقط (لا يؤثّر على النتيجة)
export async function addCard(match, teamId, playerId, minute, type) {
  return createEvent({
    tournament_id: match.tournament_id, match_id: match.id,
    team_id: teamId, player_id: playerId || null, type, minute: minute ?? null,
  });
}

// ضبط النتيجة مباشرةً (أزرار +/-). الزيادة ذرّية (B5)؛ الإنقاص قراءة-كتابة
// مع حدّ أدنى صفر (نادر التزامن، والقواعد ترفض السالب احتياطاً).
export async function bumpScore(match, isHome, delta) {
  const home = match.home_score ?? 0, away = match.away_score ?? 0;
  const key = isHome ? "home_score" : "away_score";
  if (delta > 0) {
    const init = {};
    if (match.home_score == null) init.home_score = 0;
    if (match.away_score == null) init.away_score = 0;
    if (Object.keys(init).length) await updateMatch(match.id, init);
    const patch = { [key]: increment(delta) };
    if (match.status === "scheduled") patch.status = "live";
    await updateMatch(match.id, patch);
  } else {
    const cur = isHome ? home : away;
    await updateMatch(match.id, { [key]: Math.max(0, cur + delta) });
  }
}

// حذف حدث؛ لو كان هدفاً نُنقص النتيجة فقط إذا كانت كل الأهداف منسوبة (المسجّلون == النتيجة)
export async function removeEvent(event, match, teamGoalEvents = 0) {
  if (event.type === "goal" && match) {
    const isHome = match.home_team_id === event.team_id;
    const cur = (isHome ? match.home_score : match.away_score) ?? 0;
    if (teamGoalEvents >= cur) {
      await updateMatch(match.id, { [isHome ? "home_score" : "away_score"]: Math.max(0, cur - 1) });
    }
  }
  await deleteDoc(doc(requireDb(), "events", event.id));
}

// حذف حدث خام دون أي تعديل على النتيجة (لتنظيف الأحداث المكرّرة التي لم تُغيّر النتيجة)
export async function deleteEvent(id) {
  await deleteDoc(doc(requireDb(), "events", id));
}

// مزامنة موعد القفل المخزَّن مع الصيغة الحالية (بعد تغيير مهلة القفل) — للمنظّم فقط.
// تقرأ القيمة الخام (بلا إعادة اشتقاق) وتحدّث ما اختلف فقط، كي تفرض قواعد الخادم موعد
// القفل الصحيح حتى على المباريات المنشأة قبل التغيير. آمنة للتكرار (لا تكتب إن تطابق كلّه).
export async function syncMatchLocks(tid) {
  const d = requireDb();
  const snap = await getDocs(query(collection(d, "matches"), where("tournament_id", "==", tid)));
  const stale = mapDocs(snap).filter((m) => (m.locks_at ?? null) !== (matchLockMillis(m.match_date, m.match_time) ?? null));
  let fixed = 0;
  for (let i = 0; i < stale.length; i += 450) {
    const b = writeBatch(d);
    for (const m of stale.slice(i, i + 450)) b.update(doc(d, "matches", m.id), { locks_at: matchLockMillis(m.match_date, m.match_time) });
    await b.commit();
    fixed += Math.min(450, stale.length - i);
  }
  return fixed;
}

export async function insertMatches(rows) {
  if (!rows.length) return [];
  const d = requireDb();
  for (let i = 0; i < rows.length; i += 450) {
    const b = writeBatch(d);
    for (const row of rows.slice(i, i + 450)) {
      // موعد قفل التوقّع لكل مباراة (null إن بلا تاريخ/وقت — كدوري مولَّد بلا مواعيد)
      const r = { ...row, locks_at: matchLockMillis(row.match_date, row.match_time) };
      b.set(doc(collection(d, "matches")), clean(r));
    }
    await b.commit();
  }
  return rows;
}

// ---- خروج المغلوب (Knockout) -----------------------------------------------

// ترتيب المقاعد لشجرة بحجم n (قوّة 2): بذر قياسي يضمن التباعد (1 ضدّ n، والكبار في أنصاف متقابلة)
export function bracketSeedOrder(n) {
  let pls = [1, 2];
  const rounds = Math.round(Math.log2(n));
  for (let r = 1; r < rounds; r++) {
    const sum = pls.length * 2 + 1;
    const out = [];
    for (const p of pls) { out.push(p); out.push(sum - p); }
    pls = out;
  }
  return pls;
}

// المتأهّلون من البيوت: الأوائل (qualifiers_per_group) مرتّبين حسب بذرٍ يباعد أبناء البيت الواحد
export function computeQualifiers(tournament, groups, teams, matches) {
  const points = { win: tournament.win_points ?? 3, draw: tournament.draw_points ?? 1, loss: tournament.loss_points ?? 0 };
  const perGroup = Math.max(1, tournament.qualifiers_per_group ?? 2);

  // (B6) دلو ضمني للفرق «بدون بيت» — يدعم الدوري الفردي (كما في buildFixtures)
  const buckets = groups.map((g) => teams.filter((tm) => tm.group_id === g.id));
  const ungrouped = teams.filter((tm) => tm.group_id == null);
  if (ungrouped.length) buckets.push(ungrouped);

  // متأهّلو كل بيت مرتّبين حسب المرتبة (رتبة 0 = بطل البيت، 1 = وصيف…)
  // في الدوري الفردي (دلو واحد): نأخذ أوائل الترتيب العام بعدد يكفي شجرة من 4 على الأقل
  const soloLeague = buckets.length === 1;
  const tiers = []; // tiers[rank] = [{ team, gi }]
  buckets.forEach((gTeams, gi) => {
    const take = soloLeague ? Math.max(perGroup, Math.min(4, gTeams.length)) : perGroup;
    computeGroupStandings(gTeams, matches, points).slice(0, take)
      .forEach((row, rank) => { (tiers[rank] = tiers[rank] || []).push({ team: row.team, gi }); });
  });
  const flat = tiers.reduce((n, t) => n + t.length, 0);
  if (flat < 2) return tiers.reduce((acc, t) => acc.concat(t.map((x) => x.team)), []);

  // نبذر المتأهّلين بحيث يقع كلّ متأهّلي البيت الواحد في أنصاف الشجرة المتقابلة،
  // فلا يلتقي فريقا البيت نفسه قبل النهائي. نصف كل مقعد يُحسب فعليًّا من ترتيب البذر.
  let B = 2; while (B < flat) B *= 2;
  const order = bracketSeedOrder(B);
  const posOfSeed = [];
  order.forEach((seed, i) => { posOfSeed[seed - 1] = i; });
  const halfOf = (seed) => (posOfSeed[seed - 1] < B / 2 ? 0 : 1);

  const seedTeam = []; // seedTeam[seed-1] = team (بترتيب البذور)
  const prevHalf = {}; // آخر نصف وُضع فيه كل بيت
  let seedBase = 0;
  tiers.forEach((tier, rank) => {
    if (rank === 0) {
      // الأبطال على المقاعد الأولى بترتيب البيوت
      tier.forEach((entry, k) => { const seed = seedBase + k + 1; seedTeam[seed - 1] = entry.team; prevHalf[entry.gi] = halfOf(seed); });
    } else {
      const top = [], bot = [];
      for (let k = 0; k < tier.length; k++) { const seed = seedBase + k + 1; (halfOf(seed) === 0 ? top : bot).push(seed); }
      const wantTop = [], wantBot = [];
      tier.forEach((entry) => { ((1 - (prevHalf[entry.gi] ?? 0)) === 0 ? wantTop : wantBot).push(entry); });
      const place = (list, primary, fallback) => list.forEach((entry) => {
        const seed = primary.length ? primary.shift() : fallback.shift();
        seedTeam[seed - 1] = entry.team; prevHalf[entry.gi] = halfOf(seed);
      });
      place(wantTop, top, bot);
      place(wantBot, bot, top);
    }
    seedBase += tier.length;
  });
  return seedTeam;
}

// يحسب بنية الشجرة (بلا إنشاء): قائمة مباريات مرتّبة، كلٌّ {round, pos, home, away}
// (home/away كائن فريق أو null للباي/غير المحدَّد) — لعرضها في نموذج المواعيد
export function planKnockout(tournament, bundle) {
  const qualifiers = computeQualifiers(tournament, bundle.groups, bundle.teams, bundle.matches);
  if (qualifiers.length < 2) throw new Error("لا يوجد متأهّلون كافون (فريقان على الأقل)");
  let B = 2; while (B < qualifiers.length) B *= 2;
  let advancing = bracketSeedOrder(B).map((seed) => qualifiers[seed - 1] || null);
  const rounds = Math.round(Math.log2(B));
  const plan = [];
  for (let r = 1; r <= rounds; r++) {
    const next = [];
    for (let pos = 0; pos < advancing.length / 2; pos++) {
      const home = advancing[pos * 2], away = advancing[pos * 2 + 1];
      plan.push({ round: r, pos, home, away });
      next.push(home && !away ? home : (away && !home ? away : null)); // باي يتأهّل
    }
    advancing = next;
  }
  return { plan, rounds, bracketSize: B, qualifiers: qualifiers.length };
}

// يحذف كل مباريات خروج المغلوب (وأحداثها) لهذا التورنير
export async function deleteKnockout(bundle) {
  const d = requireDb();
  for (const m of (bundle.matches || []).filter((m) => m.stage === "knockout")) {
    await deleteWhere("events", "match_id", m.id);
    await deleteDoc(doc(d, "matches", m.id));
  }
}

// ينشئ الشجرة من الخطّة + المواعيد (schedule: مصفوفة بنفس ترتيب plan، كلٌّ {date?, time?})
export async function createKnockout(tournament, bundle, plan, schedule = []) {
  await deleteKnockout(bundle);
  const rows = plan.map((p, i) => ({
    tournament_id: tournament.id, group_id: null, stage: "knockout", round: p.round, bracket_pos: p.pos,
    home_team_id: p.home ? p.home.id : null, away_team_id: p.away ? p.away.id : null,
    match_date: (schedule[i] && schedule[i].date) || undefined,   // clean يُسقط undefined
    match_time: (schedule[i] && schedule[i].time) || undefined,
    status: "scheduled", home_score: null, away_score: null, sort_order: i,
  }));
  await insertMatches(rows);
  return { count: rows.length };
}

// فائز مباراة خروج مغلوب (باي، أو الأعلى نتيجةً بعد الانتهاء؛ التعادل لا يتأهّل)
export function knockoutWinner(m) {
  if (m.home_team_id && !m.away_team_id) return m.home_team_id;
  if (m.away_team_id && !m.home_team_id) return m.away_team_id;
  if (m.status === "finished" && m.home_score != null && m.away_score != null && m.home_score !== m.away_score)
    return m.home_score > m.away_score ? m.home_team_id : m.away_team_id;
  return null;
}

// يرقّي الفائزين إلى الجولات التالية (يعمل بلا تكرار — يُستدعى بعد أي نتيجة/توليد)
export async function syncKnockoutAdvancement(bundle) {
  const ko = (bundle.matches || []).filter((m) => m.stage === "knockout");
  const byRP = new Map(ko.map((m) => [m.round + "|" + m.bracket_pos, m]));
  let changed = 0;
  for (const m of ko) {
    const w = knockoutWinner(m);
    if (!w) continue;
    const next = byRP.get((m.round + 1) + "|" + Math.floor(m.bracket_pos / 2));
    if (!next) continue;
    const slot = m.bracket_pos % 2 === 0 ? "home_team_id" : "away_team_id";
    if (next[slot] !== w) {
      // (B10) لا نبدّل طرفاً في مباراة تالية لُعبت/جارية — كان يُلصق نتيجة قديمة بفريق جديد
      if (next.status !== "scheduled") {
        console.warn("knockout: تغيّر فائز جولة سابقة لكن مباراة الدور التالي لُعبت — تُركت كما هي", next.id);
        continue;
      }
      await updateMatch(next.id, { [slot]: w }); next[slot] = w; changed++;
    }
  }
  return changed;
}

// (B10) لا يجوز إنهاء مباراة إقصائية بالتعادل — لا يتأهّل أحد وتتجمّد الشجرة بصمت
export function knockoutDrawBlocked(match, patch = {}) {
  const stage = patch.stage ?? match?.stage;
  if (stage !== "knockout") return false;
  const status = patch.status ?? match?.status;
  if (status !== "finished") return false;
  const h = patch.home_score ?? match?.home_score;
  const a = patch.away_score ?? match?.away_score;
  return h != null && a != null && h === a;
}

// ---- توليد مباريات دوري كامل (طريقة الدائرة) --------------------------------

export function roundRobinPairs(teamIds) {
  const ids = teamIds.slice();
  if (ids.length < 2) return [];
  if (ids.length % 2 === 1) ids.push(null); // فريق مستريح (bye)
  const n = ids.length;
  const arr = ids.slice();
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      if (a != null && b != null) pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr.splice(0, arr.length, arr[0], ...rest);
  }
  return rounds;
}

export function buildFixtures(tournamentId, groups, teams) {
  const rows = [];
  let order = 0;
  // كل بيت مجموعة، بالإضافة إلى مجموعة ضمنية للفرق «بدون بيت» (دوري فردي/خروج المغلوب)
  const buckets = [
    ...groups.map((g) => ({ id: g.id, ids: teams.filter((t) => t.group_id === g.id).map((t) => t.id) })),
    { id: null, ids: teams.filter((t) => t.group_id == null).map((t) => t.id) },
  ];
  for (const b of buckets) {
    const rounds = roundRobinPairs(b.ids);
    rounds.forEach((pairs, ri) => {
      for (const [home, away] of pairs) {
        rows.push({
          tournament_id: tournamentId, group_id: b.id, round: ri + 1,
          home_team_id: home, away_team_id: away, status: "scheduled", sort_order: order++,
        });
      }
    });
  }
  return rows;
}

// ---- جدولة تلقائية للدوري ---------------------------------------------------
// توزّع التواريخ والأوقات على مباريات موجودة وفق نمط يومي:
//   • البيوت «الأساسية» تملأ أوّل مباريات كل يوم (primaryPerDay).
//   • البيوت «التناوبية» (secondaryOrder) تملأ الخانات الأخيرة بالتناوب (secondaryPerDay)،
//     وتبدأ من اليوم رقم secondaryStartDayIdx (لذلك يكون اليوم الأول أقلّ مباريات).
// ضمانات: لا يلعب فريق مباراتين في اليوم نفسه، وكل مباراة تُجدول مرّة واحدة فقط.
// دالّة خالصة (بلا شبكة) — تُعيد [{ id, group_id, home_team_id, away_team_id, match_date, match_time }].
export function planLeagueSchedule(groups, teams, matches, opts) {
  const pairKey = (a, b) => [a, b].sort().join("~");
  const secondaryIds = (opts.secondaryOrder || []).filter((id) => groups.some((g) => g.id === id));
  const gById = (id) => groups.find((g) => g.id === id);
  const primaryIds = groups.map((g) => g.id).filter((id) => !secondaryIds.includes(id))
    .sort((a, b) => (gById(a)?.sort_order || 0) - (gById(b)?.sort_order || 0));
  const houseQueue = (gid) => {
    const tIds = teams.filter((x) => x.group_id === gid)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.id < b.id ? -1 : 1)).map((x) => x.id);
    const byPair = new Map();
    matches.filter((m) => m.group_id === gid).forEach((m) => byPair.set(pairKey(m.home_team_id, m.away_team_id), m));
    const q = [], seen = new Set();
    for (const rd of roundRobinPairs(tIds)) for (const [a, b] of rd) {
      const m = byPair.get(pairKey(a, b));
      if (m && !seen.has(m.id)) { q.push(m); seen.add(m.id); }
    }
    // احتياط: أضِف أي مباراة في هذا البيت لم يغطِّها الدوري المولّد (فرق فرديّة، ترتيب غير متوقّع)
    matches.filter((m) => m.group_id === gid && !seen.has(m.id)).forEach((m) => q.push(m));
    return q;
  };
  const Q = {};
  [...primaryIds, ...secondaryIds].forEach((id) => { Q[id] = houseQueue(id); });
  const rem = (id) => Q[id].length;
  const primaryPerDay = Math.max(1, opts.primaryPerDay || 1);
  const secondaryPerDay = Math.max(0, opts.secondaryPerDay || 0);
  const secStartDay = opts.secondaryStartDayIdx ?? 1;

  const days = [];
  let secCursor = 0, guard = 0;
  while (primaryIds.some(rem) || secondaryIds.some(rem)) {
    if (++guard > 1000) break;                       // صمّام أمان ضد أي حلقة لا نهائية
    const dayIdx = days.length;
    const day = { primary: [], secondary: [] };
    const used = new Set();                           // فرق لعبت هذا اليوم
    // مباريات البيوت الأساسية — نفضّل بيتاً لم يُستعمل اليوم والأكثر مباريات متبقّية
    while (day.primary.length < primaryPerDay) {
      const usedHouses = new Set(day.primary.map((m) => m.group_id));
      const ok = (id) => { const m = Q[id][0]; return m && !used.has(m.home_team_id) && !used.has(m.away_team_id); };
      let cands = primaryIds.filter((id) => rem(id) && !usedHouses.has(id) && ok(id));
      if (!cands.length) cands = primaryIds.filter((id) => rem(id) && ok(id));   // اضطراراً: بيت مكرّر بلا تعارض فرق
      if (!cands.length) break;
      cands.sort((a, b) => rem(b) - rem(a) || (gById(a).sort_order - gById(b).sort_order));
      const m = Q[cands[0]].shift();
      day.primary.push(m); used.add(m.home_team_id); used.add(m.away_team_id);
    }
    // المباراة/المباريات التناوبية — تدور على البيوت التناوبية بالترتيب
    if (dayIdx >= secStartDay) {
      let s = 0;
      while (s < secondaryPerDay && secondaryIds.some(rem)) {
        let tries = 0, got = null;
        while (tries < secondaryIds.length) {
          const gid = secondaryIds[secCursor % secondaryIds.length]; secCursor++;
          if (rem(gid)) { got = Q[gid].shift(); break; }
          tries++;
        }
        if (!got) break;
        day.secondary.push(got); s++;
      }
    }
    if (!day.primary.length && !day.secondary.length) break;
    days.push(day);
  }

  // إسناد التواريخ والأوقات (مع خيار تخطّي أيام الجمعة)
  const out = [];
  const [sy, sm, sd] = String(opts.startDate).split("-").map(Number);
  const cur = new Date(sy, (sm || 1) - 1, sd || 1);
  const [sh, smin] = String(opts.startTime || "18:30").split(":").map(Number);
  const gap = Math.max(1, opts.gapMin || 30);
  const pad = (n) => String(n).padStart(2, "0");
  const fmtD = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  for (const day of days) {
    if (opts.skipFridays) while (cur.getDay() === 5) cur.setDate(cur.getDate() + 1);
    [...day.primary, ...day.secondary].forEach((m, i) => {
      const tot = (smin || 0) + i * gap;
      out.push({
        id: m.id, group_id: m.group_id, home_team_id: m.home_team_id, away_team_id: m.away_team_id,
        match_date: fmtD(cur), match_time: `${pad((sh || 0) + Math.floor(tot / 60))}:${pad(tot % 60)}`,
      });
    });
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

// حفظ دفعة من المواعيد على مباريات موجودة (للجدولة التلقائية) — مع إعادة حساب موعد قفل التوقّع
export async function scheduleMatches(rows) {
  if (!rows.length) return 0;
  const d = requireDb();
  let done = 0;
  for (let i = 0; i < rows.length; i += 450) {
    const b = writeBatch(d);
    for (const r of rows.slice(i, i + 450)) {
      b.update(doc(d, "matches", r.id), {
        match_date: r.match_date, match_time: r.match_time,
        locks_at: matchLockMillis(r.match_date, r.match_time),
      });
    }
    await b.commit();
    done += Math.min(450, rows.length - i);
  }
  return done;
}

// ---- تعبئة بطولة تجريبية (بيانات الإكسل) -----------------------------------

export async function seedSampleTournament() {
  const d = requireDb();
  const userDoc = await fetchMyUserDoc(currentUser?.uid);
  const ownerKey = accountKeyOf(currentUser, userDoc);
  const tRef = await addDoc(collection(d, "tournaments"),
    clean({
      ...SAMPLE.tournament,
      owner_uid: currentUser?.uid || null,
      owner_email: ownerKey && !ownerKey.startsWith("uid:") ? ownerKey : null,
    }));
  const tid = tRef.id;

  const groupIdByKey = {};
  const teamIdByName = {};
  const batch = writeBatch(d);

  for (const g of SAMPLE.groups) {
    const ref = doc(collection(d, "groups"));
    groupIdByKey[g.key] = ref.id;
    batch.set(ref, { tournament_id: tid, name: g.name, sort_order: g.sort_order });
  }
  SAMPLE.teams.forEach((tm, idx) => {
    const ref = doc(collection(d, "teams"));
    teamIdByName[tm.name] = ref.id;
    batch.set(ref, { tournament_id: tid, group_id: groupIdByKey[tm.group], name: tm.name, sort_order: idx + 1 });
  });
  for (const mt of SAMPLE.matches) {
    const ref = doc(collection(d, "matches"));
    batch.set(ref, {
      tournament_id: tid, group_id: groupIdByKey[mt.group],
      match_date: mt.date, match_time: mt.time,
      home_team_id: teamIdByName[mt.home], away_team_id: teamIdByName[mt.away],
      status: "scheduled", sort_order: mt.order,
    });
  }
  await batch.commit();
  return tid;
}

// ---- التحديث اللحظي (Firestore onSnapshot) ---------------------------------

// نتجاهل أول لقطة لكل مستمع (الحالة الحالية مُحمَّلة مسبقاً)، ونتفاعل مع التغييرات فقط
function skipFirst(fn) {
  let first = true;
  return (...a) => { if (first) { first = false; return; } fn(...a); };
}

export function subscribeTournament(tid, onChange) {
  if (!db) return () => {};
  // نحتفظ بأحدث لقطة لكل مجموعة في الكاش؛ onSnapshot يسلّم المتغيّر فقط (قراءات قليلة)،
  // وعند أي تغيير نستدعي onChange مرّة واحدة — والمستهلك يقرأ الكاش بلا أي جلب كامل.
  const c = { groups: [], teams: [], matches: [], players: [], events: [], tournament: null, ready: false };
  bundleCache.set(tid, c);
  const sorters = {
    groups: (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
    teams: (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
    matches: byMatchOrder,
    players: (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
    events: byEventOrder,
  };
  const delivered = new Set();
  let t = null;
  const emit = () => { clearTimeout(t); t = setTimeout(() => { if (c.ready) onChange(); }, 250); };
  const onColl = (coll, snap) => {
    const rows = mapDocs(snap);
    c[coll] = (coll === "matches" ? rows.map(withLock) : rows).sort(sorters[coll]);
    // (B12) عند اكتمال التهيئة نبثّ onChange مرة — تغييرٌ وقع بين الجلب الأول
    // والاشتراك كان يبقى محبوساً في الكاش بلا رسم حتى تغيير لاحق
    if (!c.ready) { delivered.add(coll); if (delivered.size >= 5) { c.ready = true; emit(); } }
    else emit();
  };
  const mk = (coll) => onSnapshot(
    query(collection(db, coll), where("tournament_id", "==", tid)),
    (snap) => onColl(coll, snap),
    (err) => console.error(err)
  );
  const unsubs = [
    mk("groups"), mk("teams"), mk("matches"), mk("players"), mk("events"),
    onSnapshot(doc(db, "tournaments", tid),
      (s) => { c.tournament = s.exists() ? { id: s.id, ...s.data() } : null; if (c.ready) emit(); },
      (err) => console.error(err)),
  ];
  return () => { clearTimeout(t); bundleCache.delete(tid); unsubs.forEach((u) => { try { u(); } catch {} }); };
}

// ============================================================================
//  مسابقة التوقّعات (Predictions)
//  • المتوقّع = حساب منصة حقيقي ببريد مؤكَّد. لا ننشئ حساباً مجهولاً للمشاركة؛
//    لذلك يستطيع المشارك تسجيل الدخول لاحقاً من أي جهاز والعودة لنفس توقّعاته.
//  • النقاط ثلاث مستويات (قابلة للتعديل لكل مسابقة): النتيجة بالضبط / الاتجاه+الفارق /
//    الفائز فقط. الترتيب يُحتسب في المتصفّح من المباريات المنتهية.
// ============================================================================

function isPlatformAccount(u) {
  if (!u || u.isAnonymous) return false;
  if (currentUserDoc?.id === u.uid && currentUserDoc.banned === true) return false;  // محظور
  if (u.email && !isNoEmailAuthEmail(u.email) && u.emailVerified) return true;
  // حساب اسم مستخدم: فعّال فور التسجيل (وثيقة users موجودة) — لا انتظار موافقة
  return currentUserDoc?.id === u.uid;
}

function accountName(u) {
  return String(u?.displayName || u?.email || "").trim().slice(0, 60);
}

// حساب المنصة الحالي. يرمي خطأ واضحاً بدل إنشاء حساب مجهول.
export async function requirePlatformUser() {
  if (!auth) throw new Error("Firebase not configured");
  await authReady;
  const u = auth.currentUser;
  if (u && (!currentUserDoc || currentUserDoc.id !== u.uid)) await fetchMyUserDoc(u.uid);
  if (isPlatformAccount(u)) return u;
  const err = new Error("يجب تسجيل الدخول بحساب منصة للمشاركة");
  err.code = !u || u.isAnonymous ? "auth/login-required"
    : (currentUserDoc?.id === u?.uid && currentUserDoc?.banned === true ? "auth/banned"
      : (u.email && !isNoEmailAuthEmail(u.email) && !u.emailVerified ? "auth/email-not-verified"
        : "auth/login-required"));
  throw err;
}

// معرّف حساب المنصة الحالي إن وُجد (بلا إنشاء حساب جديد) — لفحص «هل أنا مشارك؟»
export function currentUid() {
  const u = auth?.currentUser;
  return isPlatformAccount(u) ? u.uid : null;
}

// ---- المسابقات (pcomps) ----------------------------------------------------

const compDefaults = () => ({ pts_exact: 5, pts_diff: 3, pts_outcome: 2, winners_count: 3, predictions_open: false });

export async function fetchCompetitionsByTournament(tid) {
  const snap = await getDocs(query(collection(requireDb(), "pcomps"), where("tournament_id", "==", tid)));
  return mapDocs(snap).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (b.created_at ?? 0) - (a.created_at ?? 0));
}
export async function fetchCompetition(id) {
  const s = await getDoc(doc(requireDb(), "pcomps", id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}
export async function createCompetition(p) {
  const data = { ...compDefaults(), ...p, created_at: Date.now() };
  if (!data.owner_email && currentUser?.email && !isNoEmailAuthEmail(currentUser.email)) data.owner_email = currentUser.email.toLowerCase();
  if (data.owner_email) data.owner_email = String(data.owner_email).toLowerCase();
  const ref = await addDoc(collection(requireDb(), "pcomps"), clean(data));
  return { id: ref.id, ...data };
}
export async function updateCompetition(id, patch) {
  await updateDoc(doc(requireDb(), "pcomps", id), clean(patch));
  return { id, ...patch };
}
export async function deleteCompetition(id) {
  // نجلب المسابقة أولاً: استعلام قائمة التواصل يتطلّب فلتر tournament_id (انظر fetchPredictorContacts)
  const comp = await fetchCompetition(id);
  await deleteWhere("predictions", "competition_id", id);
  await deleteWhere("predictors", "competition_id", id);
  if (comp) {
    const contacts = await fetchPredictorContacts(id, comp.tournament_id);
    await batchOp(contacts.map((c) => doc(requireDb(), "predictorContacts", c.id)), (b, ref) => b.delete(ref));
  }
  await deleteDoc(doc(requireDb(), "pcomps", id));
}

// ---- المتوقّعون (تسجيل) ----------------------------------------------------

const predKey = (compId, uid) => `${compId}__${uid}`;

// تسجيل مشارك: وثيقة عامّة (اسم الحساب للترتيب) + وثيقة تواصل خاصّة (هاتف/بريد/عمر)
export async function registerPredictor(comp, { name, phone, email, age }) {
  const user = await requirePlatformUser();
  try { await syncMyUserDoc(user); } catch (e) { console.warn(e); }
  const uid = user.uid;
  const id = predKey(comp.id, uid);
  const base = { competition_id: comp.id, tournament_id: comp.tournament_id, uid, created_at: Date.now() };
  const displayName = accountName(user) || String(name || "").trim().slice(0, 60);
  const phoneStr = phone ? String(phone).trim().slice(0, 40) : null;
  // كتابة ذرّية: إمّا الوثيقتان معاً (اسم عامّ + تواصل خاصّ) أو لا شيء — لا حالة نصفيّة
  const d = requireDb();
  const b = writeBatch(d);
  b.set(doc(d, "predictors", id), clean({
    ...base, name: displayName, verified: true,
  }));
  // البريد الاصطناعي (@no-email…) ليس وسيلة تواصل حقيقية — لا يُعرض للمنظّم
  const realEmail = user.email && !isNoEmailAuthEmail(user.email) ? user.email : (email || "");
  b.set(doc(d, "predictorContacts", id), clean({
    ...base,
    phone: phoneStr,
    phone_verified: false,
    email: String(realEmail).trim().toLowerCase().slice(0, 120) || null,
    age: (age == null || age === "") ? null : Math.trunc(Number(age)),
  }));
  await b.commit();
  return { id, uid, name: displayName, verified: true };
}

// اعتماد مشارك «قيد الموافقة» — لمدير المنصّة فقط (تفرضه القواعد)
export async function approvePredictor(predictorId) {
  await updateDoc(doc(requireDb(), "predictors", predictorId), { verified: true });
}

// تعديل بيانات مشارك بيد المنظّم: الاسم و«تسوية النقاط» في predictors،
// والهاتف/البريد/العمر في predictorContacts (تُنشأ إن كانت ناقصة).
export async function adminUpdateParticipant(comp, uid, { name, phone, email, age, pointsAdj }) {
  const d = requireDb();
  const id = predKey(comp.id, uid);
  await updateDoc(doc(d, "predictors", id), clean({
    name: String(name || "").trim().slice(0, 60),
    points_adj: Math.max(-9999, Math.min(9999, Math.trunc(Number(pointsAdj) || 0))),
  }));
  const patch = {
    phone: phone ? String(phone).trim().slice(0, 40) : null,
    email: email ? String(email).trim().toLowerCase().slice(0, 120) : null,
    age: (age == null || age === "") ? null : Math.trunc(Number(age)),
  };
  const ref = doc(d, "predictorContacts", id);
  let snap = null;
  try { snap = await getDoc(ref); } catch {}
  if (snap && snap.exists()) {
    const old = snap.data() || {};
    // تغيير الرقم بيد المنظّم يُسقط شارة «موثّق» (تفرضه القواعد أيضاً)
    if ((old.phone || null) !== patch.phone) patch.phone_verified = false;
    await updateDoc(ref, clean(patch));
  } else {
    await setDoc(ref, clean({
      competition_id: comp.id, tournament_id: comp.tournament_id, uid,
      ...patch, phone_verified: false, created_at: Date.now(),
    }));
  }
}

// حذف مشارك بالكامل: توقّعاته ثم وثيقة تواصله ثم وثيقته (صلاحية المنظّم تفرضها القواعد)
export async function deleteParticipant(comp, uid) {
  const d = requireDb();
  const id = predKey(comp.id, uid);
  const preds = await fetchMyPredictions(comp.id, uid);
  await batchOp(preds.map((p) => doc(d, "predictions", p.id)), (b, ref) => b.delete(ref));
  try { await deleteDoc(doc(d, "predictorContacts", id)); } catch (e) { console.warn(e); }  // قد لا توجد وثيقة تواصل
  await deleteDoc(doc(d, "predictors", id));
}

// تعديل اسم المشارك ووثيقة تواصله
export async function updateMyPredictor(comp, uid, { name, phone, email, age }) {
  const user = await requirePlatformUser();
  if (uid && uid !== user.uid) throw new Error("user mismatch");
  const id = predKey(comp.id, user.uid);
  const phoneStr = phone ? String(phone).trim().slice(0, 40) : null;
  const displayName = accountName(user) || String(name || "").trim().slice(0, 60);
  // (B9) لا نُسقط شارة «هاتف موثّق» إلا إذا تغيّر الرقم فعلاً
  let oldContact = null;
  try { oldContact = (await getDoc(doc(requireDb(), "predictorContacts", id))).data() || null; } catch {}
  const phoneUnchanged = oldContact && (oldContact.phone || null) === phoneStr;
  // البريد الاصطناعي (@no-email…) ليس وسيلة تواصل — لا نخزّنه للمنظّم
  const realEmail = user.email && !isNoEmailAuthEmail(user.email) ? user.email : (email || "");
  await updateDoc(doc(requireDb(), "predictors", id), { name: displayName });
  await updateDoc(doc(requireDb(), "predictorContacts", id), clean({
    phone: phoneStr,
    phone_verified: phoneUnchanged ? (oldContact.phone_verified === true) : false,
    email: String(realEmail).trim().toLowerCase().slice(0, 120) || null,
    age: (age == null || age === "") ? null : Math.trunc(Number(age)),
  }));
}

export async function fetchMyPredictor(compId, uid) {
  if (!uid) return null;
  const s = await getDoc(doc(requireDb(), "predictors", predKey(compId, uid)));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}
export async function fetchMyContact(compId, uid) {
  if (!uid) return null;
  try {
    const s = await getDoc(doc(requireDb(), "predictorContacts", predKey(compId, uid)));
    return s.exists() ? { id: s.id, ...s.data() } : null;
  } catch { return null; }
}
export async function fetchPredictors(compId) {
  const snap = await getDocs(query(collection(requireDb(), "predictors"), where("competition_id", "==", compId)));
  return mapDocs(snap);
}

// تصفير نقاط المسابقة: حذف كل توقّعاتها + إرجاع «تسوية النقاط» صفراً.
// المشاركون يبقون مسجّلين — لبدء جولة جديدة من الصفر. يعيد عدد المشاركين.
export async function resetCompetitionPoints(comp) {
  const d = requireDb();
  await deleteWhere("predictions", "competition_id", comp.id);
  const preds = await fetchPredictors(comp.id);
  await batchOp(
    preds.filter((p) => (p.points_adj || 0) !== 0).map((p) => doc(d, "predictors", p.id)),
    (b, ref) => b.update(ref, { points_adj: 0 })
  );
  return preds.length;
}
// قائمة التواصل الكاملة — للمنظّم فقط (تفشل للمستخدم العادي بحكم القواعد).
// فلتر tournament_id إلزامي: قواعد القوائم في Firestore تُثبَت من شكل الاستعلام،
// وقاعدة القراءة تعتمد على tournament_id — بدونه يُرفض الاستعلام حتى للمالك.
export async function fetchPredictorContacts(compId, tid) {
  const snap = await getDocs(query(collection(requireDb(), "predictorContacts"),
    where("competition_id", "==", compId), where("tournament_id", "==", tid)));
  return mapDocs(snap);
}

// ---- التوقّعات -------------------------------------------------------------

export async function fetchPredictions(compId) {
  const snap = await getDocs(query(collection(requireDb(), "predictions"), where("competition_id", "==", compId)));
  return mapDocs(snap);
}
export async function fetchMyPredictions(compId, uid) {
  if (!uid) return [];
  const snap = await getDocs(query(collection(requireDb(), "predictions"),
    where("competition_id", "==", compId), where("uid", "==", uid)));
  return mapDocs(snap);
}
// كل توقّعات مباراة واحدة (عبر كل المسابقات) — استعلام بحقل واحد (بلا فهرس مركّب)
export async function fetchPredictionsForMatch(matchId) {
  if (!matchId) return [];
  const snap = await getDocs(query(collection(requireDb(), "predictions"), where("match_id", "==", matchId)));
  return mapDocs(snap);
}

// حفظ توقّع لمباراة واحدة (معرّف ثابت يمنع التكرار). القواعد تمنع الحفظ بعد بدء المباراة.
export async function savePrediction(comp, match, home, away) {
  const user = await requirePlatformUser();
  const uid = user.uid;
  const id = predKey(comp.id, uid) + "__" + match.id;
  const data = {
    competition_id: comp.id, tournament_id: comp.tournament_id, match_id: match.id, uid,
    home: Math.trunc(Number(home)), away: Math.trunc(Number(away)), created_at: Date.now(),
  };
  await setDoc(doc(requireDb(), "predictions", id), clean(data));
  return { id, ...data };
}

// حذف توقّع واحد (بيد المنظّم — للغش مثلاً). تُسقط نقاطه تلقائياً عند إعادة الاحتساب،
// إذ يُحتسب الترتيب من التوقّعات الموجودة فقط (computePredictionStandings)
export async function deletePrediction(id) {
  if (!id) throw new Error("missing prediction id");
  await deleteDoc(doc(requireDb(), "predictions", id));
}

// ---- الاحتساب (دوال صرفة) --------------------------------------------------

export function compScoring(comp) {
  return {
    exact: comp?.pts_exact ?? 5,
    diff: comp?.pts_diff ?? 3,
    outcome: comp?.pts_outcome ?? 2,
  };
}

// هل المباراة قابلة للتوقّع الآن؟ (مجدولة، لها طرفان، ولم يحُن موعد بدئها بعد)
export function isPredictable(m) {
  if (m.status !== "scheduled" || !m.home_team_id || !m.away_team_id) return false;
  if (m.locks_at != null && Date.now() >= m.locks_at) return false;   // حان الموعد → مقفلة
  return true;
}

// نقاط توقّع واحد لمباراة منتهية (null إن لم تُحتسب المباراة بعد)
export function predictionPoints(pred, match, cfg) {
  if (!isCounted(match)) return null;
  const ph = pred.home, pa = pred.away;
  if (ph == null || pa == null) return 0;
  const ah = match.home_score, aa = match.away_score;
  if (ph === ah && pa === aa) return cfg.exact;          // النتيجة بالضبط
  const as = Math.sign(ah - aa), ps = Math.sign(ph - pa);
  if (as !== ps) return 0;                                // اتجاه خاطئ
  if (ah - aa === ph - pa) return cfg.diff;               // الاتجاه + الفارق صحيح
  return cfg.outcome;                                     // الاتجاه فقط
}

// جدول ترتيب المتوقّعين — يجمع النقاط عبر المباريات المنتهية لكل مشارك
// (نبدأ من «تسوية النقاط» points_adj إن وضعها المنظّم: مكافأة أو خصم يدوي)
export function computePredictionStandings(predictors, predictions, matches, comp) {
  const cfg = compScoring(comp);
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const rows = new Map();
  for (const p of predictors) rows.set(p.uid, { predictor: p, points: Math.trunc(p.points_adj || 0), exact: 0, hits: 0, scored: 0, predicted: 0 });
  // إزالة التكرار: توقّع واحد فقط لكل (مشارك، مباراة) = الأحدث (created_at) —
  // يمنع احتساب وثيقة توقّع قديمة بمعرّف مختلف مرّتين فتُضخّم النقاط (مثلاً 5+2=7 بدل 5).
  const best = new Map();
  for (const pred of predictions) {
    if (pred.uid == null || pred.match_id == null) continue;
    const key = pred.uid + "|" + pred.match_id;
    const prev = best.get(key);
    if (!prev || (pred.created_at ?? 0) >= (prev.created_at ?? 0)) best.set(key, pred);
  }
  for (const pred of best.values()) {
    const row = rows.get(pred.uid);
    if (!row) continue;                                   // توقّع بلا تسجيل — نتجاهله
    const m = matchById.get(pred.match_id);
    if (!m) continue;
    row.predicted++;
    const pts = predictionPoints(pred, m, cfg);
    if (pts == null) continue;                            // المباراة لم تنتهِ
    row.scored++;
    row.points += pts;
    if (pts > 0) row.hits++;
    if (m.home_score === pred.home && m.away_score === pred.away) row.exact++;
  }
  const list = [...rows.values()];
  list.sort((a, b) =>
    b.points - a.points || b.exact - a.exact || b.hits - a.hits ||
    String(a.predictor.name || "").localeCompare(String(b.predictor.name || ""), "ar"));
  return list.map((r, i) => ({ ...r, rank: i + 1 }));
}

// ---- اشتراك حيّ لمسابقة (جدول ترتيب مباشر) ---------------------------------
//  onSnapshot على المتوقّعين والتوقّعات: بعد اللقطة الأولى لا يُحاسَب إلا على التغييرات.
const compCache = new Map(); // compId -> { predictors, predictions, ready }
export function getCompCache(compId) {
  const c = compCache.get(compId);
  return c && c.ready ? { predictors: [...c.predictors], predictions: [...c.predictions] } : null;
}
export function subscribeCompetition(compId, onChange) {
  if (!db) return () => {};
  const c = { predictors: [], predictions: [], ready: false };
  compCache.set(compId, c);
  const delivered = new Set();
  let t = null;
  const emit = () => { clearTimeout(t); t = setTimeout(() => { if (c.ready) onChange(); }, 250); };
  const onColl = (key, snap) => {
    c[key] = mapDocs(snap);
    if (!c.ready) { delivered.add(key); if (delivered.size >= 2) { c.ready = true; onChange(); } }
    else emit();
  };
  const mk = (key, coll) => onSnapshot(
    query(collection(db, coll), where("competition_id", "==", compId)),
    (snap) => onColl(key, snap), (err) => console.error(err));
  const unsubs = [mk("predictors", "predictors"), mk("predictions", "predictions")];
  return () => { clearTimeout(t); compCache.delete(compId); unsubs.forEach((u) => { try { u(); } catch {} }); };
}
