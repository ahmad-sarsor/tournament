// ============================================================================
//  طبقة الوصول للبيانات (Firebase/Firestore) + حساب الترتيب + المصادقة + التوليد
//  الأسماء المُصدَّرة ثابتة كي تبقى بقية الواجهة كما هي.
// ============================================================================
import { db, auth } from "./firebase.js";
import {
  collection, doc, getDoc, getDocs, query, where,
  addDoc, updateDoc, deleteDoc, writeBatch, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  signInWithEmailAndPassword, signOut as fbSignOut, onAuthStateChanged,
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

export async function fetchTournaments() {
  const snap = await getDocs(collection(requireDb(), "tournaments"));
  return mapDocs(snap).sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
      String(b.start_date || "").localeCompare(String(a.start_date || ""))
  );
}

export async function fetchTournament(id) {
  const s = await getDoc(doc(requireDb(), "tournaments", id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

export async function fetchTournamentBundle(tid) {
  const d = requireDb();
  const [g, tm, mt] = await Promise.all([
    getDocs(query(collection(d, "groups"), where("tournament_id", "==", tid))),
    getDocs(query(collection(d, "teams"), where("tournament_id", "==", tid))),
    getDocs(query(collection(d, "matches"), where("tournament_id", "==", tid))),
  ]);
  return {
    groups: mapDocs(g).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    teams: mapDocs(tm).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    matches: mapDocs(mt).sort(byMatchOrder),
  };
}

// ---- حساب الترتيب (دوال صرفة) ---------------------------------------------

export function isCounted(m) {
  return m.status === "finished" && m.home_score != null && m.away_score != null;
}

export function computeGroupStandings(teams, matches, points) {
  const P = { win: 3, draw: 1, loss: 0, ...(points || {}) };
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

export async function signOut() { if (auth) await fbSignOut(auth); }

export function onAuthChange(cb) {
  authCbs.add(cb);
  return () => authCbs.delete(cb);
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
  const ref = await addDoc(collection(requireDb(), "tournaments"), clean(p));
  return { id: ref.id, ...p };
}
export async function updateTournament(id, patch) {
  await updateDoc(doc(requireDb(), "tournaments", id), clean(patch));
  return { id, ...patch };
}
export async function deleteTournament(id) {
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
export async function deleteTeam(id) {
  await nullifyWhere("matches", "home_team_id", id);
  await nullifyWhere("matches", "away_team_id", id);
  await deleteDoc(doc(requireDb(), "teams", id));
}

export async function createMatch(p) {
  const ref = await addDoc(collection(requireDb(), "matches"), clean(p));
  return { id: ref.id, ...p };
}
export async function updateMatch(id, patch) {
  await updateDoc(doc(requireDb(), "matches", id), clean(patch));
  return { id, ...patch };
}
export async function deleteMatch(id) {
  await deleteDoc(doc(requireDb(), "matches", id));
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
  for (const g of groups) {
    const groupTeams = teams.filter((t) => t.group_id === g.id);
    const rounds = roundRobinPairs(groupTeams.map((t) => t.id));
    rounds.forEach((pairs, ri) => {
      for (const [home, away] of pairs) {
        rows.push({
          tournament_id: tournamentId, group_id: g.id, round: ri + 1,
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
  const tRef = await addDoc(collection(d, "tournaments"), clean(SAMPLE.tournament));
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
  const mk = (coll) => onSnapshot(
    query(collection(db, coll), where("tournament_id", "==", tid)),
    skipFirst(() => onChange()),
    (err) => console.error(err)
  );
  const unsubs = [
    mk("matches"), mk("teams"), mk("groups"),
    // تغييرات على البطولة نفسها (النقاط/المتأهّلون/الحالة/الاسم)
    onSnapshot(doc(db, "tournaments", tid), skipFirst(() => onChange()), (err) => console.error(err)),
  ];
  return () => unsubs.forEach((u) => { try { u(); } catch {} });
}
