/**
 * قائمة منسدلة للتصفية — شريط الفلاتر (بيت/فريق/يوم) فوق البرنامج.
 */
export interface SelectProps {
  /** الخيارات: نص مباشر أو {value, label} */
  options: Array<string | { value: string; label: string }>;
  value?: string;
  onChange?: (value: string) => void;
}
export declare function Select(props: SelectProps): JSX.Element;
