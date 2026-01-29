import path from "node:path";
import { defineConfig } from "prisma/config";

/**
 * Prisma Configuration for UBI Database
 *
 * This config file is required for Prisma 7+ to specify database connection URLs
 * for migrations and other CLI operations.
 *
 * @see https://pris.ly/d/config-datasource
 */
export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, "prisma", "schema.prisma"),

  migrate: {
    async url() {
      // Use DATABASE_URL environment variable for migrations
      const url = process.env.DATABASE_URL;
      if (!url) {
        throw new Error(
          "DATABASE_URL environment variable is required for migrations",
        );
      }
      return url;
    },
  },
});
