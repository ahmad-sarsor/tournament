// ============================================================================
//  التطبيق العام (العرض للزوّار): توجيه، قائمة البطولات، البرنامج، الترتيب
// ============================================================================
import { isConfigured } from "./firebase.js";
import { SITE_NAME } from "./config.js";
import { t, statusLabel, formatDate } from "./i18n.js";
import { el, mount, clear, spinner, emptyState, toast } from "./util.js";
import {
  fetchTournaments, fetchTournament, fetchTournamentBundle, subscribeTournament,
} from "./data.js";
import { renderScheduleDays, standingsTable } from "./render.js";

const app = document.getElementById("app");
const brandName = document.getElementById("brand-name");
if (SITE_NAME) { brandName.textContent = SITE_NAME; document.title = SITE_NAME; }

let currentUnsub = null;              // إلغاء اشتراك التحديث اللحظي الحالي
function cleanup() { if (currentUnsub) { currentUnsub(); currentUnsub = null; } }

// ---- التوجيه (Hash routing) -----------------------------------------------

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean);
  // "" | "t/:id" | "t/:id/:tab"
  if (parts[0] === "t" && parts[1]) return { view: "tournament", id: parts[1], tab: parts[2] || "schedule" };
  return { view: "home" };
}

async function route() {
  cleanup();
  if (!isConfigured) return renderSetupNeeded();
  const r = parseHash();
  try {
    if (r.view === "tournament") await renderTournament(r.id, r.tab);
    else await renderHome();
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
      ]),
      tournament.description ? el("p.page-sub", { text: tournament.description }) : null,
    ]),
    tabs,
    content,
  );
  renderTabContent(state);
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
  const { bundle } = state;
  const teamById = new Map(bundle.teams.map((x) => [x.id, x]));
  const groupById = new Map(bundle.groups.map((x) => [x.id, x]));
  const playersById = new Map((bundle.players || []).map((x) => [x.id, x]));
  const eventsByMatch = new Map();
  for (const e of bundle.events || []) {
    if (!eventsByMatch.has(e.match_id)) eventsByMatch.set(e.match_id, []);
    eventsByMatch.get(e.match_id).push(e);
  }
  const wrap = el("div");

  // مرشّحات البيوت
  let activeGroup = "all";
  const listHost = el("div");
  const chips = el("div.filters");
  const rerenderList = () => {
    const matches = activeGroup === "all"
      ? bundle.matches
      : bundle.matches.filter((m) => m.group_id === activeGroup);
    mount(listHost, renderScheduleDays(matches, teamById, groupById, { eventsByMatch, playersById }));
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
  const wrap = el("div", {}, [
    el("div.alert.alert-info", { text: t.standingsNote }),
  ]);

  const groups = bundle.groups.length ? bundle.groups : [{ id: null, name: t.standings }];
  let any = false;
  for (const g of groups) {
    const groupTeams = bundle.teams.filter((x) => x.group_id === g.id);
    if (!groupTeams.length) continue;
    any = true;
    wrap.appendChild(el("div.standings-block", {}, [
      el("div.standings-title", {}, [el("span", { text: "🏠" }), el("span", { text: g.name })]),
      standingsTable(groupTeams, bundle.matches, points, tournament.qualifiers_per_group),
    ]));
  }
  if (!any) return emptyState("📊", t.noTeams);

  wrap.appendChild(el("div.legend", {}, [
    el("span", {}, [el("span.swatch"), t.qualifies]),
    el("span", { text: t.tieBreak }),
  ]));
  return wrap;
}

// ---- أدوات -----------------------------------------------------------------

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
