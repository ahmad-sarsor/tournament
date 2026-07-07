// شاشة الترتيب — جدول لكل بيت + مفتاح الألوان + ملاحظة التحديث
function StandingsScreen() {
  const { StandingsTable, Button } = window.DesignSystem_d76f5e;
  // على الهواتف يبدأ مضغوطاً (كالأصل) — زر «تفاصيل أكثر» يوسّعه
  const [showExtra, setShowExtra] = React.useState(() => window.innerWidth > 560);
  const data = window.TP_DATA;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "10px" }}>
        <Button size="sm" onClick={() => setShowExtra(!showExtra)}>
          {showExtra ? "إخفاء" : "تفاصيل أكثر"}
        </Button>
      </div>
      {data.standings.map((b) => (
        <div className="standings-block" key={b.group}>
          <div className="standings-title">🛡️ {b.group}</div>
          <StandingsTable rows={b.rows} qualifiers={b.qualifiers} showExtra={showExtra} />
        </div>
      ))}
      <div className="legend">
        <span><span className="swatch" style={{ background: "var(--sun)" }}></span>المتصدّر</span>
        <span><span className="swatch"></span>تأهُّل (أول 2 من كل بيت)</span>
        <span>الترتيب: النقاط، ثم فارق الأهداف، ثم الأهداف المُسجَّلة</span>
      </div>
      <p className="page-sub" style={{ marginTop: "10px" }}>يُحدَّث الترتيب تلقائياً فور إدخال النتائج ⚡</p>
    </div>
  );
}
window.StandingsScreen = StandingsScreen;
