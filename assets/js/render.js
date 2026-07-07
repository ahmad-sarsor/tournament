// ============================================================================
//  عناصر عرض مشتركة: بطاقة المباراة + جدول الترتيب (تُستخدم في الواجهة والإدارة)
// ============================================================================
import { el, toast, openModal } from "./util.js";
import { t, formatTime, formatDate, weekdayName } from "./i18n.js";
import { computeGroupStandings, isCounted, knockoutWinner, compScoring } from "./data.js";

// اسم جولة الخروج حسب قربها من النهائي
export function knockoutRoundName(r, totalRounds) {
  const fromEnd = totalRounds - r;
  return { 0: "النهائي", 1: "نصف النهائي", 2: "ربع النهائي", 3: "دور الـ16", 4: "دور الـ32" }[fromEnd] || ("الجولة " + r);
}

// بطاقة مباراة في الشجرة (onEdit اختياري: يُظهر زر تعديل للإدارة)
function bracketMatch(m, teamById, opts = {}) {
  const { tid, onEdit } = opts;
  const home = teamById.get(m.home_team_id), away = teamById.get(m.away_team_id);
  const finished = m.status === "finished" && m.home_score != null && m.away_score != null;
  const winner = knockoutWinner(m);
  const side = (team, teamId, score) => el("div.bk-side" + (winner && winner === teamId ? ".bk-win" : ""), {}, [
    el("span.bk-team", { text: team ? team.name : (teamId ? "—" : t.tbd) }),
    el("span.bk-score", { text: finished ? String(score ?? 0) : "" }),
  ]);
  const card = el("div.bk-match" + (opts.isFinal ? ".bk-final" : "") + (m.status === "live" ? ".is-live" : ""), {}, [
    side(home, m.home_team_id, m.home_score),
    side(away, m.away_team_id, m.away_score),
  ]);
  const body = (m.home_team_id && m.away_team_id && tid) ? el("a.bk-link", { href: `#/t/${tid}/m/${m.id}` }, [card]) : card;
  if (!onEdit) return body;
  return el("div.bk-wrap", {}, [
    body,
    el("button.bk-edit-btn", { type: "button", text: "✎ " + t.edit, onclick: () => onEdit(m) }),
  ]);
}

// شجرة خروج المغلوب (أعمدة لكل جولة) — تُستخدم في الواجهة والإدارة
export function renderBracket(matches, teamById, opts = {}) {
  const ko = (matches || []).filter((m) => m.stage === "knockout")
    .sort((a, b) => (a.round - b.round) || (a.bracket_pos - b.bracket_pos));
  if (!ko.length) return el("div.empty", {}, [el("div.icon", { text: "🏆" }), el("div", { text: t.noKnockout })]);
  const rounds = Math.max(...ko.map((m) => m.round));
  const scroller = el("div.bracket-scroll");
  const wrap = el("div.bracket");
  for (let r = 1; r <= rounds; r++) {
    const isFinal = r === rounds;
    const col = el("div.bracket-col" + (isFinal ? ".bk-final-col" : ""), {}, [
      isFinal ? el("div.bk-trophy", { "aria-hidden": "true", text: "🏆" }) : null,
      el("div.bracket-round-title", { text: knockoutRoundName(r, rounds) }),
    ]);
    for (const m of ko.filter((x) => x.round === r)) col.appendChild(bracketMatch(m, teamById, { ...opts, isFinal }));
    wrap.appendChild(col);
  }
  scroller.appendChild(wrap);
  return scroller;
}

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

// آخر النتائج لفريق (حتى ٥) لعرض «السجل» — تُستخدم أيضاً في صفحة الفريق
export function teamForm(teamId, matches) {
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
export function formGuide(results) {
  const wrap = el("span.form-guide");
  for (const r of results) wrap.appendChild(el("span.form-dot." + r, { text: { w: "ف", d: "ت", l: "خ" }[r] }));
  return wrap;
}

// أيقونة/تسمية حدث المباراة
export function eventIcon(type) { return { goal: "⚽", yellow: "🟨", red: "🟥" }[type] || "•"; }
export function eventTypeLabel(type) { return t["ev_" + type] || type; }

// أحداث المباراة بأسلوب 365: كل حدث في جهة فريقه (المضيف يميناً، الضيف يساراً)،
// والدقيقة في المنتصف. events مرتّبة مسبقاً حسب الدقيقة.
export function eventsTimeline(events, playersById, teamById, opts = {}) {
  const { homeId, awayId } = opts;
  const wrap = el("div.mp-events");
  for (const e of events) {
    const p = e.player_id ? playersById.get(e.player_id) : null;
    const isAway = awayId != null && e.team_id === awayId; // غير ذلك ← جهة المضيف
    const item = el("span.ev-item.ev-" + e.type, {}, [
      el("span.ev-ico", { text: eventIcon(e.type) }),
      el("span.ev-player", { text: p ? p.name : t.unknownPlayer }),
    ]);
    const homeCell = el("div.ev-cell.ev-cell-home");
    const awayCell = el("div.ev-cell.ev-cell-away");
    (isAway ? awayCell : homeCell).appendChild(item);
    wrap.appendChild(el("div.ev-row" + (e.type === "red" ? ".ev-row-red" : ""), {}, [
      homeCell,
      el("span.ev-min", { text: e.minute != null ? e.minute + "'" : "—" }),
      awayCell,
    ]));
  }
  return wrap;
}

// بطاقة مباراة (رابط يفتح صفحة المباراة عند وجود tid) — مضغوطة بأسلوب 365
export function matchCard(m, teamById, groupById, opts = {}) {
  const { showGroup = true, tid } = opts;
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
    scoreEl = el("div.score", {}, [String(m.home_score ?? 0), el("span.sep", { text: "-" }), String(m.away_score ?? 0)]);
  } else {
    scoreEl = el("div.score.pending", { text: "–" });
  }

  const timeCol = el("div.time", {}, [
    m.match_time ? formatTime(m.match_time) : t.vs,
    showGroup && group ? el("span.grp", { text: group.name }) : null,
    live ? el("span.grp", {}, [el("span.badge.badge-live", {}, [el("span.dot"), t.live])]) : null,
  ]);

  const center = el("div.match-center", {}, [
    el("div.team.home" + (homeWin ? ".winner" : ""), {}, [el("span.name", { text: homeName })]),
    scoreEl,
    el("div.team.away" + (awayWin ? ".winner" : ""), {}, [el("span.name", { text: awayName })]),
  ]);

  const tag = tid ? "a.match.tappable" : "div.match";
  return el(tag + (live ? ".is-live" : ""), tid ? { href: `#/t/${tid}/m/${m.id}` } : {}, [
    timeCol, center, tid ? el("span.match-go", { "aria-hidden": "true", text: "‹" }) : null,
  ]);
}

// عرض البرنامج مجمّعاً بالأيام
export function renderScheduleDays(matches, teamById, groupById, extra = {}) {
  const { tid } = extra;
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
    const wrap = el("div.day-group", { dataset: { date } }, [head]);
    for (const m of dayMatches) wrap.appendChild(matchCard(m, teamById, groupById, { tid }));
    frag.appendChild(wrap);
  }
  return frag;
}

// جدول ترتيب المتوقّعين (مسابقة التوقّعات) — أوسمة للمراكز الأولى وإبراز الفائزين
export function predictionBoard(standings, comp, opts = {}) {
  const { myUid } = opts;
  const winners = comp?.winners_count ?? 0;
  const prizes = Array.isArray(comp?.prizes) ? comp.prizes : [];
  const medal = (r) => ({ 1: "🥇", 2: "🥈", 3: "🥉" }[r] || "");
  if (!standings.length) {
    return el("div.empty", {}, [el("div.icon", { text: "🎯" }), el("div", { text: t.noPredictorsYet })]);
  }
  const head = el("thead", {}, [el("tr", {}, [
    el("th.rank-col", { text: t.th_rank }),
    el("th.team-col", { text: t.th_predictor }),
    el("th.stat-col", { text: "🎯", title: t.th_exact }),
    el("th.pts-col", { text: t.th_pts_total }),
  ])]);
  const body = el("tbody", {}, standings.map((r) => {
    const isPrize = winners > 0 && r.rank <= winners;
    const isMe = myUid && r.predictor.uid === myUid;
    const prize = isPrize ? (prizes[r.rank - 1] || "") : "";
    return el("tr" + (r.rank === 1 ? ".champion" : "") + (isPrize ? ".qualify" : "") + (isMe ? ".is-me" : ""), {}, [
      el("td", {}, [el("span.rank", { text: medal(r.rank) || String(r.rank) })]),
      el("td.team-col", {}, [
        el("span.team-name", { text: r.predictor.name || "—" }),
        prize ? el("span.prize-chip", { text: "🎁 " + prize }) : null,
        isMe ? el("span.me-chip", { text: t.myRank }) : null,
      ]),
      el("td", { text: String(r.exact) }),
      el("td", {}, [el("span.pts", { text: String(r.points) })]),
    ]);
  }));
  return el("div.table-wrap", {}, [el("table.standings", {}, [head, body])]);
}

// جدول ترتيب بيت واحد. opts.tid: اسم الفريق يصبح رابطاً إلى صفحته
export function standingsTable(groupTeams, matches, points, qualifiers, opts = {}) {
  const { tid } = opts;
  const rows = computeGroupStandings(groupTeams, matches, points);
  const head = el("thead", {}, [
    el("tr", {}, [
      el("th.rank-col", { text: t.th_rank }),
      el("th.team-col", { text: t.th_team }),
      el("th.stat-col", { text: t.th_played, title: t.th_played }),
      el("th.stat-col", { text: t.th_won_s, title: t.th_won }),
      el("th.stat-col", { text: t.th_draw_s, title: t.th_draw }),
      el("th.stat-col", { text: t.th_lost_s, title: t.th_lost }),
      el("th.stat-col.col-extra", { text: t.th_gf }),
      el("th.stat-col.col-extra", { text: t.th_ga }),
      el("th.stat-col.col-extra", { text: t.th_gd }),
      el("th.pts-col", { text: t.th_pts }),
      el("th.col-extra", { text: t.th_form }),
    ]),
  ]);
  const body = el("tbody");
  for (const r of rows) {
    const qualify = qualifiers > 0 && r.rank <= qualifiers && r.played > 0;
    const champion = r.rank === 1 && r.played > 0;
    const gdClass = r.gd > 0 ? ".pos" : r.gd < 0 ? ".neg" : "";
    body.appendChild(el("tr" + (qualify ? ".qualify" : "") + (champion ? ".champion" : ""), {}, [
      el("td", {}, [el("span.rank", { text: String(r.rank) })]),
      el("td.team-col", {}, [tid
        ? el("a.team-link", { href: `#/t/${tid}/team/${r.team.id}` }, [el("span.team-name", { text: r.team.name })])
        : el("span.team-name", { text: r.team.name })]),
      el("td", { text: String(r.played) }),
      el("td", { text: String(r.won) }),
      el("td", { text: String(r.drawn) }),
      el("td", { text: String(r.lost) }),
      el("td.col-extra", { text: String(r.gf) }),
      el("td.col-extra", { text: String(r.ga) }),
      el("td.pos-diff.col-extra" + gdClass, { text: (r.gd > 0 ? "+" : "") + r.gd }),
      el("td", {}, [el("span.pts", { text: String(r.points) })]),
      el("td.col-extra", {}, [formGuide(teamForm(r.team.id, matches))]),
    ]));
  }
  return el("div.table-wrap", {}, [el("table.standings", {}, [head, body])]);
}

// ============================================================================
//  مشاركة المسابقة: صورة دعوة مولَّدة (canvas) + مسار مشاركة أصلي (واتساب وغيره)
// ============================================================================

// لفّ نصّ على أسطر بحسب عرض أقصى (يعيد مصفوفة أسطر)
function wrapText(ctx, text, maxW, maxLines = 3) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line); line = w;
      if (lines.length === maxLines) { lines[maxLines - 1] += "…"; return lines; }
    } else line = test;
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

// مستطيل بزوايا دائرية (توافقاً مع متصفحات بلا ctx.roundRect)
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// صورة دعوة للمسابقة (1080×1350): العنوان + البطولة + الوصف + الجوائز + النقاط + الرابط
export async function buildCompShareCard(comp, tournament, url) {
  try { await document.fonts.ready; } catch {}
  const W = 1080, H = 1350, pad = 84;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const FONT = "'IBM Plex Sans Arabic','Tajawal','Segoe UI',sans-serif";
  ctx.direction = "rtl";

  // خلفية متدرّجة + دوائر زخرفية
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#241b52"); g.addColorStop(1, "#3b0764");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255,.05)";
  for (const [cx, cy, r] of [[W - 80, 120, 190], [90, H - 160, 230], [W - 140, H - 320, 120]]) {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }

  let y = 108;
  ctx.textAlign = "center";
  ctx.fillStyle = "#c4b5fd"; ctx.font = `700 32px ${FONT}`;
  ctx.fillText("منصّة البطولات", W / 2, y); y += 96;
  ctx.font = `96px ${FONT}`; ctx.fillText("🎯", W / 2, y); y += 64;
  ctx.fillStyle = "#ddd6fe"; ctx.font = `700 36px ${FONT}`;
  ctx.fillText(t.predictionComp, W / 2, y); y += 84;

  ctx.fillStyle = "#fff"; ctx.font = `800 62px ${FONT}`;
  for (const line of wrapText(ctx, comp.title || t.predictionComp, W - pad * 2, 2)) {
    ctx.fillText(line, W / 2, y); y += 74;
  }
  y += 8;
  ctx.fillStyle = "rgba(255,255,255,.82)"; ctx.font = `600 38px ${FONT}`;
  ctx.fillText(tournament?.name || "", W / 2, y); y += 58;

  if (comp.description) {
    ctx.fillStyle = "rgba(255,255,255,.72)"; ctx.font = `500 30px ${FONT}`;
    for (const line of wrapText(ctx, comp.description, W - pad * 2, 2)) {
      ctx.fillText(line, W / 2, y); y += 42;
    }
    y += 10;
  }

  // بطاقة الجوائز
  const prizes = (Array.isArray(comp.prizes) ? comp.prizes : []).filter(Boolean).slice(0, 5);
  if (prizes.length) {
    const rowH = 58, boxH = 96 + prizes.length * rowH;
    rr(ctx, pad, y, W - pad * 2, boxH, 26);
    ctx.fillStyle = "rgba(255,255,255,.09)"; ctx.fill();
    ctx.fillStyle = "#fbbf24"; ctx.font = `800 38px ${FONT}`; ctx.textAlign = "center";
    ctx.fillText("🎁 " + t.prizesTitle, W / 2, y + 60);
    const medal = (r) => ({ 1: "🥇", 2: "🥈", 3: "🥉" }[r] || "#" + r);
    ctx.textAlign = "right";
    prizes.forEach((p, i) => {
      const ry = y + 108 + i * rowH;
      ctx.font = `700 36px ${FONT}`; ctx.fillStyle = "#fff";
      ctx.fillText(medal(i + 1), W - pad - 28, ry);
      ctx.font = `600 32px ${FONT}`; ctx.fillStyle = "rgba(255,255,255,.92)";
      let txt = String(p);
      while (ctx.measureText(txt).width > W - pad * 2 - 140 && txt.length > 3) txt = txt.slice(0, -2);
      ctx.fillText(txt, W - pad - 92, ry);
    });
    y += boxH + 34;
  }

  // سطر النقاط — نُصغّر الخط تلقائياً حتى يتّسع في العرض
  const s = compScoring(comp);
  const scoreLine = `🎯 ${t.scoringExact}: ${s.exact} · ↔️ ${t.scoringDiff}: ${s.diff} · ✔️ ${t.scoringOutcome}: ${s.outcome}`;
  ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,255,255,.75)";
  let scorePx = 28;
  do { ctx.font = `600 ${scorePx}px ${FONT}`; scorePx--; }
  while (scorePx > 18 && ctx.measureText(scoreLine).width > W - pad * 2);
  ctx.fillText(scoreLine, W / 2, y);
  y += 64;

  // زرّ دعوة (شكليّ)
  const btnW = 520, btnH = 88;
  rr(ctx, (W - btnW) / 2, y, btnW, btnH, 44);
  ctx.fillStyle = "#7c3aed"; ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = `800 38px ${FONT}`;
  ctx.fillText(t.shareCardCta, W / 2, y + 58);
  y += btnH + 56;

  // الرابط أسفل الصورة
  ctx.direction = "ltr"; ctx.font = `600 26px ${FONT}`; ctx.fillStyle = "rgba(255,255,255,.6)";
  let link = String(url || "").replace(/^https?:\/\//, "");
  while (ctx.measureText(link).width > W - pad * 2 && link.length > 10) link = link.slice(0, -4) + "…";
  ctx.fillText(link, W / 2, Math.max(y, H - 64));

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

// نافذة احتياطية: معاينة الصورة + تنزيل + نسخ النص والرابط + QR (حين لا تتوفر المشاركة الأصلية)
function shareCardModal(comp, url, blob, text) {
  const objUrl = blob ? URL.createObjectURL(blob) : null;
  const img = objUrl ? el("img", {
    alt: "", src: objUrl,
    style: "display:block;width:100%;max-width:300px;margin:0 auto 12px;border-radius:14px;box-shadow:var(--shadow-sm)",
  }) : null;
  const qr = el("img", {
    alt: "QR", width: "160", height: "160",
    style: "display:block;margin:10px auto 0;border-radius:12px;background:#fff;padding:8px;box-shadow:var(--shadow-sm)",
    src: `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=${encodeURIComponent(url)}`,
  });
  qr.addEventListener("error", () => { qr.style.display = "none"; });

  const dlBtn = objUrl ? el("a.btn.btn-primary.btn-block", {
    href: objUrl, download: (comp.title || "contest").replace(/[\\/:*?"<>|]/g, "-").slice(0, 40) + ".png",
    text: "💾 " + t.downloadShareImage,
  }) : null;
  const copyAllBtn = el("button.btn.btn-outline.btn-block", {
    type: "button", text: "📋 " + t.copyTextAndLink,
    onclick: async () => {
      try { await navigator.clipboard.writeText(text); toast(t.shareTextCopied, "ok"); }
      catch { toast(t.errorGeneric, "err"); }
    },
  });
  const nativeBtn = navigator.share ? el("button.btn.btn-outline.btn-block", {
    type: "button", text: "↗ " + t.share,
    onclick: async () => { try { await navigator.share({ title: comp.title || t.predictionComp, text, url }); } catch {} },
  }) : null;

  openModal({
    title: "↗ " + t.shareCompTitle,
    body: el("div", {}, [
      el("p.page-sub", { style: "margin:0 0 12px;text-align:center", text: t.shareCompHint }),
      img,
      el("div", { style: "display:flex;flex-direction:column;gap:8px" }, [dlBtn, copyAllBtn, nativeBtn].filter(Boolean)),
      qr,
    ]),
    onDismiss: () => { if (objUrl) setTimeout(() => URL.revokeObjectURL(objUrl), 5000); },
  });
}

// مسار المشاركة الكامل: صورة + نص + رابط عبر مشاركة النظام (واتساب…)، وإلا نافذة احتياطية
export async function shareCompetitionFlow(comp, tournament, url) {
  const text = `🎯 ${comp.title || t.predictionComp} — ${tournament?.name || ""}\n${t.shareCompText}\n${url}`;
  let blob = null;
  try { blob = await buildCompShareCard(comp, tournament, url); } catch (e) { console.warn(e); }
  const file = blob ? new File([blob], "contest.png", { type: "image/png" }) : null;
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text, title: comp.title || t.predictionComp });
      return;
    } catch (e) { if (e?.name === "AbortError") return; console.warn(e); }
  }
  shareCardModal(comp, url, blob, text);
}
