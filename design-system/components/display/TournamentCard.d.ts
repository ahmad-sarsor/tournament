/**
 * بطاقة بطولة في القائمة الرئيسية — ترتفع وتميل قليلاً عند التحويم، مع شريط تقدّم المباريات.
 * @startingPoint section="Cards" subtitle="بطاقة بطولة مع تقدّم المباريات" viewport="700x260"
 */
export interface TournamentCardProps {
  name: string;
  /** إيموجي البطولة (افتراضي 🏆) */
  emoji?: string;
  description?: string;
  /** حالة البطولة كما في الكود */
  status?: "upcoming" | "active" | "finished";
  /** أسطر بيانات صغيرة: تواريخ، عدد الفرق… */
  meta?: React.ReactNode[];
  /** المباريات المنتهية / الكل — يرسمان شريط التقدّم */
  done?: number;
  total?: number;
  onClick?: () => void;
}
export declare function TournamentCard(props: TournamentCardProps): JSX.Element;
