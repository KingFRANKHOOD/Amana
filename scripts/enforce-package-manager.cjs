const userAgent = process.env.npm_config_user_agent ?? "";

if (!userAgent.startsWith("pnpm/")) {
  console.error(
    "Amana uses pnpm. Run `corepack enable` and install dependencies with `pnpm install`.",
  );
  process.exit(1);
}
