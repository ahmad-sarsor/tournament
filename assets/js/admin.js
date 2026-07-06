// ============================================================================
//  لوحة الإدارة: مصادقة + إدارة البطولات/البيوت/الفرق/المباريات + توليد المباريات
// ============================================================================
import { isConfigured } from "./firebase.js";
import { t, formatDate, formatTime, weekdayName, statusLabel, matchStatusLabel } from "./i18n.js";
import { el, mount, clear, spinner, emptyState, toast, openModal, confirmDialog } from "./util.js";
import * as api from "./data.js";
import { groupByDay, eventIcon, renderBracket } from "./render.js";
import { openSettings, applyPrefs } from "./settings.js";

const app = document.getElementById("app");
const userBox = document.getElementById("user-box");
let session = null;
// أدوار المستخدم الحالي: مالك المنصّة / مدير منصّة / عضو معتمَد (تُحدَّث مع كل تغيّر مصادقة)
let isOwnerUser = false, isPlatformAdminUser = false, isMemberUser = false;
const myEmail = () => session?.user?.email || null;
const myEmailLow = () => (session?.user?.email || "").toLowerCase() || null;
// هل يملك المستخدم صلاحية إدارة هذا التورنير؟ (منصّة، أو مالكه، أو مدير معيّن فيه)
function canEditTournament(tr) {
  if (!tr) return false;
  if (isPlatformAdminUser) return true;
  const e = myEmailLow();
  if (!e) return false;
  // كل العناوين بحروف صغيرة (owner_email من Firebase، والقوائم من الواجهة والقواعد)
  return String(tr.owner_email || "").toLowerCase() === e
    || (Array.isArray(tr.admin_emails) && tr.admin_emails.includes(e));
}
// صلاحية تسجيل النتائج: كل من يدير، أو المعيَّن في scorer_emails
function canScoreTournament(tr) {
  if (canEditTournament(tr)) return true;
  const e = myEmailLow();
  return !!e && Array.isArray(tr?.scorer_emails) && tr.scorer_emails.includes(e);
}
// رسالة خطأ مصادقة واضحة حسب رمز Firebase (مع رسالة احتياطية)
const authMsg = (e, fallback) => (e && t.authErrors && t.authErrors[e.code]) || fallback;
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
  await refreshRole();
  api.onAuthChange(async (s) => {
    session = s;
    if (s) api.syncMyUserDoc().catch(() => {});   // يبقي حالة التوثيق/الاسم محدَّثة
    await refreshRole(); renderUserBox(); route(); autoFinishStale();
  });
  window.addEventListener("hashchange", route);
  renderUserBox();
  route();
  autoFinishStale();                                   // فحص فوري عند الفتح
  setInterval(autoFinishStale, AUTO_FINISH_CHECK_MS);  // فحص دوري ما دامت اللوحة مفتوحة
}
boot();

// يحسب أدوار المستخدم الحالي بعد كل تغيّر في المصادقة
async function refreshRole() {
  if (!session) { isOwnerUser = isPlatformAdminUser = isMemberUser = false; return; }
  isOwnerUser = api.isOwnerEmail(session.user.email);
  try {
    isPlatformAdminUser = isOwnerUser || await api.amIPlatformAdmin();
    isMemberUser = isPlatformAdminUser || await api.isInMembers();
  } catch { isPlatformAdminUser = isMemberUser = isOwnerUser; }
}

// ---- إنهاء تلقائي للمباريات المنسيّة (بعد ساعة من بدئها) --------------------
const AUTO_FINISH_MS = 60 * 60 * 1000;       // ساعة من لحظة البدء
const AUTO_FINISH_CHECK_MS = 3 * 60 * 1000;  // نفحص كل ٣ دقائق (توفيراً للحصّة)
let autoFinishing = false;

async function autoFinishStale() {
  // يتطلّب بريداً مُوثَّقاً (شرط الكتابة في القواعد) وصلاحيةً، ولا فحصين متزامنين
  if (!session || !session.user.emailVerified || !isMemberUser || autoFinishing) return;
  autoFinishing = true;
  try {
    const now = Date.now();
    const stale = (await api.fetchLiveMatches()).filter(
      (m) => m.status === "live" && m.live_started_at && now - m.live_started_at >= AUTO_FINISH_MS
    );
    if (!stale.length) return;

    // مدير المنصّة يُنهي أي مباراة؛ غيره يقتصر على تورنيرات يديرها أو يسجّل فيها
    let allowed = null; // null = كل التورنيرات (مدير منصّة)
    if (!isPlatformAdminUser) {
      const mine = await api.fetchMyTournaments(myEmail());
      const byId = new Map(mine.map((tr) => [tr.id, tr]));
      allowed = new Set(mine.filter((tr) => canScoreTournament(tr)).map((tr) => tr.id));
      // نتجاهل مباريات تورنيرات لا نملك صلاحيتها بدل محاولة فاشلة
      for (let i = stale.length - 1; i >= 0; i--) if (!allowed.has(stale[i].tournament_id)) stale.splice(i, 1);
      void byId;
    }

    for (const m of stale) {
      try {
        await api.updateMatch(m.id, {
          status: "finished",
          home_score: m.home_score ?? 0,
          away_score: m.away_score ?? 0,
          live_started_at: null,
        });
      } catch (_) { /* رُفضت لسببٍ ما — نتجاهلها ونكمل البقية */ }
    }
  } catch (e) { console.error(e); }
  finally { autoFinishing = false; }
}

function renderUserBox() {
  clear(userBox);
  if (!session) return;
  const label = (session.user.displayName || session.user.email || "").trim();
  const shown = label.length > 22 ? label.slice(0, 21) + "…" : label;
  userBox.appendChild(el("span", { style: "display:flex;align-items:center;gap:8px" }, [
    el("button.btn.btn-sm.btn-outline", {
      title: t.myAccount,
      style: "background:rgba(255,255,255,.15);color:#fff;border-color:transparent;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap",
      onclick: () => accountModal(),
    }, ["👤 " + shown]),
    el("button.btn.btn-sm.btn-outline", {
      text: t.logout, style: "background:rgba(255,255,255,.15);color:#fff;border-color:transparent",
      onclick: async () => { await api.signOut(); location.hash = "#/"; },
    }),
  ]));
}

// ---- التوجيه ---------------------------------------------------------------

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "users") return { view: "users" };
  if (parts[0] === "suggestions") return { view: "suggestions" };
  if (parts[0] === "t" && parts[1]) {
    if (parts[2] === "m" && parts[3]) return { view: "live", id: parts[1], matchId: parts[3] };
    return { view: "tournament", id: parts[1], tab: parts[2] || "matches" };
  }
  return { view: "home" };
}

async function route() {
  cleanupAdmin();
  if (!isConfigured) return renderSetupNeeded();
  if (!session) return renderLogin();
  // بريد غير مُوثَّق: لا صلاحيات كتابة — نطالب بتأكيد البريد أولاً
  if (!session.user.emailVerified) { clear(userBox); renderUserBox(); return renderVerifyEmail(); }
  const r = parseHash();
  try {
    mount(app, spinner());
    if (r.view === "live") await renderLiveConsole(r.id, r.matchId);
    else if (r.view === "tournament") await renderTournamentAdmin(r.id, r.tab);
    else if (r.view === "suggestions") await renderSuggestionsAdmin();
    else if (r.view === "users") await renderUsersAdmin();
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
  const host = el("div", { style: "max-width:420px;margin:6vh auto 0" });
  // نبدأ بنموذج التسجيل عند القدوم من زر «دخول / تسجيل» في رأس الموقع (#/register)
  let mode = /register|signup/i.test(location.hash) ? "signup" : "login"; // login | signup

  const build = () => {
    const isSignup = mode === "signup";
    const errBox = el("div.alert.alert-error", { hidden: true, role: "alert" });
    const showErr = (msg) => { errBox.hidden = false; errBox.textContent = msg; };

    const name = el("input.input", { id: "reg-name", type: "text", autocomplete: "name", maxlength: "60", placeholder: t.usernamePlaceholder });
    const email = el("input.input", { id: "login-email", type: "email", autocomplete: "username", required: true, style: "direction:ltr;text-align:end" });
    const pass = el("input.input", {
      id: "login-pass", type: "password", required: true, style: "direction:ltr;text-align:end",
      autocomplete: isSignup ? "new-password" : "current-password", ...(isSignup ? { minlength: "8" } : {}),
    });
    // زر إظهار/إخفاء كلمة المرور
    const toggleEye = el("button.pw-toggle", {
      type: "button", title: t.showPassword, "aria-label": t.showPassword, text: "👁",
      onclick: () => {
        const show = pass.type === "password";
        pass.type = show ? "text" : "password";
        toggleEye.textContent = show ? "🙈" : "👁";
        const lbl = show ? t.hidePassword : t.showPassword;
        toggleEye.title = lbl; toggleEye.setAttribute("aria-label", lbl);
      },
    });
    const passWrap = el("div.pw-wrap", {}, [pass, toggleEye]);

    const btn = el("button.btn.btn-primary.btn-block", { type: "submit", text: isSignup ? t.signUp : t.login });

    // دخول Google
    const googleBtn = el("button.btn.btn-block.btn-google", { type: "button" }, [googleIcon(), t.continueWithGoogle]);
    googleBtn.addEventListener("click", async () => {
      errBox.hidden = true; googleBtn.disabled = true;
      try { await api.signInWithGoogle(); /* onAuthChange يوجّه */ }
      catch (err) {
        googleBtn.disabled = false;
        // إغلاق النافذة ليس خطأً يستحق رسالة
        if (["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(err?.code)) return;
        showErr(authMsg(err, t.errorGeneric));
      }
    });

    // نسيت كلمة المرور
    const forgot = el("button.link-btn", {
      type: "button", text: t.forgotPassword,
      onclick: async () => {
        const addr = email.value.trim();
        errBox.hidden = true;
        if (!addr) return showErr(t.enterEmailFirst);
        try { await api.sendReset(addr); toast(t.resetSent, "ok"); }
        catch (err) {
          if (err?.code === "auth/invalid-email") return showErr(t.authErrors["auth/invalid-email"]);
          toast(t.resetSent, "ok"); // منع كشف وجود الحساب من عدمه
        }
      },
    });

    const fields = [];
    if (isSignup) fields.push(el("div.field", {}, [el("label", { text: t.username, for: "reg-name" }), name]));
    fields.push(el("div.field", {}, [el("label", { text: t.email, for: "login-email" }), email]));
    fields.push(el("div.field", {}, [
      el("label", { text: t.password, for: "login-pass" }), passWrap,
      isSignup ? el("div.field-hint", { text: t.passwordHint }) : null,
      !isSignup ? el("div", { style: "text-align:start;margin-top:6px" }, [forgot]) : null,
    ]));
    fields.push(errBox, btn);
    const form = el("form", {}, fields);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errBox.hidden = true;
      const addr = email.value.trim();
      // تحقّق محلّي سريع قبل الشبكة
      if (!addr) return showErr(t.invalidEmail);
      if (isSignup && pass.value.length < 8) return showErr(t.weakPasswordLocal);
      btn.disabled = true; btn.textContent = t.loading;
      try {
        if (isSignup) { await api.signUp(addr, pass.value, name.value.trim()); toast(t.verifySent, "ok"); }
        else await api.signIn(addr, pass.value);
        // onAuthChange يتكفّل بالتوجيه (لغير المؤكَّدين → شاشة التأكيد)
      } catch (err) {
        showErr(authMsg(err, isSignup ? t.signupError : t.loginError));
        btn.disabled = false; btn.textContent = isSignup ? t.signUp : t.login;
      }
    });

    // تبويبا دخول / تسجيل
    const tab = (label, target) => el("button.tab" + (mode === target ? ".active" : ""), {
      type: "button", text: label, onclick: () => { if (mode !== target) { mode = target; build(); } },
    });
    const tabs = el("div.tabs", { style: "margin-bottom:16px" }, [tab(t.login, "login"), tab(t.signUp, "signup")]);

    mount(host,
      el("div.page-head", { style: "text-align:center" }, [
        el("h1.page-title", { text: t.adminPanel }),
        el("p.page-sub", { text: isSignup ? "" : t.loginPrompt }),
      ]),
      el("div.card.card-pad", {}, [
        tabs,
        googleBtn,
        el("div.auth-divider", {}, [el("span", { text: t.orSep })]),
        form,
      ]),
    );
  };

  build();
  mount(app, host);
}

// أيقونة Google (ثابتة — لا مدخلات مستخدم)
function googleIcon() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("width", "18"); svg.setAttribute("height", "18");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML =
    '<path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22 22-9.8 22-22c0-1.3-.1-2.3-.4-3.5z"/>' +
    '<path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 4.1 29.6 2 24 2 16.3 2 9.7 6.3 6.3 14.7z"/>' +
    '<path fill="#4CAF50" d="M24 46c5.5 0 10.5-2.1 14.3-5.6l-6.6-5.6C29.6 36.7 26.9 38 24 38c-5.2 0-9.6-3.3-11.3-7.9l-6.6 5.1C9.6 41.6 16.2 46 24 46z"/>' +
    '<path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.7l6.6 5.6C41.1 36.9 44 31 44 24c0-1.3-.1-2.3-.4-3.5z"/>';
  return svg;
}

// شاشة تأكيد البريد — لا تُمنح صلاحيات كتابة قبلها
let resendUntil = 0;      // ختم زمني لمنع إغراق إعادة الإرسال
let verifyTicker = null;  // مؤقّت العدّ التنازلي (يُلغى عند إعادة الرسم)
function renderVerifyEmail() {
  if (verifyTicker) { clearInterval(verifyTicker); verifyTicker = null; }
  const email = session?.user?.email || "";
  const errBox = el("div.alert.alert-error", { hidden: true, role: "alert" });
  const showErr = (m) => { errBox.hidden = false; errBox.textContent = m; };

  const refreshBtn = el("button.btn.btn-primary.btn-block", {
    text: "✓ " + t.iVerified,
    onclick: async () => {
      errBox.hidden = true; refreshBtn.disabled = true;
      try {
        const s = await api.refreshSession();
        if (!s?.user?.emailVerified) showErr(t.stillNotVerified);
        // إن تأكّد: onAuthChange → route() ينقله للّوحة تلقائياً
      } finally { refreshBtn.disabled = false; }
    },
  });

  const resendBtn = el("button.btn.btn-outline.btn-block", { style: "margin-top:10px", text: t.resendVerify });
  const tickResend = () => {
    const left = Math.ceil((resendUntil - Date.now()) / 1000);
    if (left > 0) { resendBtn.disabled = true; resendBtn.textContent = `${t.resendWait} ${left}s`; }
    else { resendBtn.disabled = false; resendBtn.textContent = t.resendVerify; if (verifyTicker) { clearInterval(verifyTicker); verifyTicker = null; } }
  };
  resendBtn.addEventListener("click", async () => {
    errBox.hidden = true;
    try {
      await api.resendVerification();
      toast(t.verifySent, "ok");
      resendUntil = Date.now() + 45000; // مهلة ٤٥ ثانية
      tickResend(); if (!verifyTicker) verifyTicker = setInterval(tickResend, 1000);
    } catch (err) { showErr(authMsg(err, t.errorGeneric)); }
  });
  if (resendUntil > Date.now()) { tickResend(); verifyTicker = setInterval(tickResend, 1000); }

  mount(app, el("div", { style: "max-width:460px;margin:6vh auto 0" }, [
    el("div.verify-hero", { text: "📧" }),
    el("div.page-head", { style: "text-align:center" }, [
      el("h1.page-title", { text: t.verifyTitle }),
      el("p.page-sub", { text: t.verifySentTo }),
      el("div", { style: "font-weight:700;direction:ltr;margin-top:4px", text: email }),
    ]),
    el("div.card.card-pad", {}, [
      el("p", { style: "margin:0 0 10px;color:var(--text-2);line-height:1.7", text: t.verifyBody }),
      el("p", { style: "margin:0 0 16px;color:var(--text-3);font-size:.86rem", text: t.verifySpamHint }),
      errBox,
      refreshBtn,
      resendBtn,
      el("button.btn.btn-block", {
        type: "button", style: "background:transparent;border:0;color:var(--text-2);margin-top:12px",
        text: t.logout, onclick: async () => { if (verifyTicker) { clearInterval(verifyTicker); verifyTicker = null; } await api.signOut(); location.hash = "#/"; },
      }),
    ]),
  ]));
}

// نافذة «حسابي»: الاسم الظاهر + تغيير كلمة المرور (لمن دخل بكلمة مرور)
function accountModal() {
  if (!session) return;
  const u = session.user;

  const nameInput = el("input.input", { type: "text", maxlength: "60", value: u.displayName || "" });
  const saveName = el("button.btn.btn-primary", { type: "button", text: t.save });
  saveName.addEventListener("click", async () => {
    saveName.disabled = true;
    try { await api.updateMyName(nameInput.value.trim()); toast(t.saved, "ok"); renderUserBox(); }
    catch (err) { toast(authMsg(err, t.errorGeneric), "err"); }
    finally { saveName.disabled = false; }
  });

  const body = el("div", {}, [
    el("div.field", {}, [
      el("label", { text: t.email }),
      el("input.input", { type: "email", value: u.email || "", disabled: true, style: "direction:ltr;text-align:end;opacity:.75" }),
    ]),
    el("div.field", {}, [el("label", { text: t.displayNameLbl }), nameInput]),
    el("div", { style: "margin-bottom:6px" }, [saveName]),
  ]);

  // تغيير كلمة المرور — فقط لحسابات البريد/كلمة المرور
  if (api.passwordProvider()) {
    const cur = el("input.input", { type: "password", autocomplete: "current-password", style: "direction:ltr;text-align:end" });
    const nw = el("input.input", { type: "password", autocomplete: "new-password", minlength: "8", style: "direction:ltr;text-align:end" });
    const pErr = el("div.alert.alert-error", { hidden: true, role: "alert" });
    const savePass = el("button.btn.btn-outline", { type: "button", text: t.changePassword });
    savePass.addEventListener("click", async () => {
      pErr.hidden = true;
      if (nw.value.length < 8) { pErr.hidden = false; pErr.textContent = t.weakPasswordLocal; return; }
      savePass.disabled = true;
      try {
        await api.changeMyPassword(cur.value, nw.value);
        cur.value = ""; nw.value = ""; toast(t.passwordChanged, "ok");
      } catch (err) { pErr.hidden = false; pErr.textContent = authMsg(err, t.errorGeneric); }
      finally { savePass.disabled = false; }
    });
    body.appendChild(el("div", { style: "border-top:1px solid var(--border);margin-top:8px;padding-top:14px" }, [
      el("div", { style: "font-weight:700;margin-bottom:10px", text: t.changePassword }),
      el("div.field", {}, [el("label", { text: t.currentPassword }), cur]),
      el("div.field", {}, [el("label", { text: t.newPassword }), nw]),
      pErr,
      savePass,
    ]));
  } else {
    body.appendChild(el("p", { style: "border-top:1px solid var(--border);margin-top:8px;padding-top:14px;color:var(--text-2)", text: t.googleAccountNote }));
  }

  openModal({ title: "👤 " + t.myAccount, body });
}

// ---- الصفحة الرئيسية للإدارة -----------------------------------------------

async function renderHome() {
  // مدير المنصّة يرى كل البطولات؛ غيره يرى ما يملكه أو عُيّن مديراً فيه فقط
  const tournaments = isPlatformAdminUser
    ? await api.fetchTournaments()
    : await api.fetchMyTournaments(myEmail());

  const head = el("div.page-head", { style: "display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap" }, [
    el("div", {}, [el("h1.page-title", { text: t.tournaments }),
      el("p.page-sub", { text: isPlatformAdminUser ? "كل البطولات" : "بطولاتك" })]),
    el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, [
      isOwnerUser ? el("a.btn.btn-outline", { href: "#/users", text: "👥 " + t.usersAdmin }) : null,
      isPlatformAdminUser ? el("a.btn.btn-outline", { href: "#/suggestions", text: "💡 " + t.suggestions }) : null,
      isMemberUser ? el("button.btn.btn-primary", { text: "＋ " + t.newTournament, onclick: () => tournamentForm(null) }) : null,
    ]),
  ]);

  // مسجَّل غير معتمَد: تنبيه بانتظار الاعتماد
  const banner = !isMemberUser ? el("div.alert.alert-warn", { style: "margin-bottom:14px" }, [
    el("div", { style: "font-weight:700", text: "⏳ " + t.pendingTitle }),
    el("div", { style: "font-size:.88rem;margin-top:4px", text: t.pendingBody }),
  ]) : null;

  const list = el("div");
  if (!tournaments.length) {
    list.appendChild(emptyState("🏆", isMemberUser ? "لا توجد بطولات بعد — أنشئ بطولتك الأولى" : t.noTournamentsForYou));
  }
  for (const tr of tournaments) {
    const canEdit = canEditTournament(tr);
    const isTOwner = String(tr.owner_email || "").toLowerCase() === myEmailLow();
    const canDelete = isPlatformAdminUser || isTOwner;
    const subParts = [statusLabel(tr.status), tr.start_date ? formatDate(tr.start_date) : null].filter(Boolean);
    if (!canEdit) subParts.push("🎯 " + t.roleScorer); // مسجِّل نتائج فقط
    list.appendChild(el("div.admin-list-item", {}, [
      el("div.grow", {}, [
        el("div", { style: "font-weight:800", text: tr.name }),
        el("div.sub", { text: subParts.join(" · ") }),
      ]),
      // مدير التورنير: «إدارة» · مسجِّل النتائج: «إدخال النتائج» مباشرةً
      canEdit
        ? el("a.btn.btn-sm.btn-outline", { href: `#/t/${tr.id}`, text: "إدارة" })
        : el("a.btn.btn-sm.btn-primary", { href: `#/t/${tr.id}`, text: "🎯 " + t.enterResultsOnly }),
      canEdit ? el("button.btn.btn-sm.btn-outline", { text: t.edit, onclick: () => tournamentForm(tr) }) : null,
      canDelete ? el("button.btn.btn-sm.btn-danger", { text: t.delete, onclick: () => removeTournament(tr) }) : null,
    ]));
  }
  mount(app, head, ...(banner ? [banner] : []), list);
}

async function removeTournament(tr) {
  if (!(await confirmDialog(`حذف البطولة «${tr.name}» وكل بياناتها؟ ${t.confirmDelete}`))) return;
  try { await api.deleteTournament(tr.id); toast(t.deleted, "ok"); route(); }
  catch (e) { toast(e.message || t.errorGeneric, "err"); }
}

// ---- الاقتراحات (صندوق الزوّار) --------------------------------------------

function fmtWhen(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function renderSuggestionsAdmin() {
  const items = await api.fetchSuggestions();
  const head = el("div.page-head", { style: "display:flex;align-items:center;gap:12px;flex-wrap:wrap" }, [
    el("a.btn.btn-sm.btn-outline", { href: "#/", text: "→ " + t.tournaments }),
    el("h1.page-title", { style: "margin:0", text: "💡 " + t.suggestions }),
    el("span.page-sub", { text: `(${items.length})` }),
  ]);
  const list = el("div");
  if (!items.length) list.appendChild(emptyState("💡", t.noSuggestions));
  for (const s of items) {
    list.appendChild(el("div.admin-list-item", {}, [
      el("div.grow", {}, [
        el("div", { style: "white-space:pre-wrap;font-weight:600", text: s.text }),
        el("div.sub", { text: [s.name || t.anonymousVisitor, fmtWhen(s.created_at)].filter(Boolean).join(" · ") }),
      ]),
      el("button.btn.btn-sm.btn-danger", { text: t.delete, onclick: () => removeSuggestion(s) }),
    ]));
  }
  mount(app, head, list);
}

async function removeSuggestion(s) {
  if (!(await confirmDialog(`حذف هذا الاقتراح؟ ${t.confirmDelete}`))) return;
  try { await api.deleteSuggestion(s.id); toast(t.deleted, "ok"); route(); }
  catch (e) { toast(e.message || t.errorGeneric, "err"); }
}

// ---- المستخدمون والمدراء (المالك فقط) --------------------------------------

async function renderUsersAdmin() {
  if (!isOwnerUser) return renderHome();             // حماية إضافية (القواعد تفرضها أيضاً)
  const [users, adminSet, memberSet] = await Promise.all([
    api.fetchUsers(), api.fetchAdminEmails(), api.fetchMemberEmails(),
  ]);
  const verifiedCount = users.filter((u) => u.verified === true).length;
  const head = el("div.page-head", { style: "display:flex;align-items:center;gap:12px;flex-wrap:wrap" }, [
    el("a.btn.btn-sm.btn-outline", { href: "#/", text: "→ " + t.tournaments }),
    el("h1.page-title", { style: "margin:0", text: "👥 " + t.usersAdmin }),
    el("span.page-sub", { text: `(${users.length} · ${t.verifiedBadge}: ${verifiedCount})` }),
  ]);

  const search = el("input.input", { type: "search", placeholder: t.searchUsersPlaceholder, style: "max-width:340px;margin-bottom:14px" });
  const list = el("div");

  const renderList = () => {
    const q = search.value.trim().toLowerCase();
    const shown = q
      ? users.filter((u) => (u.name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q))
      : users;
    clear(list);
    if (!shown.length) { list.appendChild(emptyState("👥", q ? "لا نتائج" : t.noUsers)); return; }
    for (const u of shown) {
      const em = (u.email || "").toLowerCase();
      const owner = api.isOwnerEmail(u.email);
      const padmin = owner || adminSet.has(em);          // مدير منصّة
      const member = padmin || memberSet.has(em);        // عضو معتمَد (المدير عضو تلقائياً)
      const roleLabel = owner ? t.roleOwner : (padmin ? t.roleAdmin : (member ? t.roleMember : t.roleUser));
      const roleCls = owner ? "badge-finished" : ((padmin || member) ? "badge-active" : "badge-upcoming");
      // شارة توثيق البريد
      const verifyBadge = u.verified === true
        ? el("span.badge.badge-active", { text: "✓ " + t.verifiedBadge })
        : (u.verified === false ? el("span.badge.badge-upcoming", { text: t.notVerifiedBadge }) : null);

      const actions = [];
      if (!owner) {
        if (!padmin) actions.push(memberSet.has(em)
          ? el("button.btn.btn-sm.btn-outline", { text: t.revokeMember, onclick: () => toggleMember(u, false) })
          : el("button.btn.btn-sm.btn-primary", { text: t.approveMember, onclick: () => toggleMember(u, true) }));
        actions.push(adminSet.has(em)
          ? el("button.btn.btn-sm.btn-danger", { text: t.removeAdminRole, onclick: () => toggleAdmin(u, false) })
          : el("button.btn.btn-sm.btn-outline", { text: t.makeAdmin, onclick: () => toggleAdmin(u, true) }));
      }
      list.appendChild(el("div.admin-list-item", {}, [
        el("div.grow", {}, [
          el("div", { style: "font-weight:700;display:flex;align-items:center;gap:8px;flex-wrap:wrap" }, [
            u.name || u.email, verifyBadge,
          ]),
          el("div.sub", { text: [u.email, u.created_at ? fmtWhen(u.created_at) : null].filter(Boolean).join(" · ") }),
        ]),
        el("span.badge." + roleCls, { text: roleLabel }),
        ...actions,
      ]));
    }
  };

  search.addEventListener("input", renderList);
  renderList();
  mount(app, head, search, list);
}

async function toggleAdmin(u, on) {
  if (!on && !(await confirmDialog(`إزالة صلاحية مدير المنصّة عن «${u.name || u.email}»؟`))) return;
  try { await api.setAdmin(u.email, on); toast(t.saved, "ok"); route(); }
  catch (e) { toast(e.message || t.errorGeneric, "err"); }
}

async function toggleMember(u, on) {
  if (!on && !(await confirmDialog(`إلغاء اعتماد «${u.name || u.email}» كعضو (لن يُنشئ تورنيرات)؟`))) return;
  try { await api.setMember(u.email, on); toast(t.saved, "ok"); route(); }
  catch (e) { toast(e.message || t.errorGeneric, "err"); }
}

// ---- إدارة بطولة واحدة -----------------------------------------------------

async function renderTournamentAdmin(id, tab) {
  const tournament = await api.fetchTournament(id);
  if (!tournament) return mount(app, emptyState("🔍", "البطولة غير موجودة"),
    el("a.btn.btn-outline", { href: "#/", text: t.backToTournaments }));
  const canEdit = canEditTournament(tournament);
  const scorerOnly = !canEdit && canScoreTournament(tournament); // مسجِّل نتائج بلا إدارة
  if (!canEdit && !scorerOnly) return mount(app,
    el("a.header-link", { href: "#/", text: "→ " + t.backToTournaments, style: "background:transparent;color:var(--text-2);padding:0;font-size:.85rem" }),
    emptyState("🔒", t.noPermissionTournament));
  const bundle = await api.fetchTournamentBundle(id);
  // المسجِّل يرى تبويب المباريات فقط
  if (scorerOnly) tab = "matches";
  const state = { tournament, ...bundle, tab, scorerOnly };

  const tabs = scorerOnly ? null : el("div.tabs", {}, [
    adminTab(t.manageMatches, id, "matches", tab),
    adminTab(t.knockout, id, "knockout", tab),
    adminTab(t.teamsTab, id, "teams", tab),
    adminTab(t.manageGroups, id, "groups", tab),
    adminTab(t.editTournament, id, "details", tab),
  ]);
  const banner = scorerOnly ? el("div.alert.alert-warn", { style: "margin:10px 0 4px" }, [
    el("div", { style: "font-weight:700", text: "🎯 " + t.roleScorer }),
    el("div", { style: "font-size:.88rem;margin-top:4px", text: t.scorerModeHint }),
  ]) : null;

  const content = el("div");
  mount(app,
    el("a.header-link", { href: "#/", text: "→ " + t.backToTournaments, style: "background:transparent;color:var(--text-2);padding:0;font-size:.85rem" }),
    el("div.page-head", { style: "margin-top:10px" }, [el("h1.page-title", { text: tournament.name })]),
    banner, tabs, content);

  if (tab === "teams") renderTeamsAdmin(content, state);
  else if (tab === "groups") renderGroupsAdmin(content, state);
  else if (tab === "matches") renderMatchesTab(content, state);
  else if (tab === "knockout") renderKnockoutAdmin(content, state);
  else renderDetailsTab(content, state);
}

// ---- تبويب خروج المغلوب (إدارة) --------------------------------------------

async function renderKnockoutAdmin(host, state) {
  const { tournament } = state;
  const bundle = { groups: state.groups, teams: state.teams, matches: state.matches, players: state.players, events: state.events };
  const teamById = new Map(state.teams.map((x) => [x.id, x]));
  const hasKo = (state.matches || []).some((m) => m.stage === "knockout");

  // ترقية الفائزين تلقائياً كلّما فُتح التبويب (يعالج البايات ونتائج المباريات)
  if (hasKo) { try { if (await api.syncKnockoutAdvancement(bundle)) return route(); } catch (e) { console.error(e); } }

  const bar = el("div", { style: "display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px" }, [
    el("button.btn.btn-primary", { type: "button", text: "⚡ " + t.generateKnockout, onclick: () => genKnockout(tournament, bundle) }),
    hasKo ? el("button.btn.btn-outline", { type: "button", text: "↑ " + t.advanceWinners, onclick: () => advanceKo(bundle) }) : null,
  ]);
  mount(host, bar,
    renderBracket(state.matches, teamById, { tid: tournament.id }),
    el("p.set-hint", { style: "margin-top:14px", text: t.knockoutHint }));
}

async function genKnockout(tournament, bundle) {
  if (!(await confirmDialog(t.regenKnockoutWarn))) return;
  try {
    const res = await api.generateKnockout(tournament, bundle);
    // ترقية البايات فوراً بعد التوليد
    try { const fresh = await api.fetchTournamentBundle(tournament.id); await api.syncKnockoutAdvancement(fresh); } catch {}
    toast(t.knockoutGenerated.replace("{n}", String(res.qualifiers)), "ok");
    route();
  } catch (e) { toast(e.message || t.errorGeneric, "err"); }
}

async function advanceKo(bundle) {
  try { await api.syncKnockoutAdvancement(bundle); toast(t.advancedDone, "ok"); route(); }
  catch (e) { toast(e.message || t.errorGeneric, "err"); }
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
  const isTOwnerHere = String(tr.owner_email || "").toLowerCase() === myEmailLow();
  const canManageStaff = isPlatformAdminUser || isTOwnerHere;
  const canDelete = isPlatformAdminUser || isTOwnerHere;
  mount(host,
    el("div.card.card-pad", {}, [
      row("الاسم", tr.name),
      tr.owner_email ? row("المالك", tr.owner_email) : null,
      row("الحالة", statusLabel(tr.status)),
      row("الفترة", [tr.start_date, tr.end_date].filter(Boolean).map(formatDate).join(" ← ") || "—"),
      row("المتأهّلون من كل بيت", String(tr.qualifiers_per_group)),
      row("نقاط الفوز/التعادل", `${tr.win_points} / ${tr.draw_points}`),
      row("عدد البيوت", String(state.groups.length)),
      row("عدد الفرق", String(state.teams.length)),
      row("عدد المباريات", String(state.matches.length)),
      el("div", { style: "display:flex;gap:10px;margin-top:16px" }, [
        el("button.btn.btn-primary", { text: t.edit, onclick: () => tournamentForm(tr) }),
        canDelete ? el("button.btn.btn-danger", { text: t.delete, onclick: () => removeTournament(tr) }) : null,
      ]),
    ]),
    canManageStaff ? tournamentStaffCard(tr) : null,
  );
}

// طاقم التورنير: مدراء (admin_emails) + مسجّلو نتائج (scorer_emails).
// يعيّنهم مالك التورنير/مدير المنصّة بالبريد، مع اقتراح من المستخدمين المسجّلين.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function tournamentStaffCard(tr) {
  const usersByEmail = new Map();          // بريد → { name, verified }
  const dlId = "staff-users-" + (++uid);   // datalist مشترك للقسمين
  const datalist = el("datalist", { id: dlId });

  // اقتراحات من المستخدمين المسجّلين (اختياري — يفشل بصمت قبل نشر القواعد)
  api.fetchUsers().then((users) => {
    for (const u of users) {
      const em = (u.email || "").toLowerCase();
      if (!em) continue;
      usersByEmail.set(em, { name: u.name || "", verified: u.verified });
      datalist.appendChild(el("option", { value: em, label: u.name || em }));
    }
    renderAll();
  }).catch(() => {});

  // قسم واحد (مدراء أو مسجّلون). dupKey = مفتاح القائمة الأخرى لمنع التكرار المتقاطع
  function section({ key, title, hint, emptyText, dupKey }) {
    const listHost = el("div");
    const input = el("input.input", {
      type: "email", list: dlId, placeholder: t.staffEmailPlaceholder,
      style: "flex:1;direction:ltr;text-align:end",
    });
    const emails = () => (Array.isArray(tr[key]) ? tr[key] : []);

    const renderList = () => {
      const arr = emails();
      mount(listHost, ...(arr.length
        ? arr.map((em) => {
            const info = usersByEmail.get(em);
            const rowTitle = info?.name || em;
            let sub;
            if (!info) sub = t.staffNotRegistered;                 // لم يُنشئ حساباً بعد
            else if (info.verified === false) sub = t.staffNotVerified; // سجّل ولم يؤكّد
            else sub = info.name ? em : null;                      // مسجَّل وموثَّق
            return el("div.admin-list-item", {}, [
              el("div.grow", {}, [
                el("div", { style: "font-weight:600;direction:ltr;text-align:start", text: rowTitle }),
                sub ? el("div.sub", { style: info && info.verified === false ? "color:var(--loss)" : "", text: sub }) : null,
              ]),
              el("button.btn.btn-sm.btn-danger", { text: t.remove, onclick: () => save(arr.filter((x) => x !== em)) }),
            ]);
          })
        : [el("p.page-sub", { style: "padding:4px 2px", text: emptyText })]));
    };

    async function save(next) {
      try {
        await api.updateTournament(tr.id, { [key]: next });
        tr[key] = next.slice();
        renderList(); toast(t.saved, "ok");
      } catch (e) { toast(e.message || t.errorGeneric, "err"); }
    }

    const add = () => {
      const em = input.value.trim().toLowerCase();
      if (!em) return;
      if (!EMAIL_RE.test(em)) return toast(t.invalidEmail, "err");
      if (emails().includes(em)) return toast(t.alreadyAdmin, "err");
      // لا يكون الشخص مديراً ومسجّلاً في آنٍ واحد (الإدارة تشمل التسجيل)
      if (Array.isArray(tr[dupKey]) && tr[dupKey].includes(em)) return toast(t.alreadyAdmin, "err");
      input.value = "";
      save([...emails(), em]);
    };

    section._renderers.push(renderList);
    return el("div", {}, [
      el("div", { style: "font-weight:800;margin-bottom:4px", text: title }),
      el("p.page-sub", { style: "margin:0 0 12px", text: hint }),
      listHost,
      el("div", { style: "display:flex;gap:8px;margin-top:12px" }, [
        input,
        el("button.btn.btn-primary", { type: "button", text: t.add, onclick: add }),
      ]),
    ]);
  }
  section._renderers = [];
  const renderAll = () => section._renderers.forEach((fn) => fn());

  const managers = section({
    key: "admin_emails", title: "🛠 " + t.tournamentAdmins, hint: t.tournamentAdminsHint,
    emptyText: t.noTournamentAdmins, dupKey: "scorer_emails",
  });
  const scorers = section({
    key: "scorer_emails", title: "🎯 " + t.tournamentScorers, hint: t.tournamentScorersHint,
    emptyText: t.noTournamentScorers, dupKey: "admin_emails",
  });
  renderAll();

  return el("div.card.card-pad", { style: "margin-top:14px" }, [
    el("div", { style: "font-weight:800;margin-bottom:14px;font-size:1.05rem", text: "👥 " + t.tournamentStaff }),
    datalist,
    managers,
    el("div", { style: "border-top:1px solid var(--border);margin:20px 0" }),
    scorers,
  ]);
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
  const { tournament, groups, teams, matches, scorerOnly } = state;
  const teamById = new Map(teams.map((x) => [x.id, x]));
  const groupById = new Map(groups.map((x) => [x.id, x]));

  // المسجِّل لا يُنشئ/يولّد/يعدّل بيانات المباراة — النتائج فقط عبر الشاشة المباشرة
  const bar = scorerOnly ? null : el("div", { style: "display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px" }, [
    el("button.btn.btn-primary", { text: "＋ " + t.addMatch, onclick: () => matchForm(state, null) }),
    el("button.btn.btn-accent", { text: "⚡ " + t.generateFixtures, onclick: () => generateFixtures(state) }),
  ]);

  const list = el("div");
  if (!matches.length) list.appendChild(emptyState("📅", "لا توجد مباريات — أضف مباراة أو ولّدها تلقائياً"));

  for (const [date, dayMatches] of groupByDay(matches)) {
    list.appendChild(el("div.day-head", { dataset: { date } }, [
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
        scorerOnly ? null : el("button.icon-btn", { text: "✎", title: t.editMatchInfo, onclick: () => matchForm(state, m) }),
        scorerOnly ? null : el("button.icon-btn", { text: "🗑", title: t.delete, onclick: () => removeMatch(m) }),
      ]));
    }
  }
  mount(host, bar, list);

  // انتقال تلقائي إلى أقرب يوم غير مُنتهٍ (نفس منطق جدول المباريات العام)
  const anchor = pickMatchAnchorDay(matches);
  if (anchor) requestAnimationFrame(() => {
    const target = list.querySelector(`.day-head[data-date="${anchor}"]`);
    if (target) target.scrollIntoView({ block: "start", behavior: "auto" });
  });
}

// «يوم المِرساة» في الإدارة: مباشر الآن ← أوّل مباراة لم تُلعب بعد ← آخر يوم
function pickMatchAnchorDay(matches) {
  if (!matches.length) return null;
  const key = (m) => m.match_date || "—";
  const live = matches.find((m) => m.status === "live");
  if (live) return key(live);
  const next = matches.find((m) => !api.isCounted(m));
  if (next) return key(next);
  return key(matches[matches.length - 1]);
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
  if (!canScoreTournament(tournament)) return mount(app,
    el("a.header-link", { href: "#/", text: "→ " + t.backToTournaments, style: "background:transparent;color:var(--text-2);padding:0;font-size:.85rem" }),
    emptyState("🔒", t.noPermissionTournament));
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

  // مجموعات الأحداث المتطابقة (نفس الفريق واللاعب والنوع والدقيقة) بأكثر من نسخة
  function duplicateEventGroups() {
    const evts = (bundle.events || []).filter((e) => e.match_id === matchId);
    const groups = new Map();
    for (const e of evts) {
      const key = [e.team_id, e.player_id || "-", e.type, e.minute ?? "-"].join("|");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    return [...groups.values()].filter((arr) => arr.length > 1);
  }

  async function cleanDuplicateEvents() {
    const dupGroups = duplicateEventGroups();
    if (!dupGroups.length) return toast(t.noDuplicates, "ok");
    const playersById = new Map((bundle.players || []).map((p) => [p.id, p]));
    const toDelete = [];
    const lines = [];
    for (const arr of dupGroups) {
      arr.sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0)); // نُبقي الأقدم
      toDelete.push(...arr.slice(1));
      const p = arr[0].player_id ? playersById.get(arr[0].player_id) : null;
      lines.push(`${eventIcon(arr[0].type)} ${p ? p.name : t.unknownPlayer}: ${arr.length} ← 1`);
    }
    if (!(await confirmDialog(t.cleanDupConfirm + "\n\n" + lines.join("\n") + "\n\n" + t.cleanDupNote))) return;
    try {
      for (const e of toDelete) await api.deleteEvent(e.id); // حذف خام دون تغيير النتيجة
      toast(t.cleanedN.replace("{n}", String(toDelete.length)), "ok");
      await reload();
    } catch (err) { toast(err.message || t.errorGeneric, "err"); }
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
      (() => {
        const extra = duplicateEventGroups().reduce((n, arr) => n + (arr.length - 1), 0);
        return el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap" }, [
          el("h3.lc-events-title", { style: "margin:0", text: t.events }),
          extra ? el("button.btn.btn-sm.btn-danger", { type: "button", text: "🧹 " + t.cleanDuplicates + " (" + extra + ")", onclick: cleanDuplicateEvents }) : null,
        ]);
      })(),
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
