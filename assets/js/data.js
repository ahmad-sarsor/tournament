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
  if (!email) return [];
  const d = requireDb();
  const low = String(email).toLowerCase();
  // كل العناوين مخزّنة بحروف صغيرة (owner_email من Firebase، والقائمتان من الواجهة)
  const [owned, adminOf, scorerOf] = await Promise.all([
    getDocs(query(collection(d, "tournaments"), where("owner_email", "==", low))),
    getDocs(query(collection(d, "tournaments"), where("admin_emails", "array-contains", low))),
    getDocs(query(collection(d, "tournaments"), where("scorer_emails", "array-contains", low))),
  ]);
  const byId = new Map();
  for (const doc of [...mapDocs(owned), ...mapDocs(adminOf), ...mapDocs(scorerOf)]) byId.set(doc.id, doc);
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

  const counted = matches.filter(
    (m) => isCounted(m) && rows.has(m.home_team_id) && rows.has(m.away_team_id)
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
const authCbs = new Set();
let markReady;
const authReady = new Promise((r) => (markReady = r));
if (auth) {
  onAuthStateChanged(auth, (u) => {
    currentUser = u;
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

export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return { user: cred.user };
}

// تسجيل جديد: إنشاء حساب + رسالة تأكيد البريد + وثيقة في users (تظهر لمانحي الصلاحيات)
export async function signUp(email, password, name) {
  const cred = await createUserWithEmailAndPassword(auth, String(email || "").trim(), password);
  const displayName = (name || "").trim().slice(0, 60);
  try { if (displayName) await updateProfile(cred.user, { displayName }); } catch {}
  // تأكيد البريد إلزامي لأي صلاحية كتابة (تفرضه firestore.rules)
  try { await sendEmailVerification(cred.user); } catch (e) { console.warn(e); }
  await setDoc(doc(requireDb(), "users", cred.user.uid), clean({
    email: (cred.user.email || "").toLowerCase(),
    name: displayName || cred.user.email || "",
    created_at: Date.now(),
    verified: !!cred.user.emailVerified,
  }));
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
  const s = currentUser ? { user: currentUser } : null;
  authCbs.forEach((cb) => { try { cb(s); } catch (e) { console.error(e); } });
  return s;
}

// مزامنة وثيقة المستخدم (الاسم/حالة التوثيق) — تُنشأ أيضاً عند أول دخول Google
export async function syncMyUserDoc(u = currentUser) {
  if (!u || !db) return;
  const ref = doc(requireDb(), "users", u.uid);
  let snap = null;
  try { snap = await getDoc(ref); } catch { return; } // قبل نشر القواعد الجديدة قد تُرفض القراءة
  const email = (u.email || "").toLowerCase();
  if (!snap.exists()) {
    try {
      await setDoc(ref, clean({
        email,
        name: (u.displayName || email || "").slice(0, 60),
        created_at: Date.now(),
        verified: !!u.emailVerified,
      }));
    } catch (e) { console.warn(e); }
    return;
  }
  const cur = snap.data() || {};
  const patch = {};
  if (!!cur.verified !== !!u.emailVerified) patch.verified = !!u.emailVerified;
  const nm = (u.displayName || "").trim().slice(0, 60);
  if (nm && nm !== cur.name) patch.name = nm;
  if (Object.keys(patch).length) {
    try { await updateDoc(ref, patch); } catch (e) { console.warn(e); }
  }
}

// هل دخل المستخدم ببريد/كلمة مرور؟ (تغيير كلمة المرور متاح لهؤلاء فقط)
export function passwordProvider() {
  return !!auth?.currentUser?.providerData?.some((p) => p.providerId === "password");
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
  if (!u || !u.email) return false;
  return isOwnerEmail(u.email) || hasDoc("admins", u.email.toLowerCase());
}

// عضو معتمَد: بريده في members (يُنشئ تورنيرات). فحص وثيقته فقط دون تكرار فحص المنصّة.
export async function isInMembers() {
  const u = currentUser;
  if (!u || !u.email) return false;
  return hasDoc("members", u.email.toLowerCase());
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
  // منشئ التورنير = مالكه (تفرضه القواعد: owner_email == uemail() المُصغَّر)
  const data = { ...p };
  if (!data.owner_email && currentUser?.email) data.owner_email = currentUser.email;
  if (data.owner_email) data.owner_email = String(data.owner_email).toLowerCase();
  const ref = await addDoc(collection(requireDb(), "tournaments"), clean(data));
  return { id: ref.id, ...data };
}
export async function updateTournament(id, patch) {
  await updateDoc(doc(requireDb(), "tournaments", id), clean(patch));
  return { id, ...patch };
}
export async function deleteTournament(id) {
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

export async function createMatch(p) {
  const data = { ...p };
  // ختم لحظة البدء عند إنشاء مباراة مباشرة مباشرةً (نادر لكن للاكتمال)
  if (data.status === "live" && data.live_started_at === undefined) data.live_started_at = Date.now();
  const ref = await addDoc(collection(requireDb(), "matches"), clean(data));
  return { id: ref.id, ...data };
}
export async function updateMatch(id, patch) {
  const p = { ...patch };
  // عند أي انتقال إلى «مباشر» نختم لحظة البدء (يغطّي زر البدء، إعادة الفتح، أول هدف، نموذج التعديل)
  if (p.status === "live" && p.live_started_at === undefined) p.live_started_at = Date.now();
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

export async function insertMatches(rows) {
  if (!rows.length) return [];
  const d = requireDb();
  for (let i = 0; i < rows.length; i += 450) {
    const b = writeBatch(d);
    for (const row of rows.slice(i, i + 450)) b.set(doc(collection(d, "matches")), clean(row));
    await b.commit();
  }
  return rows;
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
  // القواعد تشترط owner_email == بريد المُنشئ (بحروف صغيرة)
  const tRef = await addDoc(collection(d, "tournaments"),
    clean({ ...SAMPLE.tournament, owner_email: (currentUser?.email || "").toLowerCase() }));
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
