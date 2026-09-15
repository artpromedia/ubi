/** First tab stop on every page; visible on focus; Enter moves focus to #main. */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:left-6 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-mk-forest focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-mk-on-forest"
    >
      Skip to content
    </a>
  );
}
