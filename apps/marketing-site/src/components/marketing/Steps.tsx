export interface Step {
  readonly title: string;
  readonly body: string;
}

export function Steps({
  heading,
  items,
  tone = "cards",
  id = "steps-h",
}: {
  heading: string;
  items: readonly Step[];
  tone?: "cards" | "forest";
  id?: string;
}) {
  if (tone === "forest") {
    return (
      <section
        className="mk-on-forest rounded-card-lg bg-mk-forest p-6 text-mk-on-forest lg:p-9"
        aria-labelledby={id}
      >
        <h2 id={id} className="mk-h2 mb-5 !text-mk-on-forest">
          {heading}
        </h2>
        <ol className="grid gap-4">
          {items.map((step, index) => (
            <li key={step.title} className="flex gap-3.5">
              <span
                aria-hidden
                className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-full bg-mk-green text-sm font-bold text-mk-green-ink"
              >
                {index + 1}
              </span>
              <div>
                <div className="font-semibold">{step.title}</div>
                <div className="text-[14.5px] leading-relaxed text-mk-on-forest-muted">
                  {step.body}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>
    );
  }
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mk-h2 mb-5">
        {heading}
      </h2>
      <ol
        data-testid="marketing.drive.steps"
        className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-5"
      >
        {items.map((step, index) => {
          const last = index === items.length - 1;
          return (
            <li
              key={step.title}
              className={`${
                last
                  ? "bg-mk-forest text-mk-on-forest"
                  : "border border-mk-border bg-mk-surface"
              } rounded-[18px] p-5`}
            >
              <div className="mb-2 text-[13px] font-bold text-mk-green-deep">
                {String(index + 1).padStart(2, "0")}
              </div>
              <div
                className={`mb-1.5 text-[17px] font-semibold leading-tight ${
                  last ? "" : "text-mk-forest"
                }`}
              >
                {step.title}
              </div>
              <div
                className={`text-sm leading-relaxed ${
                  last ? "text-mk-on-forest-muted" : "text-mk-muted"
                }`}
              >
                {step.body}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
