/** Axis helpers for charts (the shell's and the extensions', through `$shell`). */

/** Round axis ticks covering min..max, about `count` steps of 1, 2, 2.5 or 5 x 10^n. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** The same for bytes: round in the unit the top value is shown in (KB, MB, ...), so labels read 2 MB, 4 MB. */
export function byteTicks(min: number, max: number, count = 4): number[] {
  let unit = 1;
  while (Math.max(Math.abs(min), Math.abs(max)) / unit >= 1024 && unit < 1024 ** 5) unit *= 1024;
  return niceTicks(min / unit, max / unit, count).map((v) => v * unit);
}

/** Round ticks in another unit: `scaledTicks(min, max, 3600)` puts a seconds axis on whole/half hours. */
export function scaledTicks(min: number, max: number, unit: number, count = 4): number[] {
  return niceTicks(min / unit, max / unit, count).map((v) => v * unit);
}

/** Stretches of consecutive non-null values (index + value), so a line keeps its gaps. */
export function runsOf(values: (number | null)[]): { i: number; v: number }[][] {
  const out: { i: number; v: number }[][] = [];
  let cur: { i: number; v: number }[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push({ i, v });
  });
  if (cur.length) out.push(cur);
  return out;
}
