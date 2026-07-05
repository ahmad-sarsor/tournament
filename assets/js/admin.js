// ============================================================================
//  لوحة الإدارة: مصادقة + إدارة البطولات/البيوت/الفرق/المباريات + توليد المباريات
// ============================================================================
import { isConfigured } from "./firebase.js";
import { t, formatDate, formatTime, weekdayName, statusLabel, matchStatusLabel } from "./i18n.js";
import { el, mount, clear, spinner, emptyState, toast, openModal, confirmDialog } from "./util.js";
import * as api from "./data.js";
import { groupByDay, eventIcon } from "./render.js";
import { openSettings, applyPrefs } from "./settings.js";

const app = document.getElementById("app");
const userBox = document.getElementById("user-box");
let session = null;
let uid = 0; // عدّاد لتوليد معرّفات فريدة لحقول النماذج (ربط label بالحقل)
let adminUnsub = null; // اشتراك التحديث اللحظي (للوحة الإدارة المباشرة)
function cleanupAdmin() { if (adminUnsub) { adminUnsub(); adminUnsub = null; } }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ---- إقلاع -----------------------------------------------------------------

applyPrefs();
document.getElementById("settings-btn")?.addEventListener("click", () => openSettings({ isAdmin: true }));

async function boot() {
  if (!isConfigured) return renderSetupNeeded();
  try { session = await api.getSession(); } catch (e) { console.error(e); }
  api.onAuthChange((s) => { session = s; renderUserBox(); route(); });
  window.addEventListener("hashchange", route);
  renderUserBox();
  route();
}
boot();

function renderUserBox() {
  clear(userBox);
  if (!session) return;
  userBox.appendChild(el("span", { style: "display:flex;align-items:center;gap:10px" }, [
    el("span", { style: "font-size:.82rem;opacity:.9", text: session.user.email }),
    el("button.btn.btn-sm.btn-outline", {
      text: t.logout, style: "background:rgba(255,255,255,.15);color:#fff;border-color:transparent",
      onclick: async () => { await api.signOut(); location.hash = "#/"; },
    }),
  ]));
}

// ---- التوجيه ---------------------------------------------------------------

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "t" && parts[1]) {
    if (parts[2] === "m" && parts[3]) return { view: "live", id: parts[1], matchId: parts[3] };
    return { view: "tournament", id: parts[1], tab: parts[2] || "details" };
  }
  return { view: "home" };
}

async function route() {
  cleanupAdmin();
  if (!isConfigured) return renderSetupNeeded();
  if (!session) return renderLogin();
  const r = parseHash();
  try {
    mount(app, spinner());
    if (r.view === "live") await renderLiveConsole(r.id, r.matchId);
    else if (r.view === "tournament") await renderTournamentAdmin(r.id, r.tab);
    else await renderHome();
  } catch (e) { console.error(e); renderError(e); }
}

function renderError(err) {
  mount(app, el("div.alert.alert-error", { text: (err?.message || t.errorGeneric) }),
    el("button.btn.btn-outline", { text: "إعادة المحاولة", onclick: route }));
}

function renderSetupNeeded() {
  mount(app,
    el("div.page-head", {}, [el("h1.page-title", { text: t.setupTitle })]),
    el("div.alert.alert-warn", { text: t.setupBody }));
}

// ---- تسجيل الدخول ----------------------------------------------------------

function renderLogin() {
  clear(userBox);
  const email = el("input.input", { id: "login-email", type: "email", autocomplete: "username", required: true });
  const pass = el("input.input", { id: "login-pass", type: "password", autocomplete: "current-password", required: true });
  const errBox = el("div.alert.alert-error", { hidden: true, role: "alert" });
  const btn = el("button.btn.btn-primary.btn-block", { type: "submit", text: t.login });

  const form = el("form", {}, [
    el("div.field", {}, [el("label", { text: t.email, for: "login-email" }), email]),
    el("div.field", {}, [el("label", { text: t.password, for: "login-pass" }), pass]),
    errBox, btn,
  ]);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.hidden = true; btn.disabled = true; btn.textContent = t.loading;
    try {
      await api.signIn(email.value.trim(), pass.value);
      // onAuthChange سيتكفّل بإعادة التوجيه
    } catch (err) {
      errBox.hidden = false; errBox.textContent = t.loginError;
      btn.disabled = false; btn.textContent = t.login;
    }
  });

  mount(app, el("div", { style: "max-width:400px;margin:6vh auto 0" }, [
    el("div.page-head", { style: "text-align:center" }, [
      el("h1.page-title", { text: t.adminPanel }),
      el("p.page-sub", { text: t.loginPrompt }),
    ]),
    el("div.card.card-pad", {}, [form]),
  ]));
}

// ---- الصفحة الرئيسية للإدارة -----------------------------------------------

async function renderHome() {
  const tournaments = await api.fetchTournaments();
  const head = el("div.page-head", { style: "display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap" }, [
    el("div", {}, [el("h1.page-title", { text: t.tournaments }), el("p.page-sub", { text: "إدارة كل البطولات" })]),
    el("button.btn.btn-primary", { text: "＋ " + t.newTournament, onclick: () => tournamentForm(null) }),
  ]);
  const list = el("div");
  if (!tournaments.length) list.appendChild(emptyState("🏆", "لا توجد بطولات بعد — أنشئ بطولتك الأولى"));
  for (const tr of tournaments) {
    list.appendChild(el("div.admin-list-item", {}, [
      el("div.grow", {}, [
        el("div", { style: "font-weight:800", text: tr.name }),
        el("div.sub", { text: [statusLabel(tr.status), tr.start_date ? formatDate(tr.start_date) : null].filter(Boolean).join(" · ") }),
      ]),
      el("a.btn.btn-sm.btn-outline", { href: `#/t/${tr.id}`, text: "إدارة" }),
      el("button.btn.btn-sm.btn-outline", { text: t.edit, onclick: () => tournamentForm(tr) }),
      el("button.btn.btn-sm.btn-danger", { text: t.delete, onclick: () => removeTournament(tr) }),
    ]));
  }
  mount(app, head, list);
}

async function removeTournament(tr) {
  if (!(await confirmDialog(`حذف البطولة «${tr.name}» وكل بياناتها؟ ${t.confirmDelete}`))) return;
  try { await api.deleteTournament(tr.id); toast(t.deleted, "ok"); route(); }
  catch (e) { toast(e.message || t.errorGeneric, "err"); }
}

// ---- إدارة بطولة واحدة -----------------------------------------------------

async function renderTournamentAdmin(id, tab) {
  const tournament = await api.fetchTournament(id);
  if (!tournament) return mount(app, emptyState("🔍", "البطولة غير موجودة"),
    el("a.btn.btn-outline", { href: "#/", text: t.backToTournaments }));
  const bundle = await api.fetchTournamentBundle(id);
  const state = { tournament, ...bundle, tab };

  const tabs = el("div.tabs", {}, [
    adminTab(t.editTournament, id, "details", tab),
    adminTab(t.teamsTab, id, "teams", tab),
    adminTab(t.manageGroups, id, "groups", tab),
    adminTab(t.manageMatches, id, "matches", tab),
  ]);
  const content = el("div");
  mount(app,
    el("a.header-link", { href: "#/", text: "→ " + t.backToTournaments, style: "background:transparent;color:var(--text-2);padding:0;font-size:.85rem" }),
    el("div.page-head", { style: "margin-top:10px" }, [el("h1.page-title", { text: tournament.name })]),
    tabs, content);

  if (tab === "teams") renderTeamsAdmin(content, state);
  else if (tab === "groups") renderGroupsAdmin(content, state);
  else if (tab === "matches") renderMatchesTab(content, state);
  else renderDetailsTab(content, state);
}

function adminTab(label, id, tab, active) {
  return el("button.tab" + (tab === active ? ".active" : ""), {
    text: label, onclick: () => { location.hash = `#/t/${id}/${tab}`; },
  });
}

// ---- تبويب التفاصيل --------------------------------------------------------

function renderDetailsTab(host, state) {
  const { tournament: tr } = state;
  const row = (k, v) => el("div", { style: "display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)" }, [
    el("span", { style: "color:var(--text-2)", text: k }), el("b", { text: v }),
  ]);
  mount(host,
    el("div.card.card-pad", {}, [
      row("الاسم", tr.name),
      row("الحالة", statusLabel(tr.status)),
      row("الفترة", [tr.start_date, tr.end_date].filter(Boolean).map(formatDate).join(" ← ") || "—"),
      row("المتأهّلون من كل بيت", String(tr.qualifiers_per_group)),
      row("نقاط الفوز/التعادل", `${tr.win_points} / ${tr.draw_points}`),
      row("عدد البيوت", String(state.groups.length)),
      row("عدد الفرق", String(state.teams.length)),
      row("عدد المباريات", String(state.matches.length)),
      el("div", { style: "display:flex;gap:10px;margin-top:16px" }, [
        el("button.btn.btn-primary", { text: t.edit, onclick: () => tournamentForm(tr) }),
        el("button.btn.btn-danger", { text: t.delete, onclick: () => removeTournament(tr) }),
      ]),
    ]));
}

function tournamentForm(existing) {
  const statuses = ["upcoming", "active", "finished"];
  formModal({
    title: existing ? t.editTournament : t.newTournament,
    fields: [
      { name: "name", label: t.tName, value: existing?.name, attrs: { required: true } },
      { name: "description", label: t.tDesc, type: "textarea", value: existing?.description },
      { name: "start_date", label: t.tStart, type: "date", value: existing?.start_date },
      { name: "end_date", label: t.tEnd, type: "date", value: existing?.end_date },
      { name: "status", label: t.tStatus, type: "select", value: existing?.status || "upcoming",
        options: statuses.map((s) => ({ value: s, label: statusLabel(s) })) },
      { name: "qualifiers_per_group", label: t.tQualifiers, type: "number", value: existing?.qualifiers_per_group ?? 2, attrs: { min: 0 } },
      { name: "win_points", label: t.tWinPoints, type: "number", value: existing?.win_points ?? 3, attrs: { min: 0 } },
      { name: "draw_points", label: t.tDrawPoints, type: "number", value: existing?.draw_points ?? 1, attrs: { min: 0 } },
    ],
    onSubmit: async (v, close) => {
      const payload = {
        name: v.name.trim(),
        description: v.description.trim() || null,
        start_date: v.start_date || null,
        end_date: v.end_date || null,
        status: v.status,
        qualifiers_per_group: toInt(v.qualifiers_per_group, 2),
        win_points: toInt(v.win_points, 3),
        draw_points: toInt(v.draw_points, 1),
      };
      if (!payload.name) return toast("الاسم مطلوب", "err");
      if (existing) await api.updateTournament(existing.id, payload);
      else await api.createTournament(payload);
      close(); toast(t.saved, "ok"); route();
    },
  });
}

// ---- تبويب الفرق (قائمة مسطّحة، كل فريق يُسند لأي بيت) ----------------------

function renderTeamsAdmin(host, state) {
  const { tournament, groups, teams } = state;
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const wrap = el("div", {}, [
    el("p.page-sub", { style: "margin-bottom:12px", text: "كل الفرق. عدّل بيت كل فريق من زرّ التعديل (اتركه «بدون بيت» لخروج المغلوب أو الدوري الفردي)." }),
    el("div", { style: "margin-bottom:16px" }, [
      el("button.btn.btn-primary", { text: "＋ " + t.addTeam, onclick: () => teamForm(tournament.id, groups, null) }),
    ]),
  ]);
  if (!teams.length) wrap.appendChild(emptyState("👥", "أضف فرق البطولة"));

  const sorted = teams.slice().sort((a, b) =>
    ((groupById.get(a.group_id)?.sort_order ?? 9999) - (groupById.get(b.group_id)?.sort_order ?? 9999)) ||
    (a.sort_order ?? 0) - (b.sort_order ?? 0));
  for (const tm of sorted) {
    const g = groupById.get(tm.group_id);
    const pcount = (state.players || []).filter((p) => p.team_id === tm.id).length;
    wrap.appendChild(el("div.admin-list-item", {}, [
      el("div.grow", {}, [
        el("div", { style: "font-weight:700", text: tm.name }),
        el("div.sub", { style: "display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:3px" }, [
          g ? el("span.badge.badge-active", { text: g.name }) : el("span.badge.badge-upcoming", { text: t.noGroup }),
          el("span", { text: `${pcount} ${t.players}` }),
        ]),
      ]),
      el("button.btn.btn-sm.btn-outline", { text: "👥", title: t.players, onclick: () => playersModal(state, tm) }),
      el("button.icon-btn", { text: "✎", title: t.edit, onclick: () => teamForm(tournament.id, groups, tm) }),
      el("button.icon-btn", { text: "🗑", title: t.delete, onclick: () => removeTeam(tm) }),
    ]));
  }
  mount(host, wrap);
}

// ---- تبويب البيوت (المجموعات فقط) -----------------------------------------

function renderGroupsAdmin(host, state) {
  const { tournament, groups, teams } = state;
  const wrap = el("div", {}, [
    el("p.page-sub", { style: "margin-bottom:12px", text: "البيوت (المجموعات). للدوري الفردي أو خروج المغلوب يمكن تركها فارغة." }),
    el("div", { style: "margin-bottom:16px" }, [
      el("button.btn.btn-primary", { text: "＋ " + t.addGroup, onclick: () => groupForm(tournament.id, null) }),
    ]),
  ]);
  if (!groups.length) wrap.appendChild(emptyState("🏠", "لا توجد بيوت (اختياري)"));

  const sorted = groups.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  for (const g of sorted) {
    const count = teams.filter((x) => x.group_id === g.id).length;
    wrap.appendChild(el("div.admin-list-item", {}, [
      el("div.grow", {}, [
        el("div", { style: "font-weight:700", text: g.name }),
        el("div.sub", { text: `${count} فريق` }),
      ]),
      el("button.icon-btn", { text: "✎", title: t.edit, onclick: () => groupForm(tournament.id, g) }),
      el("button.icon-btn", { text: "🗑", title: t.delete, onclick: () => removeGroup(g) }),
    ]));
  }
  mount(host, wrap);
}

function groupForm(tid, existing) {
  formModal({
    title: existing ? t.edit : t.addGroup,
    fields: [{ name: "name", label: t.groupName, value: existing?.name, attrs: { required: true } }],
    onSubmit: async (v, close) => {
      const name = v.name.trim();
      if (!name) return toast("الاسم مطلوب", "err");
      if (existing) await api.updateGroup(existing.id, { name });
      else await api.createGroup({ tournament_id: tid, name, sort_order: Date.now() });
      close(); toast(t.saved, "ok"); route();
    },
  });
}

async function removeGroup(g) {
  if (!(await confirmDialog(`حذف «${g.name}»؟ ستُفصل الفرق والمباريات عن هذا البيت. ${t.confirmDelete}`))) return;
  try { await api.deleteGroup(g.id); toast(t.deleted, "ok"); route(); }
  catch (e) { toast(e.message || t.errorGeneric, "err"); }
}

function teamForm(tid, groups, existing, defaultGroupId) {
  formModal({
    title: existing ? t.edit : t.addTeam,
    fields: [
      { name: "name", label: t.teamName, value: existing?.name, attrs: { required: true } },
      { name: "group_id", label: t.matchGroup, type: "select",
        value: existing?.group_id ?? defaultGroupId ?? "",
        options: [{ value: "", label: t.noGroup }, ...groups.map((g) => ({ value: g.id, label: g.name }))] },
    ],
    onSubmit: async (v, close) => {
      const name = v.name.trim();
      if (!name) return toast("الاسم مطلوب", "err");
      const payload = { name, group_id: v.group_id || null };
      if (existing) await api.updateTeam(existing.id, payload);
      else await api.createTeam({ tournament_id: tid, ...payload, sort_order: Date.now() });
      close(); toast(t.saved, "ok"); route();
    },
  });
}

async function removeTeam(tm) {
  if (!(await confirmDialog(`حذف الفريق «${tm.name}» ولاعبيه؟ ${t.confirmDelete}`))) return;
  try { await api.deleteTeam(tm.id); toast(t.deleted, "ok"); route(); }
  catch (e) { toast(e.message || t.errorGeneric, "err"); }
}

// ---- إدارة لاعبي الفريق ----------------------------------------------------

const ROLE_LABEL = { player: "لاعب", coach: "مدرب", management: "إداري" };

function playersModal(state, team) {
  const list = el("div");
  const render = () => {
    const members = (state.players || []).filter((p) => p.team_id === team.id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    clear(list);
    if (!members.length) { list.appendChild(el("p.page-sub", { style: "padding:8px 2px", text: t.noPlayers })); return; }
    members.forEach((p, idx) => {
      const role = p.role || "player";
      list.appendChild(el("div.admin-list-item", { style: "padding:7px 10px;gap:6px" }, [
        role === "player" && p.number != null && p.number !== "" ? el("span.player-num", { text: String(p.number) }) : null,
        el("div.grow", {}, [
          el("div", { style: "font-weight:700", text: p.name }),
          role !== "player" ? el("div.sub", { text: ROLE_LABEL[role] }) : null,
        ]),
        el("button.icon-btn", { text: "▲", title: t.moveUp, disabled: idx === 0, onclick: () => movePlayer(state, team, p, -1) }),
        el("button.icon-btn", { text: "▼", title: t.moveDown, disabled: idx === members.length - 1, onclick: () => movePlayer(state, team, p, 1) }),
        el("button.icon-btn", { text: "✎", title: t.edit, onclick: () => playerForm(state, team, p) }),
        el("button.icon-btn", { text: "🗑", title: t.delete, onclick: () => removePlayer(state, team, p) }),
      ]));
    });
  };
  render();
  openModal({
    title: `${t.managePlayers} — ${team.name}`,
    body: el("div", {}, [
      list,
      el("button.btn.btn-primary.btn-block", { style: "margin-top:14px", text: "＋ " + t.addMember, onclick: () => playerForm(state, team, null) }),
    ]),
    onDismiss: () => route(),
  });
  playersModal._refresh = render;
}

// إعادة ترتيب عضو داخل قائمة الفريق (تبديل ترقيم متسلسل)
async function movePlayer(state, team, player, dir) {
  const members = (state.players || []).filter((p) => p.team_id === team.id)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const idx = members.findIndex((p) => p.id === player.id);
  if (idx < 0 || idx + dir < 0 || idx + dir >= members.length) return;
  [members[idx], members[idx + dir]] = [members[idx + dir], members[idx]];
  try {
    for (let i = 0; i < members.length; i++) {
      if (members[i].sort_order !== i + 1) {
        await api.updatePlayer(members[i].id, { sort_order: i + 1 });
        members[i].sort_order = i + 1;
      }
    }
    playersModal._refresh?.();
  } catch (e) { toast(e.message || t.errorGeneric, "err"); }
}

function playerForm(state, team, existing) {
  const nextOrder = ((state.players || []).filter((p) => p.team_id === team.id)
    .reduce((m, p) => Math.max(m, p.sort_order ?? 0), 0)) + 1;
  formModal({
    title: existing ? t.edit : t.addMember,
    fields: [
      { name: "name", label: t.playerName, value: existing?.name, attrs: { required: true } },
      { name: "role", label: t.memberRole, type: "select", value: existing?.role || "player",
        options: [
          { value: "player", label: t.role_player },
          { value: "coach", label: t.role_coach },
          { value: "management", label: t.role_management },
        ] },
      { name: "number", label: t.playerNumber + " (للاعبين)", type: "number", value: existing?.number ?? "", attrs: { min: 0, inputmode: "numeric" } },
    ],
    onSubmit: async (v, close) => {
      const name = v.name.trim();
      if (!name) return toast("الاسم مطلوب", "err");
      const role = v.role || "player";
      const number = v.number === "" ? null : toInt(v.number, null);
      if (existing) {
        await api.updatePlayer(existing.id, { name, number, role });
        Object.assign(existing, { name, number, role });
      } else {
        const created = await api.createPlayer({
          tournament_id: team.tournament_id, team_id: team.id, name, number, role, sort_order: nextOrder,
        });
        (state.players ||= []).push(created);
      }
      close(); toast(t.saved, "ok");
      playersModal._refresh?.();
    },
  });
}

async function removePlayer(state, team, p) {
  if (!(await confirmDialog(`حذف اللاعب «${p.name}»؟`))) return;
  try {
    await api.deletePlayer(p.id);
    state.players = (state.players || []).filter((x) => x.id !== p.id);
    toast(t.deleted, "ok");
    playersModal._refresh?.();
  } catch (e) { toast(e.message || t.errorGeneric, "err"); }
}

// ---- تبويب المباريات -------------------------------------------------------

function renderMatchesTab(host, state) {
  const { tournament, groups, teams, matches } = state;
  const teamById = new Map(teams.map((x) => [x.id, x]));
  const groupById = new Map(groups.map((x) => [x.id, x]));

  const bar = el("div", { style: "display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px" }, [
    el("button.btn.btn-primary", { text: "＋ " + t.addMatch, onclick: () => matchForm(state, null) }),
    el("button.btn.btn-accent", { text: "⚡ " + t.generateFixtures, onclick: () => generateFixtures(state) }),
  ]);

  const list = el("div");
  if (!matches.length) list.appendChild(emptyState("📅", "لا توجد مباريات — أضف مباراة أو ولّدها تلقائياً"));

  for (const [date, dayMatches] of groupByDay(matches)) {
    list.appendChild(el("div.day-head", {}, [
      el("span", { text: date === "—" ? "غير مجدولة" : weekdayName(date) }),
      date !== "—" ? el("span.date", { text: formatDate(date) }) : null,
      el("span.line"),
    ]));
    for (const m of dayMatches) {
      const home = teamById.get(m.home_team_id)?.name || "—";
      const away = teamById.get(m.away_team_id)?.name || "—";
      const grp = groupById.get(m.group_id)?.name;
      const score = (m.home_score != null && m.away_score != null) ? `${m.home_score} - ${m.away_score}` : "—";
      list.appendChild(el("div.admin-list-item", {}, [
        el("div", { style: "font-weight:800;min-width:52px;text-align:center", text: m.match_time ? formatTime(m.match_time) : "—" }),
        el("div.grow", {}, [
          el("div", { style: "font-weight:700", text: `${home}   ${score}   ${away}` }),
          el("div.sub", { text: [grp, matchStatusLabel(m.status)].filter(Boolean).join(" · ") }),
        ]),
        el("a.btn.btn-sm.btn-primary", { href: `#/t/${tournament.id}/m/${m.id}`,
          text: (m.status === "finished" ? "✎ " + t.editMatchBtn : "▶ " + t.manageMatchBtn) }),
        el("button.icon-btn", { text: "✎", title: t.editMatchInfo, onclick: () => matchForm(state, m) }),
        el("button.icon-btn", { text: "🗑", title: t.delete, onclick: () => removeMatch(m) }),
      ]));
    }
  }
  mount(host, bar, list);
}

function teamOptions(teams, groups) {
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  return teams.map((tm) => ({ value: tm.id, label: groupName.has(tm.group_id) ? `${tm.name} — ${groupName.get(tm.group_id)}` : tm.name }));
}

function matchForm(state, existing) {
  const { tournament, groups, teams } = state;
  const opts = teamOptions(teams, groups);
  formModal({
    title: existing ? t.editMatch : t.addMatch,
    fields: [
      { name: "group_id", label: t.matchGroup, type: "select", value: existing?.group_id ?? "",
        options: [{ value: "", label: t.noGroup }, ...groups.map((g) => ({ value: g.id, label: g.name }))] },
      { name: "home_team_id", label: t.homeTeam, type: "select", value: existing?.home_team_id ?? "",
        options: [{ value: "", label: "—" }, ...opts] },
      { name: "away_team_id", label: t.awayTeam, type: "select", value: existing?.away_team_id ?? "",
        options: [{ value: "", label: "—" }, ...opts] },
      { name: "match_date", label: t.matchDate, type: "date", value: existing?.match_date },
      { name: "match_time", label: t.matchTime, type: "time", value: existing?.match_time ? formatTime(existing.match_time) : "" },
      { name: "status", label: t.matchStatus, type: "select", value: existing?.status || "scheduled",
        options: [{ value: "scheduled", label: t.ms_scheduled }, { value: "live", label: t.ms_live }, { value: "finished", label: t.ms_finished }] },
    ],
    onSubmit: async (v, close) => {
      if (v.home_team_id && v.away_team_id && v.home_team_id === v.away_team_id) return toast("لا يمكن اختيار نفس الفريق للطرفين", "err");
      const payload = {
        group_id: v.group_id || null,
        home_team_id: v.home_team_id || null,
        away_team_id: v.away_team_id || null,
        match_date: v.match_date || null,
        match_time: v.match_time || null,
        status: v.status,
      };
      // منع حالة "منتهية" بلا نتيجة (قيد قاعدة البيانات)
      if (payload.status === "finished" && (existing?.home_score == null || existing?.away_score == null)) {
        payload.status = "scheduled";
        toast("أدخل النتيجة أولاً عبر «إدخال النتيجة»", "err");
      }
      if (existing) await api.updateMatch(existing.id, payload);
      else await api.createMatch({ tournament_id: tournament.id, ...payload, sort_order: Date.now() });
      close(); toast(t.saved, "ok"); route();
    },
  });
}

async function removeMatch(m) {
  if (!(await confirmDialog(`حذف هذه المباراة؟ ${t.confirmDelete}`))) return;
  try { await api.deleteMatch(m.id); toast(t.deleted, "ok"); route(); }
  catch (e) { toast(e.message || t.errorGeneric, "err"); }
}

function resultModal(m) {
  formModal({
    title: t.enterResult,
    fields: [
      { name: "home_score", label: t.homeTeam, type: "number", value: m.home_score ?? "", attrs: { min: 0, inputmode: "numeric" } },
      { name: "away_score", label: t.awayTeam, type: "number", value: m.away_score ?? "", attrs: { min: 0, inputmode: "numeric" } },
      { name: "status", label: t.matchStatus, type: "select", value: m.status === "scheduled" ? "finished" : m.status,
        options: [{ value: "finished", label: t.ms_finished }, { value: "live", label: t.ms_live }, { value: "scheduled", label: t.ms_scheduled }] },
    ],
    onSubmit: async (v, close) => {
      const hs = v.home_score === "" ? null : toInt(v.home_score, null);
      const as = v.away_score === "" ? null : toInt(v.away_score, null);
      let status = v.status;
      if (status === "finished" && (hs == null || as == null)) return toast("أدخل نتيجة الفريقين", "err");
      if (status === "scheduled") { /* السماح بمسح النتيجة */ }
      await api.updateMatch(m.id, { home_score: hs, away_score: as, status });
      close(); toast(t.saved, "ok"); route();
    },
  });
}

async function generateFixtures(state) {
  const { tournament, groups, teams, matches } = state;
  // نتحقّق من وجود مجموعة (بيت أو «بدون بيت») فيها فريقان على الأقل
  const buckets = [...groups.map((g) => teams.filter((x) => x.group_id === g.id)), teams.filter((x) => x.group_id == null)];
  if (!buckets.some((b) => b.length >= 2)) return toast(t.needTeams, "err");
  const msg = matches.length ? t.fixturesExistWarn + "\n\nمتابعة؟" : "توليد مباريات دوري كامل لكل بيت؟";
  if (!(await confirmDialog(msg, { danger: false, confirmText: t.confirm }))) return;
  try {
    // منع التكرار: نتجاهل أي مباراة موجودة مسبقاً بين نفس الفريقين داخل نفس البيت (بأي ترتيب)
    const pairKey = (g, a, b) => `${g}|${[a, b].sort().join("~")}`;
    const existing = new Set(matches.map((m) => pairKey(m.group_id, m.home_team_id, m.away_team_id)));
    const all = api.buildFixtures(tournament.id, groups, teams);
    const rows = all.filter((r) => !existing.has(pairKey(r.group_id, r.home_team_id, r.away_team_id)));
    const skipped = all.length - rows.length;
    if (!rows.length) return toast("كل المباريات مُولّدة مسبقاً — لا جديد", "");
    await api.insertMatches(rows);
    toast(t.fixturesDone + ` (${rows.length})` + (skipped ? ` · تم تجاهل ${skipped} مكرّرة` : ""), "ok");
    route();
  } catch (e) { toast(e.message || t.errorGeneric, "err"); }
}

// ---- الإدارة المباشرة للمباراة ---------------------------------------------

async function renderLiveConsole(tid, matchId) {
  const tournament = await api.fetchTournament(tid);
  if (!tournament) return mount(app, emptyState("🔍", "البطولة غير موجودة"),
    el("a.btn.btn-outline", { href: "#/", text: t.backToTournaments }));
  let bundle = await api.fetchTournamentBundle(tid);
  let match = bundle.matches.find((m) => m.id === matchId);
  if (!match) return mount(app,
    el("a.header-link", { href: `#/t/${tid}/matches`, text: "→ " + t.manageMatches, style: "background:transparent;color:var(--text-2);padding:0;font-size:.85rem" }),
    emptyState("🔍", "المباراة غير موجودة"));

  const teamById = new Map(bundle.teams.map((x) => [x.id, x]));
  let currentMinute = ""; // يُحتفظ بها بين الأحداث

  const container = el("div.live-console");
  mount(app, container);

  async function reload() {
    bundle = await api.fetchTournamentBundle(tid);
    match = bundle.matches.find((m) => m.id === matchId) || match;
    render();
  }

  // تحديث لحظي: لو سجّل مديرٌ آخر هدفاً تُحدَّث الشاشة تلقائياً
  cleanupAdmin();
  adminUnsub = api.subscribeTournament(tid, debounce(() => { reload().catch((e) => console.error(e)); }, 400));

  function playersOf(teamId) {
    return (bundle.players || []).filter((p) => p.team_id === teamId && (p.role || "player") === "player")
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }

  function openPicker(type, teamId) {
    const team = teamById.get(teamId);
    const players = playersOf(teamId);
    const minInput = el("input.input.minute-input", { type: "number", inputmode: "numeric", min: 0, value: currentMinute, placeholder: "'" });
    let close;
    const pick = async (playerId) => {
      const minute = minInput.value === "" ? null : toInt(minInput.value, null);
      currentMinute = minInput.value;
      close();
      try {
        if (type === "goal") {
          const teamGoals = (bundle.events || []).filter((e) => e.match_id === matchId && e.team_id === teamId && e.type === "goal").length;
          await api.addGoal(match, teamId, playerId, minute, teamGoals);
        } else await api.addCard(match, teamId, playerId, minute, type);
        toast(t.saved, "ok");
        await reload();
      } catch (e) { toast(e.message || t.errorGeneric, "err"); }
    };
    // إضافة لاعب جديد لحظياً ثم تسجيله كصاحب الحدث
    const addNewThenPick = () => {
      const nameInput = el("input.input", { placeholder: t.newPlayerPrompt });
      const form2 = el("form", {}, [el("div.field", {}, [el("label", { text: t.newPlayerPrompt }), nameInput])]);
      const submitNew = async () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        let created;
        try {
          const order = ((bundle.players || []).filter((p) => p.team_id === teamId).reduce((m, p) => Math.max(m, p.sort_order ?? 0), 0)) + 1;
          created = await api.createPlayer({ tournament_id: match.tournament_id, team_id: teamId, name, number: null, role: "player", sort_order: order });
        } catch (e) { return toast(e.message || t.errorGeneric, "err"); }
        close2();
        pick(created.id); // النافذة الأصلية ما زالت مفتوحة؛ pick يقرأ الدقيقة ويغلقها
      };
      form2.addEventListener("submit", (e) => { e.preventDefault(); submitNew(); });
      form2.appendChild(el("button", { type: "submit", hidden: true }));
      const close2 = openModal({
        title: "＋ " + t.newPlayer,
        body: form2,
        footer: [
          el("button.btn.btn-primary", { type: "button", text: t.save, onclick: submitNew }),
          el("button.btn.btn-outline", { type: "button", text: t.cancel, onclick: () => close2() }),
        ],
      });
    };
    const grid = el("div.player-grid");
    for (const p of players) {
      grid.appendChild(el("button.btn.player-pick", { type: "button",
        text: (p.number != null && p.number !== "" ? p.number + " · " : "") + p.name, onclick: () => pick(p.id) }));
    }
    grid.appendChild(el("button.btn.player-pick.pick-new", { type: "button", text: "＋ " + t.newPlayer, onclick: addNewThenPick }));
    grid.appendChild(el("button.btn.btn-outline.player-pick", { type: "button", text: t.noPlayerKnown, onclick: () => pick(null) }));
    close = openModal({
      title: `${eventIcon(type)} ${type === "goal" ? t.whoScored : t.whoBooked}`,
      body: el("div", {}, [
        el("div.lc-picker-team", { text: team ? team.name : "" }),
        el("div.field", {}, [el("label", { text: t.minute, for: "picker-min" }), (minInput.id = "picker-min", minInput)]),
        grid,
      ]),
    });
  }

  async function bump(isHome, delta) {
    try { await api.bumpScore(match, isHome, delta); await reload(); }
    catch (e) { toast(e.message || t.errorGeneric, "err"); }
  }

  async function setStatus(status) {
    try {
      const patch = { status };
      // عند الإنهاء: نُثبّت النتيجة (0-0 إن لم تُسجَّل أهداف) كي تُحتسب في الترتيب
      if (status === "finished") {
        patch.home_score = match.home_score ?? 0;
        patch.away_score = match.away_score ?? 0;
      }
      await api.updateMatch(matchId, patch);
      await reload();
    } catch (e) { toast(e.message || t.errorGeneric, "err"); }
  }

  async function delEvent(ev) {
    if (!(await confirmDialog(t.deleteEventQ))) return;
    const teamGoals = (bundle.events || []).filter((e) => e.match_id === matchId && e.team_id === ev.team_id && e.type === "goal").length;
    try { await api.removeEvent(ev, match, teamGoals); toast(t.deleted, "ok"); await reload(); }
    catch (e) { toast(e.message || t.errorGeneric, "err"); }
  }

  function stepper(isHome, name, score) {
    return el("div.lc-stepper", {}, [
      el("div.lc-stepper-name", { text: name }),
      el("div.lc-stepper-ctrl", {}, [
        el("button.btn.lc-step", { type: "button", text: "－", "aria-label": "إنقاص", onclick: () => bump(isHome, -1) }),
        el("span.lc-stepper-val", { text: String(score ?? 0) }),
        el("button.btn.lc-step", { type: "button", text: "＋", "aria-label": "زيادة", onclick: () => bump(isHome, 1) }),
      ]),
    ]);
  }

  function sidePanel(teamId, side) {
    const team = teamById.get(teamId);
    return el("div.lc-side", {}, [
      el("div.lc-side-name", { text: team ? team.name : "—" }),
      el("button.btn.lc-btn.lc-goal", { type: "button", text: "⚽ " + t.goal, onclick: () => openPicker("goal", teamId) }),
      el("div.lc-cards", {}, [
        el("button.btn.lc-btn.lc-yellow", { type: "button", text: "🟨", title: t.yellowCard, onclick: () => openPicker("yellow", teamId) }),
        el("button.btn.lc-btn.lc-red", { type: "button", text: "🟥", title: t.redCard, onclick: () => openPicker("red", teamId) }),
      ]),
    ]);
  }

  function statusControls() {
    const btns = [];
    if (match.status === "scheduled") btns.push(el("button.btn.btn-primary", { type: "button", text: "▶ " + t.startMatch, onclick: () => setStatus("live") }));
    if (match.status === "scheduled" || match.status === "live") btns.push(el("button.btn.btn-accent", { type: "button", text: "⏹ " + t.finishMatch, onclick: () => setStatus("finished") }));
    if (match.status === "finished") btns.push(el("button.btn.btn-outline", { type: "button", text: "↺ " + t.reopenMatch, onclick: () => setStatus("live") }));
    return el("div.lc-status-controls", {}, btns);
  }

  function render() {
    const playersById = new Map((bundle.players || []).map((p) => [p.id, p]));
    const events = (bundle.events || []).filter((e) => e.match_id === matchId).sort(api.byEventOrder);
    const home = teamById.get(match.home_team_id);
    const away = teamById.get(match.away_team_id);
    const live = match.status === "live";

    const minuteRow = el("div.lc-minute-row", {}, [
      el("label", { for: "cur-min", text: t.currentMinute }),
      el("input.input.minute-input", { id: "cur-min", type: "number", inputmode: "numeric", min: 0, value: currentMinute,
        oninput: (e) => { currentMinute = e.currentTarget.value; } }),
    ]);

    const timeline = el("div.lc-timeline");
    if (!events.length) timeline.appendChild(el("p.page-sub", { style: "text-align:center;padding:10px", text: t.noEvents }));
    for (const e of events) {
      const p = e.player_id ? playersById.get(e.player_id) : null;
      const tm = teamById.get(e.team_id);
      timeline.appendChild(el("div.tl-item.tl-" + e.type, {}, [
        el("span.tl-min", { text: e.minute != null ? e.minute + "'" : "—" }),
        el("span.tl-ico", { text: eventIcon(e.type) }),
        el("span.tl-txt", {}, [
          el("span.tl-player", { text: p ? p.name : t.unknownPlayer }),
          tm ? el("span.tl-team", { text: tm.name }) : null,
        ]),
        el("button.icon-btn", { text: "✕", title: t.delete, onclick: () => delEvent(e) }),
      ]));
    }

    mount(container,
      el("a.header-link", { href: `#/t/${tid}/matches`, text: "→ " + t.manageMatches, style: "background:transparent;color:var(--text-2);padding:0;font-size:.85rem" }),
      el("div.lc-scoreboard" + (live ? ".is-live" : ""), {}, [
        el("div.lc-team", { text: home ? home.name : "—" }),
        el("div.lc-score", {}, [
          String(match.home_score ?? 0), el("span.sep", { text: ":" }), String(match.away_score ?? 0),
        ]),
        el("div.lc-team", { text: away ? away.name : "—" }),
        el("div.lc-status-badge", {}, [
          live ? el("span.badge.badge-live", {}, [el("span.dot"), t.live])
               : el("span.badge.badge-" + (match.status === "finished" ? "finished" : "upcoming"), { text: matchStatusLabel(match.status) }),
        ]),
      ]),
      // محرّر النتيجة المباشر (+/-)
      el("div.lc-steppers", {}, [
        stepper(true, home ? home.name : "—", match.home_score ?? 0),
        stepper(false, away ? away.name : "—", match.away_score ?? 0),
      ]),
      minuteRow,
      el("div.lc-actions", {}, [sidePanel(match.home_team_id, "home"), sidePanel(match.away_team_id, "away")]),
      statusControls(),
      el("h3.lc-events-title", { text: t.events }),
      timeline,
    );
  }

  render();
}

// ---- نموذج عام (Modal) ------------------------------------------------------

function formModal({ title, fields, submitText, onSubmit }) {
  const inputs = {};
  const form = el("form");
  for (const f of fields) {
    let control;
    const fid = "fld-" + f.name + "-" + (++uid);
    if (f.type === "select") {
      control = el("select.select", { id: fid });
      for (const o of f.options) {
        const opt = el("option", { value: o.value, text: o.label });
        if (String(o.value) === String(f.value ?? "")) opt.selected = true;
        control.appendChild(opt);
      }
    } else if (f.type === "textarea") {
      control = el("textarea.input", { id: fid, rows: 3 });
      control.value = f.value ?? "";
    } else {
      control = el("input.input", { id: fid, type: f.type || "text", ...(f.attrs || {}) });
      control.value = f.value ?? "";
    }
    inputs[f.name] = control;
    form.appendChild(el("div.field", {}, [el("label", { text: f.label, for: fid }), control]));
  }

  let close, busy = false;
  const submit = async () => {
    if (busy) return; busy = true;
    const values = {};
    for (const [k, c] of Object.entries(inputs)) values[k] = c.value;
    try { await onSubmit(values, () => close()); }
    catch (e) { console.error(e); toast(e.message || t.errorGeneric, "err"); }
    finally { busy = false; }
  };
  form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  // زر خفي لتفعيل الإرسال بمفتاح Enter
  form.appendChild(el("button", { type: "submit", hidden: true }));

  close = openModal({
    title, body: form,
    footer: [
      el("button.btn.btn-primary", { text: submitText || t.save, onclick: submit }),
      el("button.btn.btn-outline", { text: t.cancel, onclick: () => close() }),
    ],
  });
}

// ---- أدوات -----------------------------------------------------------------

function toInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
