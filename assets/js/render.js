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

// بطاقة مباراة واحدة (للعرض)
export function matchCard(m, teamById, groupById, { showGroup = true } = {}) {
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
    scoreEl = el("div.score.pending", { text: m.match_time ? formatTime(m.match_time) : t.matchPending });
  }

  const timeCol = el("div.time", {}, [
    m.match_time ? formatTime(m.match_time) : t.vs,
    showGroup && group ? el("span.grp", { text: group.name }) : null,
    live ? el("span.grp", {}, [el("span.badge.badge-live", {}, [el("span.dot"), t.live])]) : null,
  ]);

  return el("div.match" + (live ? ".is-live" : ""), {}, [
    timeCol,
    el("div.team.home" + (homeWin ? ".winner" : ""), {}, [el("span.name", { title: homeName, text: homeName })]),
    scoreEl,
    el("div.team.away" + (awayWin ? ".winner" : ""), {}, [el("span.name", { title: awayName, text: awayName })]),
  ]);
}

// عرض البرنامج مجمّعاً بالأيام
export function renderScheduleDays(matches, teamById, groupById) {
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
    for (const m of dayMatches) wrap.appendChild(matchCard(m, teamById, groupById));
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
    ]),
  ]);
  const body = el("tbody");
  for (const r of rows) {
    const qualify = qualifiers > 0 && r.rank <= qualifiers && r.played > 0;
    const gdClass = r.gd > 0 ? ".pos" : r.gd < 0 ? ".neg" : "";
    body.appendChild(el("tr" + (qualify ? ".qualify" : ""), {}, [
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
    ]));
  }
  return el("div.table-wrap", {}, [el("table.standings", {}, [head, body])]);
}
