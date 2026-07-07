// شاشة البرنامج — فلاتر البيت/الفريق/اليوم (كما في الأصل) + مباريات مجمّعة بالأيام
function ScheduleScreen({ onOpenMatch }) {
  const { MatchRow, Select, Button, EmptyState } = window.DesignSystem_d76f5e;
  const [group, setGroup] = React.useState("كل البيوت");
  const [team, setTeam] = React.useState("كل الفرق");
  const [day, setDay] = React.useState("كل الأيام");
  const data = window.TP_DATA;

  // قائمة الفرق تُشتق من مباريات البيت المُصفّى (فرق البيت فقط)
  const teams = React.useMemo(() => {
    const s = new Set();
    data.days.forEach((d) => d.matches.forEach((m) => {
      if (group === "كل البيوت" || m.group === group) { s.add(m.home); s.add(m.away); }
    }));
    return ["كل الفرق", ...[...s].sort((a, b) => a.localeCompare(b, "ar"))];
  }, [group]);

  const days = ["كل الأيام", ...data.days.map((d) => `${d.day} ${d.date}`)];
  const filtered = data.days
    .filter((d) => day === "كل الأيام" || `${d.day} ${d.date}` === day)
    .map((d) => ({
      ...d,
      matches: d.matches.filter((m) =>
        (group === "كل البيوت" || m.group === group) &&
        (team === "كل الفرق" || m.home === team || m.away === team)
      ),
    }))
    .filter((d) => d.matches.length);

  const hasFilter = group !== "كل البيوت" || team !== "كل الفرق" || day !== "كل الأيام";
  const clearAll = () => { setGroup("كل البيوت"); setTeam("كل الفرق"); setDay("كل الأيام"); };
  const pickGroup = (g) => { setGroup(g); setTeam("كل الفرق"); };

  return (
    <div>
      <div className="filter-selects">
        <Select options={data.groups} value={group} onChange={pickGroup} aria-label="تصفية حسب البيت" />
        <Select options={teams} value={team} onChange={setTeam} aria-label="تصفية حسب الفريق" />
        <Select options={days} value={day} onChange={setDay} aria-label="تصفية حسب اليوم" />
        {hasFilter ? <Button size="sm" onClick={clearAll}>مسح الفلاتر</Button> : null}
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon="📅">لا توجد مباريات بعد</EmptyState>
      ) : filtered.map((d) => (
        <div className="day-group" key={d.date}>
          <div className="day-head">
            <span>{d.day}</span>
            <span className="date">{d.date}</span>
            <span className="line"></span>
          </div>
          {d.matches.map((m, i) => (
            <MatchRow
              key={i}
              time={m.time}
              group={m.group}
              homeName={m.home}
              awayName={m.away}
              homeScore={m.hs}
              awayScore={m.as}
              status={m.status}
              onClick={() => onOpenMatch(m)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
window.ScheduleScreen = ScheduleScreen;
