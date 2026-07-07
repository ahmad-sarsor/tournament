// ============================================================================
//  التطبيق العام (العرض للزوّار): توجيه، قائمة البطولات، البرنامج، الترتيب
// ============================================================================
import { isConfigured } from "./firebase.js";
import { SITE_NAME } from "./config.js";
import { t, statusLabel, matchStatusLabel, formatDate, formatTime, weekdayName } from "./i18n.js";
import { el, mount, clear, spinner, emptyState, toast, openModal } from "./util.js";
import {
  fetchTournaments, fetchTournament, fetchTournamentBundle, subscribeTournament, isCounted, computeGroupStandings,
  getSession, onAuthChange, signOut, amIPlatformAdmin, isOwnerEmail,
  fetchCompetitionsByTournament, subscribeCompetition, getCompCache,
  fetchMyContact, registerPredictor, updateMyPredictor, savePrediction,
  computePredictionStandings, compScoring, isPredictable, predictionPoints, currentUid,
} from "./data.js";
import { renderScheduleDays, standingsTable, eventsTimeline, renderBracket, predictionBoard } from "./render.js";
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
  // المستخدم المجهول (متوقّع في مسابقة) ليس «دخولاً» للوحة المنظّم
  const real = session?.user && !session.user.isAnonymous;
  if (real) { authLink.textContent = "لوحتي"; authLink.setAttribute("href", "./admin.html"); }
  else { authLink.textContent = "دخول / تسجيل"; authLink.setAttribute("href", "./admin.html#/register"); }
}
getSession().then((s) => { session = s; renderAuthLink(); }).catch(() => {});
onAuthChange((s) => { session = s; renderAuthLink(); });

document.getElementById("settings-btn")?.addEventListener("click", () => openSettings({
  isAdmin: false,
  session: (session?.user && !session.user.isAnonymous) ? session : null,   // المجهول ليس جلسة منظّم
  onSignOut: async () => { try { await signOut(); } catch {} location.reload(); },
}));

let currentUnsub = null;              // إلغاء اشتراك التحديث اللحظي الحالي
let predLockTimer = null;             // مؤقّت قفل التوقّعات عند أقرب موعد مباراة
let compUnsub = null, compUnsubId = null, compOnChange = null;   // اشتراك حيّ لترتيب المسابقة
function cleanupComp() {
  if (compUnsub) { try { compUnsub(); } catch {} }
  compUnsub = null; compUnsubId = null; compOnChange = null;
}
function cleanup() {
  if (currentUnsub) { currentUnsub(); currentUnsub = null; }
  if (predLockTimer) { clearTimeout(predLockTimer); predLockTimer = null; }
  cleanupComp();
}

// تمرير تلقائي لبرنامج المباريات عند فتح التبويب فقط (لا مع التحديث اللحظي)
let scheduleAnchorPending = false;
function consumeAnchorPending() { const v = scheduleAnchorPending; scheduleAnchorPending = false; return v; }

// ---- التوجيه (Hash routing) -----------------------------------------------

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean);
  // "" | "t/:id" | "t/:id/:tab" | "t/:id/m/:matchId"
  if (parts[0] === "t" && parts[1]) {
    if (parts[2] === "m" && parts[3]) return { view: "match", id: parts[1], matchId: parts[3] };
    if (parts[2] === "team" && parts[3]) return { view: "team", id: parts[1], teamId: parts[3] };
    return { view: "tournament", id: parts[1], tab: parts[2] || "schedule" };
  }
  return { view: "home" };
}

async function route() {
  cleanup();
  if (!isConfigured) return renderSetupNeeded();
  const r = parseHash();
  try {
    if (r.view === "match") await renderMatchDetail(r.id, r.matchId);
    else if (r.view === "team") await renderTeamDetail(r.id, r.teamId);
    else if (r.view === "tournament") await renderTournament(r.id, r.tab);
    else await renderHome();
    window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    renderError(err);
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

async function renderHome() {
  loading();
  const tournaments = await fetchTournaments();
  const head = el("div.page-head", {}, [
    el("h1.page-title", { text: t.tournaments }),
    el("p.page-sub", { text: t.siteTagline }),
  ]);
  if (!tournaments.length) {
    return mount(app, head, emptyState("🏆", "لا توجد بطولات بعد"));
  }
  // إحصاءات كل بطولة (مباريات/فرق/بيوت) لملء بطاقات التصميم — بالتوازي، مع تحمّل الأخطاء
  const stats = await Promise.all(tournaments.map((tr) =>
    fetchTournamentBundle(tr.id)
      .then((b) => ({
        total: b.matches.length,
        done: b.matches.filter((m) => m.status === "finished").length,
        teams: b.teams.length,
        groups: b.groups.length,
      }))
      .catch(() => null)
  ));
  const grid = el("div.grid.cols");
  tournaments.forEach((tr, i) => grid.appendChild(tournamentCard(tr, stats[i])));
  mount(app, head, grid);
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

async function renderTournament(id, tab) {
  loading();
  const tournament = await fetchTournament(id);
  if (!tournament) return mount(app, emptyState("🔍", "البطولة غير موجودة"),
    el("a.btn.btn-outline", { href: "#/", text: t.backToTournaments }));

  const state = { tournament, bundle: await fetchTournamentBundle(id), tab };
  state.mgrCtx = await managerContext();   // لإظهار زر «إدارة البطولة» للمخوَّلين
  state.comps = await fetchCompetitionsByTournament(id).catch(() => []);  // مسابقات التوقّعات
  scheduleAnchorPending = true;         // فتح جديد للصفحة ← اسمح بالتمرير التلقائي في البرنامج
  renderTournamentShell(state);

  // تحديث لحظي: أعِد جلب البيانات وأعِد رسم الصفحة (بما فيها بيانات البطولة نفسها)
  currentUnsub = subscribeTournament(id, debounce(async () => {
    try {
      const [tr, bundle] = await Promise.all([fetchTournament(id), fetchTournamentBundle(id)]);
      if (!tr) return;
      state.tournament = tr;
      state.bundle = bundle;
      renderTournamentShell(state);
      toast("تم تحديث النتائج", "ok");
    } catch (e) { console.error(e); }
  }, 400));
}

function renderTournamentShell(state) {
  const { tournament } = state;
  const hasKnockout = (state.bundle.matches || []).some((m) => m.stage === "knockout");
  // تبويب التوقّعات يظهر فقط عند وجود مسابقة منشورة (غير مسودّة)
  const hasPredictions = (state.comps || []).some((c) => c.status && c.status !== "draft");
  const tabs = el("div.tabs", { role: "tablist" }, [
    tabBtn(t.schedule, tournament.id, "schedule", state.tab),
    tabBtn(t.standings, tournament.id, "standings", state.tab),
    hasKnockout ? tabBtn(t.knockout, tournament.id, "knockout", state.tab) : null,
    tabBtn(t.teamsTab, tournament.id, "teams", state.tab),
    tabBtn(t.statsTab, tournament.id, "stats", state.tab),
    hasPredictions ? el("button.tab.pc-tab" + (state.tab === "predictions" ? ".active" : ""), {
      role: "tab", text: "🎯 " + t.predictions,
      onclick: () => { location.hash = `#/t/${tournament.id}/predictions`; },
    }) : null,
  ]);
  const content = el("div", { id: "tab-content" });
  mount(app,
    el("div", {}, [
      el("a.header-link", { href: "#/", text: "→ " + t.backToTournaments, style: "background:transparent;color:var(--text-2);padding:0;font-size:.85rem" }),
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
    // لافتة بارزة للمسابقة (تظهر خارج تبويب التوقّعات كي لا تبدو «مختبئة»)
    hasPredictions && state.tab !== "predictions" ? predictionCta(state) : null,
    tabs,
    content,
  );
  document.title = tournament.name + " · " + (SITE_NAME || "");
  renderTabContent(state);
}

// لافتة دعوة بارزة بلون المسابقة المميّز
function predictionCta(state) {
  const comp = (state.comps || []).find((c) => c.status && c.status !== "draft");
  if (!comp) return null;
  return el("a.pc-cta", { href: `#/t/${state.tournament.id}/predictions` }, [
    el("span.pc-cta-icon", { text: "🎯" }),
    el("div.pc-cta-body", {}, [
      el("div.pc-cta-title", { text: comp.title || t.predictionComp }),
      el("div.pc-cta-sub", { text: t.predictionsCtaSub }),
    ]),
    el("span.pc-cta-go", { text: t.predictionsCtaBtn }),
  ]);
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
    text: label, role: "tab", onclick: () => { location.hash = `#/t/${id}/${tab}`; },
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
  else if (state.tab === "predictions") host.appendChild(renderPredictions(state));
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
function filterSelect(ariaLabel, allLabel, options, onChange) {
  return el("select.input.filter-select", {
    "aria-label": ariaLabel,
    onchange: (e) => onChange(e.currentTarget.value),
  }, [el("option", { value: "all", text: allLabel }),
      ...options.map((o) => el("option", { value: o.value, text: o.label }))]);
}

function renderStats(state) {
  const { bundle, tournament } = state;
  const teamById = new Map(bundle.teams.map((x) => [x.id, x]));
  const groupById = new Map(bundle.groups.map((x) => [x.id, x]));
  const playersById = new Map((bundle.players || []).map((x) => [x.id, x]));
  const points = { win: tournament.win_points ?? 3, draw: tournament.draw_points ?? 1, loss: tournament.loss_points ?? 0 };

  let activeGroup = "all", activeTeam = "all";
  const wrap = el("div");
  const content = el("div");
  const groupOfTeam = (tid) => { const tm = teamById.get(tid); return tm ? (groupById.get(tm.group_id)?.name || "—") : "—"; };

  // فلاتر منسدلة: البيت + الفريق + مسح الكل
  const selects = [];
  const filters = el("div.filter-selects");
  const addSel = (sel) => { selects.push(sel); filters.appendChild(sel); };
  if (bundle.groups.length > 1)
    addSel(filterSelect(t.filterByGroup, t.allGroups, bundle.groups.map((g) => ({ value: g.id, label: g.name })),
      (v) => { activeGroup = v; rerender(); }));
  if (bundle.teams.length) {
    const teamsSorted = [...bundle.teams].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name || "").localeCompare(String(b.name || "")));
    addSel(filterSelect(t.filterByTeam, t.allTeams, teamsSorted.map((tm) => ({ value: tm.id, label: tm.name })),
      (v) => { activeTeam = v; rerender(); }));
  }
  if (filters.children.length) {
    filters.appendChild(el("button.btn.btn-sm.btn-outline.filter-clear", {
      type: "button", text: "✕ " + t.clearFilters,
      onclick: () => { activeGroup = activeTeam = "all"; selects.forEach((s) => { s.value = "all"; }); rerender(); },
    }));
    wrap.appendChild(filters);
  }
  wrap.appendChild(content);

  function statTile(icon, value, label) {
    return el("div.stat-tile", {}, [
      icon ? el("div.stat-ico", { "aria-hidden": "true", text: icon }) : null,
      el("div.stat-val", { text: String(value) }),
      el("div.stat-lbl", { text: label }),
    ]);
  }

  function rerender() {
    const groupTeamIds = activeGroup === "all" ? null : new Set(bundle.teams.filter((x) => x.group_id === activeGroup).map((x) => x.id));
    const inGroup = (tid) => !groupTeamIds || groupTeamIds.has(tid);
    const teamOk = (tid) => activeTeam === "all" || tid === activeTeam;
    const teamName = (tid) => teamById.get(tid)?.name || "—";

    // نطاق البيت (كلا الفريقين). الهدّافون/البطاقات تُحتسب من كل مباريات النطاق —
    // منتهية أو مباشرة — كي يظهر مسجّلو المباريات الجارية أيضاً (إصلاح: كانوا يُسقَطون).
    const scopeMatches = (bundle.matches || []).filter((m) => inGroup(m.home_team_id) && inGroup(m.away_team_id));
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
        const row = merged.get(key) || { name, team_id, grp: groupOfTeam(team_id), goals: 0, y: 0, r: 0 };
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
    const teams = bundle.teams.filter((x) => inGroup(x.id) && teamOk(x.id));
    const teamRows = computeGroupStandings(teams, bundle.matches, points)
      .slice().sort((a, b) => b.gf - a.gf || b.gd - a.gd || a.team.name.localeCompare(b.team.name, "ar"));

    // بلاطات ملخّص
    const tiles = el("div.stat-tiles", {}, [
      statTile("🏟️", played.length, t.statMatchesPlayed),
      statTile("⚽", totalGoals, t.statTotalGoals),
      statTile("📈", avg, t.statAvgGoals),
      statTile("👟", scorers[0] ? scorers[0].name : "—", t.statTopScorer),
    ]);

    const showGroupCol = bundle.groups.length > 0;

    // الهدّافون (مع عمود البيت)
    const scorersEl = scorers.length
      ? el("div.table-wrap", {}, [el("table.standings", {}, [
          el("thead", {}, [el("tr", {}, [el("th.rank-col", { text: "#" }), el("th.team-col", { text: t.th_player }), el("th", { text: t.th_team }), showGroupCol ? el("th", { text: t.th_group }) : null, el("th.pts-col", { text: "⚽" })])]),
          el("tbody", {}, scorers.map((s, i) => el("tr" + (i === 0 ? ".champion" : ""), {}, [
            el("td", {}, [el("span.rank", { text: String(i + 1) })]),
            el("td.team-col", {}, [el("span.team-name", { text: s.name })]),
            el("td", {}, [el("span.stat-team", { text: teamName(s.team_id) })]),
            showGroupCol ? el("td", {}, [el("span.stat-team", { text: s.grp })]) : null,
            el("td", {}, [el("span.pts", { text: String(s.goals) })]),
          ]))),
        ])])
      : el("p.page-sub", { style: "padding:8px 2px", text: t.noScorersYet });

    // البطاقات (مع عمود البيت)
    const cardsEl = cards.length
      ? el("div.table-wrap", {}, [el("table.standings", {}, [
          el("thead", {}, [el("tr", {}, [el("th.team-col", { text: t.th_player }), el("th", { text: t.th_team }), showGroupCol ? el("th", { text: t.th_group }) : null, el("th", { text: "🟨" }), el("th", { text: "🟥" })])]),
          el("tbody", {}, cards.map((c) => el("tr", {}, [
            el("td.team-col", {}, [el("span.team-name", { text: c.name })]),
            el("td", {}, [el("span.stat-team", { text: teamName(c.team_id) })]),
            showGroupCol ? el("td", {}, [el("span.stat-team", { text: c.grp })]) : null,
            el("td", { text: String(c.y) }),
            el("td", { text: String(c.r) }),
          ]))),
        ])])
      : el("p.page-sub", { style: "padding:8px 2px", text: t.noCardsYet });

    // إحصائيات الفرق (الأهداف)
    const teamStatsEl = el("div.table-wrap", {}, [el("table.standings", {}, [
      el("thead", {}, [el("tr", {}, [el("th.rank-col", { text: "#" }), el("th.team-col", { text: t.th_team }), el("th.stat-col", { text: t.th_played }), el("th.stat-col", { text: t.th_gf }), el("th.stat-col", { text: t.th_ga }), el("th.stat-col", { text: t.th_gd })])]),
      el("tbody", {}, teamRows.map((r, i) => el("tr" + (i === 0 && r.gf > 0 ? ".champion" : ""), {}, [
        el("td", {}, [el("span.rank", { text: String(i + 1) })]),
        el("td.team-col", {}, [el("span.team-name", { text: r.team.name })]),
        el("td", { text: String(r.played) }),
        el("td", {}, [el("span.pts", { text: String(r.gf) })]),
        el("td", { text: String(r.ga) }),
        el("td.pos-diff" + (r.gd > 0 ? ".pos" : r.gd < 0 ? ".neg" : ""), { text: (r.gd > 0 ? "+" : "") + r.gd }),
      ]))),
    ])]);

    mount(content,
      tiles,
      el("div.stats-section", {}, [el("h3.mp-title", {}, [el("span", { text: "⚽ " }), t.topScorers]), scorersEl,
        el("p.set-hint", { style: "margin-top:8px", text: t.goalsNote })]),
      el("div.stats-section", {}, [el("h3.mp-title", {}, [el("span", { text: "🟨 " }), t.cardsTable]), cardsEl]),
      el("div.stats-section", {}, [el("h3.mp-title", {}, [el("span", { text: "📊 " }), t.teamStats]), teamStatsEl]),
    );
  }

  rerender();
  return wrap;
}

// ---- تبويب التوقّعات (مسابقة التوقّعات) -------------------------------------

function compStatusBadge(status) {
  const cls = { open: "badge-active", closed: "badge-upcoming", finished: "badge-finished" }[status] || "badge-upcoming";
  return el("span.badge." + cls, { text: t["pc_status_" + status] || status });
}

function renderPredictions(state) {
  const root = el("div");
  const comps = (state.comps || []).filter((c) => c.status && c.status !== "draft");
  if (!comps.length) { cleanupComp(); root.appendChild(emptyState("🎯", t.noCompetitionPublic)); return root; }
  if (!comps.some((c) => c.id === state.activeCompId)) state.activeCompId = comps[0].id;

  // draw(): يرسم المسابقة النشطة من الكاش الحيّ (onSnapshot) — الترتيب يتحدّث مباشرةً
  const draw = () => {
    const comp = comps.find((c) => c.id === state.activeCompId) || comps[0];
    if (compUnsubId !== comp.id) {                 // اشتراك حيّ جديد فقط عند تغيّر المسابقة
      cleanupComp();
      compUnsub = subscribeCompetition(comp.id, () => { if (compOnChange) compOnChange(); });
      compUnsubId = comp.id;
    }
    compOnChange = draw;                            // أحدث إغلاق (أحدث root) هو المُستدعى
    const live = getCompCache(comp.id);
    if (!live) return mount(root, spinner());       // بانتظار أوّل لقطة
    renderCompView(root, state, comp, comps, live, draw);
  };
  compOnChange = draw;
  draw();
  return root;
}

function renderCompView(root, state, comp, comps, live, rerender) {
  const teamById = new Map(state.bundle.teams.map((x) => [x.id, x]));
  const uid = currentUid();
  const myPredictor = uid ? live.predictors.find((p) => p.uid === uid) : null;
  const myPredictions = uid ? live.predictions.filter((p) => p.uid === uid) : [];
  const registered = !!myPredictor;
  const acceptsEntries = comp.status === "open" || comp.status === "closed";
  const standings = computePredictionStandings(live.predictors, live.predictions, state.bundle.matches, comp);
  if (!state.predSubTab) state.predSubTab = "board";
  if (state.predSubTab === "mine" && !registered) state.predSubTab = "board";

  // غلاف مميّز بلون المسابقة (بنفسجي) كي لا تبدو «مختبئة»
  const wrap = el("div.pc-wrap");
  const blocks = [];

  // اختيار المسابقة عند تعدّدها
  if (comps.length > 1) {
    blocks.push(el("div.filter-selects", { style: "margin-bottom:14px" }, [
      el("select.input.filter-select", {
        "aria-label": t.predictionComp,
        onchange: (e) => { state.activeCompId = e.currentTarget.value; state.predSubTab = "board"; rerender(); },
      }, comps.map((c) => {
        const o = el("option", { value: c.id, text: c.title || t.predictionComp });
        if (c.id === comp.id) o.selected = true;
        return o;
      })),
    ]));
  }

  // رأس المسابقة (شارة + عنوان + وصف) بلون مميّز
  blocks.push(el("div.pc-hero", {}, [
    el("div.pc-hero-top", {}, [
      el("span.pc-hero-icon", { text: "🎯" }),
      el("div", { style: "flex:1;min-width:0" }, [
        el("div.pc-hero-title", { text: comp.title || t.predictionComp }),
        el("div.pc-hero-sub", { text: t.predictionComp }),
      ]),
      compStatusBadge(comp.status),
    ]),
    comp.description ? el("p.pc-hero-desc", { text: comp.description }) : null,
    // شريط حالتي المضغوط
    registered
      ? el("div.pc-mine-bar", {}, [
          el("span.pc-badge-in", { text: "✓ " + t.youAreIn }),
          el("span.pc-mine-name", { text: myPredictor.name || "" }),
          el("button.btn.btn-xs.pc-btn-ghost", { style: "margin-inline-start:auto", text: "✎ " + t.editMyInfo, onclick: () => openRegisterModal(comp, state, true) }),
        ])
      : (comp.status === "open"
          ? el("div.pc-join-row", {}, [
              el("span.pc-join-txt", { text: t.registerIntro }),
              el("button.btn.pc-btn", { text: "🎯 " + t.joinCompetition, onclick: () => openRegisterModal(comp, state, false) }),
            ])
          : el("div.pc-note-warn", { text: t.registrationClosed })),
  ]));

  // تبويبان فرعيّان: الترتيب (افتراضي) | توقّعاتي — كي لا يُدفن الترتيب أسفل الإدخال
  const subTab = (label, key) => el("button.pc-subtab" + (state.predSubTab === key ? ".active" : ""), {
    type: "button", text: label, onclick: () => { state.predSubTab = key; rerender(); },
  });
  blocks.push(el("div.pc-subtabs", { role: "tablist" }, [
    subTab("🏅 " + t.predLeaderboard, "board"),
    registered ? subTab("🎲 " + t.myPredictions, "mine") : null,
  ]));

  const content = el("div.pc-content");
  if (state.predSubTab === "mine" && registered) {
    content.appendChild(el("div.pc-hint", { text: "🔒 " + t.predLockHint }));
    const myMap = new Map(myPredictions.map((p) => [p.match_id, p]));
    const matches = state.bundle.matches.filter((m) => m.home_team_id && m.away_team_id);
    const section = el("div.pc-matches");
    if (!matches.length) section.appendChild(el("p.page-sub", { style: "padding:8px 2px", text: t.noMatchesToPredict }));
    for (const m of matches) section.appendChild(predictionMatchRow(comp, m, teamById, myMap.get(m.id), acceptsEntries));
    content.appendChild(section);
  } else {
    content.appendChild(el("div.pc-live-line", {}, [el("span.pc-live-dot"), el("span", { text: t.liveBoardNote })]));
    content.appendChild(predictionBoard(standings, comp, { myUid: uid }));
    const cards2 = [scoringCard(comp), prizesCard(comp)].filter(Boolean);
    if (cards2.length) content.appendChild(el("div.pc-cards2", { style: "margin-top:16px" }, cards2));
  }
  blocks.push(content);

  mount(wrap, ...blocks);
  mount(root, wrap);

  // إعادة رسم تلقائية عند أقرب موعد قفل، كي تُقفل صفوف الإدخال حتى بلا تحديث حيّ
  if (predLockTimer) { clearTimeout(predLockTimer); predLockTimer = null; }
  if (registered && acceptsEntries) {
    const now = Date.now();
    const nextLock = state.bundle.matches.reduce((min, m) =>
      (m.status === "scheduled" && m.home_team_id && m.away_team_id && m.locks_at != null && m.locks_at > now)
        ? Math.min(min, m.locks_at) : min, Infinity);
    if (nextLock !== Infinity) {
      const delay = Math.min(nextLock - now + 500, 6 * 60 * 60 * 1000);   // هامش نصف ثانية، بحدّ 6 ساعات
      predLockTimer = setTimeout(() => rerender(), Math.max(1000, delay));
    }
  }
}

function scoringCard(comp) {
  const s = compScoring(comp);
  const row = (label, pts) => el("div.pc-score-row", {}, [
    el("span.pc-score-lbl", { text: label }),
    el("span.pc-score-pts", { text: pts + " " + t.ptsSuffix }),
  ]);
  return el("div.card.card-pad", {}, [
    el("div.pc-card-title", { text: "🧮 " + t.scoringTitle }),
    row("🎯 " + t.scoringExact, s.exact),
    row("↔️ " + t.scoringDiff, s.diff),
    row("✔️ " + t.scoringOutcome, s.outcome),
    row("✗ " + t.scoringMiss, 0),
  ]);
}

function prizesCard(comp) {
  const winners = comp.winners_count ?? 0;
  const prizes = Array.isArray(comp.prizes) ? comp.prizes : [];
  const n = Math.max(winners, prizes.length);
  if (!n) return null;
  const medal = (r) => ({ 1: "🥇", 2: "🥈", 3: "🥉" }[r] || "#" + r);
  const rows = [];
  for (let r = 1; r <= n; r++) rows.push(el("div.pc-prize-row", {}, [
    el("span.pc-prize-rank", { text: medal(r) }),
    el("span.pc-prize-txt", { text: prizes[r - 1] || "—" }),
  ]));
  return el("div.card.card-pad", {}, [el("div.pc-card-title", { text: "🎁 " + t.prizesTitle }), ...rows]);
}

// صفّ مباراة واحدة داخل «توقّعاتي»: قابل للإدخال إن كانت مجدولة، وإلا مقفل مع النتيجة والنقاط
function predictionMatchRow(comp, m, teamById, myPred, acceptsEntries) {
  const home = teamById.get(m.home_team_id)?.name || "—";
  const away = teamById.get(m.away_team_id)?.name || "—";
  const editable = acceptsEntries && isPredictable(m);
  const nameH = el("span.pc-row-team", { text: home });
  const nameA = el("span.pc-row-team", { text: away });

  if (editable) {
    const inH = el("input.input.pc-num", { type: "number", inputmode: "numeric", min: 0, max: 99, value: myPred?.home ?? "" });
    const inA = el("input.input.pc-num", { type: "number", inputmode: "numeric", min: 0, max: 99, value: myPred?.away ?? "" });
    const saveBtn = el("button.btn.btn-sm.pc-save", { type: "button", text: "💾", title: t.savePrediction });
    saveBtn.addEventListener("click", async () => {
      if (inH.value === "" || inA.value === "") return toast(t.yourGuess + "؟", "err");
      const hi = parseInt(inH.value, 10), ai = parseInt(inA.value, 10);
      if (!(hi >= 0 && hi <= 99 && ai >= 0 && ai <= 99)) return toast(t.errorGeneric, "err");
      saveBtn.disabled = true;
      try { await savePrediction(comp, m, hi, ai); toast(t.predictionSaved, "ok"); }   // onSnapshot يعيد الرسم بالقيمة المؤكَّدة
      catch (e) { toast(e.message || t.errorGeneric, "err"); }
      finally { saveBtn.disabled = false; }
    });
    return el("div.pc-row", {}, [nameH, el("div.pc-row-mid", {}, [inH, el("span.pc-colon", { text: ":" }), inA]), nameA, saveBtn]);
  }

  // مقفلة (بدأت المباراة أو حلّ موعدها)
  const finished = isCounted(m);
  const scheduledLocked = m.status === "scheduled";   // حان الموعد لكن لم تبدأ بعد
  const pts = (myPred && finished) ? predictionPoints(myPred, m, compScoring(comp)) : null;
  const resultTxt = (m.home_score != null && m.away_score != null)
    ? `${m.home_score} : ${m.away_score}`
    : (m.status === "live" ? t.live : (m.match_time ? formatTime(m.match_time) : "🔒"));
  const guess = myPred ? `${myPred.home}:${myPred.away}` : t.notPredicted;
  return el("div.pc-row.pc-row-locked", {}, [
    nameH,
    el("div.pc-row-mid", {}, [el("span.pc-result" + (m.status === "live" ? ".is-live" : ""), { text: resultTxt })]),
    nameA,
    el("div.pc-row-meta", {}, [
      scheduledLocked ? el("span.pc-lock-note", { text: "🔒 " + t.predDeadlinePassed }) : null,
      el("span.pc-guess", { text: t.yourGuess + ": " + guess }),
      pts != null ? el("span.pc-pts" + (pts > 0 ? ".pos" : ""), { text: "+" + pts }) : null,
    ]),
  ]);
}

// نموذج التسجيل/تعديل البيانات (اسم ثلاثي + هاتف/بريد + عمر)
function openRegisterModal(comp, state, isEdit) {
  const live = getCompCache(comp.id);
  const myName = (isEdit && live) ? (live.predictors.find((p) => p.uid === currentUid())?.name || "") : "";
  const nameI = el("input.input", { type: "text", maxlength: "60", placeholder: t.regNamePlaceholder, value: myName });
  const phoneI = el("input.input", { type: "tel", maxlength: "40", placeholder: t.regPhonePlaceholder, style: "direction:ltr;text-align:end" });
  const emailI = el("input.input", { type: "email", maxlength: "120", style: "direction:ltr;text-align:end" });
  const ageI = el("input.input", { type: "number", min: "5", max: "120", inputmode: "numeric" });
  const err = el("div.alert.alert-error", { hidden: true, role: "alert" });
  const showErr = (msg) => { err.hidden = false; err.textContent = msg; };

  // عند التعديل: نجلب بيانات التواصل الحالية لتعبئتها
  if (isEdit) fetchMyContact(comp.id, currentUid()).then((c) => {
    if (c) { phoneI.value = c.phone || ""; emailI.value = c.email || ""; ageI.value = c.age ?? ""; }
  }).catch(() => {});

  const submit = el("button.btn.btn-primary.btn-block", { type: "submit", text: isEdit ? t.save : t.regSubmit });
  const form = el("form", {}, [
    !isEdit ? el("p", { style: "margin:0 0 12px;color:var(--text-2);font-size:.9rem", text: t.registerIntro }) : null,
    el("div.field", {}, [el("label", { text: t.regName }), nameI]),
    el("div.field", {}, [el("label", { text: t.regPhone }), phoneI]),
    el("div.field", {}, [el("label", { text: t.regEmail }), emailI, el("div.field-hint", { text: t.regContactHint })]),
    el("div.field", {}, [el("label", { text: t.regAge }), ageI]),
    err, submit,
    el("button", { type: "submit", hidden: true }),
  ]);
  const close = openModal({ title: isEdit ? "✎ " + t.editMyInfo : "🎯 " + t.registerTitle, body: form });

  form.addEventListener("submit", async (e) => {
    e.preventDefault(); err.hidden = true;
    const name = nameI.value.trim();
    const phone = phoneI.value.trim(), email = emailI.value.trim();
    const ageRaw = ageI.value.trim();
    if (name.split(/\s+/).filter(Boolean).length < 3) return showErr(t.regNameShort);
    // مطابقة قاعدة القبول: الهاتف أو البريد ٣ أحرف على الأقل (يمنع تسجيلاً ناقصاً يرفضه الخادم)
    if (phone.length < 3 && email.length < 3) return showErr(t.regContactRequired);
    const age = ageRaw === "" ? null : parseInt(ageRaw, 10);
    if (age != null && !(age >= 5 && age <= 120)) return showErr(t.regAgeInvalid);
    submit.disabled = true; submit.textContent = t.loading;
    try {
      if (isEdit) {
        await updateMyPredictor(comp, currentUid(), { name, phone, email, age });
        toast(t.infoUpdated, "ok");
      } else {
        await registerPredictor(comp, { name, phone, email, age });
        state.predSubTab = "mine";             // بعد الانضمام: انتقل مباشرةً لإدخال التوقّعات
        toast(t.regDone, "ok");
      }
      close();                                 // onSnapshot يعيد رسم التبويب بالحالة الجديدة
    } catch (e2) {
      console.error(e2);
      submit.disabled = false; submit.textContent = isEdit ? t.save : t.regSubmit;
      // رسالة واضحة إن لم يُفعَّل الدخول المجهول في إعدادات Firebase
      const anonOff = ["auth/operation-not-allowed", "auth/admin-restricted-operation", "auth/configuration-not-found"];
      showErr(anonOff.includes(e2?.code) ? t.anonDisabled : (e2.message || t.errorGeneric));
    }
  });
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

async function renderTeamDetail(id, teamId) {
  mount(app, spinner());
  const tournament = await fetchTournament(id);
  if (!tournament) return mount(app, emptyState("🔍", "البطولة غير موجودة"),
    el("a.btn.btn-outline", { href: "#/", text: t.backToTournaments }));
  const bundle = await fetchTournamentBundle(id);
  const team = bundle.teams.find((x) => x.id === teamId);
  const backLink = el("a.header-link", { href: `#/t/${id}/teams`,
    text: "→ " + t.teamsTab, style: "background:transparent;color:var(--text-2);padding:0;font-size:.85rem" });
  if (!team) return mount(app, backLink, emptyState("🔍", "الفريق غير موجود"));

  const group = bundle.groups.find((x) => x.id === team.group_id);
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

  document.title = team.name + " · " + (SITE_NAME || "");
  mount(app,
    backLink,
    el("div.page-head", { style: "margin-top:10px" }, [
      el("h1.page-title", { text: team.name }),
      group ? el("p.page-sub", { text: group.name }) : null,
    ]),
    !members.length ? emptyState("👤", t.noLineup) : el("div", {}, [
      section(t.squadPlayers, ofRole("player"), true),
      section(t.squadCoach, ofRole("coach"), false),
      section(t.squadManagement, ofRole("management"), false),
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
  let activeGroup = "all", activeTeam = "all", activeDate = "all";
  const listHost = el("div");
  const currentMatches = () => bundle.matches.filter((m) =>
    (activeGroup === "all" || m.group_id === activeGroup)
    && (activeTeam === "all" || m.home_team_id === activeTeam || m.away_team_id === activeTeam)
    && (activeDate === "all" || (m.match_date || "") === activeDate));

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
      (v) => { activeGroup = v; rerenderList(true); }));
  if (bundle.teams.length) {
    const teams = [...bundle.teams].sort((a, b) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name || "").localeCompare(String(b.name || "")));
    addSel(filterSelect(t.filterByTeam, t.allTeams, teams.map((tm) => ({ value: tm.id, label: tm.name })),
      (v) => { activeTeam = v; rerenderList(true); }));
  }
  const dates = [...new Set(bundle.matches.map((m) => m.match_date).filter(Boolean))].sort();
  if (dates.length > 1)
    addSel(filterSelect(t.filterByDate, t.allDays, dates.map((d) => ({ value: d, label: weekdayName(d) + " · " + formatDate(d) })),
      (v) => { activeDate = v; rerenderList(true); }));

  if (filters.children.length) {
    filters.appendChild(el("button.btn.btn-sm.btn-outline.filter-clear", {
      type: "button", text: "✕ " + t.clearFilters,
      onclick: () => { activeGroup = activeTeam = activeDate = "all"; selects.forEach((s) => { s.value = "all"; }); rerenderList(true); },
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
      standingsTable(groupTeams, bundle.matches, points, tournament.qualifiers_per_group),
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
  const u = s?.user;
  if (!u || !u.email || !u.emailVerified) return null;   // الكتابة تتطلّب بريداً موثَّقاً
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

async function renderMatchDetail(id, matchId) {
  mount(app, spinner());
  const tournament = await fetchTournament(id);
  if (!tournament) return mount(app, emptyState("🔍", "البطولة غير موجودة"),
    el("a.btn.btn-outline", { href: "#/", text: t.backToTournaments }));
  let bundle = await fetchTournamentBundle(id);
  let match = bundle.matches.find((m) => m.id === matchId);
  const backLink = el("a.header-link", { href: `#/t/${id}/schedule`,
    text: "→ " + t.backToSchedule, style: "background:transparent;color:var(--text-2);padding:0;font-size:.85rem" });
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
  document.title = t.matchDetails + " · " + (SITE_NAME || "");

  const render = () => {
    const teamById = new Map(bundle.teams.map((x) => [x.id, x]));
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

    mount(host,
      el("div.mp-scoreboard" + (live ? ".is-live" : ""), {}, [
        el("div.mp-team", {}, [
          el("div.mp-team-badge", { "aria-hidden": "true", text: "⚽" }),
          el("span.mp-team-name", { text: home ? home.name : "—" }),
        ]),
        el("div", {}, [
          scoreMid,
          live ? el("div.mp-minute", {}, [
            el("span.badge.badge-live", {}, [el("span.dot"), match.minute != null ? t.live + " · " + match.minute + "'" : t.live]),
          ]) : null,
        ]),
        el("div.mp-team", {}, [
          el("div.mp-team-badge", { "aria-hidden": "true", text: "⚽" }),
          el("span.mp-team-name", { text: away ? away.name : "—" }),
        ]),
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

  currentUnsub = subscribeTournament(id, debounce(async () => {
    try {
      bundle = await fetchTournamentBundle(id);
      const m2 = bundle.matches.find((m) => m.id === matchId);
      if (m2) match = m2;
      render();
    } catch (e) { console.error(e); }
  }, 400));
}

// ---- أدوات -----------------------------------------------------------------

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
