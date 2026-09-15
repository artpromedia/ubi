"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";

interface MenuLink {
  readonly href: string;
  readonly label: string;
  readonly current?: boolean;
}

/**
 * Board 24b/24e: dialog sheet with focus trap, Esc, focus return, scroll lock,
 * reduced motion. Links only to routes that exist.
 */
export function MobileMenu({
  links,
  cta,
}: {
  links: readonly MenuLink[];
  cta: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLAnchorElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    first.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || dialog.current === null) return;
      const focusable =
        dialog.current.querySelectorAll<HTMLElement>("a,button");
      const firstEl = focusable[0];
      const lastEl = focusable[focusable.length - 1];
      if (firstEl === undefined || lastEl === undefined) return;
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      button.current?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls="mk-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        data-testid="marketing.menu.button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-11 w-11 flex-col items-center justify-center gap-[5px] rounded-[10px] border-[1.5px] border-mk-forest lg:hidden"
      >
        <span className="h-0.5 w-[18px] bg-mk-forest" />
        <span className="h-0.5 w-[18px] bg-mk-forest" />
      </button>
      {open ? (
        <div
          ref={dialog}
          id="mk-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className="mk-motion fixed inset-0 z-50 flex flex-col bg-mk-canvas p-5 motion-safe:animate-slideIn"
        >
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-target rounded-[10px] px-3 font-semibold text-mk-forest"
            >
              Close
            </button>
          </div>
          <nav aria-label="Primary" className="mt-4 flex flex-col">
            {links.map((link, index) => (
              <Link
                key={link.href}
                ref={index === 0 ? first : undefined}
                href={link.href}
                aria-current={link.current ? "page" : undefined}
                onClick={() => setOpen(false)}
                className="min-h-[52px] border-b border-mk-border py-3 text-lg font-semibold text-mk-forest"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="mt-6 flex flex-col gap-2.5">{cta}</div>
        </div>
      ) : null}
    </>
  );
}
