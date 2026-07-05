// ============================================================================
//  التطبيق العام (العرض للزوّار): توجيه، قائمة البطولات، البرنامج، الترتيب
// ============================================================================
import { isConfigured } from "./firebase.js";
import { SITE_NAME } from "./config.js";
import { t, statusLabel, matchStatusLabel, formatDate, formatTime, weekdayName } from "./i18n.js";
import { el, mount, clear, spinner, emptyState, toast } from "./util.js";
import {
  fetchTournaments, fetchTournament, fetchTournamentBundle, subscribeTournament, isCounted, computeGroupStandings,
} from "./data.js";
import { renderScheduleDays, standingsTable, eventsTimeline } from "./render.js";
import { openSettings, applyPrefs } from "./settings.js";

const app = document.getElementById("app");
const brandName = document.getElementById("brand-name");
if (SITE_NAME) { brandName.textContent = SITE_NAME; document.title = SITE_NAME; }

applyPrefs();
document.getElementById("settings-btn")?.addEventListener("click", () => openSettings({ isAdmin: false }));

let currentUnsub = null;              // إلغاء اشتراك التحديث اللحظي الحالي
function cleanup() { if (currentUnsub) { currentUnsub(); currentUnsub = null; } }

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
  const grid = el("div.grid.cols");
  for (const tr of tournaments) grid.appendChild(tournamentCard(tr));
  mount(app, head, grid);
}

function tournamentCard(tr) {
  const dates = [tr.start_date, tr.end_date].filter(Boolean).map(formatDate).join(" ← ");
  return el("a.t-card", { href: `#/t/${tr.id}` }, [
    el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:10px" }, [
      el("h3", { text: tr.name }),
      statusBadge(tr.status),
    ]),
    tr.description ? el("p.page-sub", { text: tr.description }) : null,
    el("div.meta", {}, [ dates ? el("span", { text: "🗓️ " + dates }) : null ]),
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
  const tabs = el("div.tabs", { role: "tablist" }, [
    tabBtn(t.schedule, tournament.id, "schedule", state.tab),
    tabBtn(t.standings, tournament.id, "standings", state.tab),
    tabBtn(t.teamsTab, tournament.id, "teams", state.tab),
    tabBtn(t.statsTab, tournament.id, "stats", state.tab),
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
    text: label, role: "tab", onclick: () => { location.hash = `#/t/${id}/${tab}`; },
  });
}

function renderTabContent(state) {
  const host = document.getElementById("tab-content");
  if (!host) return;
  clear(host);
  if (state.tab === "standings") host.appendChild(renderStandings(state));
  else if (state.tab === "teams") host.appendChild(renderTeams(state));
  else if (state.tab === "stats") host.appendChild(renderStats(state));
  else host.appendChild(renderSchedule(state));
}

// ---- تبويب الإحصائيات ------------------------------------------------------

function renderStats(state) {
  const { bundle, tournament } = state;
  const teamById = new Map(bundle.teams.map((x) => [x.id, x]));
  const groupById = new Map(bundle.groups.map((x) => [x.id, x]));
  const playersById = new Map((bundle.players || []).map((x) => [x.id, x]));
  const points = { win: tournament.win_points ?? 3, draw: tournament.draw_points ?? 1, loss: tournament.loss_points ?? 0 };

  let activeGroup = "all";
  const wrap = el("div");
  const content = el("div");

  const chips = el("div.filters");
  if (bundle.groups.length > 1) {
    const makeChip = (label, val) => el("button.chip" + (val === activeGroup ? ".active" : ""), {
      text: label,
      onclick: (e) => { activeGroup = val; [...chips.children].forEach((c) => c.classList.toggle("active", c === e.currentTarget)); rerender(); },
    });
    chips.appendChild(makeChip(t.allGroups, "all"));
    for (const g of bundle.groups) chips.appendChild(makeChip(g.name, g.id));
    wrap.appendChild(chips);
  }
  wrap.appendChild(content);

  function statTile(value, label) {
    return el("div.stat-tile", {}, [el("div.stat-val", { text: String(value) }), el("div.stat-lbl", { text: label })]);
  }

  function rerender() {
    const teamIds = activeGroup === "all" ? null : new Set(bundle.teams.filter((x) => x.group_id === activeGroup).map((x) => x.id));
    const inFilter = (tid) => !teamIds || teamIds.has(tid);
    const teamName = (tid) => teamById.get(tid)?.name || "—";

    // المباريات المُحتسَبة (منتهية وضمن المرشّح) — منها تُبنى كل الإحصائيات
    const played = (bundle.matches || []).filter((m) => isCounted(m) && inFilter(m.home_team_id) && inFilter(m.away_team_id));
    const countedIds = new Set(played.map((m) => m.id));

    // أهداف اللاعبين والبطاقات من أحداث تلك المباريات فقط (اتّساقاً مع باقي الإحصائيات)
    const goalMap = new Map(), cardMap = new Map();
    for (const e of bundle.events || []) {
      if (!e.player_id || !countedIds.has(e.match_id)) continue;
      if (e.type === "goal") goalMap.set(e.player_id, (goalMap.get(e.player_id) || 0) + 1);
      else if (e.type === "yellow" || e.type === "red") {
        const c = cardMap.get(e.player_id) || { y: 0, r: 0, team: e.team_id };
        if (e.type === "yellow") c.y++; else c.r++;
        cardMap.set(e.player_id, c);
      }
    }
    const scorers = [...goalMap.entries()]
      .map(([pid, g]) => ({ p: playersById.get(pid), goals: g }))
      .filter((x) => x.p)
      .sort((a, b) => b.goals - a.goals || a.p.name.localeCompare(b.p.name, "ar"));
    const cards = [...cardMap.entries()]
      .map(([pid, c]) => ({ p: playersById.get(pid), ...c }))
      .filter((x) => x.p)
      .sort((a, b) => (b.r - a.r) || (b.y - a.y) || a.p.name.localeCompare(b.p.name, "ar"));

    const totalGoals = played.reduce((s, m) => s + (m.home_score || 0) + (m.away_score || 0), 0);
    const avg = played.length ? (totalGoals / played.length).toFixed(1) : "0";

    // إحصائيات الفرق (ترتيب حسب الأهداف المُسجَّلة)
    const teams = activeGroup === "all" ? bundle.teams : bundle.teams.filter((x) => x.group_id === activeGroup);
    const teamRows = computeGroupStandings(teams, bundle.matches, points)
      .slice().sort((a, b) => b.gf - a.gf || b.gd - a.gd || a.team.name.localeCompare(b.team.name, "ar"));

    // بلاطات ملخّص
    const tiles = el("div.stat-tiles", {}, [
      statTile(played.length, t.statMatchesPlayed),
      statTile(totalGoals, t.statTotalGoals),
      statTile(avg, t.statAvgGoals),
      statTile(scorers[0] ? scorers[0].p.name : "—", t.statTopScorer),
    ]);

    // الهدّافون
    const scorersEl = scorers.length
      ? el("div.table-wrap", {}, [el("table.standings", {}, [
          el("thead", {}, [el("tr", {}, [el("th.rank-col", { text: "#" }), el("th.team-col", { text: t.th_player }), el("th", { text: t.th_team }), el("th.pts-col", { text: "⚽" })])]),
          el("tbody", {}, scorers.map((s, i) => el("tr" + (i === 0 ? ".champion" : ""), {}, [
            el("td", {}, [el("span.rank", { text: String(i + 1) })]),
            el("td.team-col", {}, [el("span.team-name", { text: s.p.name })]),
            el("td", {}, [el("span.stat-team", { text: teamName(s.p.team_id) })]),
            el("td", {}, [el("span.pts", { text: String(s.goals) })]),
          ]))),
        ])])
      : el("p.page-sub", { style: "padding:8px 2px", text: t.noScorersYet });

    // البطاقات
    const cardsEl = cards.length
      ? el("div.table-wrap", {}, [el("table.standings", {}, [
          el("thead", {}, [el("tr", {}, [el("th.team-col", { text: t.th_player }), el("th", { text: t.th_team }), el("th", { text: "🟨" }), el("th", { text: "🟥" })])]),
          el("tbody", {}, cards.map((c) => el("tr", {}, [
            el("td.team-col", {}, [el("span.team-name", { text: c.p.name })]),
            el("td", {}, [el("span.stat-team", { text: teamName(c.p.team_id) })]),
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

  // مرشّحات البيوت
  let activeGroup = "all";
  const listHost = el("div");
  const chips = el("div.filters");
  const currentMatches = () => activeGroup === "all"
    ? bundle.matches
    : bundle.matches.filter((m) => m.group_id === activeGroup);
  const rerenderList = (scrollToAnchor) => {
    const matches = currentMatches();
    mount(listHost, renderScheduleDays(matches, teamById, groupById, { tid: tournament.id }));
    if (scrollToAnchor) {
      const date = pickAnchorDate(matches);
      // بعد أن يُنفّذ route() الأمر scrollTo(0,0)، لذا نؤجّل لإطار العرض التالي
      requestAnimationFrame(() => scrollToDay(listHost, date));
    }
  };
  const makeChip = (label, val) => el("button.chip" + (val === activeGroup ? ".active" : ""), {
    text: label,
    // تغيير الفلتر ← نعيد الانتقال لليوم المناسب داخل نتائج البيت المختار
    onclick: (e) => { activeGroup = val; [...chips.children].forEach((c) => c.classList.toggle("active", c === e.currentTarget)); rerenderList(true); },
  });
  if (bundle.groups.length > 1) {
    chips.appendChild(makeChip(t.allGroups, "all"));
    for (const g of bundle.groups) chips.appendChild(makeChip(g.name, g.id));
    wrap.appendChild(chips);
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
  mount(app, el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:10px" }, [backLink, shareBtn(t.matchDetails)]), host);
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
      group ? group.name : null,
      match.match_date ? weekdayName(match.match_date) + " " + formatDate(match.match_date) : null,
      match.match_time ? formatTime(match.match_time) : null,
    ].filter(Boolean);

    mount(host,
      el("div.mp-scoreboard" + (live ? ".is-live" : ""), {}, [
        el("div.mp-team", {}, [el("span.mp-team-name", { text: home ? home.name : "—" })]),
        scoreMid,
        el("div.mp-team", {}, [el("span.mp-team-name", { text: away ? away.name : "—" })]),
      ]),
      el("div.mp-meta", {}, [
        el("span", { text: metaParts.join(" · ") }),
        live ? el("span.badge.badge-live", {}, [el("span.dot"), t.live])
             : el("span.badge.badge-" + (finished ? "finished" : "upcoming"), { text: matchStatusLabel(match.status) }),
      ]),
      el("div.mp-section", {}, [
        el("h3.mp-title", { text: t.events }),
        events.length ? el("div.card", {}, [eventsTimeline(events, playersById, teamById, { homeId: match.home_team_id, awayId: match.away_team_id })])
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
