/**
 * تبويبات مقسّمة داخل كبسولة — تنقّل أقسام البطولة (البرنامج/الترتيب/الفرق).
 */
export interface TabsProps {
  /** العناصر: نص مباشر أو {id, label} */
  items: Array<string | { id: string; label: React.ReactNode }>;
  /** معرّف التبويب المفعّل */
  active?: string;
  onChange?: (id: string) => void;
}
export declare function Tabs(props: TabsProps): JSX.Element;
