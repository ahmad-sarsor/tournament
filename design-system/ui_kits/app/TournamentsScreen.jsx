// شاشة قائمة البطولات — الصفحة الرئيسية
function TournamentsScreen({ onOpen }) {
  const { TournamentCard } = window.DesignSystem_d76f5e;
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">البطولات</h1>
        <p className="page-sub">اختر بطولة لعرض البرنامج والترتيب — تُحدَّث النتائج مباشرةً</p>
      </div>
      <div className="grid cols">
        {window.TP_DATA.tournaments.map((t) => (
          <TournamentCard
            key={t.id}
            name={t.name}
            emoji={t.emoji}
            status={t.status}
            description={t.description}
            meta={t.meta}
            done={t.done}
            total={t.total}
            onClick={() => onOpen(t)}
          />
        ))}
      </div>
    </div>
  );
}
window.TournamentsScreen = TournamentsScreen;
