/**
 * `use:enhance` with a pending state (audit report W1): while a form is on its way, it carries
 * aria-busy and its submit button is disabled, so a second click cannot send it twice and the page shows
 * that something happens. Same signature as SvelteKit's; the shell's pages import it instead, and
 * extensions get it from $shell/ui.
 */
import { enhance as kitEnhance } from '$app/forms';

type Submit = NonNullable<Parameters<typeof kitEnhance>[1]>;
type Input = Parameters<Submit>[0];
type After = Exclude<Awaited<ReturnType<Submit>>, void>;

export function enhance(form: HTMLFormElement, submit?: Submit) {
  return kitEnhance(form, async (input: Input) => {
    let cancelled = false;
    const own = { ...input, cancel: () => ((cancelled = true), input.cancel()) };
    const after = submit ? await submit(own) : undefined;
    if (cancelled) return;
    const button = input.submitter instanceof HTMLButtonElement || input.submitter instanceof HTMLInputElement ? input.submitter : null;
    form.setAttribute('aria-busy', 'true');
    if (button) button.disabled = true;
    return async (opts: Parameters<After>[0]) => {
      try {
        if (typeof after === 'function') await after(opts);
        else await opts.update();
      } finally {
        form.removeAttribute('aria-busy');
        if (button) button.disabled = false;
      }
    };
  });
}
