/**
 * جدول ترتيب بيت واحد — المتصدّر ذهبي، المتأهّلون بشريط أزرق، النقاط بخط العرض.
 * @startingPoint section="Standings" subtitle="جدول ترتيب كامل بصفوف تأهّل وتتويج" viewport="700x420"
 */
export interface StandingRow {
  rank: number;
  name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  /** الأهداف له/عليه — يظهران مع showExtra */
  gf?: number;
  ga?: number;
  /** الفارق — يُحسب من gf/ga إن غاب */
  gd?: number;
  points: number;
  /** آخر النتائج لعمود «السجل» */
  form?: Array<"w" | "d" | "l">;
}
export interface StandingsTableProps {
  rows: StandingRow[];
  /** عدد المتأهّلين من البيت (صفوف مميّزة بشريط أزرق) — افتراضي 2 كما في الكود */
  qualifiers?: number;
  /** إظهار الأعمدة الإضافية: له/عليه/الفارق/السجل */
  showExtra?: boolean;
  /** ميداليات 🥇🥈🥉 بدل أرقام المراكز الثلاثة الأولى (نمط لوحة المتوقّعين) */
  medals?: boolean;
}
export declare function StandingsTable(props: StandingsTableProps): JSX.Element;
