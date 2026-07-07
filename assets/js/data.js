// ============================================================================
//  طبقة الوصول للبيانات (Firebase/Firestore) + حساب الترتيب + المصادقة + التوليد
//  الأسماء المُصدَّرة ثابتة كي تبقى بقية الواجهة كما هي.
// ============================================================================
import { db, auth } from "./firebase.js";
import { OWNER_EMAILS } from "./config.js";
import {
  collection, doc, getDoc, getDocs, query, where,
  addDoc, setDoc, updateDoc, deleteDoc, writeBatch, onSnapshot,
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
  // كل العناوين مخزّنة بحروف صغيرة (owner_email من Firebase، والقائمتان من الواجهة)
  const jobs = [
    low ? getDocs(query(collection(d, "tournaments"), where("owner_email", "==", low))) : Promise.resolve({ docs: [] }),
    low ? getDocs(query(collection(d, "tournaments"), where("admin_emails", "array-contains", low))) : Promise.resolve({ docs: [] }),
    low ? getDocs(query(collection(d, "tournaments"), where("scorer_emails", "array-contains", low))) : Promise.resolve({ docs: [] }),
    u?.uid ? getDocs(query(collection(d, "tournaments"), where("owner_uid", "==", u.uid))) : Promise.resolve({ docs: [] }),
  ];
  const [owned, adminOf, scorerOf, ownedByUid] = await Promise.all(jobs);
  const byId = new Map();
  for (const doc of [...mapDocs(owned), ...mapDocs(adminOf), ...mapDocs(scorerOf), ...mapDocs(ownedByUid)]) byId.set(doc.id, doc);
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
    matches: mapDocs(mt).sort(byMatchOrder),
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
const usernameRe = /^[a-z0-9_]{3,24}$/;

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

export function usernameValid(username) {
  return usernameRe.test(normalizeUsername(username));
}

export function isNoEmailAuthEmail(email) {
  return String(email || "").toLowerCase().endsWith("@" + NO_EMAIL_DOMAIN);
}

function usernameAuthEmail(username) {
  return `${normalizeUsername(username)}@${NO_EMAIL_DOMAIN}`;
}

function usernameBaseFrom(...parts) {
  const raw = parts.filter(Boolean).join("_").toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_");
  const base = raw || "user";
  return base.slice(0, 18).replace(/^_+|_+$/g, "") || "user";
}

async function reserveUsernameForUser(u, preferred, authEmail, realEmail) {
  let base = normalizeUsername(preferred);
  if (!usernameValid(base)) base = usernameBaseFrom(realEmail?.split("@")[0], u.displayName, u.uid.slice(0, 6));
  for (let i = 0; i < 8; i++) {
    const suffix = i === 0 ? "" : "_" + u.uid.slice(0, Math.min(6, 3 + i));
    const candidate = (base + suffix).slice(0, 24);
    if (!usernameValid(candidate)) continue;
    const ref = doc(requireDb(), "usernames", candidate);
    const existing = await getDoc(ref).catch(() => null);
    if (existing?.exists()) {
      if (existing.data()?.uid === u.uid) return candidate;
      continue;
    }
    await setDoc(ref, clean({
      uid: u.uid, username: candidate, auth_email: authEmail,
      email: realEmail || null, created_at: Date.now(),
    }));
    return candidate;
  }
  const fallback = ("user_" + u.uid.slice(0, 12)).slice(0, 24);
  await setDoc(doc(requireDb(), "usernames", fallback), clean({
    uid: u.uid, username: fallback, auth_email: authEmail,
    email: realEmail || null, created_at: Date.now(),
  }));
  return fallback;
}

async function resolveLoginIdentifier(identifier) {
  const raw = String(identifier || "").trim();
  if (raw.includes("@")) return raw.toLowerCase();
  const username = normalizeUsername(raw);
  if (!usernameValid(username)) return raw;
  const s = await getDoc(doc(requireDb(), "usernames", username));
  return s.exists() ? String(s.data().auth_email || "").toLowerCase() : raw;
}

export async function signIn(identifier, password) {
  const login = await resolveLoginIdentifier(identifier);
  const cred = await signInWithEmailAndPassword(auth, login, password);
  try { await syncMyUserDoc(cred.user); } catch {}
  return { user: cred.user };
}

// تسجيل جديد: إنشاء حساب + رسالة تأكيد البريد + وثيقة في users (تظهر لمانحي الصلاحيات)
export async function signUp(email, password, username) {
  const realEmail = String(email || "").trim().toLowerCase();
  const uname = normalizeUsername(username);
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
  if (cur && !cur.email) {
    cred = await linkWithCredential(cur, EmailAuthProvider.credential(addr, password));
  } else {
    cred = await createUserWithEmailAndPassword(auth, addr, password);
  }
  const displayName = uname.slice(0, 60);
  try { if (displayName) await updateProfile(cred.user, { displayName }); } catch {}
  if (realEmail) {
    try { await sendEmailVerification(cred.user); } catch (e) { console.warn(e); }
  }
  const d = requireDb();
  const base = {
    email: realEmail,
    auth_email: addr.toLowerCase(),
    username: uname,
    name: displayName,
    created_at: Date.now(),
    verified: !!(realEmail && cred.user.emailVerified),
    approved: !realEmail ? false : !!cred.user.emailVerified,
    no_email: !realEmail,
  };
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
    try { await deleteUser(cred.user); } catch {}
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
      approved: !!(email && u.emailVerified),
      no_email: noEmail,
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
  if (verified && cur.approved !== true) patch.approved = true;
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

export async function isApprovedAccount() {
  const u = currentUser;
  if (!u || u.isAnonymous) return false;
  if (u.email && !isNoEmailAuthEmail(u.email) && u.emailVerified) return true;
  const doc = await fetchMyUserDoc(u.uid);
  return doc?.approved === true;
}

function accountKeyOf(u = currentUser, userDoc = currentUserDoc) {
  if (!u) return "";
  if (u.email && !isNoEmailAuthEmail(u.email) && u.emailVerified) return u.email.toLowerCase();
  return userDoc?.approved === true ? `uid:${u.uid}` : "";
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

// مدير منصّة: المالك دائماً، أو بريده في admins (صلاحيات على كل التورنيرات)
export async function amIPlatformAdmin() {
  const u = currentUser;
  if (!u || !u.email || isNoEmailAuthEmail(u.email) || !u.emailVerified) return false;
  return isOwnerEmail(u.email) || hasDoc("admins", u.email.toLowerCase());
}

// حساب فعّال: بريد مؤكّد تلقائياً أو حساب بلا بريد وافق عليه المالك.
export async function isInMembers() {
  const u = currentUser;
  if (!u || u.isAnonymous) return false;
  if (u.email && !isNoEmailAuthEmail(u.email) && u.emailVerified) return true;
  return (await fetchMyUserDoc(u.uid))?.approved === true;
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
export async function setUserApproved(uid, on) {
  await updateDoc(doc(requireDb(), "users", uid), { approved: !!on });
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

// موعد قفل التوقّع = لحظة بدء المباراة (تاريخ+وقت محلّيان) بالمللي ثانية، أو null إن نقص أحدهما
export function matchLockMillis(date, time) {
  if (!date || !time) return null;
  const [y, m, d] = String(date).split("-").map(Number);
  if (!y || !m || !d) return null;
  const [hh, mm] = String(time).split(":").map(Number);
  const ms = new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0).getTime();
  return Number.isFinite(ms) ? ms : null;
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
  // إن مسّ التعديل التاريخ/الوقت نعيد حساب موعد قفل التوقّع
  if ("match_date" in p || "match_time" in p) p.locks_at = matchLockMillis(p.match_date, p.match_time);
  await updateDoc(doc(requireDb(), "matches", id), clean(p));
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
  const patch = { home_score: home, away_score: away };
  if (teamGoalEvents >= curScore) { // هدف جديد
    if (isHome) patch.home_score = home + 1; else patch.away_score = away + 1;
  }
  if (match.status === "scheduled") patch.status = "live";
  await updateMatch(match.id, patch);
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

// ضبط النتيجة مباشرةً (أزرار +/-)
export async function bumpScore(match, isHome, delta) {
  const home = match.home_score ?? 0, away = match.away_score ?? 0;
  const patch = { home_score: home, away_score: away };
  if (isHome) patch.home_score = Math.max(0, home + delta); else patch.away_score = Math.max(0, away + delta);
  if (match.status === "scheduled" && delta > 0) patch.status = "live";
  await updateMatch(match.id, patch);
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

  // متأهّلو كل بيت مرتّبين حسب المرتبة (رتبة 0 = بطل البيت، 1 = وصيف…)
  const tiers = []; // tiers[rank] = [{ team, gi }]
  groups.forEach((g, gi) => {
    const gTeams = teams.filter((tm) => tm.group_id === g.id);
    computeGroupStandings(gTeams, matches, points).slice(0, perGroup)
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
    if (next[slot] !== w) { await updateMatch(next.id, { [slot]: w }); next[slot] = w; changed++; }
  }
  return changed;
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
    c[coll] = mapDocs(snap).sort(sorters[coll]);
    if (!c.ready) { delivered.add(coll); if (delivered.size >= 5) c.ready = true; } // أول تهيئة بلا onChange
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
  if (u.email && !isNoEmailAuthEmail(u.email) && u.emailVerified) return true;
  return currentUserDoc?.id === u.uid && currentUserDoc.approved === true;
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
  const err = new Error("يجب تسجيل الدخول بحساب منصة مؤكَّد للمشاركة");
  err.code = u && !u.isAnonymous
    ? (u.email && !isNoEmailAuthEmail(u.email) ? "auth/email-not-verified" : "auth/approval-required")
    : "auth/login-required";
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
  b.set(doc(d, "predictorContacts", id), clean({
    ...base,
    phone: phoneStr,
    phone_verified: false,
    email: String(user.email || email || "").trim().toLowerCase().slice(0, 120),
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
  await updateDoc(doc(requireDb(), "predictors", id), { name: displayName });
  await updateDoc(doc(requireDb(), "predictorContacts", id), clean({
    phone: phoneStr,
    phone_verified: false,
    email: String(user.email || email || "").trim().toLowerCase().slice(0, 120),
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
  for (const pred of predictions) {
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
