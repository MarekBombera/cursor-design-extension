// A held Enter repeats a button's `click` (detail 0), so a toggle or an action whose label flipped
// would save again per repeat. Chromium activates on the keydown, so a repeated one does nothing.
export const ignoreKeyRepeat = (event: KeyboardEvent): void => {
	if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
		event.preventDefault();
	}
};
