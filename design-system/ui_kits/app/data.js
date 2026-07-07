// بيانات عرض واقعية — من seed-data.js في الريبو الأصلي (بطولة «أحفاد الصحابة»)
window.TP_DATA = {
  tournaments: [
    {
      id: "t1", name: "أحفاد الصحابة", emoji: "🏆", status: "active",
      description: "برنامج مباريات البطولة",
      meta: ["📅 03/07 – 13/07", "👥 19 فريقاً", "🛡️ 4 بيوت"],
      done: 14, total: 36,
    },
    {
      id: "t2", name: "بطولة الأحياء الصيفية", emoji: "☀️", status: "upcoming",
      description: "دوري الصيف للأشبال",
      meta: ["📅 20/07 – 01/08", "👥 12 فريقاً", "🛡️ 3 بيوت"],
      done: 0, total: 18,
    },
    {
      id: "t3", name: "دوري الربيع", emoji: "🌱", status: "finished",
      description: "انتهت — البطل: صقور الحي",
      meta: ["📅 10/03 – 02/04", "👥 8 فرق", "🛡️ 2 بيوت"],
      done: 12, total: 12,
    },
  ],

  groups: ["كل البيوت", "البيت الأول", "البيت الثاني", "البيت الثالث", "البيت الرابع"],

  // اليوم: مباراة مباشرة + برنامج ثلاثة أيام (من جدول الإكسل الأصلي)
  days: [
    {
      day: "الإثنين", date: "06/07/2026", matches: [
        { time: "17:00", group: "البيت الأول", home: "خزيمة", away: "رافع الظاهري", hs: 4, as: 0, status: "finished" },
        { time: "18:00", group: "البيت الثاني", home: "بلال بن رباح", away: "عمر بن الخطاب", hs: 2, as: 2, status: "live", minute: 38,
          events: [
            { min: 9,  type: "goal",   player: "أنس",  side: "home" },
            { min: 17, type: "goal",   player: "كريم", side: "away" },
            { min: 24, type: "yellow", player: "ياسر", side: "away" },
            { min: 31, type: "goal",   player: "أنس",  side: "home" },
            { min: 36, type: "goal",   player: "مهند", side: "away" },
          ] },
        { time: "19:00", group: "البيت الثالث", home: "سعد بن معاذ", away: "أسد الله", hs: null, as: null, status: "scheduled" },
        { time: "20:00", group: "البيت الرابع", home: "عمر بن العاص", away: "أحفاد الصديق", hs: null, as: null, status: "scheduled" },
      ],
    },
    {
      day: "الثلاثاء", date: "07/07/2026", matches: [
        { time: "17:00", group: "البيت الأول", home: "أسامة بن زيد", away: "عثمان بن عفان", hs: null, as: null, status: "scheduled" },
        { time: "18:00", group: "البيت الثاني", home: "القعقاع", away: "خالد بن الوليد", hs: null, as: null, status: "scheduled" },
        { time: "19:00", group: "البيت الثالث", home: "أحفاد أبي ذر", away: "ذو النورين", hs: null, as: null, status: "scheduled" },
      ],
    },
    {
      day: "الأحد", date: "05/07/2026", matches: [
        { time: "17:00", group: "البيت الأول", home: "عثمان بن عفان", away: "حذيفة بن اليمان", hs: 3, as: 1, status: "finished" },
        { time: "18:00", group: "البيت الثاني", home: "القعقاع", away: "عمر بن الخطاب", hs: 1, as: 1, status: "finished" },
        { time: "19:00", group: "البيت الثالث", home: "أحفاد أبي ذر", away: "عبدالله بن مسعود", hs: 2, as: 3, status: "finished" },
        { time: "20:00", group: "البيت الرابع", home: "علي بن أبي طالب", away: "سيف الله المسلول", hs: 5, as: 2, status: "finished" },
      ],
    },
  ],

  standings: [
    {
      group: "البيت الأول", qualifiers: 2, rows: [
        { rank: 1, name: "خزيمة", played: 3, won: 3, drawn: 0, lost: 0, gf: 9, ga: 2, points: 9, form: ["w", "w", "w"] },
        { rank: 2, name: "عثمان بن عفان", played: 3, won: 2, drawn: 0, lost: 1, gf: 6, ga: 4, points: 6, form: ["w", "l", "w"] },
        { rank: 3, name: "أسامة بن زيد", played: 3, won: 1, drawn: 1, lost: 1, gf: 4, ga: 4, points: 4, form: ["d", "w", "l"] },
        { rank: 4, name: "حذيفة بن اليمان", played: 3, won: 0, drawn: 1, lost: 2, gf: 2, ga: 6, points: 1, form: ["l", "d", "l"] },
        { rank: 5, name: "رافع الظاهري", played: 2, won: 0, drawn: 0, lost: 2, gf: 0, ga: 5, points: 0, form: ["l", "l"] },
      ],
    },
    {
      group: "البيت الثاني", qualifiers: 2, rows: [
        { rank: 1, name: "بلال بن رباح", played: 2, won: 1, drawn: 1, lost: 0, gf: 4, ga: 2, points: 4, form: ["w", "d"] },
        { rank: 2, name: "عمر بن الخطاب", played: 3, won: 1, drawn: 1, lost: 1, gf: 4, ga: 4, points: 4, form: ["l", "d", "w"] },
        { rank: 3, name: "القعقاع", played: 2, won: 1, drawn: 1, lost: 0, gf: 3, ga: 2, points: 4, form: ["d", "w"] },
        { rank: 4, name: "خالد بن الوليد", played: 3, won: 0, drawn: 1, lost: 2, gf: 2, ga: 5, points: 1, form: ["l", "l", "d"] },
      ],
    },
  ],

  stats: [
    { icon: "🏟️", value: "14", label: "مباريات لُعبت" },
    { icon: "⚽", value: "43", label: "الأهداف" },
    { icon: "📈", value: "3.1", label: "معدّل التهديف" },
    { icon: "👟", value: "أنس", label: "أفضل هدّاف" },
  ],
};
