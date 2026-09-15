export type PillStatus = "live" | "not_yet" | "not_launched" | "launching";

/** Availability status as a WORD (never colour alone). */
export function StatusPill({
  status,
  label,
}: {
  status: PillStatus;
  label?: string;
}) {
  const text =
    label ??
    (status === "live"
      ? "Live"
      : status === "not_yet"
        ? "Not yet available"
        : status === "launching"
          ? "Launching · no date yet"
          : "Not launched");
  const tone =
    status === "live"
      ? "border-mk-mint-border bg-mk-mint text-mk-forest"
      : status === "launching"
        ? "border-mk-launch-border bg-mk-launch-bg text-mk-launch-ink"
        : "border-mk-border bg-mk-canvas text-mk-muted";
  return (
    <span
      data-status={status}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[.08em] ${tone}`}
    >
      {status === "live" ? (
        <span
          aria-hidden
          className="h-[7px] w-[7px] rounded-full bg-mk-green"
        />
      ) : null}
      {text}
    </span>
  );
}
