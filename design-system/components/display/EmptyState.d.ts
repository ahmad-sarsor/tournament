/**
 * حالة فارغة: إيموجي كبير فوق رسالة قصيرة — نمط الكود الأصلي للقوائم الخالية.
 */
export interface EmptyStateProps {
  /** الإيموجي (📅 برنامج، 🏆 خروج مغلوب، 🎯 متوقّعون) */
  icon?: string;
  children?: React.ReactNode;
}
export declare function EmptyState(props: EmptyStateProps): JSX.Element;
