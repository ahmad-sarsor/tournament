// هيكل التطبيق — رأس + توجيه بسيط: قائمة البطولات ← بطولة (برنامج/ترتيب) ← مباراة
function AppShell() {
  const { Tabs, Badge, Bracket } = window.DesignSystem_d76f5e;
  const [tournament, setTournament] = React.useState(null);
  const [tab, setTab] = React.useState("schedule");
  const [match, setMatch] = React.useState(null);

  const goHome = () => { setTournament(null); setMatch(null); setTab("schedule"); };

  let body;
  if (!tournament) {
    body = <window.TournamentsScreen onOpen={(t) => { setTournament(t); setTab("schedule"); }} />;
  } else if (match) {
    body = <window.MatchScreen match={match} onBack={() => setMatch(null)} />;
  } else {
    body = (
      <div>
        <div className="page-head" style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span>{tournament.emoji}</span>{tournament.name}
          </h1>
          <Badge status={tournament.status} />
          <a style={{ marginInlineStart: "auto", fontWeight: 700, fontSize: ".85rem", cursor: "pointer" }} onClick={goHome}>كل البطولات ‹</a>
        </div>
        <Tabs
          items={[
            { id: "schedule", label: "البرنامج" },
            { id: "standings", label: "الترتيب" },
            { id: "knockout", label: "خروج المغلوب" },
          ]}
          active={tab}
          onChange={setTab}
        />
        {tab === "schedule" ? (
          <window.ScheduleScreen onOpenMatch={setMatch} />
        ) : tab === "standings" ? (
          <window.StandingsScreen />
        ) : (
          <div>
            <Bracket rounds={[
              { title: "ربع النهائي", matches: [
                { home: "خزيمة", away: "عمر بن الخطاب", hs: 3, as: 1, status: "finished" },
                { home: "أحفاد أبي ذر", away: "علي بن أبي طالب", hs: 2, as: 4, status: "finished" },
                { home: "بلال بن رباح", away: "عثمان بن عفان", hs: 2, as: 0, status: "finished" },
                { home: "سعد بن معاذ", away: "أحفاد الصديق", hs: 1, as: 2, status: "finished" },
              ]},
              { title: "نصف النهائي", matches: [
                { home: "خزيمة", away: "علي بن أبي طالب", hs: 2, as: 0, status: "finished" },
                { home: "بلال بن رباح", away: "أحفاد الصديق", hs: 1, as: 1, status: "live" },
              ]},
              { title: "النهائي", matches: [
                { home: "خزيمة", away: null },
              ]},
            ]} />
            <p className="page-sub" style={{ marginTop: "12px" }}>الفائز يتأهّل تلقائياً للجولة التالية عند إنهاء المباراة ⚡</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <header className="site-header">
        <div className="wrap">
          <a className="brand" style={{ cursor: "pointer" }} onClick={goHome}>
            <span className="logo" aria-hidden="true">🏆</span>
            <span>منصّة البطولات</span>
          </a>
          <span className="header-spacer"></span>
          <a className="header-auth">دخول / تسجيل</a>
          <button className="header-icon-btn" type="button" aria-label="الإعدادات" title="الإعدادات">⚙️</button>
        </div>
      </header>
      <main className="container">{body}</main>
      <footer className="site-footer">
        <div>منصّة إدارة البطولات · تُحدَّث النتائج مباشرةً</div>
      </footer>
    </div>
  );
}
window.AppShell = AppShell;
