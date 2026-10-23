import { IconAlert, IconCheck, IconInfo } from "./icons";

const styles = {
  info: "border-sky-100 bg-sky-50 text-ink",
  success: "border-sage-200 bg-sage-50 text-ink",
  warning: "border-warn/25 bg-warn-50 text-ink",
  error: "border-danger/30 bg-danger-50 text-ink",
};
const icons = { info: IconInfo, success: IconCheck, warning: IconAlert, error: IconAlert };
const iconColor = { info: "text-sky-700", success: "text-sage-700", warning: "text-warn", error: "text-danger" };

export function Notice({
  tone = "info",
  title,
  children,
  role,
}: {
  tone?: keyof typeof styles;
  title?: string;
  children?: React.ReactNode;
  role?: "alert" | "status";
}) {
  const Icon = icons[tone];
  return (
    <div role={role ?? (tone === "error" ? "alert" : undefined)} className={`flex gap-3 rounded-xl border px-4 py-3 ${styles[tone]}`}>
      <Icon className={`mt-0.5 shrink-0 ${iconColor[tone]}`} />
      <div className="min-w-0 text-[15px] leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}
