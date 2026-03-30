import { execFileSync } from "child_process";
import path from "path";

const runDb = process.env.RUN_DATABASE_TESTS === "1";
const runMigrations = process.env.PRISMA_RUN_MIGRATIONS === "1";
const backendRoot = path.resolve(__dirname, "..", "..");
const schemaPath = path.join(backendRoot, "prisma", "schema.prisma");

function runPrismaCommand(args: string[]): string {
  return execFileSync("npx", ["prisma", ...args, "--schema", schemaPath], {
    cwd: backendRoot,
    env: process.env,
    encoding: "utf8",
  });
}

(runDb ? describe : describe.skip)("Prisma schema integrity", () => {
  it("validates the Prisma schema", () => {
    const output = runPrismaCommand(["validate"]);

    expect(output).toContain("schema");
  });

  it("reports migration status for the isolated test database", () => {
    const output = runPrismaCommand(["migrate", "status"]);

    expect(output.toLowerCase()).toContain("database schema");
  });

  (runMigrations ? it : it.skip)("can apply migrations against the isolated test database", () => {
    const output = runPrismaCommand(["migrate", "deploy"]);

    expect(output.toLowerCase()).toContain("migrations");
  });
});
