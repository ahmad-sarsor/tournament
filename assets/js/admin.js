// ============================================================================
//  لوحة الإدارة: مصادقة + إدارة البطولات/البيوت/الفرق/المباريات + توليد المباريات
// ============================================================================
import { isConfigured } from "./firebase.js";
import { t, formatDate, formatTime, weekdayName, statusLabel, matchStatusLabel } from "./i18n.js";
import { el, mount, clear, spinner, emptyState, toast, openModal, confirmDialog, downloadCsv } from "./util.js";
import * as api from "./data.js";
import { groupByDay, eventIcon, renderBracket, knockoutRoundName, shareCompetitionFlow } from "./render.js";
import { openSettings, applyPrefs } from "./settings.js";

const app = document.getElementById("app");
const userBox = document.getElementById("user-box");
let session = null;
// أدوار المستخدم الحالي: مالك المنصّة / مدير منصّة / عضو معتمَد (تُحدَّث مع كل تغيّر مصادقة)
let isOwnerUser = false, isPlatformAdminUser = false, isMemberUser = false;
let myUsername = null;   // اسم المستخدم (من وثيقة users) — للصلاحيات الممنوحة بالاسم
const myEmail = () => session?.user?.email || null;
const myUid = () => session?.user?.uid || null;
const myEmailLow = () => {
  const email = (session?.user?.email || "").toLowerCase();
  return email && !api.isNoEmailAuthEmail(email) ? email : null;
};
// مفاتيحي في قوائم الطاقم: البريد و/أو اسم المستخدم
const myStaffKeys = () => [myEmailLow(), myUsername].filter(Boolean);
// هل يملك المستخدم صلاحية إدارة هذا التورنير؟ (منصّة، أو مالكه، أو مدير معيّن فيه)
function canEditTournament(tr) {
  if (!tr) return false;
  if (isPlatformAdminUser) return true;
  const e = myEmailLow();
  const uid = myUid();
  return (!!uid && tr.owner_uid === uid)
    || (!!e && String(tr.owner_email || "").toLowerCase() === e)
    || (Array.isArray(tr.admin_emails) && myStaffKeys().some((k) => tr.admin_emails.includes(k)));
}
// صلاحية تسجيل النتائج: كل من يدير، أو المعيَّن في scorer_emails
function canScoreTournament(tr) {
  if (canEditTournament(tr)) return true;
  return Array.isArray(tr?.scorer_emails) && myStaffKeys().some((k) => tr.scorer_emails.includes(k));
}
// رسالة خطأ مصادقة واضحة حسب رمز Firebase (مع رسالة احتياطية)
const authMsg = (e, fallback) => (e && t.authErrors && t.authErrors[e.code]) || fallback;
let uid = 0; // عدّاد لتوليد معرّفات فريدة لحقول النماذج (ربط label بالحقل)
let adminUnsub = null; // اشتراك التحديث اللحظي (للوحة الإدارة المباشرة)
let adminAnchorPending = true; // (D8) قفزة المرساة عند فتح التبويب فقط، لا بعد كل حفظ
function cleanupAdmin() { if (adminUnsub) { adminUnsub(); adminUnsub = null; } }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const AUTH_RETURN_KEY = "tp_auth_return";
// (D5) المفتاح مع طابع زمني: عودة أقدم من 15 دقيقة تُتجاهل — لا يخطف دخولاً لاحقاً
function consumeAuthReturn() {
  let raw = "";
  try { raw = localStorage.getItem(AUTH_RETURN_KEY) || ""; } catch {}
  if (!raw) return "";
  try {
    localStorage.removeItem(AUTH_RETURN_KEY);
    let target = raw, ts = 0;
    if (raw.startsWith("{")) { const o = JSON.parse(raw); target = o.url || ""; ts = o.ts || 0; }
    if (ts && Date.now() - ts > 15 * 60 * 1000) return "";   // انتهت صلاحيته
    const url = new URL(target, location.href);
    const here = new URL(location.href);
    if (url.origin !== here.origin || /\/admin\.html$/i.test(url.pathname)) return "";
    return url.href;
  } catch {
    try { localStorage.removeItem(AUTH_RETURN_KEY); } catch {}
    return "";
  }
}

// ---- إقلاع -----------------------------------------------------------------

applyPrefs();
document.getElementById("settings-btn")?.addEventListener("click", () => openSettings({ isAdmin: true }));

// الحسابات المجهولة القديمة لا تُعدّ جلسة منظّم في هذه اللوحة
const realSession = (s) => (s && s.user && !s.user.isAnonymous && s.user.email) ? s : null;

async function boot() {
  if (!isConfigured) return renderSetupNeeded();
  try { session = realSession(await api.getSession()); } catch (e) { console.error(e); }
  await refreshRole();
  api.onAuthChange(async (s) => {
    session = realSession(s);
    if (session) api.syncMyUserDoc().catch(() => {});   // يبقي حالة التوثيق/الاسم محدَّثة
    await refreshRole(); renderUserBox(); route(); autoFinishStale();
  });
  // (D8) قفزة «يوم المرساة» عند تنقّل فعلي فقط — لا بعد كل حفظ نتيجة (route المباشر)
  window.addEventListener("hashchange", () => { adminAnchorPending = true; route(); });
  renderUserBox();
  route();
  autoFinishStale();                                   // فحص فوري عند الفتح
  setInterval(autoFinishStale, AUTO_FINISH_CHECK_MS);  // فحص دوري ما دامت اللوحة مفتوحة
}
boot();

// يحسب أدوار المستخدم الحالي بعد كل تغيّر في المصادقة
async function refreshRole() {
  if (!session) { isOwnerUser = isPlatformAdminUser = isMemberUser = false; myUsername = null; return; }
  isOwnerUser = api.isOwnerEmail(session.user.email);
  try {
    myUsername = (await api.fetchMyUserDoc(session.user.uid))?.username || null;
    isPlatformAdminUser = isOwnerUser || await api.amIPlatformAdmin();
    isMemberUser = isPlatformAdminUser || await api.isInMembers();
  } catch { myUsername = null; isPlatformAdminUser = isMemberUser = isOwnerUser; }
}

// ---- إنهاء تلقائي للمباريات المنسيّة (بعد ساعة من بدئها) --------------------
const AUTO_FINISH_MS = 60 * 60 * 1000;       // ساعة من لحظة البدء
const AUTO_FINISH_CHECK_MS = 3 * 60 * 1000;  // نفحص كل ٣ دقائق (توفيراً للحصّة)
let autoFinishing = false;

async function autoFinishStale() {
  // حساب فعّال (بريد مؤكّد أو حساب اسم مستخدم)، ولا فحصين متزامنين
  const noEmailAcc = api.isNoEmailAuthEmail(session?.user?.email);
  if (!session || (!noEmailAcc && !session.user.emailVerified) || autoFinishing) return;
  autoFinishing = true;
  try {
    // نحدّد نطاق الصلاحية أوّلاً: مدير المنصّة = كل التورنيرات؛ غيره = ما يديره/يسجّل فيه
    // (يشمل مدراء/مسجّلي تورنير ليسوا أعضاء منصّة). لو لا صلاحية في أيّها → لا نمسح المباريات الحيّة أصلاً.
    let allowed = null; // null = كل التورنيرات (مدير منصّة)
    if (!isPlatformAdminUser) {
      const mine = await api.fetchMyTournaments(myEmail());
      allowed = new Set(mine.filter((tr) => canScoreTournament(tr)).map((tr) => tr.id));
      if (!allowed.size) return;   // لا يدير/يسجّل في أيّ تورنير → لا فحص
    }

    const now = Date.now();
    let stale = (await api.fetchLiveMatches()).filter(
      (m) => m.status === "live" && m.live_started_at && now - m.live_started_at >= AUTO_FINISH_MS
    );
    // نقتصر على المباريات التي نملك صلاحية إنهائها (تجنّباً لمحاولات فاشلة)
    if (allowed) stale = stale.filter((m) => allowed.has(m.tournament_id));

    for (const m of stale) {
      // (B10) لا نُنهي مباراة إقصائية متعادلة تلقائياً — تحتاج قرار المنظّم (ترجيح)
      if (api.knockoutDrawBlocked(m, { status: "finished", home_score: m.home_score ?? 0, away_score: m.away_score ?? 0 })) continue;
      try {
        await api.updateMatch(m.id, {
          status: "finished",
          home_score: m.home_score ?? 0,
          away_score: m.away_score ?? 0,
          // نُبقي live_started_at كما هو (وقت البدء الفعلي) لعرضه في تدقيق التوقّعات
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
  // (A4) ألوان .btn الافتراضية — الأبيض المفروض سابقاً كان يختفي على الرأس الفاتح
  userBox.appendChild(el("span", { style: "display:flex;align-items:center;gap:8px" }, [
    el("button.btn.btn-sm.btn-outline", {
      title: t.myAccount,
      style: "max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap",
      onclick: () => accountModal(),
    }, ["👤 " + shown]),
    el("button.btn.btn-sm.btn-outline", {
      text: t.logout,
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
  // (A3) حساب بريد قديم غير مؤكَّد: شاشة التأكيد أولاً (كانت كوداً ميتاً لا يُستدعى)،
  // ولا نستهلك مفتاح العودة قبل التأكيد — كان يرتد للمسابقة بلا تفسير في حلقة أبدية.
  const em = session.user.email || "";
  if (em && !api.isNoEmailAuthEmail(em) && !session.user.emailVerified) {
    clear(userBox); renderUserBox();
    return renderVerifyEmail();
  }
  const authReturn = consumeAuthReturn();
  if (authReturn) { location.href = authReturn; return; }
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

    const username = el("input.input", {
      id: "reg-username", type: "text", autocomplete: "username", maxlength: "24",
      placeholder: t.usernamePlaceholder, style: "direction:ltr;text-align:end",
    });
    const personName = el("input.input", {
      id: "reg-person-name", type: "text", autocomplete: "name", maxlength: "60",
      required: isSignup, placeholder: t.personNamePlaceholder,
    });
    const email = el("input.input", {
      id: "login-email", type: "text", autocomplete: "username",
      required: !isSignup, style: "direction:ltr;text-align:end",
      placeholder: t.loginIdentifierPlaceholder,
    });
    const phone = el("input.input", {
      id: "reg-phone", type: "tel", autocomplete: "tel", maxlength: "40",
      placeholder: t.regPhonePlaceholder, style: "direction:ltr;text-align:end",
    });
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
        // الاستعادة الذاتيّة للحسابات ذات البريد فقط (حسابات اسم المستخدم بلا بريد)
        if (!addr || !addr.includes("@")) return showErr(t.forgotEmailOnly);
        try { await api.sendReset(addr); toast(t.resetSent, "ok"); }
        catch (err) {
          if (err?.code === "auth/invalid-email") return showErr(t.authErrors["auth/invalid-email"]);
          toast(t.resetSent, "ok"); // منع كشف وجود الحساب من عدمه
        }
      },
    });

    const fields = [];
    if (isSignup) fields.push(el("div.field", {}, [
      el("label", { text: t.personName, for: "reg-person-name" }),
      personName,
    ]));
    if (isSignup) fields.push(el("div.field", {}, [
      el("label", { text: t.username, for: "reg-username" }),
      username,
      el("div.field-hint", { text: t.usernameHint }),
    ]));
    // التسجيل بلا بريد إطلاقاً: اسم + اسم مستخدم + هاتف اختياري + كلمة مرور.
    // حقل البريد/المعرّف يظهر في الدخول فقط (المالك يدخل ببريده، والبقية باسم المستخدم).
    if (isSignup) fields.push(el("div.field", {}, [
      el("label", { text: t.phoneOptionalLbl, for: "reg-phone" }),
      phone,
    ]));
    else fields.push(el("div.field", {}, [
      el("label", { text: t.loginIdentifier, for: "login-email" }),
      email,
    ]));
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
      const uname = username.value.trim();
      const name = personName.value.trim();
      // تحقّق محلّي سريع قبل الشبكة
      if (isSignup && !name) return showErr(t.personNameRequired);
      if (isSignup && !api.usernameValid(uname)) return showErr(t.usernameInvalid);
      if (!isSignup && !addr) return showErr(t.loginIdentifierRequired);
      if (isSignup && pass.value.length < 8) return showErr(t.weakPasswordLocal);
      btn.disabled = true; btn.textContent = t.loading;
      try {
        if (isSignup) {
          // بلا بريد: اسم مستخدم + كلمة مرور (+هاتف اختياري) — الحساب فعّال فوراً
          await api.signUp("", pass.value, uname, name, phone.value.trim());
          session = realSession(await api.getSession());
          await refreshRole();
          renderUserBox();
          const back = consumeAuthReturn();
          if (back) { toast(t.welcomeSignedUp, "ok"); location.href = back; return; }
          location.hash = "#/";
          toast(t.welcomeSignedUp, "ok");
          route();
        }
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
        el("h1.page-title", { text: t.accountPortalTitle }),
        el("p.page-sub", { text: isSignup ? t.accountPortalSubSignup : t.accountPortalSubLogin }),
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
  const noEmail = api.isNoEmailAuthEmail(u.email);

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
      el("input.input", { type: "text", value: noEmail ? t.noEmailAccount : (u.email || ""), disabled: true, style: "direction:ltr;text-align:end;opacity:.75" }),
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
  const isNoEmailAccount = api.isNoEmailAuthEmail(session?.user?.email);
  const banner = !isMemberUser ? el("div.alert.alert-warn", { style: "margin-bottom:14px" }, [
    el("div", { style: "font-weight:700", text: "⏳ " + t.pendingTitle }),
    el("div", { style: "font-size:.88rem;margin-top:4px", text: isNoEmailAccount ? t.pendingBody : t.emailPendingBody }),
  ]) : null;

  const list = el("div");
  if (!tournaments.length) {
    list.appendChild(emptyState("🏆", isMemberUser ? "لا توجد بطولات بعد — أنشئ بطولتك الأولى" : t.noTournamentsForYou));
  }
  for (const tr of tournaments) {
    const canEdit = canEditTournament(tr);
    const isTOwner = (!!myUid() && tr.owner_uid === myUid()) || (!!myEmailLow() && String(tr.owner_email || "").toLowerCase() === myEmailLow());
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
  const [allUsers, adminSet, memberSet] = await Promise.all([
    api.fetchUsers(), api.fetchAdminEmails(), api.fetchMemberEmails(),
  ]);
  const active = allUsers.filter((u) => u.removed !== true);   // المُزالون مخفيّون افتراضياً
  const removedList = allUsers.filter((u) => u.removed === true);
  const bannedCount = active.filter((u) => u.banned === true).length;

  const head = el("div.page-head", { style: "display:flex;align-items:center;gap:12px;flex-wrap:wrap" }, [
    el("a.btn.btn-sm.btn-outline", { href: "#/", text: "→ " + t.tournaments }),
    el("h1.page-title", { style: "margin:0", text: "👥 " + t.usersAdmin }),
    el("span.page-sub", { text: `(${active.length}${bannedCount ? " · 🚫 " + bannedCount : ""})` }),
  ]);

  const search = el("input.input", { type: "search", "aria-label": t.searchUsersPlaceholder, placeholder: t.searchUsersPlaceholder, style: "max-width:340px;margin-bottom:14px" });
  const list = el("div");
  let showRemoved = false;
  const removedToggle = removedList.length ? el("button.link-btn", {
    type: "button", style: "margin:0 0 12px", text: `${t.showRemoved} (${removedList.length})`,
    onclick: () => { showRemoved = !showRemoved; removedToggle.textContent = (showRemoved ? t.hideRemoved : t.showRemoved) + ` (${removedList.length})`; renderList(); },
  }) : null;

  // تعدّد الحسابات من نفس الجهاز: عدّ device_id المكرّرة (علامة ⚠️ للمالك ليقرّر)
  const deviceCount = new Map();
  for (const u of active) if (u.device_id) deviceCount.set(u.device_id, (deviceCount.get(u.device_id) || 0) + 1);

  const renderList = () => {
    const base = showRemoved ? allUsers : active;
    const q = search.value.trim().toLowerCase();
    const shown = q
      ? base.filter((u) => (u.name || "").toLowerCase().includes(q) || (u.username || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q))
      : base;
    clear(list);
    if (!shown.length) { list.appendChild(emptyState("👥", q ? "لا نتائج" : t.noUsers)); return; }
    for (const u of shown) {
      const em = (u.email || "").toLowerCase();
      const owner = !!em && api.isOwnerEmail(u.email);
      const grantKey = em || u.username || "";
      const padmin = owner || adminSet.has(em) || (u.username && adminSet.has(u.username));
      const member = padmin || memberSet.has(em) || (u.username && memberSet.has(u.username));
      const banned = u.banned === true;
      const removed = u.removed === true;
      const roleLabel = owner ? t.roleOwner : (padmin ? t.roleAdmin : (member ? t.roleMember : t.roleUser));
      const roleCls = owner ? "badge-finished" : ((padmin || member) ? "badge-active" : "badge-upcoming");
      const badges = [
        removed ? el("span.badge", { style: "background:var(--text-3);color:#fff", text: "🗑 " + t.removedBadge })
          : (banned ? el("span.badge", { style: "background:var(--loss);color:#fff", text: "🚫 " + t.bannedBadge }) : null),
        (!removed && u.device_id && deviceCount.get(u.device_id) > 1)
          ? el("span.badge.badge-upcoming", { title: t.sameDeviceWarnHint, text: "⚠️ " + t.sameDeviceWarn })
          : null,
      ];

      const actions = [];
      if (owner) { /* المالك: بلا إجراءات */ }
      else if (removed) {
        actions.push(el("button.btn.btn-sm.btn-primary", { text: "↩ " + t.restoreUser, onclick: () => restoreUser(u) }));
      } else {
        if (grantKey) actions.push((memberSet.has(em) || memberSet.has(u.username || ""))
          ? el("button.btn.btn-sm.btn-outline", { text: t.revokeMember, onclick: () => toggleMemberKey(u, false) })
          : el("button.btn.btn-sm.btn-outline", { text: t.approveMember, onclick: () => toggleMemberKey(u, true) }));
        if (grantKey) actions.push((adminSet.has(em) || adminSet.has(u.username || ""))
          ? el("button.btn.btn-sm.btn-danger", { text: t.removeAdminRole, onclick: () => toggleAdmin(u, false) })
          : el("button.btn.btn-sm.btn-outline", { text: t.makeAdmin, onclick: () => toggleAdmin(u, true) }));
        actions.push(banned
          ? el("button.btn.btn-sm.btn-primary", { text: t.unbanUser, onclick: () => toggleBanned(u, false) })
          : el("button.btn.btn-sm.btn-danger", { text: "🚫 " + t.banUser, onclick: () => toggleBanned(u, true) }));
        actions.push(el("button.btn.btn-sm.btn-danger", { text: "🗑 " + t.delete, onclick: () => removeUser(u) }));
      }
      list.appendChild(el("div.admin-list-item.user-row", {}, [
        el("div.grow", {}, [
          el("div", { style: "font-weight:700;display:flex;align-items:center;gap:8px;flex-wrap:wrap" }, [
            u.name || u.username || u.email, ...badges,
          ]),
          el("div.sub", { text: [
            u.username ? "@" + u.username : null,
            em || null,
            u.phone || null,
            u.created_at ? fmtWhen(u.created_at) : null,
          ].filter(Boolean).join(" · ") }),
        ]),
        el("div.user-actions", {}, [el("span.badge." + roleCls, { text: roleLabel }), ...actions]),
      ]));
    }
  };

  search.addEventListener("input", renderList);
  renderList();
  mount(app, head, search, ...(removedToggle ? [removedToggle] : []), list);
}

// مفتاح المنح: البريد الحقيقي إن وُجد، وإلا اسم المستخدم (القوائم تقبل كليهما)
const grantKeyOf = (u) => {
  const em = (u.email || "").toLowerCase();
  return (em && !api.isNoEmailAuthEmail(em)) ? em : (u.username || "");
};

async function toggleAdmin(u, on) {
  if (!on && !(await confirmDialog(`إزالة صلاحية مدير المنصّة عن «${u.name || u.username || u.email}»؟`))) return;
  try { await api.setAdmin(grantKeyOf(u), on); toast(t.saved, "ok"); route(); }
  catch (e) { toast(e.message || t.errorGeneric, "err"); }
}

async function toggleMemberKey(u, on) {
  if (!on && !(await confirmDialog(`إلغاء اعتماد «${u.name || u.username || u.email}» كعضو (لن يُنشئ تورنيرات)؟`))) return;
  try { await api.setMember(grantKeyOf(u), on); toast(t.saved, "ok"); route(); }
  catch (e) { toast(e.message || t.errorGeneric, "err"); }
}

// حظر مستخدم (تبنيد): يمنعه فوراً من المشاركة في المسابقات — للمالك وحده
async function toggleBanned(u, on) {
  const label = u.name || u.username || u.email || "";
  if (on && !(await confirmDialog(`حظر «${label}» من المشاركة في المسابقات؟`))) return;
  try { await api.setUserBanned(u.id, on); toast(on ? t.userBannedDone : t.userUnbannedDone, "ok"); route(); }
  catch (e) { toast(e.message || t.errorGeneric, "err"); }
}

// «حذف» = حظر دائم + إزالة من القوائم وتحرير الاسم (لا يُعاد تفعيله بإعادة الدخول)
async function removeUser(u) {
  if (api.isOwnerEmail(u.email)) return;
  const label = u.name || u.username || u.email || "هذا المستخدم";
  if (!(await confirmDialog(t.deleteUserQ.replace("{name}", label)))) return;
  try { await api.deletePlatformUser(u); toast(t.userRemovedDone, "ok"); route(); }
  catch (e) { toast(e.message || t.errorGeneric, "err"); }
}

// استعادة مستخدم مُزال (فكّ الحظر وإلغاء «مُزال»)
async function restoreUser(u) {
  try { await api.restoreUser(u.id); toast(t.userRestoredDone, "ok"); route(); }
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
    el("a.header-link.back-link", { href: "#/", text: "→ " + t.backToTournaments }),
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
    adminTab("🎯 " + t.predictionsAdmin, id, "predictions", tab),
    adminTab(t.editTournament, id, "details", tab),
  ]);
  const banner = scorerOnly ? el("div.alert.alert-warn", { style: "margin:10px 0 4px" }, [
    el("div", { style: "font-weight:700", text: "🎯 " + t.roleScorer }),
    el("div", { style: "font-size:.88rem;margin-top:4px", text: t.scorerModeHint }),
  ]) : null;

  const content = el("div");
  mount(app,
    el("a.header-link.back-link", { href: "#/", text: "→ " + t.backToTournaments }),
    el("div.page-head", { style: "margin-top:10px" }, [el("h1.page-title", { text: tournament.name })]),
    banner, tabs, content);

  if (tab === "teams") renderTeamsAdmin(content, state);
  else if (tab === "groups") renderGroupsAdmin(content, state);
  else if (tab === "matches") renderMatchesTab(content, state);
  else if (tab === "knockout") renderKnockoutAdmin(content, state);
  else if (tab === "predictions") renderPredictionsAdmin(content, state);
  else renderDetailsTab(content, state);
}

// ---- تبويب مسابقة التوقّعات (إدارة) ----------------------------------------

function compStatusBadgeAdmin(status) {
  const cls = { open: "badge-active", closed: "badge-upcoming", finished: "badge-finished" }[status] || "badge-upcoming";
  return el("span.badge." + cls, { text: t["pc_status_" + status] || status });
}
function scoringSummary(c) {
  const s = api.compScoring(c);
  return `${t.scoringExact}: ${s.exact} · ${t.scoringDiff}: ${s.diff} · ${t.scoringOutcome}: ${s.outcome}`;
}

async function renderPredictionsAdmin(host, state) {
  const { tournament } = state;
  mount(host, spinner());
  let comps = [];
  try { comps = await api.fetchCompetitionsByTournament(tournament.id); }
  catch (e) { return mount(host, el("div.alert.alert-error", { text: e.message || t.errorGeneric })); }

  const wrap = el("div", {}, [
    el("div.pc-adm-intro", {}, [
      el("span.pc-adm-intro-icon", { text: "🎯" }),
      el("div", { style: "flex:1;min-width:0" }, [
        el("div", { style: "font-weight:800;font-size:1.02rem;color:var(--ink)", text: t.predictionComp }),
        el("p.page-sub", { style: "margin:2px 0 0", text: t.predictionsIntro }),
      ]),
      el("button.btn.pc-adm-new", { text: t.newCompetition, onclick: () => competitionForm(state, null) }),
    ]),
  ]);
  if (!comps.length) wrap.appendChild(emptyState("🎯", t.noCompetitions));

  for (const c of comps) {
    // عدّاد مشاركين حيّ على البطاقة (+ المنتظرين للاعتماد) — يُملأ فور جلب المتوقّعين
    const cnt = el("div.pc-adm-sub", { text: "👥 …" });
    api.fetchPredictors(c.id)
      .then((list) => {
        const pending = list.filter((p) => p.verified === false).length;
        cnt.textContent = `👥 ${t.compParticipants}: ${list.length}`
          + (pending ? ` · ⏳ ${t.pendingCountLbl}: ${pending}` : "");
        if (pending) cnt.style.color = "var(--loss)";
      })
      .catch(() => { cnt.textContent = ""; });
    wrap.appendChild(el("div.pc-adm-card" + (c.status === "open" ? ".is-open" : ""), {}, [
      el("div.pc-adm-cardhead", {}, [
        el("div.grow", {}, [
          el("div.pc-adm-title", {}, [el("span", { text: c.title || t.predictionComp }), compStatusBadgeAdmin(c.status)]),
          el("div.pc-adm-sub", { text: scoringSummary(c) }),
          cnt,
          (c.status === "draft") ? el("div.pc-adm-hintline", { text: "• " + t.pcDraftHint }) : null,
        ]),
        el("div.pc-adm-icons", {}, [
          el("button.icon-btn", { text: "✎", title: t.edit, "aria-label": t.edit, onclick: () => competitionForm(state, c) }),
          el("button.icon-btn", { text: "🗑", title: t.delete, "aria-label": t.delete, onclick: () => removeCompetition(c) }),
        ]),
      ]),
      el("div.pc-adm-actions", {}, [
        (c.status === "open" || c.status === "closed")
          ? el("button.btn.btn-sm" + (c.predictions_open === false ? ".btn-primary" : ""), {
              text: c.predictions_open === false ? "▶ " + t.startPredictions : "⏸ " + t.stopPredictions,
              onclick: () => togglePredictions(c),
            })
          : null,
        el("button.btn.btn-sm", { text: "👥 " + t.viewParticipants, onclick: () => participantsModal(c, tournament) }),
        el("button.btn.btn-sm.btn-danger", { text: "♻️ " + t.resetPoints, onclick: () => resetPoints(c) }),
        el("button.btn.btn-sm", { text: "🖼 " + t.exportImage, onclick: () => exportBoardImageFor(c, tournament) }),
        el("button.btn.btn-sm", { text: "↗ " + t.shareComp, onclick: () => shareCompetition(c, tournament) }),
        el("a.btn.btn-sm", { href: `./index.html#/t/${tournament.id}/predictions`, target: "_blank", text: "🏅 " + t.openBoard }),
      ]),
    ]));
  }
  mount(host, wrap);

  // مزامنة صامتة لمواعيد القفل المخزَّنة مع الصيغة الحالية (قفل قبل ساعة) — كي تفرضها
  // قواعد الخادم على المباريات القائمة أيضاً. آمنة للتكرار: لا تكتب إلا عند وجود اختلاف.
  api.syncMatchLocks(tournament.id)
    .then((n) => { if (n) toast(t.locksSynced.replace("{n}", String(n)), "ok"); })
    .catch((e) => console.warn("syncMatchLocks", e));
}

// تصدير صورة (PNG) لجدول الترتيب — للمنظّم فقط. يجلب البيانات ثم يرسمها على canvas.
async function exportBoardImageFor(comp, tournament) {
  toast(t.loading, "");
  try {
    const [predictors, predictions, bundle] = await Promise.all([
      api.fetchPredictors(comp.id), api.fetchPredictions(comp.id), api.fetchTournamentBundle(tournament.id),
    ]);
    const standings = api.computePredictionStandings(predictors, predictions, bundle.matches, comp);
    if (!standings.length) return toast(t.noParticipants, "err");
    await exportBoardImage(comp, standings);
  } catch (e) { toast(e.message || t.errorGeneric, "err"); }
}

async function exportBoardImage(comp, standings) {
  try { await document.fonts.ready; } catch {}
  const rows = standings.slice(0, 60);
  const W = 680, padX = 26, headH = 118, rowH = 44, footH = 46;
  const H = headH + Math.max(1, rows.length) * rowH + footH;
  const s = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * s; canvas.height = H * s;
  const ctx = canvas.getContext("2d");
  ctx.scale(s, s);
  const FONT = "'IBM Plex Sans Arabic','Tajawal',sans-serif";
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#241b52"); g.addColorStop(1, "#3b0764");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "right"; ctx.fillStyle = "#fff";
  ctx.font = `800 30px ${FONT}`;
  ctx.fillText("🏅 " + (comp.title || "ترتيب المتوقّعين"), W - padX, 54);
  ctx.font = `500 17px ${FONT}`; ctx.fillStyle = "rgba(255,255,255,.72)";
  ctx.fillText("مسابقة التوقّعات · جدول الترتيب", W - padX, 84);

  const y = headH;
  ctx.font = `700 13px ${FONT}`; ctx.fillStyle = "rgba(255,255,255,.5)";
  ctx.textAlign = "right"; ctx.fillText("المتوقّع", W - 64, y - 12);
  ctx.textAlign = "left"; ctx.fillText("النقاط", padX + 6, y - 12);

  const medal = (r) => ({ 1: "🥇", 2: "🥈", 3: "🥉" }[r] || String(r));
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], top3 = r.rank <= 3, ry = y + i * rowH;
    if (top3 || i % 2) { ctx.fillStyle = top3 ? "rgba(255,255,255,.10)" : "rgba(255,255,255,.04)"; ctx.fillRect(padX - 8, ry, W - 2 * (padX - 8), rowH - 4); }
    ctx.textAlign = "right"; ctx.font = `800 ${top3 ? 20 : 16}px ${FONT}`;
    ctx.fillStyle = top3 ? "#fbbf24" : "rgba(255,255,255,.6)";
    ctx.fillText(medal(r.rank), W - padX, ry + 28);
    ctx.font = `700 17px ${FONT}`; ctx.fillStyle = "#fff";
    let name = r.predictor.name || "—", full = name;
    while (ctx.measureText(name).width > W - 230 && name.length > 4) name = name.slice(0, -2);
    if (name !== full) name += "…";
    ctx.fillText(name, W - padX - 46, ry + 28);
    ctx.textAlign = "left"; ctx.font = `900 19px ${FONT}`; ctx.fillStyle = "#c4b5fd";
    ctx.fillText(String(r.points), padX + 6, ry + 28);
  }

  ctx.textAlign = "center"; ctx.font = `500 13px ${FONT}`; ctx.fillStyle = "rgba(255,255,255,.45)";
  ctx.fillText("منصّة البطولات · مسابقة التوقّعات", W / 2, H - 18);

  canvas.toBlob((blob) => {
    if (!blob) return toast(t.errorGeneric, "err");
    const url = URL.createObjectURL(blob);
    const safe = String(comp.title || "leaderboard").replace(/[\\/:*?"<>|]/g, "-").slice(0, 40);
    const a = el("a", { href: url, download: safe + ".png", style: "display:none" });
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    toast(t.imageReady, "ok");
  }, "image/png");
}

function competitionForm(state, existing) {
  const { tournament } = state;
  const numInput = (v) => el("input.input", { type: "number", min: "0", inputmode: "numeric", value: String(v) });
  const titleI = el("input.input", { type: "text", maxlength: "120", value: existing?.title || "", placeholder: t.compTitlePlaceholder });
  const descI = el("textarea.input", { rows: "2" }); descI.value = existing?.description || "";
  const statusSel = el("select.select", {}, ["draft", "open", "closed", "finished"].map((s) => {
    const o = el("option", { value: s, text: t["pc_status_" + s] });
    if ((existing?.status || "draft") === s) o.selected = true;
    return o;
  }));
  const predOpenI = el("input", { type: "checkbox" });
  predOpenI.checked = existing ? existing.predictions_open !== false : false;
  const exactI = numInput(existing?.pts_exact ?? 5);
  const diffI = numInput(existing?.pts_diff ?? 3);
  const outI = numInput(existing?.pts_outcome ?? 2);
  const winnersI = numInput(existing?.winners_count ?? 3);
  const prizesI = el("textarea.input", { rows: "4", placeholder: "🥇 …\n🥈 …\n🥉 …" });
  prizesI.value = Array.isArray(existing?.prizes) ? existing.prizes.join("\n") : "";
  const err = el("div.alert.alert-error", { hidden: true, role: "alert" });

  const body = el("div", {}, [
    el("div.field", {}, [el("label", { text: t.compTitle }), titleI]),
    el("div.field", {}, [el("label", { text: t.compDesc }), descI]),
    el("div.field", {}, [el("label", { text: t.compStatus }), statusSel, el("div.field-hint", { text: t.compLaunchHint })]),
    el("div.field", {}, [
      el("label", { style: "display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600" }, [predOpenI, el("span", { text: t.predictionsOpenLabel })]),
      el("div.field-hint", { text: t.predictionsOpenHint }),
    ]),
    el("div.pc-grid3", {}, [
      el("div.field", {}, [el("label", { text: t.ptsExact }), exactI]),
      el("div.field", {}, [el("label", { text: t.ptsDiff }), diffI]),
      el("div.field", {}, [el("label", { text: t.ptsOutcome }), outI]),
    ]),
    el("div.field", {}, [el("label", { text: t.winnersCount }), winnersI]),
    el("div.field", {}, [el("label", { text: t.prizesField }), prizesI, el("div.field-hint", { text: t.prizesFieldHint })]),
    err,
  ]);

  let busy = false;
  async function submit() {
    if (busy) return;
    const title = titleI.value.trim();
    if (!title) { err.hidden = false; err.textContent = "العنوان مطلوب"; return; }
    const prizes = prizesI.value.split(/\r?\n/).map((s) => s.trim());
    while (prizes.length && prizes[prizes.length - 1] === "") prizes.pop();
    const payload = {
      title,
      description: descI.value.trim() || null,
      status: statusSel.value,
      predictions_open: predOpenI.checked,
      pts_exact: toInt(exactI.value, 5),
      pts_diff: toInt(diffI.value, 3),
      pts_outcome: toInt(outI.value, 2),
      winners_count: toInt(winnersI.value, 3),
      prizes,
    };
    busy = true;
    try {
      if (existing) await api.updateCompetition(existing.id, payload);
      else await api.createCompetition({ tournament_id: tournament.id, sort_order: Date.now(), ...payload });
      close(); toast(t.compSaved, "ok"); route();
    } catch (e) { busy = false; err.hidden = false; err.textContent = e.message || t.errorGeneric; }
  }

  const close = openModal({
    title: existing ? "✎ " + t.editCompetition : "🎯 " + t.predictionComp,
    body,
    footer: [
      el("button.btn.btn-primary", { type: "button", text: t.save, onclick: submit }),
      el("button.btn.btn-outline", { type: "button", text: t.cancel, onclick: () => close() }),
    ],
  });
}

// بدء/إيقاف إدخال التوقّعات (مرحلة «تسجيل فقط»): التسجيل يبقى مضبوطًا بالحالة (status)
async function togglePredictions(c) {
  const open = c.predictions_open === false;   // نُبدّل إلى المعاكس
  try {
    await api.updateCompetition(c.id, { predictions_open: open });
    toast(open ? t.predictionsStarted : t.predictionsStopped, "ok");
    route();
  } catch (e) { toast(e.message || t.errorGeneric, "err"); }
}

// تصفير نقاط المسابقة: حذف كل التوقّعات + إرجاع تسويات النقاط صفراً (تأكيد مزدوج — لا رجوع)
async function resetPoints(c) {
  if (!(await confirmDialog(t.resetPointsQ))) return;
  if (!(await confirmDialog(t.resetPointsQ2))) return;
  toast(t.loading, "");
  try {
    const n = await api.resetCompetitionPoints(c);
    toast(t.resetPointsDone.replace("{n}", String(n)), "ok");
    route();
  } catch (e) { toast(e.message || t.errorGeneric, "err"); }
}

async function removeCompetition(c) {
  if (!(await confirmDialog(t.deleteCompetitionQ))) return;
  try { await api.deleteCompetition(c.id); toast(t.deleted, "ok"); route(); }
  catch (e) { toast(e.message || t.errorGeneric, "err"); }
}

// قائمة المشاركين مع بيانات التواصل والنقاط (للمنظّم فقط) + تعديل/حذف/اعتماد
async function participantsModal(comp, tournament) {
  const body = el("div", {}, [spinner()]);
  openModal({ title: "👥 " + t.participantsTitle, body });
  await loadParticipants(body, comp, tournament);
}

async function loadParticipants(body, comp, tournament) {
  mount(body, spinner());
  const reload = () => loadParticipants(body, comp, tournament);
  try {
    // بيانات التواصل قد تفشل (قواعد لم تُنشر بعد/صلاحية ناقصة) — نُظهر الجدول بدونها بدل فشل كامل
    const [predictors, contacts, predictions, bundle] = await Promise.all([
      api.fetchPredictors(comp.id),
      api.fetchPredictorContacts(comp.id, tournament.id).catch((e) => { console.warn(e); return null; }),
      api.fetchPredictions(comp.id), api.fetchTournamentBundle(tournament.id),
    ]);
    const contactsFailed = contacts == null;
    const contactByUid = new Map((contacts || []).map((c) => [c.uid, c]));
    const standings = api.computePredictionStandings(predictors, predictions, bundle.matches, comp);
    if (!standings.length) { mount(body, emptyState("👥", t.noParticipants)); return; }

    // شارة «بانتظار الموافقة» + زر اعتماد (لمدير المنصّة — القواعد تفرض ذلك)
    const pendingCell = (p) => {
      const wrap = el("div", { style: "display:flex;align-items:center;gap:6px;margin-top:4px;flex-wrap:wrap" }, [
        el("span.badge.badge-upcoming", { text: "⏳ " + t.pendingCountLbl }),
      ]);
      if (isPlatformAdminUser) {
        const b = el("button.btn.btn-sm.btn-primary", { type: "button", text: "✓ " + t.approveBtn });
        b.addEventListener("click", async () => {
          b.disabled = true;
          try {
            await api.approvePredictor(p.id);
            toast(t.approvedDone, "ok");
            wrap.replaceWith(el("span.badge.badge-active", { text: "✓ " + t.approvedDone }));
          } catch (e) { b.disabled = false; toast(e.message || t.errorGeneric, "err"); }
        });
        wrap.appendChild(b);
      }
      return wrap;
    };

    const table = el("div.table-wrap", { style: "overflow-x:auto" }, [el("table.standings", { style: "table-layout:auto;min-width:560px" }, [
      el("thead", {}, [el("tr", {}, [
        el("th.rank-col", { text: "#" }),
        el("th.team-col", { text: t.regName }),
        el("th", { text: t.th_phone }),
        el("th", { text: t.email }),
        el("th.stat-col", { text: t.th_age }),
        el("th.pts-col", { text: t.th_pts_total }),
        el("th", { text: "" }),
      ])]),
      el("tbody", {}, standings.map((r) => {
        const c = contactByUid.get(r.predictor.uid) || {};
        return el("tr" + (r.rank === 1 ? ".champion" : ""), {}, [
          el("td", {}, [el("span.rank", { text: String(r.rank) })]),
          el("td.team-col", {}, [
            el("span.team-name", { text: r.predictor.name || "—" }),
            (r.predictor.points_adj ? el("span", { style: "font-size:.75rem;color:var(--text-3);margin-inline-start:6px", text: `(± ${r.predictor.points_adj})` }) : null),
            r.predictor.verified === false ? pendingCell(r.predictor) : null,
          ]),
          el("td", { style: "direction:ltr;text-align:start", text: (c.phone || "—") + (c.phone_verified ? " ✓" : "") }),
          el("td", { style: "direction:ltr;text-align:start;font-size:.8rem", text: c.email || "—" }),
          el("td", { text: c.age != null ? String(c.age) : "—" }),
          el("td", {}, [el("span.pts", { text: String(r.points) })]),
          el("td", {}, [el("div", { style: "display:flex;gap:4px" }, [
            el("button.icon-btn", { text: "👁", title: t.viewPredictions, "aria-label": t.viewPredictions,
              onclick: () => participantPredictionsModal(comp, r, predictions, bundle, reload) }),
            el("button.icon-btn", { text: "✎", title: t.editParticipant, "aria-label": t.editParticipant,
              onclick: () => participantEditForm(comp, r, contactByUid.get(r.predictor.uid) || null, reload) }),
            el("button.icon-btn", { text: "🗑", title: t.deleteParticipant, "aria-label": t.deleteParticipant, onclick: async () => {
              if (!(await confirmDialog(`${t.deleteParticipantQ} (${r.predictor.name || "—"})`))) return;
              try { await api.deleteParticipant(comp, r.predictor.uid); toast(t.participantDeleted, "ok"); reload(); }
              catch (e) { toast(e.message || t.errorGeneric, "err"); }
            } }),
          ])]),
        ]);
      })),
    ])]);

    const exportBtn = el("button.btn.btn-sm.btn-primary", { type: "button", text: "⬇ " + t.exportCsv, onclick: () => {
      const rows = [[t.th_rank, t.regName, t.th_phone, t.phoneVerifiedMark, t.email, t.th_age, t.th_pts_total, t.th_exactCol, t.th_hitsCol, t.th_joinedAt]];
      for (const r of standings) {
        const c = contactByUid.get(r.predictor.uid) || {};
        rows.push([r.rank, r.predictor.name || "", c.phone || "", c.phone_verified ? "✓" : "", c.email || "", c.age ?? "",
          r.points, r.exact, r.hits, c.created_at ? fmtWhen(c.created_at) : ""]);
      }
      const safe = String(comp.title || "predictions").replace(/[\\/:*?"<>|]/g, "-").slice(0, 40);
      downloadCsv(`${safe}.csv`, rows);
      toast(t.csvExported, "ok");
    } });

    mount(body,
      el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0 0 12px" }, [
        el("span.page-sub", { style: "margin:0", text: `${t.compParticipants}: ${standings.length}` }),
        exportBtn,
      ]),
      contactsFailed ? el("div.alert.alert-warn", { style: "margin:0 0 12px", text: t.contactsLoadFailed }) : null,
      table);
  } catch (e) {
    mount(body, el("div.alert.alert-error", { text: e.message || t.errorGeneric }));
  }
}

// عرض كل توقّعات مشارك مع أوقاتها (وقت التوقّع + مواعيد المباراة) وحذف أي توقّع (لغشٍّ مثلاً) — للمنظّم
function participantPredictionsModal(comp, row, predictions, bundle, onChange) {
  const p = row.predictor;
  const teamById = new Map(bundle.teams.map((tm) => [tm.id, tm]));
  const matchById = new Map(bundle.matches.map((m) => [m.id, m]));
  const order = new Map(bundle.matches.map((m, i) => [m.id, i]));
  const cfg = api.compScoring(comp);
  let mine = predictions.filter((x) => x.uid === p.uid)
    .sort((a, b) => (order.get(a.match_id) ?? 1e9) - (order.get(b.match_id) ?? 1e9));

  const body = el("div");
  // موعد المباراة المجدول (تاريخ+وقت نصّيان)
  const schedTxt = (m) => (m && m.match_date)
    ? formatDate(m.match_date) + (m.match_time ? " " + formatTime(m.match_time) : "")
    : "—";
  const timeCell = (txt) => el("td", { style: "direction:ltr;text-align:start;white-space:nowrap;font-size:.78rem", text: txt || "—" });

  const render = () => {
    clear(body);
    if (!mine.length) { body.appendChild(emptyState("🔮", t.noPredictionsYet)); return; }
    const trs = mine.map((pr) => {
      const m = matchById.get(pr.match_id);
      const home = m ? (teamById.get(m.home_team_id)?.name || "—") : "—";
      const away = m ? (teamById.get(m.away_team_id)?.name || "—") : "—";
      const counted = m && api.isCounted(m);
      const finished = m && m.status === "finished";
      const result = counted ? `${m.home_score} : ${m.away_score}` : (m ? matchStatusLabel(m.status) : "—");
      const pts = counted ? api.predictionPoints(pr, m, cfg) : null;
      // مقارنة وقت الحفظ بموعد القفل: وسم «بعد القفل» للتوقّعات المتأخّرة (شفافية للمنظّم)
      const late = (m && m.locks_at != null && pr.created_at != null) ? pr.created_at >= m.locks_at : false;
      const delBtn = el("button.icon-btn", { text: "🗑", title: t.deletePrediction, onclick: async () => {
        if (!(await confirmDialog(t.deletePredictionQ))) return;
        try {
          await api.deletePrediction(pr.id);
          const gi = predictions.indexOf(pr); if (gi >= 0) predictions.splice(gi, 1);   // زامن المصفوفة المشتركة
          mine = mine.filter((x) => x !== pr);
          toast(t.predictionDeleted, "ok");
          render();                 // حدّث النافذة فوراً
          onChange?.();             // أعد تحميل جدول المشاركين وأعد احتساب النقاط (يُخصم توقّع المحذوف)
        } catch (e) { toast(e.message || t.errorGeneric, "err"); }
      } });
      return el("tr", {}, [
        el("td.team-col", { text: `${home} × ${away}` }),
        el("td", { style: "font-weight:800;white-space:nowrap", text: `${pr.home} : ${pr.away}` }),
        el("td", { style: "white-space:nowrap", text: result }),
        pts != null ? el("td", {}, [el("span.pts", { text: "+" + pts })]) : el("td", { text: "—" }),
        timeCell(schedTxt(m)),
        timeCell(m && m.live_started_at ? fmtWhen(m.live_started_at) : "—"),
        timeCell(finished && m.finished_at ? fmtWhen(m.finished_at) : "—"),
        el("td", { style: "direction:ltr;text-align:start;white-space:nowrap;font-size:.78rem" }, [
          el("span", { text: fmtWhen(pr.created_at) || "—" }),
          late ? el("span.badge.badge-finished", { style: "margin-inline-start:6px", text: t.predAfterLock }) : null,
        ]),
        el("td", {}, [delBtn]),
      ]);
    });
    body.appendChild(el("div.table-wrap", { style: "overflow-x:auto" }, [el("table.standings", { style: "table-layout:auto;min-width:820px" }, [
      el("thead", {}, [el("tr", {}, [
        el("th.team-col", { text: t.th_match }),
        el("th", { text: t.th_guess }),
        el("th", { text: t.th_predResult }),
        el("th.pts-col", { text: t.th_pts_total }),
        el("th", { text: t.th_scheduled }),
        el("th", { text: t.th_started }),
        el("th", { text: t.th_ended }),
        el("th", { text: t.th_predAt }),
        el("th", { text: "" }),
      ])]),
      el("tbody", {}, trs),
    ])]));
  };

  render();
  openModal({ title: "👁 " + t.predictionsOf.replace("{name}", p.name || "—"), body });
}

// نموذج تعديل مشارك بيد المنظّم: اسم/هاتف/بريد/عمر + «تسوية النقاط» (±)
function participantEditForm(comp, row, contact, onSaved) {
  const p = row.predictor;
  const nameI = el("input.input", { type: "text", maxlength: "60", value: p.name || "" });
  const phoneI = el("input.input", { type: "tel", maxlength: "40", value: contact?.phone || "", style: "direction:ltr;text-align:end" });
  const emailI = el("input.input", { type: "email", maxlength: "120", value: contact?.email || "", style: "direction:ltr;text-align:end" });
  const ageI = el("input.input", { type: "number", min: "3", max: "120", inputmode: "numeric", value: contact?.age ?? "" });
  // (E7) لوحة الأرقام على iOS بلا زر سالب — أزرار ± تضمن الخصم من أي جهاز
  const adjI = el("input.input", { type: "number", min: "-9999", max: "9999", value: String(p.points_adj ?? 0), style: "direction:ltr;text-align:center;flex:1" });
  const adjStep = (d) => {
    const v = parseInt(adjI.value, 10);
    adjI.value = String(Math.max(-9999, Math.min(9999, (Number.isFinite(v) ? v : 0) + d)));
  };
  const adjRow = el("div", { style: "display:flex;gap:8px;align-items:center" }, [
    el("button.btn.btn-sm.btn-outline", { type: "button", text: "−", "aria-label": "إنقاص", onclick: () => adjStep(-1) }),
    adjI,
    el("button.btn.btn-sm.btn-outline", { type: "button", text: "＋", "aria-label": "زيادة", onclick: () => adjStep(1) }),
  ]);
  const err = el("div.alert.alert-error", { hidden: true, role: "alert" });

  const body = el("div", {}, [
    el("div.field", {}, [el("label", { text: t.regName }), nameI]),
    el("div.field", {}, [el("label", { text: t.regPhone }), phoneI,
      contact?.phone_verified ? el("div.field-hint", { text: "✓ " + t.phoneVerifiedMark + " — " + t.phoneEditDropsBadge }) : null]),
    el("div.field", {}, [el("label", { text: t.regEmail }), emailI]),
    el("div.field", {}, [el("label", { text: t.regAge }), ageI]),
    el("div.field", {}, [el("label", { text: t.pointsAdjLbl }), adjRow,
      el("div.field-hint", { text: t.pointsAdjHint.replace("{pts}", String(row.points)) })]),
    err,
  ]);

  let busy = false;
  async function submit() {
    if (busy) return;
    err.hidden = true;
    const name = nameI.value.trim();
    if (!name) { err.hidden = false; err.textContent = t.regNameShort; return; }
    const adjRaw = parseInt(adjI.value, 10);
    const pointsAdj = Number.isFinite(adjRaw) ? adjRaw : 0;
    busy = true;
    try {
      await api.adminUpdateParticipant(comp, p.uid, {
        name, phone: phoneI.value.trim(), email: emailI.value.trim(), age: ageI.value.trim(), pointsAdj,
      });
      close(); toast(t.participantSaved, "ok"); onSaved();
    } catch (e) { busy = false; err.hidden = false; err.textContent = e.message || t.errorGeneric; }
  }

  const close = openModal({
    title: "✎ " + t.editParticipant,
    body,
    footer: [
      el("button.btn.btn-primary", { type: "button", text: t.save, onclick: submit }),
      el("button.btn.btn-outline", { type: "button", text: t.cancel, onclick: () => close() }),
    ],
  });
}

// مشاركة رابط المسابقة (نسخ + مشاركة أصليّة + رمز QR)
function shareCompetition(comp, tournament) {
  // نفس مسار المشاركة العامّ: صورة دعوة مولَّدة + نص + رابط (واتساب…)، أو نافذة تنزيل/نسخ/QR
  const u = new URL("./index.html", location.href);   // صفحة العرض العامّة (شقيقة admin.html)
  u.hash = `#/t/${tournament.id}/predictions`;
  shareCompetitionFlow(comp, tournament, u.href);
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
    hasKo ? el("button.btn.btn-danger", { type: "button", text: "🗑 " + t.deleteKnockout, onclick: () => delKnockout(bundle) }) : null,
  ]);
  // تعديل أي مباراة من الشجرة (مباراة عادية → يُنسَّق تلقائياً مع البرنامج)
  const onEdit = (m) => matchForm(state, m);
  mount(host, bar,
    renderBracket(state.matches, teamById, { tid: tournament.id, onEdit }),
    el("p.set-hint", { style: "margin-top:14px", text: t.knockoutHint }));
}

// توليد الشجرة: يعرض نموذجاً لموعد كل مباراة ثم يُنشئ
async function genKnockout(tournament, bundle) {
  let planRes;
  try { planRes = api.planKnockout(tournament, bundle); }
  catch (e) { return toast(e.message || t.errorGeneric, "err"); }
  const { plan, rounds } = planRes;

  const rows = plan.map((p) => {
    const names = (p.home || p.away)
      ? `${p.home ? p.home.name : "…"} × ${p.away ? p.away.name : "…"}`
      : `#${p.pos + 1}`;
    return {
      p, label: `${knockoutRoundName(p.round, rounds)} — ${names}`,
      dateI: el("input.input", { type: "date" }),
      timeI: el("input.input", { type: "time" }),
    };
  });
  const body = el("div", {}, [
    el("p.set-hint", { style: "margin-bottom:12px", text: t.regenKnockoutWarn }),
    ...rows.map((r) => el("div.field", {}, [
      el("label", { text: r.label }),
      el("div", { style: "display:flex;gap:8px" }, [r.dateI, r.timeI]),
    ])),
  ]);
  let busy = false;
  const close = openModal({
    title: "⚡ " + t.generateKnockout,
    body,
    footer: [
      el("button.btn.btn-primary", { type: "button", text: t.generateKnockout, onclick: async () => {
        if (busy) return; busy = true;
        const schedule = rows.map((r) => ({ date: r.dateI.value || undefined, time: r.timeI.value || undefined }));
        try {
          await api.createKnockout(tournament, bundle, plan, schedule);
          try { const fresh = await api.fetchTournamentBundle(tournament.id); await api.syncKnockoutAdvancement(fresh); } catch {}
          close(); toast(t.knockoutGenerated.replace("{n}", String(planRes.qualifiers)), "ok"); route();
        } catch (e) { busy = false; toast(e.message || t.errorGeneric, "err"); }
      } }),
      el("button.btn.btn-outline", { type: "button", text: t.cancel, onclick: () => close() }),
    ],
  });
}

async function delKnockout(bundle) {
  if (!(await confirmDialog(t.deleteKnockoutWarn))) return;
  try { await api.deleteKnockout(bundle); toast(t.deleted, "ok"); route(); }
  catch (e) { toast(e.message || t.errorGeneric, "err"); }
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
  const isTOwnerHere = (!!myUid() && tr.owner_uid === myUid()) || (!!myEmailLow() && String(tr.owner_email || "").toLowerCase() === myEmailLow());
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
  const usersByKey = new Map();            // اسم مستخدم أو بريد → { name, verified, noEmail }
  let usersLoaded = false;                 // هل نجحنا في قراءة دليل المستخدمين؟ (مدير المنصّة فقط)
  const dlId = "staff-users-" + (++uid);   // datalist مشترك للقسمين
  const datalist = el("datalist", { id: dlId });

  // اقتراحات من المستخدمين المسجّلين — التعيين باسم المستخدم أولاً (أو بالبريد للحسابات القديمة)
  api.fetchUsers().then((users) => {
    for (const u of users) {
      if (u.removed === true) continue;   // لا نقترح مستخدماً مُزالاً/محظوراً
      const em = (u.email || "").toLowerCase();
      const un = (u.username || "").toLowerCase();
      const info = { name: u.name || "", verified: u.verified, noEmail: u.no_email === true };
      if (un) { usersByKey.set(un, info); datalist.appendChild(el("option", { value: un, label: (u.name || un) + " (@" + un + ")" })); }
      if (em && !api.isNoEmailAuthEmail(em)) { usersByKey.set(em, info); if (!un) datalist.appendChild(el("option", { value: em, label: u.name || em })); }
    }
    usersLoaded = true;
    renderAll();
  }).catch(() => {});

  // قسم واحد (مدراء أو مسجّلون). dupKey = مفتاح القائمة الأخرى لمنع التكرار المتقاطع
  function section({ key, title, hint, emptyText, dupKey }) {
    const listHost = el("div");
    const input = el("input.input", {
      type: "text", list: dlId, "aria-label": t.staffIdPlaceholder, placeholder: t.staffIdPlaceholder,
      style: "flex:1;direction:ltr;text-align:end",
    });
    const emails = () => (Array.isArray(tr[key]) ? tr[key] : []);

    const renderList = () => {
      const arr = emails();
      mount(listHost, ...(arr.length
        ? arr.map((em) => {
            const info = usersByKey.get(em);
            const isUname = !em.includes("@");
            const rowTitle = info?.name || em;
            let sub;
            if (!usersLoaded) sub = isUname ? "@" + em : null;     // لا دليل متاح → لا نزعم حالةً
            else if (!info) sub = t.staffNotRegistered;            // لم يُنشئ حساباً بعد
            else if (!isUname && info.verified === false) sub = t.staffNotVerified; // بريد لم يؤكَّد
            else sub = isUname ? "@" + em : (info.name ? em : null);
            return el("div.admin-list-item", {}, [
              el("div.grow", {}, [
                el("div", { style: "font-weight:600;direction:ltr;text-align:start", text: rowTitle }),
                sub ? el("div.sub", { style: info && !isUname && info.verified === false ? "color:var(--loss)" : "", text: sub }) : null,
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

    const add = async () => {
      const em = input.value.trim().toLowerCase();
      if (!em) return;
      const isEmail = EMAIL_RE.test(em);
      // يقبل اسم مستخدم (تعيين بالاسم) أو بريداً (حسابات قديمة)
      if (!isEmail && !api.usernameValid(em)) return toast(t.staffIdInvalid, "err");
      if (emails().includes(em)) return toast(t.alreadyAdmin, "err");
      // لا يكون الشخص مديراً ومسجّلاً في آنٍ واحد (الإدارة تشمل التسجيل)
      if (Array.isArray(tr[dupKey]) && tr[dupKey].includes(em)) return toast(t.alreadyAdmin, "err");
      // اسم المستخدم يجب أن يكون مسجَّلاً فعلاً — كي لا تُمنح الصلاحية لأوّل من يسجّله لاحقاً
      if (!isEmail) {
        input.disabled = true;
        const ok = await api.usernameExists(em).catch(() => false);
        input.disabled = false;
        if (!ok) return toast(t.staffUserNotFound, "err");
      }
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
      el("button.icon-btn", { text: "✎", title: t.edit, "aria-label": t.edit, onclick: () => teamForm(tournament.id, groups, tm) }),
      el("button.icon-btn", { text: "🗑", title: t.delete, "aria-label": t.delete, onclick: () => removeTeam(tm) }),
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
      el("button.icon-btn", { text: "✎", title: t.edit, "aria-label": t.edit, onclick: () => groupForm(tournament.id, g) }),
      el("button.icon-btn", { text: "🗑", title: t.delete, "aria-label": t.delete, onclick: () => removeGroup(g) }),
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
        el("button.icon-btn", { text: "✎", title: t.edit, "aria-label": t.edit, onclick: () => playerForm(state, team, p) }),
        el("button.icon-btn", { text: "🗑", title: t.delete, "aria-label": t.delete, onclick: () => removePlayer(state, team, p) }),
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
    matches.length ? el("button.btn.btn-outline", { text: "🗓 جدولة تلقائية", onclick: () => autoScheduleForm(state) }) : null,
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
        scorerOnly ? null : el("button.icon-btn", { text: "🗑", title: t.delete, "aria-label": t.delete, onclick: () => removeMatch(m) }),
      ]));
    }
  }
  mount(host, bar, list);

  // انتقال تلقائي إلى أقرب يوم غير مُنتهٍ — عند فتح التبويب فقط (D8):
  // إعادة الرسم بعد حفظ نتيجة كانت تقفز بالمنظّم بعيداً عن مكان عمله
  const anchor = adminAnchorPending ? pickMatchAnchorDay(matches) : null;
  adminAnchorPending = false;
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
      // (B10) لا تعادل في الإقصائيات — لا يتأهّل أحد وتتجمّد الشجرة بصمت
      if (api.knockoutDrawBlocked(m, { home_score: hs, away_score: as, status })) return toast(t.koDrawNotAllowed, "err");
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

// ---- الجدولة التلقائية: نموذج الإعدادات ثم معاينة ثم تطبيق دفعة واحدة --------
function autoScheduleForm(state) {
  const { tournament, groups, teams, matches } = state;
  if (!matches.length) return toast("لا توجد مباريات لجدولتها — ولّد المباريات أوّلاً", "err");
  const secGroups = groups.filter((g) => /ثانوي/.test(g.name || "")).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const priGroups = groups.filter((g) => !/ثانوي/.test(g.name || ""));
  const rot = secGroups.map((g) => g.name).join(" ← ") || "—";
  formModal({
    title: "🗓 جدولة تلقائية",
    submitText: "معاينة الجدول",
    fields: [
      { name: "start_date", label: "تاريخ أوّل يوم", type: "date", value: tournament.start_date || "" },
      { name: "start_time", label: "وقت أوّل مباراة", type: "time", value: "18:30" },
      { name: "gap", label: "دقائق بين كل مباراة وأخرى", type: "number", value: 30, attrs: { min: 1, inputmode: "numeric" } },
      { name: "first_day", label: "عدد مباريات اليوم الأوّل (من البيوت الأساسية)", type: "number", value: 3, attrs: { min: 1, inputmode: "numeric" } },
      { name: "other_day", label: "عدد مباريات باقي الأيام", type: "number", value: 4, attrs: { min: 1, inputmode: "numeric" } },
      { name: "skip_fri", label: "تخطّي أيام الجمعة", type: "select", value: "no",
        options: [{ value: "no", label: "لا — أيام متتالية" }, { value: "yes", label: "نعم — تخطَّ الجمعة" }] },
    ],
    onSubmit: async (v, close) => {
      if (!v.start_date) return toast("اختر تاريخ أوّل يوم", "err");
      const primaryPerDay = toInt(v.first_day, 3);
      const otherDay = toInt(v.other_day, 4);
      const secondaryPerDay = Math.max(0, otherDay - primaryPerDay);
      const opts = {
        startDate: v.start_date,
        startTime: v.start_time || "18:30",
        gapMin: toInt(v.gap, 30),
        primaryPerDay,
        secondaryPerDay,
        secondaryStartDayIdx: 1,                       // اليوم الأوّل بلا مباريات تناوبيّة
        secondaryOrder: secGroups.map((g) => g.id),
        skipFridays: v.skip_fri === "yes",
      };
      const plan = api.planLeagueSchedule(groups, teams, matches, opts);
      if (!plan.length) return toast("تعذّر توليد الجدول — تحقّق من الفرق والبيوت", "err");
      close();
      previewAndApplySchedule(state, plan, { primaryLabel: priGroups.map((g) => g.name).join("، "), rot });
    },
  });
}

function previewAndApplySchedule(state, plan, info) {
  const tName = new Map(state.teams.map((x) => [x.id, x.name]));
  const gName = new Map(state.groups.map((x) => [x.id, x.name]));
  const byDate = new Map();
  for (const p of plan) { if (!byDate.has(p.match_date)) byDate.set(p.match_date, []); byDate.get(p.match_date).push(p); }
  const dates = [...byDate.keys()].sort();

  const preview = el("div", { style: "max-height:46vh;overflow:auto;text-align:start" });
  dates.forEach((d, i) => {
    preview.appendChild(el("div.day-head", {}, [
      el("span", { text: `يوم ${i + 1} · ${weekdayName(d)}` }),
      el("span.date", { text: formatDate(d) }),
      el("span.line"),
    ]));
    for (const p of byDate.get(d)) {
      preview.appendChild(el("div", { style: "display:flex;gap:10px;align-items:center;padding:3px 4px;font-size:13px" }, [
        el("b", { style: "min-width:46px", text: formatTime(p.match_time) }),
        el("span", { style: "opacity:.65;min-width:104px", text: gName.get(p.group_id) || "" }),
        el("span", { text: `${tName.get(p.home_team_id) || "?"} × ${tName.get(p.away_team_id) || "?"}` }),
      ]));
    }
  });

  let close;
  const applyBtn = el("button.btn.btn-primary", { type: "button", text: "تطبيق الجدول" });
  applyBtn.addEventListener("click", async () => {
    applyBtn.disabled = true; applyBtn.textContent = "جارٍ الحفظ…";
    try {
      const n = await api.scheduleMatches(plan.map((p) => ({ id: p.id, match_date: p.match_date, match_time: p.match_time })));
      close(); toast(`تمّت جدولة ${n} مباراة ✓`, "ok"); route();
    } catch (e) {
      applyBtn.disabled = false; applyBtn.textContent = "تطبيق الجدول";
      toast(e.message || t.errorGeneric, "err");
    }
  });

  close = openModal({
    title: `🗓 معاينة الجدول — ${plan.length} مباراة / ${dates.length} يوم`,
    body: el("div", {}, [
      el("p.page-sub", { style: "margin-bottom:6px", text: `من ${formatDate(dates[0])} إلى ${formatDate(dates[dates.length - 1])}. سيُستبدل أي موعد سابق للمباريات المشمولة.` }),
      el("p.page-sub", { style: "margin-bottom:10px;opacity:.7", text: `الأساسية: ${info.primaryLabel || "—"} · التناوب: ${info.rot}` }),
      preview,
    ]),
    footer: [applyBtn, el("button.btn.btn-outline", { type: "button", text: "إلغاء", onclick: () => close() })],
  });
}

// ---- الإدارة المباشرة للمباراة ---------------------------------------------

async function renderLiveConsole(tid, matchId) {
  const tournament = await api.fetchTournament(tid);
  if (!tournament) return mount(app, emptyState("🔍", "البطولة غير موجودة"),
    el("a.btn.btn-outline", { href: "#/", text: t.backToTournaments }));
  if (!canScoreTournament(tournament)) return mount(app,
    el("a.header-link.back-link", { href: "#/", text: "→ " + t.backToTournaments }),
    emptyState("🔒", t.noPermissionTournament));
  let bundle = await api.fetchTournamentBundle(tid);
  let match = bundle.matches.find((m) => m.id === matchId);
  if (!match) return mount(app,
    el("a.header-link.back-link", { href: `#/t/${tid}/matches`, text: "→ " + t.manageMatches }),
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
        // (B10) لا تعادل «منتهية» في الإقصائيات
        if (api.knockoutDrawBlocked(match, patch)) return toast(t.koDrawNotAllowed, "err");
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
      el("a.header-link.back-link", { href: `#/t/${tid}/matches`, text: "→ " + t.manageMatches }),
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
