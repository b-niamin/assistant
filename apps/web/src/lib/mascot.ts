/**
 * Beni, the app's mascot. Its mood follows today's Training Readiness, so the hero card reads at a
 * glance even before the number does. Pure logic here; the drawing is in Mascot.svelte.
 */
import { isAccessory, type Accessory } from './beni-accessories';

export { ACCESSORY_IDS, isAccessory, type Accessory } from './beni-accessories';

export type Mood = 'charged' | 'steady' | 'tired' | 'asleep' | 'idle';

export function moodFor(readiness: number | null | undefined): Mood {
  if (readiness == null) return 'idle';
  if (readiness >= 75) return 'charged';
  if (readiness >= 50) return 'steady';
  if (readiness >= 25) return 'tired';
  return 'asleep';
}

/** Beni's mood by the local hour, for places with no readiness to go on (dashboard greeting). */
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


/** Words in an extension's id or name that tell what Beni should wear there, first match wins. */
const GUESSES: [RegExp, Accessory][] = [
  [/gym|workout|fitness|sport|run|train|exercise|cycl|swim|strength|yoga/, 'headband'],
  [/health|medic|doctor|clinic|symptom|pill|vital/, 'stethoscope'],
  [/learn|study|school|course|flashcard|language|vocab|book|read|lesson/, 'book'],
  [/recipe|food|cook|meal|diet|nutrition|kitchen|grocer|shopping/, 'chef-hat'],
  [/music|podcast|audio|radio|spotify|playlist/, 'headphones'],
  [/home|light|smart|house|energy|device/, 'bulb'],
  [/money|financ|budget|expense|bank|invest|wallet|bill/, 'coin'],
  [/weather|forecast|rain/, 'umbrella'],
  [/note|journal|calendar|todo|task|diary|plan|agenda|habit/, 'pencil'],
  [/sleep|night|dream/, 'nightcap'],
  [/code|dev|data|terminal|log|report|stat/, 'glasses'],
  [/setting|config|tool|admin|repair|maint/, 'wrench'],
  [/party|birthday|celebrat|award|record|goal/, 'party-hat']
];

/** A fitting accessory for something named like this (an extension without its own "accessory"). */
export function guessAccessory(...words: (string | null | undefined)[]): Accessory {
  const text = words.filter(Boolean).join(' ').toLowerCase();
  for (const [re, a] of GUESSES) if (re.test(text)) return a;
  return 'none';
}

export interface AccessorySource {
  id: string;
  name?: string;
  accessory?: string | null;
}

/** The extension's own choice (manifest "accessory"), else a guess from its id and name. */
export function accessoryOf(ext: AccessorySource): Accessory {
  return isAccessory(ext.accessory) ? ext.accessory : guessAccessory(ext.id, ext.name);
}

/** What Beni wears on a page: tools in settings, the app's own in an app. */
export function accessoryFor(pathname: string, extensions: AccessorySource[] = []): Accessory {
  const [first = ''] = pathname.split('/').filter(Boolean);
  if (first === 'settings') return 'wrench';
  const ext = extensions.find((e) => e.id === first);
  return ext ? accessoryOf(ext) : 'none';
}
