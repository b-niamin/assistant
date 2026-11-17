/** Shell UI an extension may reuse: Pingo, charts, the empty state, small helpers. Styles: the tokens and classes in app.css. */
export { default as Mascot } from '#lib/Mascot.svelte';
/** Since shell 2: a line chart with tooltip, keys and table twin; a trend glyph; Pingo's "nothing here yet". */
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
/**
 * Since shell 7, Assistant UI (spec 001): the head of every page with the shell's page navigation, a bottom
 * sheet, the icon set. Buttons, cards, lists, segmented controls, steppers and chips are classes
 * (lib/ui.css): .btn .btn-primary .btn-tinted .btn-plain .btn-danger .btn-glass, .card, .list > .list-row, ...
 */
export { default as PageHead } from '#lib/ui/PageHead.svelte';
export { default as Sheet } from '#lib/ui/Sheet.svelte';
export { default as Icon } from '#lib/ui/Icon.svelte';
export { ICON_NAMES } from '#lib/ui/icons.js';
/** Since shell 8: swipe through periods (a week, a month): the page follows the finger, with buttons and arrow keys. */
export { default as Pager } from '#lib/ui/Pager.svelte';
/** Since shell 7: the mascot's name, picked in System settings -> Appearance (Pingo by default). */
export { mascotName } from '#lib/ui/mascot-name.ts';
