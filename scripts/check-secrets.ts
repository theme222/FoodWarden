import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  lstatSync,
  rmSync,
} from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dir, "..");
const local = resolve(
  root,
  ".tools/gitleaks",
  process.platform === "win32" ? "gitleaks.exe" : "gitleaks",
);
const binary = existsSync(local) ? local : Bun.which("gitleaks");
if (!binary) {
  console.error(
    "Gitleaks is required. On Windows run: pwsh -File scripts/install-gitleaks.ps1; on other platforms install Gitleaks 8.30.1, then retry.",
  );
  process.exit(2);
}
const flags = [
  "--redact=100",
  "--no-banner",
  "--config",
  resolve(root, ".gitleaks.toml"),
];
let exitCode = 2;
if (process.argv.includes("--all")) {
  const snapshot = mkdtempSync(resolve(tmpdir(), "foodwarden-secrets-"));
  try {
    const listing = Bun.spawnSync(
      ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: root },
    );
    if (listing.exitCode !== 0)
      throw new Error("Cannot enumerate repository files.");
    for (const path of listing.stdout.toString().split("\0").filter(Boolean)) {
      const source = resolve(root, path);
      if (!existsSync(source) || !lstatSync(source).isFile()) continue;
      const destination = resolve(snapshot, path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }
    const reportPath = resolve(snapshot, "gitleaks-report.json");
    exitCode =
      Bun.spawnSync(
        [
          binary,
          "dir",
          ...flags,
          "--report-format",
          "json",
          "--report-path",
          reportPath,
          snapshot,
        ],
        { cwd: root, stdout: "inherit", stderr: "inherit" },
      ).exitCode ?? 2;
    if (exitCode === 1 && existsSync(reportPath)) {
      const findings = JSON.parse(readFileSync(reportPath, "utf8")) as Array<{
        RuleID: string;
        File: string;
        StartLine: number;
      }>;
      for (const finding of findings)
        console.error(
          `${finding.RuleID}: ${relative(snapshot, finding.File)}:${finding.StartLine}`,
        );
    }
  } finally {
    // Remove only the freshly created temporary snapshot, never the repository.
    rmSync(snapshot, { recursive: true, force: true });
  }
} else {
  exitCode =
    Bun.spawnSync([binary, "git", "--staged", ...flags, root], {
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
    }).exitCode ?? 2;
}
process.exit(exitCode);
