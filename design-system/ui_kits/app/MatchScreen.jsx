// شاشة المباراة — لوحة النتيجة + الأحداث (كما في صفحة المباراة الأصلية)
function MatchScreen({ match, onBack }) {
  const { Scoreboard, Button, EmptyState } = window.DesignSystem_d76f5e;
  const icons = { goal: "⚽", yellow: "🟨", red: "🟥" };
  const live = match.status === "live";
  return (
    <div style={{ maxWidth: "640px", margin: "0 auto" }}>
      <Button size="sm" onClick={onBack}>‹ البرنامج</Button>
      <Scoreboard
        homeName={match.home}
        awayName={match.away}
        homeScore={match.hs}
        awayScore={match.as}
        live={live}
        minute={match.minute}
        time={match.time}
      />
      <div className="mp-meta">
        <span>🛡️ {match.group}</span>
        <span>🕐 {match.time}</span>
      </div>
      <div className="mp-section">
        <div className="mp-title">الأحداث</div>
        {match.events && match.events.length ? (
          <div className="card card-pad">
            <div className="mp-events">
              {match.events.map((e, i) => (
                <div className={`ev-row${e.type === "red" ? " ev-row-red" : ""}`} key={i}>
                  <div className="ev-cell ev-cell-home">
                    {e.side === "home" ? (
                      <span className="ev-item">
                        <span className="ev-ico">{icons[e.type]}</span>
                        <span className="ev-player">{e.player}</span>
                      </span>
                    ) : null}
                  </div>
                  <span className="ev-min">{e.min}'</span>
                  <div className="ev-cell ev-cell-away">
                    {e.side === "away" ? (
                      <span className="ev-item">
                        <span className="ev-ico">{icons[e.type]}</span>
                        <span className="ev-player">{e.player}</span>
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState icon="⚽">لا توجد أحداث بعد</EmptyState>
        )}
      </div>
    </div>
  );
}
window.MatchScreen = MatchScreen;
