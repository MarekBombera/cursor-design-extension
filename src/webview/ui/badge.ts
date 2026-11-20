import type { IconName } from './icons';

// Badge.svelte's props, here so the pure rule modules (pins.ts) can import them.
export type BadgeTone = 'accent' | 'agent' | 'success' | 'warning' | 'neutral';

export type BadgeProps = {
	tone: BadgeTone;
	icon?: IconName;
	label: string;
	description?: string;
};
