/**
 * رقاقة تصفية قابلة للنقر — صف «كل البيوت / البيت الأول…» فوق القوائم.
 */
export interface ChipProps {
  /** مفعّلة (أزرق ممتلئ) */
  active?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}
export declare function Chip(props: ChipProps): JSX.Element;
