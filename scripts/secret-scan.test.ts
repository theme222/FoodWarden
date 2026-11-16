import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dir, "..");
const executable = process.platform === "win32" ? "gitleaks.exe" : "gitleaks";
const local = resolve(root, ".tools/gitleaks", executable);
const scanner = Bun.which("gitleaks") ?? local;

test("staged secret checks cover every subsystem and detect staged content even after working tree cleanup", () => {
  const fixture = mkdtempSync(join(tmpdir(), "foodwarden-secret-test-"));
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: fixture });
    expect(result.exitCode).toBe(0);
  };
  const scan = () =>
    Bun.spawnSync(
      [
        scanner,
        "git",
        "--staged",
        "--redact=100",
        "--no-banner",
        "--config",
        resolve(root, ".gitleaks.toml"),
        fixture,
      ],
      { cwd: fixture },
    );
  try {
    git("init", "--quiet");
    writeFileSync(join(fixture, "README.md"), "Safe public documentation\n");
    git("add", ".");
    expect(scan().exitCode).toBe(0);
    for (const subsystem of ["camera", "fridge", "door", "server"]) {
      mkdirSync(join(fixture, subsystem), { recursive: true });
      const file = join(fixture, subsystem, "config.txt");
      const fakeCredential = "AKIA" + "QWERTYUIOPASDFGH";
      writeFileSync(file, "AWS_ACCESS_KEY_ID=" + fakeCredential + "\n");
      git("add", `${subsystem}/config.txt`);
      writeFileSync(file, "Working tree no longer has a credential\n");
      expect(scan().exitCode).toBe(1);
      git("add", `${subsystem}/config.txt`);
      expect(scan().exitCode).toBe(0);
    }
    writeFileSync(
      join(fixture, "fridge", "secrets.h"),
      "private configuration\n",
    );
    git("add", ".");
    expect(scan().exitCode).toBe(1);
  } finally {
    // Only remove the exact temporary fixture created above.
    rmSync(fixture, { recursive: true, force: true });
  }
}, 30_000);
