/** Shell UI an extension may reuse: Beni, charts, the empty state, small helpers. Styles: the tokens and classes in app.css. */
export { default as Mascot } from '#lib/Mascot.svelte';
/** Since shell 2: a line chart with tooltip, keys and table twin; a trend glyph; Beni's "nothing here yet". */
export { default as LineChart } from '#lib/charts/LineChart.svelte';
export { default as Sparkline } from '#lib/charts/Sparkline.svelte';
export { default as EmptyState } from '#lib/EmptyState.svelte';
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
