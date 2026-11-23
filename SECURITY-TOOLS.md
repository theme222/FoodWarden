# Repository secret protection

The root [lefthook.yml](lefthook.yml) runs [scripts/check-secrets.ts](scripts/check-secrets.ts) on staged Git content across `camera/`, `fridge/`, `door/`, `server/`, and root files. [.gitleaks.toml](.gitleaks.toml) extends Gitleaks' built-in rules and adds a rule blocking private environment and device secret files. Example templates are exempt only from that filename rule; actual credentials inside examples are still scanned by the default rules.

## Install on each clone

```powershell
# From repository root on Windows x64:
pwsh -NoProfile -File scripts/install-gitleaks.ps1
cd server
bun install --frozen-lockfile
bun run hooks:install
```

The installer pins Gitleaks 8.30.1, verifies its release SHA-256 checksum, and places it in gitignored `.tools/gitleaks/`. Other platforms can install the same Gitleaks version on PATH. Lefthook is pinned as a server development dependency; its configuration and scan scope are repository-wide. The project-owned installer writes a portable Lefthook launcher into this clone's Git hooks directory and refuses to replace unrelated hooks. It avoids implicit hook synchronization when running a commit.

## Run manually

```bash
# From repository root:
bun scripts/check-secrets.ts
bun scripts/check-secrets.ts --all
bun test scripts/secret-scan.test.ts

# Or from server/:
bun run secrets:staged
bun run secrets:all
```

The default scan examines staged content, including a secret that was removed from the working file but remains staged. With `--all`, the script scans a temporary snapshot of tracked and ordinary untracked, non-ignored files across the repository. Deleted files are skipped. Private ignored local files and Git history are not included in that snapshot. Output is redacted; snapshot scan findings print only rule, path and line metadata. Temporary snapshots are removed afterwards. Missing Gitleaks fails the check instead of skipping it.

Tests use an isolated temporary Git repository to check benign content, synthetic credentials in all four subsystems, staged versus working-tree differences, and the private-config filename rule. They do not stage or commit anything in the FoodWarden repository.

## Limits

Git hooks are local and can be bypassed with `--no-verify`; this is not remote push protection. Every contributor must install the hook in their clone. A CI check can enforce the policy remotely as a separate change. A clean scan does not guarantee that every possible secret format is recognized. If a real credential has already entered Git history, revoke/rotate it and assess history cleanup separately.

Use `.env` / `.dev.vars` / `secrets.h` for private values and commit only placeholder templates. The root ignore rules cover private environment files across all subsystems. Existing tracked files are still scanned even if an ignore rule now matches them.
