// Chrome-only: kept out of stageGeometry.ts, which the exported canvas.html embeds whole.

const ZOOM_PRESETS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

type ZoomChoice = { value: string; label: string };

const zoomPercent = (zoom: number): number => Math.round(zoom * 100);

// The current zoom is always shown: the preset with the same percentage (0.996 shows 100%), or its
// own option in sorted place, so arrow keys step to the neighbouring presets.
export const zoomChoices = (zoom: number): { options: readonly ZoomChoice[]; selected: string } => {
	const presets = ZOOM_PRESETS.map((preset) => ({
		value: String(preset),
		label: `${zoomPercent(preset)}%`,
	}));
	const match = ZOOM_PRESETS.find((preset) => zoomPercent(preset) === zoomPercent(zoom));
	if (match !== undefined) {
		return { options: presets, selected: String(match) };
	}
	const current = { value: String(zoom), label: `${zoomPercent(zoom)}%` };
	const after = ZOOM_PRESETS.findIndex((preset) => preset > zoom);
	const at = after === -1 ? presets.length : after;
	return {
		options: [...presets.slice(0, at), current, ...presets.slice(at)],
		selected: current.value,
	};
};
