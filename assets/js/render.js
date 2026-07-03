// ============================================================================
//  عناصر عرض مشتركة: بطاقة المباراة + جدول الترتيب (تُستخدم في الواجهة والإدارة)
// ============================================================================
import { el } from "./util.js";
import { t, formatTime, formatDate, weekdayName } from "./i18n.js";
import { computeGroupStandings, isCounted } from "./data.js";

// تجميع المباريات حسب اليوم (بالترتيب)
export function groupByDay(matches) {
  const map = new Map();
  for (const m of matches) {
    const k = m.match_date || "—";
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(m);
  }
  return [...map.entries()]; // [[date, matches], ...] محافظ على ترتيب الإدخال
}

// آخر النتائج لفريق (حتى ٥) لعرض «السجل»
function teamForm(teamId, matches) {
  const played = matches
    .filter((m) => isCounted(m) && (m.home_team_id === teamId || m.away_team_id === teamId))
    .sort((a, b) => ((a.match_date || "") + (a.match_time || "")).localeCompare((b.match_date || "") + (b.match_time || "")));
  return played.slice(-5).map((m) => {
    const isHome = m.home_team_id === teamId;
    const gf = isHome ? m.home_score : m.away_score;
    const ga = isHome ? m.away_score : m.home_score;
    return gf > ga ? "w" : gf < ga ? "l" : "d";
  });
}
function formGuide(results) {
  const wrap = el("span.form-guide");
  for (const r of results) wrap.appendChild(el("span.form-dot." + r, { text: { w: "ف", d: "ت", l: "خ" }[r] }));
  return wrap;
}

// أيقونة/تسمية حدث المباراة
export function eventIcon(type) { return { goal: "⚽", yellow: "🟨", red: "🟥" }[type] || "•"; }
export function eventTypeLabel(type) { return t["ev_" + type] || type; }

// خطّ زمني للأحداث (أهداف/بطاقات) — مرتّب مسبقاً
export function eventsTimeline(events, playersById, teamById) {
  const list = el("ul.timeline");
  for (const e of events) {
    const p = e.player_id ? playersById.get(e.player_id) : null;
    const tm = teamById.get(e.team_id);
    list.appendChild(el("li.tl-item.tl-" + e.type, {}, [
      el("span.tl-min", { text: e.minute != null ? e.minute + "'" : "—" }),
      el("span.tl-ico", { text: eventIcon(e.type) }),
      el("span.tl-txt", {}, [
        el("span.tl-player", { text: p ? p.name : t.unknownPlayer }),
        tm ? el("span.tl-team", { text: tm.name }) : null,
      ]),
    ]));
  }
  return list;
}

// بطاقة مباراة واحدة (للعرض) — قابلة للتوسّع لعرض الأحداث إن وُجدت
export function matchCard(m, teamById, groupById, opts = {}) {
  const { showGroup = true, events = [], playersById = new Map() } = opts;
  const home = teamById.get(m.home_team_id);
  const away = teamById.get(m.away_team_id);
  const homeName = home ? home.name : "—";
  const awayName = away ? away.name : "—";
  const group = groupById.get(m.group_id);

  const finished = isCounted(m);
  const live = m.status === "live";
  const homeWin = finished && m.home_score > m.away_score;
  const awayWin = finished && m.away_score > m.home_score;

  let scoreEl;
  if (finished || (live && m.home_score != null)) {
    scoreEl = el("div.score", {}, [
      String(m.home_score ?? 0),
      el("span.sep", { text: "-" }),
      String(m.away_score ?? 0),
    ]);
  } else {
    scoreEl = el("div.score.pending", { text: "–" }); // فاصل «ضد»؛ الوقت يظهر على الجانب
  }

  const timeCol = el("div.time", {}, [
    m.match_time ? formatTime(m.match_time) : t.vs,
    showGroup && group ? el("span.grp", { text: group.name }) : null,
    live ? el("span.grp", {}, [el("span.badge.badge-live", {}, [el("span.dot"), t.live])]) : null,
  ]);

  const hasEvents = events.length > 0;
  const matchEl = el("div.match" + (live ? ".is-live" : "") + (hasEvents ? ".has-events" : ""), {}, [
    timeCol,
    el("div.match-center", {}, [
      el("div.team.home" + (homeWin ? ".winner" : ""), {}, [el("span.name", { title: homeName, text: homeName })]),
      scoreEl,
      el("div.team.away" + (awayWin ? ".winner" : ""), {}, [el("span.name", { title: awayName, text: awayName })]),
    ]),
  ]);

  if (!hasEvents) return matchEl;

  const details = el("div.match-details", { hidden: true }, [eventsTimeline(events, playersById, teamById)]);
  matchEl.setAttribute("role", "button");
  matchEl.setAttribute("tabindex", "0");
  matchEl.setAttribute("aria-expanded", "false");
  const toggle = () => {
    const open = details.hidden;
    details.hidden = !open;
    matchEl.classList.toggle("open", open);
    matchEl.setAttribute("aria-expanded", String(open));
  };
  matchEl.addEventListener("click", toggle);
  matchEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
  });
  return el("div.match-wrap", {}, [matchEl, details]);
}

// عرض البرنامج مجمّعاً بالأيام
export function renderScheduleDays(matches, teamById, groupById, extra = {}) {
  const { eventsByMatch, playersById } = extra;
  if (!matches.length) {
    return el("div.empty", {}, [el("div.icon", { text: "📅" }), el("div", { text: t.noMatches })]);
  }
  const frag = document.createDocumentFragment();
  for (const [date, dayMatches] of groupByDay(matches)) {
    const head = el("div.day-head", {}, [
      el("span", { text: date === "—" ? "غير مجدولة" : weekdayName(date) }),
      date !== "—" ? el("span.date", { text: formatDate(date) }) : null,
      el("span.line"),
    ]);
    const wrap = el("div.day-group", {}, [head]);
    for (const m of dayMatches) {
      wrap.appendChild(matchCard(m, teamById, groupById, {
        events: eventsByMatch ? (eventsByMatch.get(m.id) || []) : [],
        playersById: playersById || new Map(),
      }));
    }
    frag.appendChild(wrap);
  }
  return frag;
}

// جدول ترتيب بيت واحد
export function standingsTable(groupTeams, matches, points, qualifiers) {
  const rows = computeGroupStandings(groupTeams, matches, points);
  const head = el("thead", {}, [
    el("tr", {}, [
      el("th", { text: t.th_rank }),
      el("th.team-col", { text: t.th_team }),
      el("th", { text: t.th_played }),
      el("th", { text: t.th_won }),
      el("th", { text: t.th_draw }),
      el("th", { text: t.th_lost }),
      el("th", { text: t.th_gf }),
      el("th", { text: t.th_ga }),
      el("th", { text: t.th_gd }),
      el("th", { text: t.th_pts }),
      el("th", { text: t.th_form }),
    ]),
  ]);
  const body = el("tbody");
  for (const r of rows) {
    const qualify = qualifiers > 0 && r.rank <= qualifiers && r.played > 0;
    const champion = r.rank === 1 && r.played > 0;
    const gdClass = r.gd > 0 ? ".pos" : r.gd < 0 ? ".neg" : "";
    body.appendChild(el("tr" + (qualify ? ".qualify" : "") + (champion ? ".champion" : ""), {}, [
      el("td", {}, [el("span.rank", { text: String(r.rank) })]),
      el("td.team-col", {}, [el("span.team-name", { text: r.team.name })]),
      el("td", { text: String(r.played) }),
      el("td", { text: String(r.won) }),
      el("td", { text: String(r.drawn) }),
      el("td", { text: String(r.lost) }),
      el("td", { text: String(r.gf) }),
      el("td", { text: String(r.ga) }),
      el("td.pos-diff" + gdClass, { text: (r.gd > 0 ? "+" : "") + r.gd }),
      el("td.pts", { text: String(r.points) }),
      el("td", {}, [formGuide(teamForm(r.team.id, matches))]),
    ]));
  }
  return el("div.table-wrap", {}, [el("table.standings", {}, [head, body])]);
}
