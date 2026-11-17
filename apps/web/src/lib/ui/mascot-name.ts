import { page } from '$app/state';
import { DEFAULT_APPEARANCE } from '#lib/appearance.ts';

/** The mascot's name (System settings -> Appearance) for texts: t('{name} says: {line}', { name: mascotName(), line }). */
export const mascotName = (): string => (page.data?.appearance as { name?: string } | undefined)?.name ?? DEFAULT_APPEARANCE.name;
