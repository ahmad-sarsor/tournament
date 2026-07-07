/**
 * صف مباراة مضغوط: وقت | مضيف — نتيجة — ضيف | سهم. النتيجة في المنتصف تماماً.
 * @startingPoint section="Match" subtitle="صف مباراة: مجدولة، مباشرة، منتهية" viewport="700x260"
 */
export interface MatchRowProps {
  /** وقت المباراة "17:00" — يظهر × إن غاب */
  time?: string;
  /** اسم البيت (يظهر تحت الوقت) */
  group?: string;
  homeName: string;
  awayName: string;
  homeScore?: number | null;
  awayScore?: number | null;
  /** حالة المباراة كما في الكود: مجدولة/مباشر/منتهية */
  status?: "scheduled" | "live" | "finished";
  /** يجعل الصف قابلاً للنقر مع سهم */
  onClick?: () => void;
}
export declare function MatchRow(props: MatchRowProps): JSX.Element;
