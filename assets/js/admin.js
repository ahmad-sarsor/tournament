// ============================================================================
//  لوحة الإدارة: مصادقة + إدارة البطولات/البيوت/الفرق/المباريات + توليد المباريات
// ============================================================================
import { isConfigured } from "./firebase.js";
import { t, formatDate, formatTime, weekdayName, statusLabel, matchStatusLabel } from "./i18n.js";
import { el, mount, clear, spinner, emptyState, toast, openModal, confirmDialog } from "./util.js";
import * as api from "./data.js";
import { groupByDay } from "./render.js";

const app = document.getElementById("app");
const userBox = document.getElementById("user-box");
let session = null;
let uid = 0; // عدّاد لتوليد معرّفات فريدة لحقول النماذج (ربط label بالحقل)

// ---- إقلاع -----------------------------------------------------------------

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
  if (parts[0] === "t" && parts[1]) return { view: "tournament", id: parts[1], tab: parts[2] || "details" };
  return { view: "home" };
}

async function route() {
  if (!isConfigured) return renderSetupNeeded();
  if (!session) return renderLogin();
  const r = parseHash();
  try {
    mount(app, spinner());
    if (r.view === "tournament") await renderTournamentAdmin(r.id, r.tab);
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
    el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, [
      el("button.btn.btn-outline", { text: "📥 " + t.loadSample, onclick: loadSample }),
      el("button.btn.btn-primary", { text: "＋ " + t.newTournament, onclick: () => tournamentForm(null) }),
    ]),
  ]);
  const list = el("div");
  if (!tournaments.length) list.appendChild(emptyState("🏆", "لا توجد بطولات — أنشئ واحدة أو حمّل بطولة تجريبية"));
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

async function loadSample() {
  if (!(await confirmDialog(t.loadSampleConfirm, { danger: false, confirmText: t.confirm }))) return;
  try { await api.seedSampleTournament(); toast(t.saved, "ok"); route(); }
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
    adminTab(t.manageGroups, id, "groups", tab),
    adminTab(t.manageMatches, id, "matches", tab),
  ]);
  const content = el("div");
  mount(app,
    el("a.header-link", { href: "#/", text: "→ " + t.backToTournaments, style: "background:transparent;color:var(--text-2);padding:0;font-size:.85rem" }),
    el("div.page-head", { style: "margin-top:10px" }, [el("h1.page-title", { text: tournament.name })]),
    tabs, content);

  if (tab === "groups") renderGroupsTab(content, state);
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

// ---- تبويب البيوت والفرق ---------------------------------------------------

function renderGroupsTab(host, state) {
  const { tournament, groups, teams } = state;
  const wrap = el("div", {}, [
    el("div", { style: "margin-bottom:16px" }, [
      el("button.btn.btn-primary", { text: "＋ " + t.addGroup, onclick: () => groupForm(tournament.id, null) }),
    ]),
  ]);

  if (!groups.length) wrap.appendChild(emptyState("🏠", "أضف بيتاً (مجموعة) للبدء"));

  for (const g of groups) {
    const groupTeams = teams.filter((x) => x.group_id === g.id);
    const teamList = el("div");
    if (!groupTeams.length) teamList.appendChild(el("p.page-sub", { style: "padding:6px 2px", text: "لا توجد فرق في هذا البيت" }));
    for (const tm of groupTeams) {
      teamList.appendChild(el("div.admin-list-item", { style: "padding:8px 12px" }, [
        el("div.grow", { text: tm.name }),
        el("button.icon-btn", { text: "✎", title: t.edit, onclick: () => teamForm(tournament.id, groups, tm) }),
        el("button.icon-btn", { text: "🗑", title: t.delete, onclick: () => removeTeam(tm) }),
      ]));
    }
    wrap.appendChild(el("div.card.card-pad", { style: "margin-bottom:14px" }, [
      el("div", { style: "display:flex;align-items:center;justify-content:space-between;margin-bottom:10px" }, [
        el("h3", { style: "font-weight:800", text: g.name }),
        el("div", { style: "display:flex;gap:6px" }, [
          el("button.icon-btn", { text: "✎", title: t.edit, onclick: () => groupForm(tournament.id, g) }),
          el("button.icon-btn", { text: "🗑", title: t.delete, onclick: () => removeGroup(g) }),
        ]),
      ]),
      teamList,
      el("button.btn.btn-sm.btn-outline", { style: "margin-top:10px", text: "＋ " + t.addTeam, onclick: () => teamForm(tournament.id, groups, null, g.id) }),
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
  if (!(await confirmDialog(`حذف الفريق «${tm.name}»؟ ${t.confirmDelete}`))) return;
  try { await api.deleteTeam(tm.id); toast(t.deleted, "ok"); route(); }
  catch (e) { toast(e.message || t.errorGeneric, "err"); }
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
        el("button.btn.btn-sm.btn-primary", { text: t.enterResult, onclick: () => resultModal(m) }),
        el("button.icon-btn", { text: "✎", title: t.edit, onclick: () => matchForm(state, m) }),
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
  const playable = groups.filter((g) => teams.filter((x) => x.group_id === g.id).length >= 2);
  if (!playable.length) return toast(t.needTeams, "err");
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
