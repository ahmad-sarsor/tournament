// ============================================================================
//  النصوص العربية + تنسيق التواريخ/الأوقات
//  كل نصوص الواجهة مجمّعة هنا لتسهيل التعديل أو الترجمة لاحقاً.
// ============================================================================

export const t = {
  // عام
  siteTagline: "إدارة البطولات والدوريات",
  tournaments: "البطولات",
  schedule: "البرنامج",
  standings: "الترتيب",
  admin: "الإدارة",
  backToTournaments: "كل البطولات",
  loading: "جارٍ التحميل…",

  // حالات البطولة
  status_upcoming: "قادمة",
  status_active: "جارية",
  status_finished: "منتهية",

  // البرنامج
  allDays: "كل الأيام",
  allGroups: "كل البيوت",
  matchPending: "لم تُلعب",
  live: "مباشر",
  vs: "×",
  noMatches: "لا توجد مباريات بعد",

  // الترتيب
  th_rank: "#",
  th_team: "الفريق",
  th_played: "لعب",
  th_won: "فوز",
  th_draw: "تعادل",
  th_lost: "خسارة",
  th_gf: "له",
  th_ga: "عليه",
  th_gd: "الفارق",
  th_pts: "نقاط",
  th_form: "السجل",
  matchesProgress: "مباراة",
  qualifies: "تأهُّل",
  standingsNote: "يُحدَّث الترتيب تلقائياً فور إدخال النتائج",
  tieBreak: "الترتيب: النقاط، ثم فارق الأهداف، ثم الأهداف المُسجَّلة، ثم المواجهة المباشرة",
  noTeams: "لا توجد فرق بعد",

  // أيام الأسبوع (0 = الأحد)
  weekdays: ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
  months: ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"],

  // الإدارة
  login: "تسجيل الدخول",
  logout: "خروج",
  email: "البريد الإلكتروني",
  password: "كلمة المرور",
  adminPanel: "لوحة الإدارة",
  loginPrompt: "سجّل الدخول لإدارة البطولات",
  loginError: "بيانات الدخول غير صحيحة",
  save: "حفظ",
  cancel: "إلغاء",
  edit: "تعديل",
  delete: "حذف",
  add: "إضافة",
  confirm: "تأكيد",
  saved: "تم الحفظ",
  deleted: "تم الحذف",
  errorGeneric: "حدث خطأ، حاول مجدداً",
  confirmDelete: "هل أنت متأكد من الحذف؟ لا يمكن التراجع.",

  newTournament: "بطولة جديدة",
  loadSample: "تحميل بطولة تجريبية",
  loadSampleConfirm: "إنشاء بطولة «أحفاد الصحابة» كاملة ببياناتها من ملف الإكسل؟",
  editTournament: "تعديل البطولة",
  tName: "اسم البطولة",
  tDesc: "الوصف",
  tStart: "تاريخ البداية",
  tEnd: "تاريخ النهاية",
  tStatus: "الحالة",
  tQualifiers: "عدد المتأهّلين من كل بيت",
  tWinPoints: "نقاط الفوز",
  tDrawPoints: "نقاط التعادل",

  manageGroups: "البيوت والفرق",
  manageMatches: "المباريات",
  addGroup: "إضافة بيت",
  groupName: "اسم البيت",
  addTeam: "إضافة فريق",
  teamName: "اسم الفريق",
  noGroup: "بدون بيت",

  addMatch: "إضافة مباراة",
  editMatch: "تعديل المباراة",
  generateFixtures: "توليد المباريات تلقائياً",
  generateHint: "ينشئ مباريات دوري كامل (كل فريق ضدّ الجميع) داخل كل بيت.",
  homeTeam: "الفريق الأول",
  awayTeam: "الفريق الثاني",
  matchDate: "التاريخ",
  matchTime: "الساعة",
  matchGroup: "البيت",
  matchStatus: "الحالة",
  ms_scheduled: "مجدولة",
  ms_live: "مباشر",
  ms_finished: "منتهية",
  enterResult: "إدخال النتيجة",
  fixturesExistWarn: "توجد مباريات مسبقاً. التوليد سيضيف مباريات جديدة إليها.",
  fixturesDone: "تم توليد المباريات",
  needTeams: "أضف فِرقاً إلى البيوت أولاً",

  // اللاعبون
  players: "اللاعبون",
  managePlayers: "لاعبو الفريق",
  addPlayer: "إضافة لاعب",
  playerName: "اسم اللاعب",
  playerNumber: "الرقم",
  noPlayers: "لا يوجد لاعبون — أضف لاعبين للفريق",
  unknownPlayer: "غير معروف",

  // إدارة مباشرة + أحداث
  liveManage: "إدارة مباشرة",
  liveConsole: "إدارة المباراة مباشرةً",
  currentMinute: "الدقيقة الحالية",
  minute: "الدقيقة",
  goal: "هدف",
  addGoal: "تسجيل هدف",
  yellowCard: "إنذار",
  redCard: "طرد",
  whoScored: "مَن سجّل الهدف؟",
  whoBooked: "مَن حصل على البطاقة؟",
  pickPlayer: "اختر اللاعب",
  noPlayerKnown: "بدون تحديد لاعب",
  events: "الأحداث",
  noEvents: "لا توجد أحداث بعد",
  startMatch: "بدء المباراة",
  finishMatch: "إنهاء المباراة",
  reopenMatch: "إعادة الفتح",
  matchFinished: "انتهت المباراة",
  ev_goal: "هدف",
  ev_yellow: "إنذار",
  ev_red: "طرد",
  deleteEventQ: "حذف هذا الحدث؟",
  addPlayersFirst: "أضف لاعبين لهذا الفريق أولاً (من تبويب «البيوت والفرق»)",

  // إعداد مطلوب
  setupTitle: "المنصّة غير مُهيّأة بعد",
  setupBody: "لم يتم ربط مشروع Firebase. افتح الملف assets/js/config.js وألصق كائن firebaseConfig من إعدادات مشروعك. راجع ملف README لخطوات الإعداد الكاملة.",
};

const DIGITS = "٠١٢٣٤٥٦٧٨٩"; // نستخدم الأرقام اللاتينية افتراضياً للوضوح

// تحويل "YYYY-MM-DD" إلى كائن تاريخ محلي (بدون انزياح المنطقة الزمنية)
export function parseDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function formatDate(iso) {
  const dt = parseDate(iso);
  if (!dt) return "";
  return `${dt.getDate()} ${t.months[dt.getMonth()]} ${dt.getFullYear()}`;
}

export function weekdayName(iso) {
  const dt = parseDate(iso);
  if (!dt) return "";
  return t.weekdays[dt.getDay()];
}

// "17:00:00" → "17:00"
export function formatTime(time) {
  if (!time) return "";
  const parts = String(time).split(":");
  return `${parts[0].padStart(2, "0")}:${(parts[1] || "00").padStart(2, "0")}`;
}

export function statusLabel(s) {
  return t[`status_${s}`] || s;
}

// حالة المباراة: scheduled | live | finished
export function matchStatusLabel(s) {
  return t[`ms_${s}`] || s;
}
