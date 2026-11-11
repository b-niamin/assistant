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

/**
 * `use:saveOnChoose` on a form of radios or a select that saves as soon as something is picked. A click
 * or tap saves at once; with the keyboard (arrow keys walk through the options) it saves when focus
 * leaves the form, so walking past an option does not submit it (WCAG 3.2.2).
 */
export function saveOnChoose(form: HTMLFormElement) {
  let pointerAt = 0;
  let dirty = false;
  const onPointer = () => (pointerAt = Date.now());
  const onChange = () => {
    // A pointer opened a select a few seconds ago and picked an option: that is a choice, not a walk.
    if (Date.now() - pointerAt < 5000) form.requestSubmit();
    else dirty = true;
  };
  const onLeave = (e: FocusEvent) => {
    if (dirty && !form.contains(e.relatedTarget as Node | null)) {
      dirty = false;
      form.requestSubmit();
    }
  };
  form.addEventListener('pointerdown', onPointer);
  form.addEventListener('change', onChange);
  form.addEventListener('focusout', onLeave);
  return {
    destroy() {
      form.removeEventListener('pointerdown', onPointer);
      form.removeEventListener('change', onChange);
      form.removeEventListener('focusout', onLeave);
    }
  };
}
