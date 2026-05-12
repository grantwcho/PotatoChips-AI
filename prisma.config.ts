import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: process.env.PRISMA_SCHEMA_PATH || "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
