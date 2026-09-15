/**
 * Server-only. One iconic, licensed photograph per city, served from
 * /public/marketing/cities/{cityId}.jpg. A slide is emitted only when the file
 * exists on disk, so a missing photo means an omitted slide, never a broken
 * image. Attribution is rendered by CityCarousel from `credit` and must be
 * kept for openly licensed photographs (see THIRD_PARTY_NOTICES.md).
 */
import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";

import type { CitySlide } from "@/components/marketing/CityCarousel";
import { cityPath } from "@/lib/availability-pure";

interface CityImage {
  readonly src: string;
  readonly alt: string;
  readonly caption: string;
  readonly credit?: string;
  readonly creditHref?: string;
}

/**
 * Launch images. LOS: Omoeko Media, Wikimedia Commons, CC BY-SA 4.0.
 * ABV: Jeff Attaway, Wikimedia Commons, CC BY 2.0. Replace with UBI-owned
 * photography by swapping the file and dropping `credit`/`creditHref`.
 */
const CITY_IMAGES: Record<string, CityImage> = {
  LOS: {
    src: "/marketing/cities/los.jpg",
    alt: "Lekki-Ikoyi Link Bridge lit at night over Five Cowries Creek, Lagos",
    caption: "Lagos · Lekki-Ikoyi Link Bridge at night",
    credit: "Photo: Omoeko Media, Wikimedia Commons, CC BY-SA 4.0",
    creditHref:
      "https://commons.wikimedia.org/wiki/File:Lekki_link_bridge_at_Night.jpg",
  },
  ABV: {
    src: "/marketing/cities/abv.jpg",
    alt: "Zuma Rock monolith beside the Abuja to Kaduna road",
    caption: "Abuja · Zuma Rock, the gateway from Suleja",
    credit: "Photo: Jeff Attaway, Wikimedia Commons, CC BY 2.0",
    creditHref: "https://commons.wikimedia.org/wiki/File:Zuma_Rock.jpg",
  },
};

function imageExists(src: string): boolean {
  return existsSync(path.join(process.cwd(), "public", src));
}

export function citySlides(
  cities: readonly { id: string; name: string }[],
  withLinks = false,
): CitySlide[] {
  const slides: CitySlide[] = [];
  for (const city of cities) {
    const image = CITY_IMAGES[city.id];
    if (image === undefined || !imageExists(image.src)) continue;
    slides.push({
      cityId: city.id,
      cityName: city.name,
      src: image.src,
      alt: image.alt,
      caption: image.caption,
      ...(image.credit ? { credit: image.credit } : {}),
      ...(image.creditHref ? { creditHref: image.creditHref } : {}),
      ...(withLinks ? { href: cityPath(city) } : {}),
    });
  }
  return slides;
}
