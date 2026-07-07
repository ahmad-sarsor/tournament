/**
 * إشعار عائم على شكل كبسولة — «تم الحفظ» أخضر، أخطاء حمراء.
 */
export interface ToastProps {
  /** ok أخضر، err أحمر، بدون = داكن */
  kind?: "ok" | "err";
  children?: React.ReactNode;
}
export declare function Toast(props: ToastProps): JSX.Element;
