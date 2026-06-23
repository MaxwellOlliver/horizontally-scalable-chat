import { useId, type InputHTMLAttributes } from "react";

/** Labeled text input in the Relay language (square-ish, hairline, rose focus). */
export function TextField({
  label,
  hint,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-fg-muted">
        {label}
      </label>
      <input
        id={id}
        className={`h-12 w-full rounded-lg border border-line bg-ink px-3 text-sm text-fg placeholder:text-fg-faint transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 ${className}`}
        {...props}
      />
      {hint && <p className="text-[12px] text-fg-faint">{hint}</p>}
    </div>
  );
}
