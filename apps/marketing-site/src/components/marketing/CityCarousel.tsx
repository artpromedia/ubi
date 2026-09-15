"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export interface CitySlide {
  readonly cityId: string;
  readonly cityName: string;
  readonly src: string;
  readonly alt: string;
  readonly caption: string;
  readonly href?: string;
  readonly credit?: string;
  readonly creditHref?: string;
}

const AUTO_ADVANCE_MS = 6_000;

/**
 * Boards 24a/24b/24f. One licensed photo per city. Opens on `activeCityId`.
 * Arrows, dots (tablist), swipe (≥ 40 px); Left/Right keys when the region has
 * focus. Auto-advance only when `auto` (the cities index): 6 s, paused on
 * hover/focus, off under prefers-reduced-motion. Slides are photos, never
 * links, except the caption on /cities.
 */
export function CityCarousel({
  slides,
  activeCityId,
  auto = false,
  className = "",
}: {
  slides: readonly CitySlide[];
  activeCityId: string;
  auto?: boolean;
  className?: string;
}) {
  const start = Math.max(
    0,
    slides.findIndex((slide) => slide.cityId === activeCityId),
  );
  const [index, setIndex] = useState(start);
  const [paused, setPaused] = useState(false);
  const touchX = useRef<number | null>(null);
  const count = slides.length;

  useEffect(() => {
    if (!auto || paused || count < 2) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return undefined;
    }
    const timer = window.setInterval(
      () => setIndex((current) => (current + 1) % count),
      AUTO_ADVANCE_MS,
    );
    return () => window.clearInterval(timer);
  }, [auto, paused, count]);

  if (count === 0) return null;

  const go = (delta: number): void =>
    setIndex((current) => (current + delta + count) % count);

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label="UBI cities"
      data-testid="marketing.carousel"
      data-auto={auto ? "true" : "false"}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") go(-1);
        if (event.key === "ArrowRight") go(1);
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={(event) => {
        touchX.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        if (touchX.current === null) return;
        const end = event.changedTouches[0]?.clientX;
        if (end !== undefined) {
          const dx = end - touchX.current;
          if (Math.abs(dx) >= 40) go(dx < 0 ? 1 : -1);
        }
        touchX.current = null;
      }}
      className={`relative overflow-hidden rounded-[20px] border border-mk-mint-border bg-mk-mint lg:rounded-[28px] ${className}`}
    >
      {slides.map((slide, position) => {
        const active = position === index;
        return (
          <figure
            key={slide.cityId}
            aria-hidden={!active}
            data-testid="marketing.carousel.slide"
            data-city={slide.cityId}
            data-active={active ? "true" : "false"}
            className={`absolute inset-0 m-0 transition-opacity duration-500 motion-reduce:transition-none ${
              active ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            <Image
              src={slide.src}
              alt={slide.alt}
              fill
              sizes="(min-width: 1024px) 50vw, 100vw"
              priority={position === start}
              className="object-cover"
            />
            <figcaption className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-b from-transparent to-mk-forest/75 px-5 pb-10 pt-11 text-sm font-semibold text-mk-on-forest">
              {slide.href ? (
                <Link
                  href={slide.href}
                  tabIndex={active ? 0 : -1}
                  className="text-mk-on-forest underline-offset-[3px] hover:underline"
                >
                  {slide.caption}
                </Link>
              ) : (
                <span>{slide.caption}</span>
              )}
              <span className="rounded-full border border-mk-on-forest/40 bg-mk-on-forest/15 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[.08em]">
                {slide.cityName}
              </span>
            </figcaption>
            {slide.credit ? (
              <small
                data-testid="marketing.carousel.credit"
                className="absolute bottom-3 left-3 rounded bg-mk-forest/55 px-2 py-1 text-[10.5px] text-mk-on-forest"
              >
                {slide.creditHref ? (
                  <a
                    href={slide.creditHref}
                    rel="noopener license"
                    tabIndex={active ? 0 : -1}
                    className="underline-offset-2 hover:underline"
                  >
                    {slide.credit}
                  </a>
                ) : (
                  slide.credit
                )}
              </small>
            ) : null}
          </figure>
        );
      })}
      {count > 1 ? (
        <>
          <div className="pointer-events-none absolute inset-x-3.5 top-1/2 flex -translate-y-1/2 justify-between">
            <button
              type="button"
              aria-label="Previous city"
              onClick={() => go(-1)}
              className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full bg-mk-canvas/95 text-lg font-semibold text-mk-forest shadow"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next city"
              onClick={() => go(1)}
              className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full bg-mk-canvas/95 text-lg font-semibold text-mk-forest shadow"
            >
              ›
            </button>
          </div>
          <div
            role="tablist"
            aria-label="Choose a city"
            className="absolute right-3.5 top-3.5 flex items-center gap-1.5 rounded-full bg-mk-forest/55 px-2.5 py-2"
          >
            {slides.map((slide, position) => (
              <button
                key={slide.cityId}
                role="tab"
                type="button"
                aria-selected={position === index}
                aria-label={slide.cityName}
                onClick={() => setIndex(position)}
                className={`h-2 rounded-full transition-all ${
                  position === index
                    ? "w-[22px] bg-mk-green"
                    : "w-2 bg-mk-on-forest/60"
                }`}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
