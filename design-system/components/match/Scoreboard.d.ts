/**
 * لوحة النتيجة الكبيرة — بطل صفحة المباراة: تدرّج أزرق، نتيجة ضخمة، حلقة حمراء عند البث.
 * @startingPoint section="Match" subtitle="لوحة نتيجة مباشرة بتدرّج أزرق" viewport="700x240"
 */
export interface ScoreboardProps {
  homeName: string;
  awayName: string;
  homeScore?: number | null;
  awayScore?: number | null;
  /** مباشر: حلقة حمراء + شارة نابضة مع الدقيقة */
  live?: boolean;
  /** الدقيقة الحالية للمباراة المباشرة */
  minute?: number;
  /** وقت المباراة إن لم تبدأ بعد ("17:00") */
  time?: string;
  /** إيموجي شعار الفريقين (افتراضي ⚽) */
  homeEmoji?: string;
  awayEmoji?: string;
}
export declare function Scoreboard(props: ScoreboardProps): JSX.Element;
