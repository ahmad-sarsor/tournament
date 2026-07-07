/**
 * زر المنصّة. الأساسي أزرق بظل صلب «قابل للكبس»؛ sun ذهبي للأفعال الاحتفالية.
 * @startingPoint section="Core" subtitle="أزرار المنصّة بكل الأنواع" viewport="700x300"
 */
export interface ButtonProps {
  /** نوع الزر */
  variant?: "default" | "primary" | "sun" | "outline" | "danger";
  /** حجم مصغّر */
  size?: "sm";
  /** يمتد بعرض الحاوية */
  block?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}
export declare function Button(props: ButtonProps): JSX.Element;
