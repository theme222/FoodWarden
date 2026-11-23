export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 1;
  }

  /** Mulberry32 deterministic PRNG in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  bool(prob = 0.5): boolean {
    return this.next() < prob;
  }

  chance(prob: number): boolean {
    return this.next() < prob;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("Cannot pick from empty array");
    }
    return items[this.int(0, items.length - 1)]!;
  }

  weightedPick<T>(entries: ReadonlyArray<readonly [T, number]>): T {
    if (entries.length === 0) {
      throw new Error("Cannot pick from empty weighted list");
    }
    let total = 0;
    for (const [, w] of entries) {
      total += Math.max(0, w);
    }
    if (total <= 0) return entries[0]![0];
    let target = this.next() * total;
    for (const [value, w] of entries) {
      const weight = Math.max(0, w);
      if (target < weight) return value;
      target -= weight;
    }
    return entries[entries.length - 1]![0];
  }

  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = copy[i]!;
      copy[i] = copy[j]!;
      copy[j] = tmp;
    }
    return copy;
  }
}

export function resolveDstSeeds(defaultCount = 50): number[] {
  const override = process.env.DST_SEED;
  if (override !== undefined && override.trim() !== "") {
    const parsed = Number.parseInt(override, 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return [parsed];
    }
  }
  return Array.from({ length: defaultCount }, (_, i) => i + 1);
}

export function parseCliIntArg(
  argv: readonly string[],
  name: string,
  fallback: number,
  min = 1,
): number {
  const prefix = `--${name}=`;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const raw = arg.startsWith(prefix)
      ? arg.slice(prefix.length)
      : arg === `--${name}`
        ? argv[i + 1]
        : undefined;
    if (raw !== undefined) {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isSafeInteger(parsed) && parsed >= min) return parsed;
    }
  }
  return fallback;
}

export function formatReplayHint(seed: number, suite: string): string {
  return `bun run test:dst:cli -- --seed=${seed} --suite=${suite}`;
}
