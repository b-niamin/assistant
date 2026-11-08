/** Shell UI an extension may reuse: Beni the mascot and small motion helpers. Styles: the tokens in app.css. */
export { default as Mascot } from '#lib/Mascot.svelte';
export { countUp } from '#lib/count-up.ts';
export {
  accessoryFor,
  guessAccessory,
  lineFor,
  moodFor,
  moodForHour,
  ACCESSORY_IDS,
  type Accessory,
  type Mood
} from '#lib/mascot.ts';
