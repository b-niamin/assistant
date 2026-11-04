/**
 * Pip, the app's mascot. Its mood follows today's Training Readiness, so the hero card reads at a
 * glance even before the number does. Pure logic here; the drawing is in Mascot.svelte.
 */
export type Mood = 'charged' | 'steady' | 'tired' | 'asleep' | 'idle';

export function moodFor(readiness: number | null | undefined): Mood {
  if (readiness == null) return 'idle';
  if (readiness >= 75) return 'charged';
  if (readiness >= 50) return 'steady';
  if (readiness >= 25) return 'tired';
  return 'asleep';
}

/** Pip's mood by the local hour, for places with no readiness to go on (dashboard greeting). */
export function moodForHour(hour: number): Mood {
  if (hour < 6) return 'asleep';
  if (hour < 12) return 'charged';
  if (hour < 22) return 'steady';
  return 'tired';
}

const LINES: Record<Mood, string[]> = {
  charged: ['Fully charged. Good day for quality work.', 'Legs feel springy. Go get it.', 'Green light for intervals.'],
  steady: ['Steady. An easy or moderate run fits.', 'Solid, not spicy. Keep it aerobic.', 'Fine to train, no heroics.'],
  tired: ['Running low. Easy pace or mobility today.', 'Recovery first. Short and easy.', 'Your body is asking for a lighter day.'],
  asleep: ['Rest day. Seriously.', 'Sleep, food, feet up.', 'Battery empty. Recharge first.'],
  idle: ['No readiness yet. Waiting for your data.', 'Connect a data source and I will tell you more.']
};

/** One line for the mood; the same one all day so it does not flicker between page loads. */
export function lineFor(mood: Mood, day: string): string {
  const options = LINES[mood];
  let h = 0;
  for (const c of day) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return options[h % options.length];
}
