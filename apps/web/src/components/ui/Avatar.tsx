import { initials } from "../../lib/format";

/** Initial-based avatar. Override size/typography via `className`. */
export function Avatar({
  name,
  className = "h-9 w-9 text-[11px]",
}: {
  name: string | null;
  className?: string;
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-panel-2 font-semibold text-fg-muted ${className}`}
    >
      {initials(name)}
    </span>
  );
}
