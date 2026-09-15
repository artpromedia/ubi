import { reportUnsetDestinations } from "./src/lib/destination-env.mjs";

// Build must log unset destinations (handoff, DestinationLink contract).
reportUnsetDestinations();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ubi/ui", "@ubi/utils"],
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.ubi.africa",
      },
    ],
  },
  async redirects() {
    return [
      // Legacy paths from the old site.
      {
        source: "/drivers",
        destination: "/drive",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
