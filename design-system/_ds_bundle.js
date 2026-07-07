/* @ds-bundle: {"format":4,"namespace":"DesignSystem_d76f5e","components":[{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Chip","sourcePath":"components/core/Chip.jsx"},{"name":"Select","sourcePath":"components/core/Select.jsx"},{"name":"Tabs","sourcePath":"components/core/Tabs.jsx"},{"name":"EmptyState","sourcePath":"components/display/EmptyState.jsx"},{"name":"StatTile","sourcePath":"components/display/StatTile.jsx"},{"name":"Toast","sourcePath":"components/display/Toast.jsx"},{"name":"TournamentCard","sourcePath":"components/display/TournamentCard.jsx"},{"name":"Bracket","sourcePath":"components/match/Bracket.jsx"},{"name":"MatchRow","sourcePath":"components/match/MatchRow.jsx"},{"name":"Scoreboard","sourcePath":"components/match/Scoreboard.jsx"},{"name":"FormGuide","sourcePath":"components/standings/FormGuide.jsx"},{"name":"StandingsTable","sourcePath":"components/standings/StandingsTable.jsx"}],"sourceHashes":{"components/core/Badge.jsx":"e22517e2c235","components/core/Button.jsx":"b344561eff41","components/core/Chip.jsx":"82df08e02578","components/core/Select.jsx":"53ec3361ceb4","components/core/Tabs.jsx":"fdbfba537a8a","components/display/EmptyState.jsx":"12e84dc7783f","components/display/StatTile.jsx":"55fc14d430cc","components/display/Toast.jsx":"08a28a6d2cbe","components/display/TournamentCard.jsx":"8ec307e4b8af","components/match/Bracket.jsx":"d0a27e5114e5","components/match/MatchRow.jsx":"976ba8fe3ccc","components/match/Scoreboard.jsx":"9d683137b5f8","components/standings/FormGuide.jsx":"350420eb290e","components/standings/StandingsTable.jsx":"81f282072060","ui_kits/app/AppShell.jsx":"f805afabf1eb","ui_kits/app/MatchScreen.jsx":"42df8c39f951","ui_kits/app/ScheduleScreen.jsx":"aefbce017a1d","ui_kits/app/StandingsScreen.jsx":"6610e321eb86","ui_kits/app/TournamentsScreen.jsx":"ce2489562896","ui_kits/app/data.js":"b3f49a774019"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.DesignSystem_d76f5e = window.DesignSystem_d76f5e || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Badge.jsx
try { (() => {
const LABELS = {
  upcoming: "قادمة",
  active: "جارية",
  finished: "منتهية",
  live: "مباشر"
};

/** شارة حالة — بطولة (قادمة/جارية/منتهية) أو مباراة مباشرة (نابضة) أو ذهبية */
function Badge({
  status = "upcoming",
  children,
  dot
}) {
  const showDot = dot ?? status === "live";
  return /*#__PURE__*/React.createElement("span", {
    className: `badge badge-${status}`
  }, showDot ? /*#__PURE__*/React.createElement("span", {
    className: "dot"
  }) : null, children ?? LABELS[status] ?? status);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** زر المنصّة — الأساسي «قابل للكبس» بظل صلب */
function Button({
  variant = "default",
  size,
  block,
  children,
  ...rest
}) {
  const cls = ["btn", variant === "primary" && "btn-primary", variant === "sun" && "btn-sun", variant === "outline" && "btn-outline", variant === "danger" && "btn-danger", size === "sm" && "btn-sm", block && "btn-block"].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    className: cls
  }, rest), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Chip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** رقاقة تصفية (فلتر) — تُستخدم في صفوف الفلاتر فوق البرنامج والترتيب */
function Chip({
  active,
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    className: `chip${active ? " active" : ""}`
  }, rest), children);
}
Object.assign(__ds_scope, { Chip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Chip.jsx", error: String((e && e.message) || e) }); }

// components/core/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** قائمة منسدلة للتصفية — «كل البيوت / كل الفرق / كل الأيام» */
function Select({
  options = [],
  value,
  onChange,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("select", _extends({
    className: "select filter-select",
    value: value,
    onChange: e => onChange && onChange(e.target.value)
  }, rest), options.map(o => {
    const opt = typeof o === "string" ? {
      value: o,
      label: o
    } : o;
    return /*#__PURE__*/React.createElement("option", {
      key: opt.value,
      value: opt.value
    }, opt.label);
  }));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Select.jsx", error: String((e && e.message) || e) }); }

// components/core/Tabs.jsx
try { (() => {
/** تبويبات مقسّمة (Segmented) — البرنامج / الترتيب / الفرق… */
function Tabs({
  items = [],
  active,
  onChange
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "tabs",
    role: "tablist"
  }, items.map(it => {
    const item = typeof it === "string" ? {
      id: it,
      label: it
    } : it;
    return /*#__PURE__*/React.createElement("button", {
      key: item.id,
      type: "button",
      role: "tab",
      "aria-selected": active === item.id,
      className: `tab${active === item.id ? " active" : ""}`,
      onClick: () => onChange && onChange(item.id)
    }, item.label);
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/display/EmptyState.jsx
try { (() => {
/** حالة فارغة — إيموجي كبير + رسالة (📅 لا مباريات، 🎯 لا مشاركين…) */
function EmptyState({
  icon = "📅",
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, /*#__PURE__*/React.createElement("div", {
    className: "icon"
  }, icon), /*#__PURE__*/React.createElement("div", null, children));
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/display/StatTile.jsx
try { (() => {
/** مربّع إحصائية — رقم كبير بخط العرض فوق تسمية صغيرة */
function StatTile({
  icon,
  value,
  label
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "stat-tile"
  }, icon ? /*#__PURE__*/React.createElement("div", {
    className: "stat-ico"
  }, icon) : null, /*#__PURE__*/React.createElement("div", {
    className: "stat-val"
  }, value), /*#__PURE__*/React.createElement("div", {
    className: "stat-lbl"
  }, label));
}
Object.assign(__ds_scope, { StatTile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/StatTile.jsx", error: String((e && e.message) || e) }); }

// components/display/Toast.jsx
try { (() => {
/** إشعار عائم (Toast) — كبسولة داكنة، أو خضراء ok / حمراء err */
function Toast({
  kind,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: `toast${kind ? " " + kind : ""}`
  }, children);
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Toast.jsx", error: String((e && e.message) || e) }); }

// components/display/TournamentCard.jsx
try { (() => {
/** بطاقة بطولة — اسم + شارة حالة + وصف + بيانات + شريط تقدّم */
function TournamentCard({
  name,
  emoji = "🏆",
  description,
  status = "active",
  meta = [],
  done,
  total,
  onClick
}) {
  const pct = total ? Math.round((done ?? 0) / total * 100) : 0;
  const statusLabels = {
    upcoming: "قادمة",
    active: "جارية",
    finished: "منتهية"
  };
  return /*#__PURE__*/React.createElement("a", {
    className: "t-card",
    onClick: onClick
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: "10px"
    }
  }, /*#__PURE__*/React.createElement("h3", null, /*#__PURE__*/React.createElement("span", {
    className: "t-emoji"
  }, emoji), name), /*#__PURE__*/React.createElement("span", {
    className: `badge badge-${status}`
  }, statusLabels[status] || status)), description ? /*#__PURE__*/React.createElement("p", {
    className: "meta",
    style: {
      marginTop: "6px"
    }
  }, description) : null, meta.length ? /*#__PURE__*/React.createElement("div", {
    className: "meta"
  }, meta.map((m, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    dir: "auto",
    style: {
      whiteSpace: "nowrap"
    }
  }, m))) : null, total ? /*#__PURE__*/React.createElement("div", {
    className: "t-progress"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bar"
  }, /*#__PURE__*/React.createElement("i", {
    style: {
      width: pct + "%"
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, done, " / ", total, " \u0645\u0628\u0627\u0631\u0627\u0629")) : null);
}
Object.assign(__ds_scope, { TournamentCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/TournamentCard.jsx", error: String((e && e.message) || e) }); }

// components/match/Bracket.jsx
try { (() => {
/** شجرة خروج المغلوب — أعمدة لكل جولة، النهائي ذهبي متوَّج 🏆 */
function Bracket({
  rounds = []
}) {
  const winner = m => m.status === "finished" && m.hs != null && m.as != null && m.hs !== m.as ? m.hs > m.as ? "home" : "away" : null;
  const side = (m, who) => {
    const name = who === "home" ? m.home : m.away;
    const score = who === "home" ? m.hs : m.as;
    const w = winner(m);
    return /*#__PURE__*/React.createElement("div", {
      className: `bk-side${w === who ? " bk-win" : ""}`
    }, /*#__PURE__*/React.createElement("span", {
      className: `bk-team${name ? "" : " tbd"}`
    }, name || "يُحدَّد لاحقاً"), /*#__PURE__*/React.createElement("span", {
      className: "bk-score"
    }, m.hs != null && score != null ? String(score) : ""));
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "bracket-scroll"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bracket"
  }, rounds.map((r, ri) => {
    const isFinal = ri === rounds.length - 1;
    return /*#__PURE__*/React.createElement("div", {
      className: `bracket-col${isFinal ? " bk-final-col" : ""}`,
      key: ri
    }, /*#__PURE__*/React.createElement("div", null, isFinal ? /*#__PURE__*/React.createElement("div", {
      className: "bk-trophy"
    }, "\uD83C\uDFC6") : null, /*#__PURE__*/React.createElement("div", {
      className: "bracket-round-title"
    }, r.title)), r.matches.map((m, mi) => /*#__PURE__*/React.createElement("div", {
      className: `bk-match${m.status === "live" ? " is-live" : ""}${isFinal ? " bk-final" : ""}`,
      key: mi
    }, side(m, "home"), side(m, "away"))));
  })));
}
Object.assign(__ds_scope, { Bracket });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/match/Bracket.jsx", error: String((e && e.message) || e) }); }

// components/match/MatchRow.jsx
try { (() => {
/** صف مباراة — وقت | مضيف — نتيجة — ضيف | سهم (نفس بنية matchCard في render.js) */
function MatchRow({
  time,
  group,
  homeName,
  awayName,
  homeScore,
  awayScore,
  status = "scheduled",
  onClick
}) {
  const finished = status === "finished" && homeScore != null && awayScore != null;
  const live = status === "live";
  const hasScore = finished || live && homeScore != null;
  const homeWin = finished && homeScore > awayScore;
  const awayWin = finished && awayScore > homeScore;
  const Tag = onClick ? "a" : "div";
  return /*#__PURE__*/React.createElement(Tag, {
    className: `match${onClick ? " tappable" : ""}${live ? " is-live" : ""}`,
    onClick: onClick
  }, /*#__PURE__*/React.createElement("div", {
    className: "time"
  }, time || "×", group ? /*#__PURE__*/React.createElement("span", {
    className: "grp"
  }, group) : null, live ? /*#__PURE__*/React.createElement("span", {
    className: "grp"
  }, /*#__PURE__*/React.createElement("span", {
    className: "badge badge-live"
  }, /*#__PURE__*/React.createElement("span", {
    className: "dot"
  }), "\u0645\u0628\u0627\u0634\u0631")) : null), /*#__PURE__*/React.createElement("div", {
    className: "match-center"
  }, /*#__PURE__*/React.createElement("div", {
    className: `team home${homeWin ? " winner" : ""}`
  }, /*#__PURE__*/React.createElement("span", {
    className: "name"
  }, homeName)), hasScore ? /*#__PURE__*/React.createElement("div", {
    className: "score"
  }, String(homeScore ?? 0), /*#__PURE__*/React.createElement("span", {
    className: "sep"
  }, "-"), String(awayScore ?? 0)) : /*#__PURE__*/React.createElement("div", {
    className: "score pending"
  }, "\u2013"), /*#__PURE__*/React.createElement("div", {
    className: `team away${awayWin ? " winner" : ""}`
  }, /*#__PURE__*/React.createElement("span", {
    className: "name"
  }, awayName))), onClick ? /*#__PURE__*/React.createElement("span", {
    className: "match-go",
    "aria-hidden": "true"
  }, "\u2039") : null);
}
Object.assign(__ds_scope, { MatchRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/match/MatchRow.jsx", error: String((e && e.message) || e) }); }

// components/match/Scoreboard.jsx
try { (() => {
/** لوحة نتيجة كبيرة متدرّجة الأزرق — رأس صفحة المباراة (mp-scoreboard) */
function Scoreboard({
  homeName,
  awayName,
  homeScore,
  awayScore,
  live,
  minute,
  time,
  homeEmoji = "⚽",
  awayEmoji = "⚽"
}) {
  const hasScore = homeScore != null && awayScore != null;
  return /*#__PURE__*/React.createElement("div", {
    className: `mp-scoreboard${live ? " is-live" : ""}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "mp-team"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mp-team-badge"
  }, homeEmoji), /*#__PURE__*/React.createElement("div", {
    className: "mp-team-name"
  }, homeName)), /*#__PURE__*/React.createElement("div", null, hasScore ? /*#__PURE__*/React.createElement("div", {
    className: "mp-score"
  }, String(homeScore), /*#__PURE__*/React.createElement("span", {
    className: "sep"
  }, "-"), String(awayScore)) : /*#__PURE__*/React.createElement("div", {
    className: "mp-score time"
  }, time || "×"), live ? /*#__PURE__*/React.createElement("div", {
    className: "mp-minute"
  }, /*#__PURE__*/React.createElement("span", {
    className: "badge badge-live"
  }, /*#__PURE__*/React.createElement("span", {
    className: "dot"
  }), minute != null ? `مباشر · ${minute}'` : "مباشر")) : null), /*#__PURE__*/React.createElement("div", {
    className: "mp-team"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mp-team-badge"
  }, awayEmoji), /*#__PURE__*/React.createElement("div", {
    className: "mp-team-name"
  }, awayName)));
}
Object.assign(__ds_scope, { Scoreboard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/match/Scoreboard.jsx", error: String((e && e.message) || e) }); }

// components/standings/FormGuide.jsx
try { (() => {
/** دليل الأداء — آخر ٥ نتائج كمربعات ملوّنة ف/ت/خ */
function FormGuide({
  results = []
}) {
  const label = {
    w: "ف",
    d: "ت",
    l: "خ"
  };
  return /*#__PURE__*/React.createElement("span", {
    className: "form-guide"
  }, results.map((r, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    className: `form-dot ${r}`
  }, label[r] || "؟")));
}
Object.assign(__ds_scope, { FormGuide });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/standings/FormGuide.jsx", error: String((e && e.message) || e) }); }

// components/standings/StandingsTable.jsx
try { (() => {
const MEDALS = {
  1: "🥇",
  2: "🥈",
  3: "🥉"
};

/** جدول ترتيب بيت واحد — الأعمدة الأصلية: # الفريق لعب ف ت خ (له عليه الفارق) نقاط السجل */
function StandingsTable({
  rows = [],
  qualifiers = 2,
  showExtra = false,
  medals = false
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: `standings-wrap${showExtra ? " show-all" : ""}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "table-wrap"
  }, /*#__PURE__*/React.createElement("table", {
    className: "standings"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
    className: "rank-col"
  }, "#"), /*#__PURE__*/React.createElement("th", {
    className: "team-col"
  }, "\u0627\u0644\u0641\u0631\u064A\u0642"), /*#__PURE__*/React.createElement("th", {
    className: "stat-col",
    title: "\u0644\u0639\u0628"
  }, "\u0644\u0639\u0628"), /*#__PURE__*/React.createElement("th", {
    className: "stat-col",
    title: "\u0641\u0648\u0632"
  }, "\u0641"), /*#__PURE__*/React.createElement("th", {
    className: "stat-col",
    title: "\u062A\u0639\u0627\u062F\u0644"
  }, "\u062A"), /*#__PURE__*/React.createElement("th", {
    className: "stat-col",
    title: "\u062E\u0633\u0627\u0631\u0629"
  }, "\u062E"), /*#__PURE__*/React.createElement("th", {
    className: "stat-col col-extra"
  }, "\u0644\u0647"), /*#__PURE__*/React.createElement("th", {
    className: "stat-col col-extra"
  }, "\u0639\u0644\u064A\u0647"), /*#__PURE__*/React.createElement("th", {
    className: "stat-col col-extra"
  }, "\u0627\u0644\u0641\u0627\u0631\u0642"), /*#__PURE__*/React.createElement("th", {
    className: "pts-col"
  }, "\u0646\u0642\u0627\u0637"), /*#__PURE__*/React.createElement("th", {
    className: "col-extra"
  }, "\u0627\u0644\u0633\u062C\u0644"))), /*#__PURE__*/React.createElement("tbody", null, rows.map(r => {
    const qualify = qualifiers > 0 && r.rank <= qualifiers && r.played > 0;
    const champion = r.rank === 1 && r.played > 0;
    const gd = r.gd ?? (r.gf ?? 0) - (r.ga ?? 0);
    const medal = medals ? MEDALS[r.rank] : null;
    return /*#__PURE__*/React.createElement("tr", {
      key: r.name,
      className: `${qualify ? "qualify" : ""} ${champion ? "champion" : ""}`.trim()
    }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
      className: `rank${medal ? " medal" : ""}`
    }, medal || String(r.rank))), /*#__PURE__*/React.createElement("td", {
      className: "team-col"
    }, /*#__PURE__*/React.createElement("span", {
      className: "team-name"
    }, r.name)), /*#__PURE__*/React.createElement("td", null, String(r.played)), /*#__PURE__*/React.createElement("td", null, String(r.won)), /*#__PURE__*/React.createElement("td", null, String(r.drawn)), /*#__PURE__*/React.createElement("td", null, String(r.lost)), /*#__PURE__*/React.createElement("td", {
      className: "col-extra"
    }, String(r.gf ?? 0)), /*#__PURE__*/React.createElement("td", {
      className: "col-extra"
    }, String(r.ga ?? 0)), /*#__PURE__*/React.createElement("td", {
      className: `pos-diff col-extra${gd > 0 ? " pos" : gd < 0 ? " neg" : ""}`
    }, (gd > 0 ? "+" : "") + gd), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
      className: "pts"
    }, String(r.points))), /*#__PURE__*/React.createElement("td", {
      className: "col-extra"
    }, r.form ? /*#__PURE__*/React.createElement(__ds_scope.FormGuide, {
      results: r.form
    }) : null));
  })))));
}
Object.assign(__ds_scope, { StandingsTable });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/standings/StandingsTable.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/AppShell.jsx
try { (() => {
// هيكل التطبيق — رأس + توجيه بسيط: قائمة البطولات ← بطولة (برنامج/ترتيب) ← مباراة
function AppShell() {
  const {
    Tabs,
    Badge,
    Bracket
  } = window.DesignSystem_d76f5e;
  const [tournament, setTournament] = React.useState(null);
  const [tab, setTab] = React.useState("schedule");
  const [match, setMatch] = React.useState(null);
  const goHome = () => {
    setTournament(null);
    setMatch(null);
    setTab("schedule");
  };
  let body;
  if (!tournament) {
    body = /*#__PURE__*/React.createElement(window.TournamentsScreen, {
      onOpen: t => {
        setTournament(t);
        setTab("schedule");
      }
    });
  } else if (match) {
    body = /*#__PURE__*/React.createElement(window.MatchScreen, {
      match: match,
      onBack: () => setMatch(null)
    });
  } else {
    body = /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "page-head",
      style: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        flexWrap: "wrap"
      }
    }, /*#__PURE__*/React.createElement("h1", {
      className: "page-title",
      style: {
        display: "flex",
        alignItems: "center",
        gap: "10px"
      }
    }, /*#__PURE__*/React.createElement("span", null, tournament.emoji), tournament.name), /*#__PURE__*/React.createElement(Badge, {
      status: tournament.status
    }), /*#__PURE__*/React.createElement("a", {
      style: {
        marginInlineStart: "auto",
        fontWeight: 700,
        fontSize: ".85rem",
        cursor: "pointer"
      },
      onClick: goHome
    }, "\u0643\u0644 \u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062A \u2039")), /*#__PURE__*/React.createElement(Tabs, {
      items: [{
        id: "schedule",
        label: "البرنامج"
      }, {
        id: "standings",
        label: "الترتيب"
      }, {
        id: "knockout",
        label: "خروج المغلوب"
      }],
      active: tab,
      onChange: setTab
    }), tab === "schedule" ? /*#__PURE__*/React.createElement(window.ScheduleScreen, {
      onOpenMatch: setMatch
    }) : tab === "standings" ? /*#__PURE__*/React.createElement(window.StandingsScreen, null) : /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Bracket, {
      rounds: [{
        title: "ربع النهائي",
        matches: [{
          home: "خزيمة",
          away: "عمر بن الخطاب",
          hs: 3,
          as: 1,
          status: "finished"
        }, {
          home: "أحفاد أبي ذر",
          away: "علي بن أبي طالب",
          hs: 2,
          as: 4,
          status: "finished"
        }, {
          home: "بلال بن رباح",
          away: "عثمان بن عفان",
          hs: 2,
          as: 0,
          status: "finished"
        }, {
          home: "سعد بن معاذ",
          away: "أحفاد الصديق",
          hs: 1,
          as: 2,
          status: "finished"
        }]
      }, {
        title: "نصف النهائي",
        matches: [{
          home: "خزيمة",
          away: "علي بن أبي طالب",
          hs: 2,
          as: 0,
          status: "finished"
        }, {
          home: "بلال بن رباح",
          away: "أحفاد الصديق",
          hs: 1,
          as: 1,
          status: "live"
        }]
      }, {
        title: "النهائي",
        matches: [{
          home: "خزيمة",
          away: null
        }]
      }]
    }), /*#__PURE__*/React.createElement("p", {
      className: "page-sub",
      style: {
        marginTop: "12px"
      }
    }, "\u0627\u0644\u0641\u0627\u0626\u0632 \u064A\u062A\u0623\u0647\u0651\u0644 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0644\u0644\u062C\u0648\u0644\u0629 \u0627\u0644\u062A\u0627\u0644\u064A\u0629 \u0639\u0646\u062F \u0625\u0646\u0647\u0627\u0621 \u0627\u0644\u0645\u0628\u0627\u0631\u0627\u0629 \u26A1")));
  }
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("header", {
    className: "site-header"
  }, /*#__PURE__*/React.createElement("div", {
    className: "wrap"
  }, /*#__PURE__*/React.createElement("a", {
    className: "brand",
    style: {
      cursor: "pointer"
    },
    onClick: goHome
  }, /*#__PURE__*/React.createElement("span", {
    className: "logo",
    "aria-hidden": "true"
  }, "\uD83C\uDFC6"), /*#__PURE__*/React.createElement("span", null, "\u0645\u0646\u0635\u0651\u0629 \u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062A")), /*#__PURE__*/React.createElement("span", {
    className: "header-spacer"
  }), /*#__PURE__*/React.createElement("a", {
    className: "header-auth"
  }, "\u062F\u062E\u0648\u0644 / \u062A\u0633\u062C\u064A\u0644"), /*#__PURE__*/React.createElement("button", {
    className: "header-icon-btn",
    type: "button",
    "aria-label": "\u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A",
    title: "\u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A"
  }, "\u2699\uFE0F"))), /*#__PURE__*/React.createElement("main", {
    className: "container"
  }, body), /*#__PURE__*/React.createElement("footer", {
    className: "site-footer"
  }, /*#__PURE__*/React.createElement("div", null, "\u0645\u0646\u0635\u0651\u0629 \u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062A \xB7 \u062A\u064F\u062D\u062F\u064E\u0651\u062B \u0627\u0644\u0646\u062A\u0627\u0626\u062C \u0645\u0628\u0627\u0634\u0631\u0629\u064B")));
}
window.AppShell = AppShell;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/AppShell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/MatchScreen.jsx
try { (() => {
// شاشة المباراة — لوحة النتيجة + الأحداث (كما في صفحة المباراة الأصلية)
function MatchScreen({
  match,
  onBack
}) {
  const {
    Scoreboard,
    Button,
    EmptyState
  } = window.DesignSystem_d76f5e;
  const icons = {
    goal: "⚽",
    yellow: "🟨",
    red: "🟥"
  };
  const live = match.status === "live";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "640px",
      margin: "0 auto"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    onClick: onBack
  }, "\u2039 \u0627\u0644\u0628\u0631\u0646\u0627\u0645\u062C"), /*#__PURE__*/React.createElement(Scoreboard, {
    homeName: match.home,
    awayName: match.away,
    homeScore: match.hs,
    awayScore: match.as,
    live: live,
    minute: match.minute,
    time: match.time
  }), /*#__PURE__*/React.createElement("div", {
    className: "mp-meta"
  }, /*#__PURE__*/React.createElement("span", null, "\uD83D\uDEE1\uFE0F ", match.group), /*#__PURE__*/React.createElement("span", null, "\uD83D\uDD50 ", match.time)), /*#__PURE__*/React.createElement("div", {
    className: "mp-section"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mp-title"
  }, "\u0627\u0644\u0623\u062D\u062F\u0627\u062B"), match.events && match.events.length ? /*#__PURE__*/React.createElement("div", {
    className: "card card-pad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mp-events"
  }, match.events.map((e, i) => /*#__PURE__*/React.createElement("div", {
    className: `ev-row${e.type === "red" ? " ev-row-red" : ""}`,
    key: i
  }, /*#__PURE__*/React.createElement("div", {
    className: "ev-cell ev-cell-home"
  }, e.side === "home" ? /*#__PURE__*/React.createElement("span", {
    className: "ev-item"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ev-ico"
  }, icons[e.type]), /*#__PURE__*/React.createElement("span", {
    className: "ev-player"
  }, e.player)) : null), /*#__PURE__*/React.createElement("span", {
    className: "ev-min"
  }, e.min, "'"), /*#__PURE__*/React.createElement("div", {
    className: "ev-cell ev-cell-away"
  }, e.side === "away" ? /*#__PURE__*/React.createElement("span", {
    className: "ev-item"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ev-ico"
  }, icons[e.type]), /*#__PURE__*/React.createElement("span", {
    className: "ev-player"
  }, e.player)) : null))))) : /*#__PURE__*/React.createElement(EmptyState, {
    icon: "\u26BD"
  }, "\u0644\u0627 \u062A\u0648\u062C\u062F \u0623\u062D\u062F\u0627\u062B \u0628\u0639\u062F")));
}
window.MatchScreen = MatchScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/MatchScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/ScheduleScreen.jsx
try { (() => {
// شاشة البرنامج — فلاتر البيت/الفريق/اليوم (كما في الأصل) + مباريات مجمّعة بالأيام
function ScheduleScreen({
  onOpenMatch
}) {
  const {
    MatchRow,
    Select,
    Button,
    EmptyState
  } = window.DesignSystem_d76f5e;
  const [group, setGroup] = React.useState("كل البيوت");
  const [team, setTeam] = React.useState("كل الفرق");
  const [day, setDay] = React.useState("كل الأيام");
  const data = window.TP_DATA;

  // قائمة الفرق تُشتق من مباريات البيت المُصفّى (فرق البيت فقط)
  const teams = React.useMemo(() => {
    const s = new Set();
    data.days.forEach(d => d.matches.forEach(m => {
      if (group === "كل البيوت" || m.group === group) {
        s.add(m.home);
        s.add(m.away);
      }
    }));
    return ["كل الفرق", ...[...s].sort((a, b) => a.localeCompare(b, "ar"))];
  }, [group]);
  const days = ["كل الأيام", ...data.days.map(d => `${d.day} ${d.date}`)];
  const filtered = data.days.filter(d => day === "كل الأيام" || `${d.day} ${d.date}` === day).map(d => ({
    ...d,
    matches: d.matches.filter(m => (group === "كل البيوت" || m.group === group) && (team === "كل الفرق" || m.home === team || m.away === team))
  })).filter(d => d.matches.length);
  const hasFilter = group !== "كل البيوت" || team !== "كل الفرق" || day !== "كل الأيام";
  const clearAll = () => {
    setGroup("كل البيوت");
    setTeam("كل الفرق");
    setDay("كل الأيام");
  };
  const pickGroup = g => {
    setGroup(g);
    setTeam("كل الفرق");
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "filter-selects"
  }, /*#__PURE__*/React.createElement(Select, {
    options: data.groups,
    value: group,
    onChange: pickGroup,
    "aria-label": "\u062A\u0635\u0641\u064A\u0629 \u062D\u0633\u0628 \u0627\u0644\u0628\u064A\u062A"
  }), /*#__PURE__*/React.createElement(Select, {
    options: teams,
    value: team,
    onChange: setTeam,
    "aria-label": "\u062A\u0635\u0641\u064A\u0629 \u062D\u0633\u0628 \u0627\u0644\u0641\u0631\u064A\u0642"
  }), /*#__PURE__*/React.createElement(Select, {
    options: days,
    value: day,
    onChange: setDay,
    "aria-label": "\u062A\u0635\u0641\u064A\u0629 \u062D\u0633\u0628 \u0627\u0644\u064A\u0648\u0645"
  }), hasFilter ? /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    onClick: clearAll
  }, "\u0645\u0633\u062D \u0627\u0644\u0641\u0644\u0627\u062A\u0631") : null), filtered.length === 0 ? /*#__PURE__*/React.createElement(EmptyState, {
    icon: "\uD83D\uDCC5"
  }, "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0628\u0627\u0631\u064A\u0627\u062A \u0628\u0639\u062F") : filtered.map(d => /*#__PURE__*/React.createElement("div", {
    className: "day-group",
    key: d.date
  }, /*#__PURE__*/React.createElement("div", {
    className: "day-head"
  }, /*#__PURE__*/React.createElement("span", null, d.day), /*#__PURE__*/React.createElement("span", {
    className: "date"
  }, d.date), /*#__PURE__*/React.createElement("span", {
    className: "line"
  })), d.matches.map((m, i) => /*#__PURE__*/React.createElement(MatchRow, {
    key: i,
    time: m.time,
    group: m.group,
    homeName: m.home,
    awayName: m.away,
    homeScore: m.hs,
    awayScore: m.as,
    status: m.status,
    onClick: () => onOpenMatch(m)
  })))));
}
window.ScheduleScreen = ScheduleScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/ScheduleScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/StandingsScreen.jsx
try { (() => {
// شاشة الترتيب — جدول لكل بيت + مفتاح الألوان + ملاحظة التحديث
function StandingsScreen() {
  const {
    StandingsTable,
    Button
  } = window.DesignSystem_d76f5e;
  // على الهواتف يبدأ مضغوطاً (كالأصل) — زر «تفاصيل أكثر» يوسّعه
  const [showExtra, setShowExtra] = React.useState(() => window.innerWidth > 560);
  const data = window.TP_DATA;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "flex-end",
      marginBottom: "10px"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    onClick: () => setShowExtra(!showExtra)
  }, showExtra ? "إخفاء" : "تفاصيل أكثر")), data.standings.map(b => /*#__PURE__*/React.createElement("div", {
    className: "standings-block",
    key: b.group
  }, /*#__PURE__*/React.createElement("div", {
    className: "standings-title"
  }, "\uD83D\uDEE1\uFE0F ", b.group), /*#__PURE__*/React.createElement(StandingsTable, {
    rows: b.rows,
    qualifiers: b.qualifiers,
    showExtra: showExtra
  }))), /*#__PURE__*/React.createElement("div", {
    className: "legend"
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    className: "swatch",
    style: {
      background: "var(--sun)"
    }
  }), "\u0627\u0644\u0645\u062A\u0635\u062F\u0651\u0631"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    className: "swatch"
  }), "\u062A\u0623\u0647\u064F\u0651\u0644 (\u0623\u0648\u0644 2 \u0645\u0646 \u0643\u0644 \u0628\u064A\u062A)"), /*#__PURE__*/React.createElement("span", null, "\u0627\u0644\u062A\u0631\u062A\u064A\u0628: \u0627\u0644\u0646\u0642\u0627\u0637\u060C \u062B\u0645 \u0641\u0627\u0631\u0642 \u0627\u0644\u0623\u0647\u062F\u0627\u0641\u060C \u062B\u0645 \u0627\u0644\u0623\u0647\u062F\u0627\u0641 \u0627\u0644\u0645\u064F\u0633\u062C\u064E\u0651\u0644\u0629")), /*#__PURE__*/React.createElement("p", {
    className: "page-sub",
    style: {
      marginTop: "10px"
    }
  }, "\u064A\u064F\u062D\u062F\u064E\u0651\u062B \u0627\u0644\u062A\u0631\u062A\u064A\u0628 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0641\u0648\u0631 \u0625\u062F\u062E\u0627\u0644 \u0627\u0644\u0646\u062A\u0627\u0626\u062C \u26A1"));
}
window.StandingsScreen = StandingsScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/StandingsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/TournamentsScreen.jsx
try { (() => {
// شاشة قائمة البطولات — الصفحة الرئيسية
function TournamentsScreen({
  onOpen
}) {
  const {
    TournamentCard
  } = window.DesignSystem_d76f5e;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "page-head"
  }, /*#__PURE__*/React.createElement("h1", {
    className: "page-title"
  }, "\u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062A"), /*#__PURE__*/React.createElement("p", {
    className: "page-sub"
  }, "\u0627\u062E\u062A\u0631 \u0628\u0637\u0648\u0644\u0629 \u0644\u0639\u0631\u0636 \u0627\u0644\u0628\u0631\u0646\u0627\u0645\u062C \u0648\u0627\u0644\u062A\u0631\u062A\u064A\u0628 \u2014 \u062A\u064F\u062D\u062F\u064E\u0651\u062B \u0627\u0644\u0646\u062A\u0627\u0626\u062C \u0645\u0628\u0627\u0634\u0631\u0629\u064B")), /*#__PURE__*/React.createElement("div", {
    className: "grid cols"
  }, window.TP_DATA.tournaments.map(t => /*#__PURE__*/React.createElement(TournamentCard, {
    key: t.id,
    name: t.name,
    emoji: t.emoji,
    status: t.status,
    description: t.description,
    meta: t.meta,
    done: t.done,
    total: t.total,
    onClick: () => onOpen(t)
  }))));
}
window.TournamentsScreen = TournamentsScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/TournamentsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/data.js
try { (() => {
// بيانات عرض واقعية — من seed-data.js في الريبو الأصلي (بطولة «أحفاد الصحابة»)
window.TP_DATA = {
  tournaments: [{
    id: "t1",
    name: "أحفاد الصحابة",
    emoji: "🏆",
    status: "active",
    description: "برنامج مباريات البطولة",
    meta: ["📅 03/07 – 13/07", "👥 19 فريقاً", "🛡️ 4 بيوت"],
    done: 14,
    total: 36
  }, {
    id: "t2",
    name: "بطولة الأحياء الصيفية",
    emoji: "☀️",
    status: "upcoming",
    description: "دوري الصيف للأشبال",
    meta: ["📅 20/07 – 01/08", "👥 12 فريقاً", "🛡️ 3 بيوت"],
    done: 0,
    total: 18
  }, {
    id: "t3",
    name: "دوري الربيع",
    emoji: "🌱",
    status: "finished",
    description: "انتهت — البطل: صقور الحي",
    meta: ["📅 10/03 – 02/04", "👥 8 فرق", "🛡️ 2 بيوت"],
    done: 12,
    total: 12
  }],
  groups: ["كل البيوت", "البيت الأول", "البيت الثاني", "البيت الثالث", "البيت الرابع"],
  // اليوم: مباراة مباشرة + برنامج ثلاثة أيام (من جدول الإكسل الأصلي)
  days: [{
    day: "الإثنين",
    date: "06/07/2026",
    matches: [{
      time: "17:00",
      group: "البيت الأول",
      home: "خزيمة",
      away: "رافع الظاهري",
      hs: 4,
      as: 0,
      status: "finished"
    }, {
      time: "18:00",
      group: "البيت الثاني",
      home: "بلال بن رباح",
      away: "عمر بن الخطاب",
      hs: 2,
      as: 2,
      status: "live",
      minute: 38,
      events: [{
        min: 9,
        type: "goal",
        player: "أنس",
        side: "home"
      }, {
        min: 17,
        type: "goal",
        player: "كريم",
        side: "away"
      }, {
        min: 24,
        type: "yellow",
        player: "ياسر",
        side: "away"
      }, {
        min: 31,
        type: "goal",
        player: "أنس",
        side: "home"
      }, {
        min: 36,
        type: "goal",
        player: "مهند",
        side: "away"
      }]
    }, {
      time: "19:00",
      group: "البيت الثالث",
      home: "سعد بن معاذ",
      away: "أسد الله",
      hs: null,
      as: null,
      status: "scheduled"
    }, {
      time: "20:00",
      group: "البيت الرابع",
      home: "عمر بن العاص",
      away: "أحفاد الصديق",
      hs: null,
      as: null,
      status: "scheduled"
    }]
  }, {
    day: "الثلاثاء",
    date: "07/07/2026",
    matches: [{
      time: "17:00",
      group: "البيت الأول",
      home: "أسامة بن زيد",
      away: "عثمان بن عفان",
      hs: null,
      as: null,
      status: "scheduled"
    }, {
      time: "18:00",
      group: "البيت الثاني",
      home: "القعقاع",
      away: "خالد بن الوليد",
      hs: null,
      as: null,
      status: "scheduled"
    }, {
      time: "19:00",
      group: "البيت الثالث",
      home: "أحفاد أبي ذر",
      away: "ذو النورين",
      hs: null,
      as: null,
      status: "scheduled"
    }]
  }, {
    day: "الأحد",
    date: "05/07/2026",
    matches: [{
      time: "17:00",
      group: "البيت الأول",
      home: "عثمان بن عفان",
      away: "حذيفة بن اليمان",
      hs: 3,
      as: 1,
      status: "finished"
    }, {
      time: "18:00",
      group: "البيت الثاني",
      home: "القعقاع",
      away: "عمر بن الخطاب",
      hs: 1,
      as: 1,
      status: "finished"
    }, {
      time: "19:00",
      group: "البيت الثالث",
      home: "أحفاد أبي ذر",
      away: "عبدالله بن مسعود",
      hs: 2,
      as: 3,
      status: "finished"
    }, {
      time: "20:00",
      group: "البيت الرابع",
      home: "علي بن أبي طالب",
      away: "سيف الله المسلول",
      hs: 5,
      as: 2,
      status: "finished"
    }]
  }],
  standings: [{
    group: "البيت الأول",
    qualifiers: 2,
    rows: [{
      rank: 1,
      name: "خزيمة",
      played: 3,
      won: 3,
      drawn: 0,
      lost: 0,
      gf: 9,
      ga: 2,
      points: 9,
      form: ["w", "w", "w"]
    }, {
      rank: 2,
      name: "عثمان بن عفان",
      played: 3,
      won: 2,
      drawn: 0,
      lost: 1,
      gf: 6,
      ga: 4,
      points: 6,
      form: ["w", "l", "w"]
    }, {
      rank: 3,
      name: "أسامة بن زيد",
      played: 3,
      won: 1,
      drawn: 1,
      lost: 1,
      gf: 4,
      ga: 4,
      points: 4,
      form: ["d", "w", "l"]
    }, {
      rank: 4,
      name: "حذيفة بن اليمان",
      played: 3,
      won: 0,
      drawn: 1,
      lost: 2,
      gf: 2,
      ga: 6,
      points: 1,
      form: ["l", "d", "l"]
    }, {
      rank: 5,
      name: "رافع الظاهري",
      played: 2,
      won: 0,
      drawn: 0,
      lost: 2,
      gf: 0,
      ga: 5,
      points: 0,
      form: ["l", "l"]
    }]
  }, {
    group: "البيت الثاني",
    qualifiers: 2,
    rows: [{
      rank: 1,
      name: "بلال بن رباح",
      played: 2,
      won: 1,
      drawn: 1,
      lost: 0,
      gf: 4,
      ga: 2,
      points: 4,
      form: ["w", "d"]
    }, {
      rank: 2,
      name: "عمر بن الخطاب",
      played: 3,
      won: 1,
      drawn: 1,
      lost: 1,
      gf: 4,
      ga: 4,
      points: 4,
      form: ["l", "d", "w"]
    }, {
      rank: 3,
      name: "القعقاع",
      played: 2,
      won: 1,
      drawn: 1,
      lost: 0,
      gf: 3,
      ga: 2,
      points: 4,
      form: ["d", "w"]
    }, {
      rank: 4,
      name: "خالد بن الوليد",
      played: 3,
      won: 0,
      drawn: 1,
      lost: 2,
      gf: 2,
      ga: 5,
      points: 1,
      form: ["l", "l", "d"]
    }]
  }],
  stats: [{
    icon: "🏟️",
    value: "14",
    label: "مباريات لُعبت"
  }, {
    icon: "⚽",
    value: "43",
    label: "الأهداف"
  }, {
    icon: "📈",
    value: "3.1",
    label: "معدّل التهديف"
  }, {
    icon: "👟",
    value: "أنس",
    label: "أفضل هدّاف"
  }]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/data.js", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Chip = __ds_scope.Chip;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.StatTile = __ds_scope.StatTile;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.TournamentCard = __ds_scope.TournamentCard;

__ds_ns.Bracket = __ds_scope.Bracket;

__ds_ns.MatchRow = __ds_scope.MatchRow;

__ds_ns.Scoreboard = __ds_scope.Scoreboard;

__ds_ns.FormGuide = __ds_scope.FormGuide;

__ds_ns.StandingsTable = __ds_scope.StandingsTable;

})();
