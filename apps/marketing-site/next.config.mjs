/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ubi/ui", "@ubi/utils", "@ubi/i18n"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "cdn.ubi.africa",
      },
    ],
  },
  async redirects() {
    return [
      // Redirect old URLs to new ones
      {
        source: "/drivers",
        destination: "/drive",
        permanent: true,
      },
      {
        source: "/restaurants",
        destination: "/restaurant",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
