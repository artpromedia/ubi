/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ubi/ui", "@ubi/utils", "@ubi/api-client"],
  images: {
    domains: ["ubi.africa", "api.ubi.africa", "images.ubi.africa"],
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
