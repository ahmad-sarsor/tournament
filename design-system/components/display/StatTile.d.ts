/**
 * مربّع إحصائية: إيموجي + رقم أزرق كبير + تسمية — شبكة stat-tiles من ٤ أعمدة.
 */
export interface StatTileProps {
  /** إيموجي فوق الرقم (⚽ 🥅 📊 👟) */
  icon?: string;
  value: React.ReactNode;
  label: string;
}
export declare function StatTile(props: StatTileProps): JSX.Element;
