"use client";

import { useId, useState } from "react";

export interface FaqItem {
  readonly q: string;
  readonly a: string;
}

/**
 * Native disclosure: <h3><button aria-expanded aria-controls> and a sibling
 * region hidden with the `hidden` attribute, so it works before hydration.
 * Enter/Space toggle; no arrow-key roving (not a tablist).
 */
export function Faq({ items }: { items: readonly FaqItem[] }) {
  const base = useId();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div data-testid="marketing.faq" className="border-t border-mk-border">
      {items.map((item, index) => {
        const id = `${base}-${index}`;
        const isOpen = open === index;
        return (
          <div key={item.q} className="border-b border-mk-border">
            <h3 className="m-0">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`${id}-panel`}
                id={`${id}-btn`}
                onClick={() => setOpen(isOpen ? null : index)}
                className="flex min-h-[56px] w-full items-center justify-between gap-4 bg-transparent py-4 text-left text-[17px] font-semibold text-mk-forest"
              >
                {item.q}
                <span
                  aria-hidden
                  className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-full border-[1.5px] border-mk-forest text-lg leading-none"
                >
                  {isOpen ? "−" : "+"}
                </span>
              </button>
            </h3>
            <div
              id={`${id}-panel`}
              role="region"
              aria-labelledby={`${id}-btn`}
              hidden={!isOpen}
              className="mk-body max-w-[720px] pb-4"
            >
              {item.a}
            </div>
          </div>
        );
      })}
    </div>
  );
}
