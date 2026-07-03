// ============================================================================
//  التطبيق العام (العرض للزوّار): توجيه، قائمة البطولات، البرنامج، الترتيب
// ============================================================================
import { isConfigured } from "./firebase.js";
import { SITE_NAME } from "./config.js";
import { t, statusLabel, matchStatusLabel, formatDate, formatTime, weekdayName } from "./i18n.js";
import { el, mount, clear, spinner, emptyState, toast } from "./util.js";
import {
  fetchTournaments, fetchTournament, fetchTournamentBundle, subscribeTournament, isCounted,
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

// ---- التوجيه (Hash routing) -----------------------------------------------

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean);
  // "" | "t/:id" | "t/:id/:tab" | "t/:id/m/:matchId"
  if (parts[0] === "t" && parts[1]) {
    if (parts[2] === "m" && parts[3]) return { view: "match", id: parts[1], matchId: parts[3] };
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
  else host.appendChild(renderSchedule(state));
}

// ---- تبويب البرنامج --------------------------------------------------------

function renderSchedule(state) {
  const { bundle, tournament } = state;
  const teamById = new Map(bundle.teams.map((x) => [x.id, x]));
  const groupById = new Map(bundle.groups.map((x) => [x.id, x]));
  const wrap = el("div");

  // مرشّحات البيوت
  let activeGroup = "all";
  const listHost = el("div");
  const chips = el("div.filters");
  const rerenderList = () => {
    const matches = activeGroup === "all"
      ? bundle.matches
      : bundle.matches.filter((m) => m.group_id === activeGroup);
    mount(listHost, renderScheduleDays(matches, teamById, groupById, { tid: tournament.id }));
  };
  const makeChip = (label, val) => el("button.chip" + (val === activeGroup ? ".active" : ""), {
    text: label,
    onclick: (e) => { activeGroup = val; [...chips.children].forEach((c) => c.classList.toggle("active", c === e.currentTarget)); rerenderList(); },
  });
  if (bundle.groups.length > 1) {
    chips.appendChild(makeChip(t.allGroups, "all"));
    for (const g of bundle.groups) chips.appendChild(makeChip(g.name, g.id));
    wrap.appendChild(chips);
  }
  wrap.appendChild(listHost);
  rerenderList();
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

    const lineupCol = (team) => {
      const members = (bundle.players || []).filter((p) => team && p.team_id === team.id)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      const ofRole = (r) => members.filter((p) => (p.role || "player") === r);
      const section = (label, arr, showNum) => arr.length ? el("div.lu-group", {}, [
        el("div.lu-label", { text: label }),
        ...arr.map((p) => el("div.lu-row", {}, [
          showNum && p.number != null && p.number !== "" ? el("span.player-num", { text: String(p.number) }) : null,
          el("span", { text: p.name }),
        ])),
      ]) : null;
      return el("div.lu-card", {}, [
        el("div.lu-team", { text: team ? team.name : "—" }),
        section(t.squadPlayers, ofRole("player"), true),
        section(t.squadCoach, ofRole("coach"), false),
        section(t.squadManagement, ofRole("management"), false),
        !members.length ? el("p.page-sub", { style: "padding:4px 2px", text: t.noLineup }) : null,
      ]);
    };

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
        events.length ? el("div.card", {}, [eventsTimeline(events, playersById, teamById)])
                      : el("p.page-sub", { style: "padding:6px 2px", text: t.noEvents }),
      ]),
      el("div.mp-section", {}, [
        el("h3.mp-title", { text: t.lineups }),
        el("div.mp-lineups", {}, [lineupCol(home), lineupCol(away)]),
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
