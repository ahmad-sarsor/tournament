/**
 * شارة حالة على شكل حبّة دواء: حالات البطولة والمباراة، والذهبية للتتويج.
 */
export interface BadgeProps {
  /** الحالة — تحدد اللون والنص الافتراضي. live تنبض تلقائياً */
  status?: "upcoming" | "active" | "finished" | "live" | "gold";
  /** نص بديل للنص الافتراضي للحالة */
  children?: React.ReactNode;
  /** إظهار نقطة قبل النص (تلقائي في live) */
  dot?: boolean;
}
export declare function Badge(props: BadgeProps): JSX.Element;
