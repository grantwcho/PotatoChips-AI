import { spawnSync } from "node:child_process";

const schemaPaths = process.env.PRISMA_SCHEMA_PATH
  ? [process.env.PRISMA_SCHEMA_PATH]
  : ["prisma/schema.postgresql.prisma", "prisma/schema.prisma"];

for (const schemaPath of schemaPaths) {
  const result = spawnSync(
    process.execPath,
    ["./node_modules/prisma/build/index.js", "generate", "--schema", schemaPath],
    {
      stdio: "inherit",
      env: process.env,
    }
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
