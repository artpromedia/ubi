# Third-party notices for apps/marketing-site

## City hero photographs (`public/marketing/cities/`)

Both photographs are openly licensed. The licence requires attribution, which
the site renders as a visible credit on every slide (`CityCarousel`), linking to
the source page. Each file is a resized (max 1600 px wide) JPEG derivative of
the original; no other changes were made.

| File      | Subject                                          | Author       | Source                                                                 | Licence                                                       |
| --------- | ------------------------------------------------ | ------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| `los.jpg` | Lekki-Ikoyi Link Bridge at night, Lagos          | Omoeko Media | https://commons.wikimedia.org/wiki/File:Lekki_link_bridge_at_Night.jpg | CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/ |
| `abv.jpg` | Zuma Rock beside the Abuja to Kaduna road, Abuja | Jeff Attaway | https://commons.wikimedia.org/wiki/File:Zuma_Rock.jpg                  | CC BY 2.0, https://creativecommons.org/licenses/by/2.0/       |

The handoff named dotun55's "Lekki-ikoyi link bridge (20374823179).jpg"
(CC BY-SA 2.0) for Lagos; that original is 589 x 800 px, too small for a
1440 px hero, so a higher-resolution photograph of the same landmark under a
compatible licence was used instead. Replace either file with UBI-owned
photography by dropping in a new JPEG and removing the `credit` fields in
`src/lib/city-images.ts`.

## Fonts

Inter and Poppins are loaded through `next/font/google` (SIL Open Font
License 1.1) and self-hosted by the Next.js build.
