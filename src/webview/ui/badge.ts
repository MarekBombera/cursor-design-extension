import type { IconName } from './icons';

// The Badge primitive's props (Badge.svelte), shared with the rule modules that pick a badge's copy
// (pins.ts), so the tone union is written once.
export type BadgeTone = 'accent' | 'agent' | 'success' | 'warning' | 'neutral';

export type BadgeProps = {
	tone: BadgeTone;
	icon?: IconName;
	label: string;
	// The sentence that explains the label: a tooltip and hidden text for assistive tech.
	description?: string;
};
