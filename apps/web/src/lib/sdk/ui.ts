/** Shell UI an extension may reuse: Beni the mascot and small motion helpers. Styles: the tokens in app.css. */
export { default as Mascot } from '#lib/Mascot.svelte';
export { countUp } from '#lib/count-up.ts';
export { dayIn, todayIn } from '#lib/dates.ts';
export { enhance, saveOnChoose } from '#lib/forms.ts';
/** const t = useT(): this extension's texts in the page's language (spec 007), e.g. {t('Last night')}. */
export { useT } from '#lib/i18n/index.ts';
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
