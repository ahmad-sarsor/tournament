// ============================================================================
//  التطبيق العام (العرض للزوّار): توجيه، قائمة البطولات، البرنامج، الترتيب
// ============================================================================
import { isConfigured } from "./firebase.js";
import { SITE_NAME } from "./config.js";
import { t, statusLabel, matchStatusLabel, formatDate, formatTime, weekdayName } from "./i18n.js";
import { el, mount, clear, spinner, emptyState, toast } from "./util.js";
import {
  fetchTournaments, fetchTournament, fetchTournamentBundle, subscribeTournament, isCounted, computeGroupStandings,
  getSession, onAuthChange, signOut, amIPlatformAdmin, isOwnerEmail, syncMyUserDoc,
  isNoEmailAuthEmail,
} from "./data.js";
import { renderScheduleDays, standingsTable, eventsTimeline, renderBracket, teamForm, formGuide } from "./render.js";
import { openSettings, applyPrefs } from "./settings.js";

const app = document.getElementById("app");
const brandName = document.getElementById("brand-name");
if (SITE_NAME) { brandName.textContent = SITE_NAME; document.title = SITE_NAME; }

applyPrefs();

// حالة الدخول (نفس جلسة لوحة الإدارة) — تُظهر زر الخروج وزر إدارة المباراة للمخوَّلين
let session = null;
const authLink = document.querySelector(".header-auth");
function renderAuthLink() {
  if (!authLink) return;
  // الحساب المجهول القديم ليس «دخولاً» للوحة المنظّم
  const real = session?.user && !session.user.isAnonymous && session.user.email;
  if (real) { authLink.textContent = "لوحتي"; authLink.setAttribute("href", "./admin.html"); }
  else { authLink.textContent = "دخول / تسجيل"; authLink.setAttribute("href", "./admin.html#/register"); }
}
getSession().then((s) => {
  session = s;
  if (isSignedPlatformUser(session?.user)) syncMyUserDoc(session.user).catch(() => {});
  renderAuthLink();
}).catch(() => {});
onAuthChange((s) => {
  session = s;
  if (isSignedPlatformUser(session?.user)) syncMyUserDoc(session.user).catch(() => {});
  renderAuthLink();
});

document.getElementById("settings-btn")?.addEventListener("click", () => openSettings({
  isAdmin: false,
  // الحساب المجهول القديم ليس جلسة منظّم
  session: (session?.user && !session.user.isAnonymous && session.user.email) ? session : null,
  onSignOut: async () => { try { await signOut(); } catch {} location.reload(); },
}));

const AUTH_RETURN_KEY = "tp_auth_return";
function isSignedPlatformUser(u) {
  return !!(u && !u.isAnonymous && u.email);
}
// (D5) مفتاح العودة مع طابع زمني — لا يخطف دخولاً بعد أيام
function saveAuthReturn() {
  try { localStorage.setItem(AUTH_RETURN_KEY, JSON.stringify({ url: location.href, ts: Date.now() })); } catch {}
}
// (A1) «دخول / تسجيل» من الرأس يحفظ صفحة العودة
authLink?.addEventListener("click", () => { if (!isSignedPlatformUser(session?.user)) saveAuthReturn(); });

let currentUnsub = null;              // إلغاء اشتراك التحديث اللحظي الحالي
function cleanup() {
  if (currentUnsub) { currentUnsub(); currentUnsub = null; }
}

// تمرير تلقائي لبرنامج المباريات عند فتح التبويب فقط (لا مع التحديث اللحظي)
let scheduleAnchorPending = false;
function consumeAnchorPending() { const v = scheduleAnchorPending; scheduleAnchorPending = false; return v; }

// ---- التوجيه (Hash routing) -----------------------------------------------

const KNOWN_TABS = ["schedule", "standings", "knockout", "teams", "stats"];
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean);
  // "" | "t/:id" | "t/:id/:tab" | "t/:id/m/:matchId" | "t/:id/team/:teamId"
  if (parts[0] === "t" && parts[1]) {
    if (parts[2] === "m" && parts[3]) return { view: "match", id: parts[1], matchId: parts[3] };
    if (parts[2] === "team" && parts[3]) return { view: "team", id: parts[1], teamId: parts[3] };
    const tab = KNOWN_TABS.includes(parts[2]) ? parts[2] : "schedule";   // (D8-عام) تبويب مجهول → البرنامج
    return { view: "tournament", id: parts[1], tab };
  }
  return { view: "home" };
}

// (A6) ذاكرة تمرير لكل صفحة: الرجوع يعيدك حيث كنت، والدخول الجديد يبدأ من الأعلى
const scrollMemory = new Map();   // hash -> scrollY
let lastRouteHash = null;
let suppressNextAnchor = false;   // يمنع قفزة «يوم المرساة» عند العودة لصفحة محفوظة التمرير
// (D1) رجوع ذكي: إن وصل المستخدم من داخل الموقع فسهم الرجوع = زر رجوع المتصفح
// (يعود للترتيب/الإحصائيات التي جاء منها)، وإلا (رابط عميق) يتبع الرابط الثابت
let internalNavs = 0;
function smartBackHandler(e) {
  if (internalNavs > 1) { e.preventDefault(); history.back(); }
}
// (B1) رمز تنقّل: كل عرض يتحقق أن المستخدم ما زال على صفحته قبل الرسم/الاشتراك
let navSeq = 0;
const stillCurrent = (my) => my === navSeq;

async function route() {
  const my = ++navSeq;
  internalNavs++;
  if (lastRouteHash !== null) scrollMemory.set(lastRouteHash, scrollY);   // احفظ موضع الصفحة السابقة
  lastRouteHash = location.hash;
  cleanup();
  if (!isConfigured) return renderSetupNeeded();
  const r = parseHash();
  const savedScroll = scrollMemory.get(location.hash);
  suppressNextAnchor = savedScroll != null;   // عائد لصفحة زارها — لا قفزة مرساة (A6)
  try {
    if (r.view === "match") await renderMatchDetail(r.id, r.matchId, my);
    else if (r.view === "team") await renderTeamDetail(r.id, r.teamId, my);
    else if (r.view === "tournament") await renderTournament(r.id, r.tab, r, my);
    else await renderHome(my);
    if (!stillCurrent(my)) return;
    if (savedScroll != null) requestAnimationFrame(() => { if (stillCurrent(my)) window.scrollTo(0, savedScroll); });
    else window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    if (stillCurrent(my)) renderError(err);
  }
}

window.addEventListener("hashchange", route);
// هذا السكربت وحدة ES (deferred) فيعمل بعد تحليل DOM، لذا نستدعي route مرة واحدة فقط
route();

// ---- شاشات مساعدة ----------------------------------------------------------

function renderSetupNeeded() {
  mount(app,
    el("div.page-head", {}, [el("h1.page-title", { text: t.setupTitle })]),
    el("div.alert.alert-warn", { text: t.setupBody }),
    el("div.card.card-pad", {}, [
      el("p", { html: "افتح الملف <code>assets/js/config.js</code> وألصق كائن <b>firebaseConfig</b> من إعدادات مشروع Firebase (apiKey و projectId وغيرها)." }),
      el("p", { html: "الخطوات الكاملة في ملف <code>README.md</code>." }),
    ]),
  );
}

function renderError(err) {
  mount(app,
    el("div.alert.alert-error", {}, [
      el("b", { text: "تعذّر تحميل البيانات. " }),
      el("span", { text: String(err?.message || err || "") }),
    ]),
    el("button.btn.btn-outline", { text: "إعادة المحاولة", onclick: route }),
  );
}

function loading() { mount(app, spinner()); }

// ---- الصفحة الرئيسية: قائمة البطولات ---------------------------------------

async function renderHome(nav) {
  loading();
  document.title = SITE_NAME || "منصّة البطولات";   // (D6) لا يبقى عنوان بطولة سابقة
  const tournaments = await fetchTournaments();
  if (nav != null && !stillCurrent(nav)) return;     // (B1) غادر المستخدم أثناء الجلب
  const head = el("div.page-head", {}, [
    el("h1.page-title", { text: t.tournaments }),
    el("p.page-sub", { text: t.siteTagline }),
  ]);
  if (!tournaments.length) {
    return mount(app, head, emptyState("🏆", "لا توجد بطولات بعد"));
  }
  // (D2) نعرض البطاقات فوراً، وتُملأ إحصاءات كل بطولة تدريجياً عند وصولها —
  // أبطأ بطولة لم تعد تحجب القائمة كلها خلف سبينر
  const grid = el("div.grid.cols");
  const cards = tournaments.map((tr) => {
    const card = tournamentCard(tr, null);
    grid.appendChild(card);
    return card;
  });
  mount(app, head, grid);
  tournaments.forEach((tr, i) => {
    fetchTournamentBundle(tr.id).then((b) => {
      if (nav != null && !stillCurrent(nav)) return;
      const stats = {
        total: b.matches.length,
        done: b.matches.filter((m) => m.status === "finished").length,
        teams: b.teams.length,
        groups: b.groups.length,
      };
      const fresh = tournamentCard(tr, stats);
      if (cards[i].parentNode === grid) grid.replaceChild(fresh, cards[i]);
      cards[i] = fresh;
    }).catch(() => {});
  });
}

function tournamentCard(tr, stats) {
  const dates = [tr.start_date, tr.end_date].filter(Boolean).map(formatDate).join(" ← ");
  const chips = [];
  if (dates) chips.push(el("span", { dir: "auto", style: "white-space:nowrap", text: "📅 " + dates }));
  if (stats && stats.teams) chips.push(el("span", { style: "white-space:nowrap", text: `👥 ${stats.teams} ${stats.teams === 1 ? "فريق" : "فريقاً"}` }));
  if (stats && stats.groups) chips.push(el("span", { style: "white-space:nowrap", text: `🛡️ ${stats.groups} ${stats.groups === 1 ? "بيت" : "بيوت"}` }));
  const pct = stats && stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
  return el("a.t-card", { href: `#/t/${tr.id}` }, [
    el("div", { style: "display:flex;align-items:flex-start;justify-content:space-between;gap:10px" }, [
      el("h3", {}, [el("span.t-emoji", { text: tr.emoji || "🏆" }), tr.name]),
      statusBadge(tr.status),
    ]),
    tr.description ? el("p.meta", { style: "margin-top:6px", text: tr.description }) : null,
    chips.length ? el("div.meta", {}, chips) : null,
    (stats && stats.total) ? el("div.t-progress", {}, [
      el("div.bar", {}, [el("i", { style: `width:${pct}%` })]),
      el("div.lbl", { text: `${stats.done} / ${stats.total} مباراة` }),
    ]) : null,
  ]);
}

function statusBadge(status) {
  const cls = { upcoming: "badge-upcoming", active: "badge-active", finished: "badge-finished" }[status] || "badge-upcoming";
  return el("span.badge." + cls, {}, [
    status === "active" ? el("span.dot") : null,
    statusLabel(status),
  ]);
}

// ---- صفحة البطولة ----------------------------------------------------------

let lastResultsToastAt = 0;   // (A2) توست «تم التحديث» لا يتكرر بإزعاج أثناء البثّ الحيّ
// (A2) اختيارات المستخدم لكل بطولة (فلاتر التبويبات) تثبت عبر تبديل التبويبات
const tournamentUiState = new Map();   // id -> { schedFilters, statsFilters }

async function renderTournament(id, tab, extra = {}, nav = null) {
  loading();
  const tournament = await fetchTournament(id);
  if (nav != null && !stillCurrent(nav)) return;      // (B1) غادر أثناء الجلب — لا نرسم فوق الجديدة
  if (!tournament) return mount(app, emptyState("🔍", "البطولة غير موجودة"),
    el("a.btn.btn-outline", { href: "#/", text: t.backToTournaments }));

  const remembered = tournamentUiState.get(id) || {};
  const state = { ...remembered, tournament, bundle: await fetchTournamentBundle(id), tab };
  tournamentUiState.set(id, state);   // نفس الكائن — أي تعديل لاحق يبقى محفوظاً
  state.mgrCtx = await managerContext();   // لإظهار زر «إدارة البطولة» للمخوَّلين
  if (nav != null && !stillCurrent(nav)) return;      // (B1) فحص ثانٍ بعد كل الجلب
  scheduleAnchorPending = !suppressNextAnchor;   // (A6) لا مرساة عند العودة بتمرير محفوظ
  suppressNextAnchor = false;
  renderTournamentShell(state);

  // تحديث لحظي: أعِد جلب البيانات وأعِد رسم الصفحة (بما فيها بيانات البطولة نفسها)
  const sub = subscribeTournament(id, debounce(async () => {
    // إن غادر المستخدم صفحة هذه البطولة (لصفحة فريق/مباراة/أخرى) لا نُعِد الرسم فوقها.
    let r = parseHash();
    if (!(r.view === "tournament" && r.id === id)) return;
    try {
      const [tr, bundle] = await Promise.all([fetchTournament(id), fetchTournamentBundle(id)]);
      if (!tr) return;
      r = parseHash();                                  // أعِد الفحص بعد الجلب غير المتزامن
      if (!(r.view === "tournament" && r.id === id)) return;
      state.tournament = tr;
      state.bundle = bundle;
      state.tab = r.tab;                                // احترم التبويب الحالي
      renderTournamentShell(state);
      // (A2) التوست مرة كل 45 ثانية على الأكثر — لا وابل إشعارات أثناء مباراة حيّة
      if (Date.now() - lastResultsToastAt > 45000) { lastResultsToastAt = Date.now(); toast("تم تحديث النتائج", "ok"); }
    } catch (e) { console.error(e); }
  }, 400));
  // (B1) لو سبقنا تنقّلٌ جديد أثناء الاشتراك، ألغِ فوراً بدل تسريب المستمعين
  if (nav != null && !stillCurrent(nav)) { try { sub(); } catch {} return; }
  currentUnsub = sub;
}

function renderTournamentShell(state) {
  const { tournament } = state;
  const hasKnockout = (state.bundle.matches || []).some((m) => m.stage === "knockout");
  // (E4) أزرار عادية بـ aria-current — بديل صالح لبنية tablist الناقصة
  const tabs = el("div.tabs", {}, [
    tabBtn(t.schedule, tournament.id, "schedule", state.tab),
    tabBtn(t.standings, tournament.id, "standings", state.tab),
    hasKnockout ? tabBtn(t.knockout, tournament.id, "knockout", state.tab) : null,
    tabBtn(t.teamsTab, tournament.id, "teams", state.tab),
    tabBtn(t.statsTab, tournament.id, "stats", state.tab),
  ]);
  const content = el("div", { id: "tab-content" });
  mount(app,
    el("div", {}, [
      el("a.header-link.back-link", { href: "#/", text: "→ " + t.backToTournaments }),
    ]),
    el("div.page-head", { style: "margin-top:10px" }, [
      el("div", { style: "display:flex;align-items:center;gap:12px;flex-wrap:wrap" }, [
        el("h1.page-title", { text: tournament.name }),
        statusBadge(tournament.status),
        shareBtn(tournament.name),
        // زر «إدارة البطولة» يظهر فقط لمن يملك صلاحية عليها (لا للزائر العادي)
        canManageWith(state.mgrCtx, tournament)
          ? el("a.btn.btn-sm.btn-primary", { href: `./admin.html#/t/${tournament.id}`, text: "⚙️ " + t.manageTournament })
          : null,
      ]),
      tournament.description ? el("p.page-sub", { text: tournament.description }) : null,
    ]),
    tabs,
    content,
  );
  document.title = tournament.name + " · " + (SITE_NAME || "");
  renderTabContent(state);
}

// زرّ المشاركة (Web Share API مع احتياط نسخ الرابط)
function shareBtn(title) {
  return el("button.header-icon-btn", {
    type: "button", title: t.share, "aria-label": t.share, text: "↗",
    onclick: async () => {
      const url = location.href;
      try {
        if (navigator.share) await navigator.share({ title, url });
        else if (navigator.clipboard) { await navigator.clipboard.writeText(url); toast(t.linkCopied, "ok"); }
      } catch (e) { /* أُلغيت المشاركة */ }
    },
  });
}

function tabBtn(label, id, tab, active) {
  return el("button.tab" + (tab === active ? ".active" : ""), {
    text: label,
    "aria-current": tab === active ? "true" : null,   // (E4) القارئ يعرف التبويب المفعّل
    onclick: () => { location.hash = `#/t/${id}/${tab}`; },
  });
}

function renderTabContent(state) {
  const host = document.getElementById("tab-content");
  if (!host) return;
  clear(host);
  if (state.tab === "standings") host.appendChild(renderStandings(state));
  else if (state.tab === "knockout") host.appendChild(renderKnockout(state));
  else if (state.tab === "teams") host.appendChild(renderTeams(state));
  else if (state.tab === "stats") host.appendChild(renderStats(state));
  else host.appendChild(renderSchedule(state));
}

function renderKnockout(state) {
  const { bundle } = state;
  const teamById = new Map(bundle.teams.map((x) => [x.id, x]));
  return el("div", {}, [
    renderBracket(bundle.matches, teamById, { tid: state.tournament.id }),
    el("p.set-hint", { style: "margin-top:14px", text: t.knockoutHint }),
  ]);
}

// ---- تبويب الإحصائيات ------------------------------------------------------

// قائمة فلتر منسدلة موحّدة (خيار «الكل» + بقيّة الخيارات)
function filterSelect(ariaLabel, allLabel, options, onChange, value = "all") {
  const sel = el("select.input.filter-select", {
    "aria-label": ariaLabel,
    onchange: (e) => onChange(e.currentTarget.value),
  }, [el("option", { value: "all", text: allLabel }),
      ...options.map((o) => el("option", { value: o.value, text: o.label }))]);
  sel.value = options.some((o) => o.value === value) ? value : "all";   // (A2) استرجاع الاختيار المحفوظ
  return sel;
}

function renderStats(state) {
  const { bundle, tournament } = state;
  const teamById = new Map(bundle.teams.map((x) => [x.id, x]));
  const groupById = new Map(bundle.groups.map((x) => [x.id, x]));
  const playersById = new Map((bundle.players || []).map((x) => [x.id, x]));
  const points = { win: tournament.win_points ?? 3, draw: tournament.draw_points ?? 1, loss: tournament.loss_points ?? 0 };

  // (A2) فلاتر الإحصائيات في state — تنجو من إعادة الرسم اللحظية
  const sf = state.statsFilters || (state.statsFilters = { group: "all", team: "all" });
  const wrap = el("div");
  const content = el("div");

  // فلاتر منسدلة: البيت + الفريق + مسح الكل
  const selects = [];
  const filters = el("div.filter-selects");
  const addSel = (sel) => { selects.push(sel); filters.appendChild(sel); };
  if (bundle.groups.length > 1)
    addSel(filterSelect(t.filterByGroup, t.allGroups, bundle.groups.map((g) => ({ value: g.id, label: g.name })),
      (v) => { sf.group = v; rerender(); }, sf.group));
  if (bundle.teams.length) {
    const teamsSorted = [...bundle.teams].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name || "").localeCompare(String(b.name || "")));
    addSel(filterSelect(t.filterByTeam, t.allTeams, teamsSorted.map((tm) => ({ value: tm.id, label: tm.name })),
      (v) => { sf.team = v; rerender(); }, sf.team));
  }
  if (filters.children.length) {
    filters.appendChild(el("button.btn.btn-sm.btn-outline.filter-clear", {
      type: "button", text: "✕ " + t.clearFilters,
      onclick: () => { sf.group = sf.team = "all"; selects.forEach((s) => { s.value = "all"; }); rerender(); },
    }));
    wrap.appendChild(filters);
  }
  wrap.appendChild(content);

  // isName: قيمة نصية (اسم هدّاف) — تلتفّ لسطرين بدل قصّها بثلاث نقاط
  function statTile(icon, value, label, isName) {
    return el("div.stat-tile", {}, [
      icon ? el("div.stat-ico", { "aria-hidden": "true", text: icon }) : null,
      el("div.stat-val" + (isName ? ".is-name" : ""), { text: String(value) }),
      el("div.stat-lbl", { text: label }),
    ]);
  }

  function rerender() {
    const activeGroup = sf.group, activeTeam = sf.team;
    const groupTeamIds = activeGroup === "all" ? null : new Set(bundle.teams.filter((x) => x.group_id === activeGroup).map((x) => x.id));
    const inGroup = (tid) => !groupTeamIds || groupTeamIds.has(tid);
    const teamOk = (tid) => activeTeam === "all" || tid === activeTeam;
    const teamName = (tid) => teamById.get(tid)?.name || "—";

    // نطاق البيت (كلا الفريقين). الهدّافون/البطاقات تُحتسب من كل مباريات النطاق —
    // (B3) وعند اختيار فريق تتبع البلاطات مباريات ذلك الفريق كي لا تتناقض مع الجداول
    const scopeMatches = (bundle.matches || []).filter((m) =>
      inGroup(m.home_team_id) && inGroup(m.away_team_id)
      && (activeTeam === "all" || m.home_team_id === activeTeam || m.away_team_id === activeTeam));
    const scopeIds = new Set(scopeMatches.map((m) => m.id));
    const played = scopeMatches.filter(isCounted);   // للبلاطات وإحصاء الفرق (المنتهية فقط)

    const goalMap = new Map(), cardMap = new Map();
    for (const e of bundle.events || []) {
      if (!e.player_id || !scopeIds.has(e.match_id)) continue;
      if (e.type === "goal") { const c = goalMap.get(e.player_id) || { goals: 0, team_id: e.team_id }; c.goals++; goalMap.set(e.player_id, c); }
      else if (e.type === "yellow" || e.type === "red") {
        const c = cardMap.get(e.player_id) || { y: 0, r: 0, team_id: e.team_id };
        if (e.type === "yellow") c.y++; else c.r++;
        cardMap.set(e.player_id, c);
      }
    }
    // نُجمّع حسب (الاسم + الفريق) لا حسب المعرّف: يدمج سجلّات اللاعب المكرّرة في صفّ واحد
    // (لاعب أُضيف مرّتين تُوزَّع أهدافه على معرّفين فيظهر مكرّراً) — ولا نُسقط أحداً.
    const rowsFrom = (map) => {
      const merged = new Map();
      for (const [pid, v] of map.entries()) {
        const p = playersById.get(pid);
        const team_id = p?.team_id || v.team_id;
        const name = p?.name || t.unknownPlayer;
        const key = name + "|" + team_id;
        const row = merged.get(key) || { name, team_id, goals: 0, y: 0, r: 0 };
        row.goals += v.goals || 0; row.y += v.y || 0; row.r += v.r || 0;
        merged.set(key, row);
      }
      return [...merged.values()].filter((row) => teamOk(row.team_id));
    };
    const scorers = rowsFrom(goalMap).sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name, "ar"));
    const cards = rowsFrom(cardMap).sort((a, b) => (b.r - a.r) || (b.y - a.y) || a.name.localeCompare(b.name, "ar"));

    const totalGoals = played.reduce((s, m) => s + (m.home_score || 0) + (m.away_score || 0), 0);
    const avg = played.length ? (totalGoals / played.length).toFixed(1) : "0";

    // إحصائيات الفرق (ضمن نطاق البيت والفريق المختار)
    // (B3) نحسب الترتيب على نطاق البيت كاملاً ثم نصفّي الصفوف بالفريق المختار —
    // تمرير فريق وحيد كان يجعله صِفراً في كل الأعمدة (لا مباريات ضد نفسه)
    const scopeTeams = bundle.teams.filter((x) => inGroup(x.id));
    const teamRows = computeGroupStandings(scopeTeams, bundle.matches, points)
      .filter((r) => teamOk(r.team.id))
      .slice().sort((a, b) => b.gf - a.gf || b.gd - a.gd || a.team.name.localeCompare(b.team.name, "ar"));

    // بلاطات ملخّص
    const tiles = el("div.stat-tiles", {}, [
      statTile("🏟️", played.length, t.statMatchesPlayed),
      statTile("⚽", totalGoals, t.statTotalGoals),
      statTile("📈", avg, t.statAvgGoals),
      statTile("👟", scorers[0] ? scorers[0].name : "—", t.statTopScorer, true),
    ]);

    // ---- عرض موبايل أولاً: قوائم بلا أي تمرير أفقي (اسم + فريق + قيمة) ----
    // ترتيب مشترك عند التساوي: متساوو القيمة يأخذون المركز نفسه
    const withRanks = (rows, keyOf) => {
      let prevKey = null, rank = 0;
      return rows.map((row, i) => {
        const k = keyOf(row);
        if (k !== prevKey) { rank = i + 1; prevKey = k; }
        return { ...row, rank };
      });
    };
    const medal = (r) => ({ 1: "🥇", 2: "🥈", 3: "🥉" }[r]);
    // اسم الفريق سطراً صغيراً تحت اسم اللاعب (رابط لصفحته إن كان موجوداً)
    const slTeam = (tid2) => teamById.get(tid2)
      ? el("a.sl-team", { href: `#/t/${tournament.id}/team/${tid2}`, text: teamName(tid2) })
      : el("span.sl-team", { text: "—" });
    // صفّ قائمة موحّد: المركز + (الاسم فوق الفريق) + قيمة/شارات في الطرف
    const slRow = (rank, name, tid2, tail, useMedals) => el("div.sl-row" + (useMedals && rank === 1 ? ".sl-top" : ""), {}, [
      el("span.sl-rank", { text: (useMedals && medal(rank)) || String(rank) }),
      el("div.sl-main", {}, [el("div.sl-name", { text: name }), slTeam(tid2)]),
      ...tail,
    ]);

    // الهدّافون — وسام للثلاثة الأوائل وقيمة بارزة
    const scorersEl = scorers.length
      ? el("div.card.stat-list", {}, withRanks(scorers, (s) => s.goals).map((s) =>
          slRow(s.rank, s.name, s.team_id, [el("span.sl-val", { title: t.statTotalGoals, text: String(s.goals) })], true)))
      : el("p.page-sub", { style: "padding:8px 2px", text: t.noScorersYet });

    // البطاقات — شارتان (إنذار/طرد)، والصفر باهت
    const cardsEl = cards.length
      ? el("div.card.stat-list", {}, withRanks(cards, (c) => c.r + "|" + c.y).map((c) =>
          slRow(c.rank, c.name, c.team_id, [
            el("span.sl-chip" + (c.y ? "" : ".is-zero"), { title: t.yellowCard, text: "🟨 " + c.y }),
            el("span.sl-chip" + (c.r ? "" : ".is-zero"), { title: t.redCard, text: "🟥 " + c.r }),
          ], false)))
      : el("p.page-sub", { style: "padding:8px 2px", text: t.noCardsYet });

    // إحصائيات الفرق — جدول مضغوط يتّسع لأصغر الشاشات بلا تمرير
    const th = (txt, ttl) => el("th.stat-col", { scope: "col", title: ttl, text: txt });
    const teamStatsEl = el("div.table-wrap", {}, [el("table.standings.team-stats", {}, [
      el("thead", {}, [el("tr", {}, [
        el("th.rank-col", { scope: "col", text: "#" }),
        el("th.team-col", { scope: "col", text: t.th_team }),
        th(t.th_played, t.statMatchesPlayed),
        th(t.th_gf, t.thGfFull),
        th(t.th_ga, t.thGaFull),
        th(t.th_gd, t.thGdFull),
      ])]),
      el("tbody", {}, withRanks(teamRows, (r) => r.gf).map((r) => el("tr" + (r.rank === 1 && r.gf > 0 ? ".champion" : ""), {}, [
        el("td", {}, [el("span.rank", { text: String(r.rank) })]),
        el("td.team-col", {}, [el("a.team-link", { href: `#/t/${tournament.id}/team/${r.team.id}` }, [el("span.team-name", { text: r.team.name })])]),
        el("td", { text: String(r.played) }),
        el("td", {}, [el("span.pts", { text: String(r.gf) })]),
        el("td", { text: String(r.ga) }),
        el("td.pos-diff" + (r.gd > 0 ? ".pos" : r.gd < 0 ? ".neg" : ""), { text: (r.gd > 0 ? "+" : "") + r.gd }),
      ]))),
    ])]);

    mount(content,
      tiles,
      el("div.stats-section", {}, [
        el("h3.mp-title", {}, [el("span", { text: "⚽ " }), t.topScorers]),
        scorersEl,
        el("p.set-hint", { style: "margin-top:8px", text: t.goalsNote }),
      ]),
      el("div.stats-section", {}, [
        el("h3.mp-title", {}, [el("span", { text: "🟨 " }), t.cardsTable]),
        el("p.stats-subnote", { text: t.cardsSortNote }),
        cardsEl,
      ]),
      el("div.stats-section", {}, [
        el("h3.mp-title", {}, [el("span", { text: "📊 " }), t.teamStats]),
        el("p.stats-subnote", { text: t.teamStatsSortNote }),
        teamStatsEl,
      ]),
    );
  }

  rerender();
  return wrap;
}

// ---- تبويب الفرق (كل البيوت وفرقها) ---------------------------------------

function renderTeams(state) {
  const { bundle, tournament } = state;
  const wrap = el("div");
  let any = false;

  const teamCard = (tm) => {
    const count = (bundle.players || []).filter((p) => p.team_id === tm.id && (p.role || "player") === "player").length;
    return el("a.team-card", { href: `#/t/${tournament.id}/team/${tm.id}` }, [
      el("span.team-card-name", { text: tm.name }),
      el("span.team-card-sub", { text: count ? `${count} ${t.squadPlayers}` : t.viewSquad }),
      el("span.match-go", { "aria-hidden": "true", text: "‹" }),
    ]);
  };
  const section = (title, teams) => {
    if (!teams.length) return;
    any = true;
    const grid = el("div.teams-grid");
    for (const tm of teams.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) grid.appendChild(teamCard(tm));
    wrap.appendChild(el("div.standings-block", {}, [
      el("div.standings-title", {}, [el("span", { text: "🏠" }), el("span", { text: title })]),
      grid,
    ]));
  };

  for (const g of bundle.groups) section(g.name, bundle.teams.filter((x) => x.group_id === g.id));
  // الفرق «بدون بيت» (دوري فردي/خروج المغلوب/غير مُسندة)
  section(bundle.groups.length ? t.noGroup : t.teamsTab, bundle.teams.filter((x) => x.group_id == null));

  if (!any) return emptyState("👥", t.noTeamsYet);
  return wrap;
}

// ---- صفحة فريق (اللاعبون + الإدارة) ----------------------------------------

async function renderTeamDetail(id, teamId, nav = null) {
  mount(app, spinner());
  const tournament = await fetchTournament(id);
  if (nav != null && !stillCurrent(nav)) return;   // (B1)
  if (!tournament) return mount(app, emptyState("🔍", "البطولة غير موجودة"),
    el("a.btn.btn-outline", { href: "#/", text: t.backToTournaments }));
  const bundle = await fetchTournamentBundle(id);
  if (nav != null && !stillCurrent(nav)) return;   // (B1)
  const team = bundle.teams.find((x) => x.id === teamId);
  // (D1) الرجوع الذكي: من داخل الموقع نعود للصفحة الفعلية السابقة (ترتيب/إحصائيات…)
  const backLink = el("a.header-link.back-link", { href: `#/t/${id}/teams`,
    text: "→ " + t.teamsTab, onclick: smartBackHandler });
  if (!team) return mount(app, backLink, emptyState("🔍", "الفريق غير موجود"));

  const group = bundle.groups.find((x) => x.id === team.group_id);
  const teamById = new Map(bundle.teams.map((x) => [x.id, x]));
  const groupById = new Map(bundle.groups.map((x) => [x.id, x]));
  const playersById = new Map((bundle.players || []).map((x) => [x.id, x]));
  const points = { win: tournament.win_points ?? 3, draw: tournament.draw_points ?? 1, loss: tournament.loss_points ?? 0 };

  // مركز الفريق ضمن بيته (أو ضمن فرق «بدون بيت» في دوري فردي)
  const scopeTeams = bundle.teams.filter((x) => (x.group_id ?? null) === (team.group_id ?? null));
  const row = computeGroupStandings(scopeTeams, bundle.matches, points).find((r) => r.team.id === teamId)
    || { rank: "—", points: 0, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0 };

  const members = (bundle.players || []).filter((p) => p.team_id === teamId)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const ofRole = (r) => members.filter((p) => (p.role || "player") === r);

  const section = (label, arr, showNum) => arr.length ? el("div.sq-group", {}, [
    el("div.sq-label", { text: label }),
    el("div.card", {}, arr.map((p) => el("div.sq-row", {}, [
      showNum ? el("span.player-num", { text: p.number != null && p.number !== "" ? String(p.number) : "•" }) : el("span.sq-dot", { text: "•" }),
      el("span.sq-name", { text: p.name }),
    ]))),
  ]) : null;

  // مباريات الفريق (بطاقات قابلة للنقر إلى صفحة المباراة، مجمّعة بالأيام)
  const teamMatches = bundle.matches.filter((m) => m.home_team_id === teamId || m.away_team_id === teamId);

  // هدّافو الفريق من أحداث الأهداف
  const goals = new Map();
  for (const e of bundle.events || [])
    if (e.type === "goal" && e.team_id === teamId && e.player_id)
      goals.set(e.player_id, (goals.get(e.player_id) || 0) + 1);
  const scorers = [...goals.entries()]
    .map(([pid, n]) => ({ name: playersById.get(pid)?.name || t.unknownPlayer, n }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "ar")).slice(0, 10);

  const tile = (icon, value, label) => el("div.stat-tile", {}, [
    el("div.stat-ico", { "aria-hidden": "true", text: icon }),
    el("div.stat-val", { text: String(value) }),
    el("div.stat-lbl", { text: label }),
  ]);

  document.title = team.name + " · " + (SITE_NAME || "");
  mount(app,
    backLink,
    el("div.page-head", { style: "margin-top:10px;display:flex;align-items:center;gap:14px;flex-wrap:wrap" }, [
      el("div", { style: "flex:1;min-width:0" }, [
        el("h1.page-title", { text: team.name }),
        el("p.page-sub", { text: [group?.name, row.played ? `${t.rankLbl} ${row.rank}` : null].filter(Boolean).join(" · ") || t.teamsTab }),
      ]),
      row.played ? el("div", { style: "display:flex;flex-direction:column;align-items:center;gap:4px" }, [
        formGuide(teamForm(teamId, bundle.matches)),
        el("span", { style: "font-size:.72rem;color:var(--text-3)", text: t.th_form }),
      ]) : null,
    ]),
    // مربّعات إحصائيات الفريق (StatTile من التصميم)
    el("div.stat-tiles", {}, [
      tile("🏅", row.rank, t.rankLbl),   // (A11) «المركز» بدل مفتاح رأس الجدول «#»
      tile("⭐", row.points, t.th_pts),
      tile("🏟️", row.played, t.th_played),
      tile("↔️", (row.gd > 0 ? "+" : "") + row.gd, t.th_gd),
      tile("✅", row.won, t.th_won),
      tile("🤝", row.drawn, t.th_draw),
      tile("❌", row.lost, t.th_lost),
      tile("⚽", `${row.gf}:${row.ga}`, t.goalsForAgainst),
    ]),
    scorers.length ? el("div.mp-section", {}, [
      el("h3.mp-title", {}, [el("span", { text: "👟 " }), t.teamTopScorers]),
      el("div.card", {}, scorers.map((s, i) => el("div.sq-row", {}, [
        el("span.player-num", { text: String(s.n) }),
        el("span.sq-name", { text: s.name }),
        i === 0 ? el("span", { "aria-hidden": "true", text: "👑" }) : null,
      ]))),
    ]) : null,
    el("div.mp-section", {}, [
      el("h3.mp-title", {}, [el("span", { text: "📅 " }), t.teamMatches]),
      teamMatches.length
        ? renderScheduleDays(teamMatches, teamById, groupById, { tid: id })
        : el("p.page-sub", { style: "padding:6px 2px", text: t.noMatches }),
    ]),
    el("div.mp-section", {}, [
      el("h3.mp-title", {}, [el("span", { text: "👥 " }), t.squadTitle]),
      !members.length ? emptyState("👤", t.noLineup) : el("div", {}, [
        section(t.squadPlayers, ofRole("player"), true),
        section(t.squadCoach, ofRole("coach"), false),
        section(t.squadManagement, ofRole("management"), false),
      ]),
    ]),
  );
}

// ---- تبويب البرنامج --------------------------------------------------------

// مفتاح يوم المباراة كما يستخدمه groupByDay (غير المجدولة ← "—")
const dayKeyOf = (m) => m.match_date || "—";

// «يوم المِرساة»: أوّل مباراة لم تُلعب بعد (الأقرب زمنياً لأن المباريات مرتّبة تصاعدياً).
// نعتمد على الحالة لا على التاريخ: مباشر الآن ← أوّل مباراة غير ملعوبة ← (لُعبت كلها) آخر يوم.
function pickAnchorDate(matches) {
  if (!matches.length) return null;
  const live = matches.find((m) => m.status === "live");
  if (live) return dayKeyOf(live);                     // ١) مباراة مباشرة الآن
  const next = matches.find((m) => !isCounted(m));     // ٢) أوّل مباراة لم تُلعب بعد
  if (next) return dayKeyOf(next);
  return dayKeyOf(matches[matches.length - 1]);        // ٣) لُعبت كلها ← آخر يوم
}

// التمرير إلى يوم محدّد داخل القائمة (scroll-margin في CSS يترك هامش الترويسة الثابتة)
function scrollToDay(container, date, behavior = "auto") {
  const target = date && container.querySelector(`.day-group[data-date="${date}"]`);
  if (target) target.scrollIntoView({ block: "start", behavior });
  else window.scrollTo({ top: 0, behavior });
}

function renderSchedule(state) {
  const { bundle, tournament } = state;
  const teamById = new Map(bundle.teams.map((x) => [x.id, x]));
  const groupById = new Map(bundle.groups.map((x) => [x.id, x]));
  const wrap = el("div");

  // فلاتر متراكبة (AND): بيت + فريق + تاريخ
  // (A2) الفلاتر تعيش في state — تنجو من إعادة الرسم اللحظية والتنقّل بين التبويبات
  const f = state.schedFilters || (state.schedFilters = { group: "all", team: "all", date: "all" });
  const listHost = el("div");
  const currentMatches = () => bundle.matches.filter((m) =>
    (f.group === "all" || m.group_id === f.group)
    && (f.team === "all" || m.home_team_id === f.team || m.away_team_id === f.team)
    && (f.date === "all" || (m.match_date || "") === f.date));

  const rerenderList = (scrollToAnchor) => {
    const matches = currentMatches();
    mount(listHost, renderScheduleDays(matches, teamById, groupById, { tid: tournament.id }));
    if (scrollToAnchor) {
      const date = pickAnchorDate(matches);
      requestAnimationFrame(() => scrollToDay(listHost, date));
    }
  };

  // فلاتر منسدلة موحّدة: بيت + فريق + تاريخ + زر مسح
  const selects = [];
  const filters = el("div.filter-selects");
  const addSel = (sel) => { selects.push(sel); filters.appendChild(sel); };
  if (bundle.groups.length > 1)
    addSel(filterSelect(t.filterByGroup, t.allGroups, bundle.groups.map((g) => ({ value: g.id, label: g.name })),
      (v) => { f.group = v; rerenderList(true); }, f.group));
  if (bundle.teams.length) {
    const teams = [...bundle.teams].sort((a, b) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name || "").localeCompare(String(b.name || "")));
    addSel(filterSelect(t.filterByTeam, t.allTeams, teams.map((tm) => ({ value: tm.id, label: tm.name })),
      (v) => { f.team = v; rerenderList(true); }, f.team));
  }
  const dates = [...new Set(bundle.matches.map((m) => m.match_date).filter(Boolean))].sort();
  if (dates.length > 1)
    addSel(filterSelect(t.filterByDate, t.allDays, dates.map((d) => ({ value: d, label: weekdayName(d) + " · " + formatDate(d) })),
      (v) => { f.date = v; rerenderList(true); }, f.date));

  if (filters.children.length) {
    filters.appendChild(el("button.btn.btn-sm.btn-outline.filter-clear", {
      type: "button", text: "✕ " + t.clearFilters,
      onclick: () => { f.group = f.team = f.date = "all"; selects.forEach((s) => { s.value = "all"; }); rerenderList(true); },
    }));
    wrap.appendChild(filters);
  }
  wrap.appendChild(listHost);

  // تمرير تلقائي عند فتح التبويب فقط (لا مع التحديث اللحظي الذي يعيد الرسم)
  rerenderList(consumeAnchorPending());
  return wrap;
}

// ---- تبويب الترتيب ---------------------------------------------------------

function renderStandings(state) {
  const { bundle, tournament } = state;
  const points = { win: tournament.win_points ?? 3, draw: tournament.draw_points ?? 1, loss: tournament.loss_points ?? 0 };

  const tablesHost = el("div.standings-wrap"); // نبدأ مضغوطاً؛ الزر يُظهر بقية الأعمدة
  const groups = bundle.groups.length ? bundle.groups : [{ id: null, name: t.standings }];
  let any = false;
  for (const g of groups) {
    const groupTeams = bundle.teams.filter((x) => x.group_id === g.id);
    if (!groupTeams.length) continue;
    any = true;
    tablesHost.appendChild(el("div.standings-block", {}, [
      el("div.standings-title", {}, [el("span", { text: "🏠" }), el("span", { text: g.name })]),
      standingsTable(groupTeams, bundle.matches, points, tournament.qualifiers_per_group, { tid: tournament.id }),
    ]));
  }
  if (!any) return emptyState("📊", t.noTeams);

  let showAll = false;
  const toggle = el("button.btn.btn-sm.btn-outline", { text: "＋ " + t.showMore, onclick: () => {
    showAll = !showAll;
    tablesHost.classList.toggle("show-all", showAll);
    toggle.textContent = (showAll ? "－ " : "＋ ") + (showAll ? t.showLess : t.showMore);
  } });

  return el("div", {}, [
    el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap" }, [
      el("div.page-sub", { style: "margin:0", text: t.standingsNote }),
      toggle,
    ]),
    tablesHost,
    el("div.legend", {}, [
      el("span", {}, [el("span.swatch"), t.qualifies]),
      el("span", { text: t.tieBreak }),
    ]),
  ]);
}

// ---- صفحة المباراة (مستقلّة، مثل 365) --------------------------------------

// سياق المدير الحالي (بريد موثَّق + هل هو مدير منصّة) — يُحسب مرّة ويُعاد استخدامه
async function managerContext() {
  const s = await getSession();
  session = s;
  renderAuthLink();
  const u = s?.user;
  if (u) await syncMyUserDoc(u).catch(() => {});
  if (!u || !u.email || !u.emailVerified || isNoEmailAuthEmail(u.email)) return null;
  return { email: u.email.toLowerCase(), platformAdmin: isOwnerEmail(u.email) || await amIPlatformAdmin() };
}
// هل يملك صاحب هذا السياق صلاحية على التورنير؟ (تحقّق متزامن)
function canManageWith(ctx, tr) {
  if (!ctx || !tr) return false;
  if (ctx.platformAdmin) return true;
  const inList = (arr) => Array.isArray(arr) && arr.some((x) => String(x).toLowerCase() === ctx.email);
  return String(tr.owner_email || "").toLowerCase() === ctx.email
    || inList(tr.admin_emails) || inList(tr.scorer_emails);
}
async function canManageTournament(tr) { return canManageWith(await managerContext(), tr); }

async function renderMatchDetail(id, matchId, nav = null) {
  mount(app, spinner());
  const tournament = await fetchTournament(id);
  if (nav != null && !stillCurrent(nav)) return;   // (B1)
  if (!tournament) return mount(app, emptyState("🔍", "البطولة غير موجودة"),
    el("a.btn.btn-outline", { href: "#/", text: t.backToTournaments }));
  let bundle = await fetchTournamentBundle(id);
  if (nav != null && !stillCurrent(nav)) return;   // (B1)
  let match = bundle.matches.find((m) => m.id === matchId);
  // (D1) الرجوع الذكي: يعود للصفحة الفعلية التي جاء منها (شجرة/فريق/برنامج)
  const backLink = el("a.header-link.back-link", { href: `#/t/${id}/schedule`,
    text: "→ " + t.backToSchedule, onclick: smartBackHandler });
  if (!match) return mount(app, backLink, emptyState("🔍", "المباراة غير موجودة"));

  const host = el("div");
  // زر «إدارة المباراة» يظهر فقط لمن يملك صلاحية على هذا التورنير (لا للزائر العادي)
  const canManage = await canManageTournament(tournament);
  mount(app, el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:10px" }, [
    backLink,
    el("div", { style: "display:flex;align-items:center;gap:8px" }, [
      canManage ? el("a.btn.btn-sm.btn-primary", { href: `./admin.html#/t/${id}/m/${matchId}`, text: "▶ " + t.manageMatchBtn }) : null,
      shareBtn(t.matchDetails),
    ]),
  ]), host);
  const render = () => {
    const teamById = new Map(bundle.teams.map((x) => [x.id, x]));
    // (D6) عنوان تبويب مميّز: «فريق × فريق» بدل «تفاصيل المباراة» العامة
    {
      const h = teamById.get(match.home_team_id)?.name, a = teamById.get(match.away_team_id)?.name;
      document.title = (h && a ? `${h} × ${a}` : t.matchDetails) + " · " + (SITE_NAME || "");
    }
    const groupById = new Map(bundle.groups.map((x) => [x.id, x]));
    const playersById = new Map((bundle.players || []).map((x) => [x.id, x]));
    const home = teamById.get(match.home_team_id);
    const away = teamById.get(match.away_team_id);
    const group = groupById.get(match.group_id);
    const events = (bundle.events || []).filter((e) => e.match_id === matchId);
    const finished = isCounted(match);
    const live = match.status === "live";
    const showScore = finished || (live && match.home_score != null);

    const scoreMid = showScore
      ? el("div.mp-score", {}, [String(match.home_score ?? 0), el("span.sep", { text: ":" }), String(match.away_score ?? 0)])
      : el("div.mp-score.time", {}, [match.match_time ? formatTime(match.match_time) : t.vs]);

    const metaParts = [
      group ? "🛡️ " + group.name : null,
      match.match_date ? "📅 " + weekdayName(match.match_date) + " " + formatDate(match.match_date) : null,
      match.match_time ? "🕐 " + formatTime(match.match_time) : null,
    ].filter(Boolean);

    // جهة فريق في لوحة النتيجة — اسم الفريق رابط إلى صفحته
    const teamSide = (tm) => {
      const inner = [
        el("div.mp-team-badge", { "aria-hidden": "true", text: "⚽" }),
        el("span.mp-team-name", { text: tm ? tm.name : "—" }),
      ];
      return tm
        ? el("a.mp-team.team-link", { href: `#/t/${id}/team/${tm.id}` }, inner)
        : el("div.mp-team", {}, inner);
    };
    mount(host,
      el("div.mp-scoreboard" + (live ? ".is-live" : ""), {}, [
        teamSide(home),
        el("div", {}, [
          scoreMid,
          live ? el("div.mp-minute", {}, [
            el("span.badge.badge-live", {}, [el("span.dot"), match.minute != null ? t.live + " · " + match.minute + "'" : t.live]),
          ]) : null,
        ]),
        teamSide(away),
      ]),
      el("div.mp-meta", {}, [
        el("span", { text: metaParts.join(" · ") }),
        !live ? el("span.badge.badge-" + (finished ? "finished" : "upcoming"), { text: matchStatusLabel(match.status) }) : null,
      ]),
      el("div.mp-section", {}, [
        el("h3.mp-title", { text: t.events }),
        events.length ? el("div.card.card-pad", {}, [eventsTimeline(events, playersById, teamById, { homeId: match.home_team_id, awayId: match.away_team_id })])
                      : el("p.page-sub", { style: "padding:6px 2px", text: t.noEvents }),
      ]),
    );
  };
  render();

  const sub = subscribeTournament(id, debounce(async () => {
    // (B12) مؤقّت مؤجَّل بعد مغادرة الصفحة لا يجلب ولا يرسم في فراغ
    let r = parseHash();
    if (!(r.view === "match" && r.matchId === matchId)) return;
    try {
      bundle = await fetchTournamentBundle(id);
      r = parseHash();
      if (!(r.view === "match" && r.matchId === matchId)) return;
      const m2 = bundle.matches.find((m) => m.id === matchId);
      if (m2) match = m2;
      render();
    } catch (e) { console.error(e); }
  }, 400));
  if (nav != null && !stillCurrent(nav)) { try { sub(); } catch {} return; }   // (B1)
  currentUnsub = sub;
}

// ---- أدوات -----------------------------------------------------------------

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
