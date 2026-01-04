/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@ubi/ui", "@ubi/utils", "@ubi/api-client"],
  experimental: {
    optimizePackageImports: ["@ubi/ui", "lucide-react", "recharts"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.ubi.africa",
      },
    ],
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/dashboard",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
