/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable React Strict Mode for better development experience
  reactStrictMode: true,

  // Ignore ESLint during builds (run separately)
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Transpile workspace packages
  transpilePackages: ["@ubi/ui", "@ubi/utils", "@ubi/api-client", "@ubi/i18n"],

  // Image optimization configuration
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.ubi.africa",
      },
      {
        protocol: "https",
        hostname: "ubi-assets.s3.af-south-1.amazonaws.com",
      },
    ],
    // Optimize for low-bandwidth African networks
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24, // 24 hours
  },

  // Enable experimental features
  experimental: {
    // Enable Turbopack for faster development
    // turbo: {},

    // Optimize package imports
    optimizePackageImports: [
      "@ubi/ui",
      "@tanstack/react-query",
      "framer-motion",
      "lucide-react",
    ],
  },

  // Note: i18n configuration removed - App Router uses a different approach
  // See: https://nextjs.org/docs/app/building-your-application/routing/internationalization

  // Headers for security and performance
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), microphone=(), camera=()",
          },
        ],
      },
      {
        // Cache static assets aggressively
        source: "/static/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },

  // Rewrites for API proxy (useful for development)
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        {
          source: "/api/v1/:path*",
          destination: `${process.env.API_GATEWAY_URL || "http://localhost:4000"}/v1/:path*`,
        },
      ],
      fallback: [],
    };
  },

  // Environment variables exposed to the browser
  env: {
    NEXT_PUBLIC_APP_NAME: "UBI",
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version,
  },

  // Output configuration for deployment
  // Note: standalone disabled on Windows due to symlink permission issues
  // Enable in production/CI environment
  // output: "standalone",

  // Disable x-powered-by header for security
  poweredByHeader: false,

  // Enable compression
  compress: true,

  // Generate ETags for caching
  generateEtags: true,

  // Logging configuration
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
};

export default nextConfig;
