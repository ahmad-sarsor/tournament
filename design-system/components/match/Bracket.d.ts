/**
 * شجرة خروج المغلوب: عمود لكل جولة (ربع/نصف/نهائي)، الفائز مُبرز، النهائي ذهبي بكأس 🏆.
 * @startingPoint section="Match" subtitle="شجرة خروج المغلوب — النهائي ذهبي" viewport="700x360"
 */
export interface BracketMatch {
  /** اسم الفريق — اتركه فارغاً لعرض «يُحدَّد لاحقاً» */
  home?: string | null;
  away?: string | null;
  hs?: number | null;
  as?: number | null;
  status?: "scheduled" | "live" | "finished";
}
export interface BracketRound {
  /** «ربع النهائي» / «نصف النهائي» / «النهائي» */
  title: string;
  matches: BracketMatch[];
}
export interface BracketProps {
  /** الجولات بالترتيب — الأخيرة تُعامَل كنهائي ذهبي */
  rounds: BracketRound[];
}
export declare function Bracket(props: BracketProps): JSX.Element;
