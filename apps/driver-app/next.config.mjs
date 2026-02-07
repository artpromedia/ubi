/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ubi/ui", "@ubi/utils", "@ubi/api-client"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  experimental: {
    optimizePackageImports: ["@ubi/ui", "lucide-react"],
  },
};

export default nextConfig;
