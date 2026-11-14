import type { Sample } from "./model";

export function chartPoints(
  samples: Sample[],
  key: "temperature" | "voc" | "light",
  now: number,
) {
  const start = now - 3600;
  const values = samples
    .filter((sample) => sample.timeS >= start && sample.timeS <= now)
    .sort((a, b) => a.timeS - b.timeS);
  const readings = values.flatMap((sample) =>
    sample[key] === null ? [] : [sample[key]],
  );
  if (readings.length === 0) return [];

  const min = Math.min(...readings);
  const max = Math.max(...readings);
  const segments: Array<Array<[number, number]>> = [];
  let segment: Array<[number, number]> = [];
  let lastTime = start;
  for (const sample of values) {
    const value = sample[key];
    if (value === null || sample.timeS - lastTime > 360) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (value !== null) {
      const x = 4 + ((sample.timeS - start) * 232) / 3600;
      const y = max === min ? 23 : 42 - ((value - min) * 38) / (max - min);
      segment.push([x, y]);
    }
    lastTime = sample.timeS;
  }
  if (segment.length) segments.push(segment);
  return segments;
}
