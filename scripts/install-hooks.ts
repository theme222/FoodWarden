import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
const result = Bun.spawnSync(
  ["git", "rev-parse", "--git-path", "hooks/pre-commit"],
  { cwd: root },
);
if (result.exitCode !== 0) throw new Error("Cannot locate Git hooks.");
const hook = resolve(root, result.stdout.toString().trim());
if (existsSync(hook)) {
  const existing = readFileSync(hook, "utf8");
  if (
    !existing.includes("FoodWarden: Lefthook launcher") &&
    !existing.includes("lefthook") &&
    existing.trim() !== "# placeholder"
  ) {
    throw new Error(
      "An existing pre-commit hook must be integrated manually; it was not overwritten.",
    );
  }
}
writeFileSync(
  hook,
  `#!/bin/sh
# FoodWarden: Lefthook launcher
repo_root=$(git rev-parse --show-toplevel) || exit 1
cd "$repo_root/server" || exit 1
exec bun run --silent lefthook run pre-commit --no-auto-install "$@"
`,
);
if (process.platform !== "win32") chmodSync(hook, 0o755);
console.log("Installed repository-wide Lefthook pre-commit launcher.");
