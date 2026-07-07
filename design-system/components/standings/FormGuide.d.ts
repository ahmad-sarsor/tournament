/**
 * دليل الأداء: آخر ٥ نتائج للفريق كمربعات ملوّنة (ف أخضر / ت رمادي / خ أحمر).
 */
export interface FormGuideProps {
  /** النتائج بالترتيب الزمني: w فوز، d تعادل، l خسارة */
  results: Array<"w" | "d" | "l">;
}
export declare function FormGuide(props: FormGuideProps): JSX.Element;
