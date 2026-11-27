import type { ChromePick } from './commentPick';
import type { SectionId } from './editInspector';

// Inspector's focus handoff: Add border's Width focus and the section-header fallback.
export class InspectorFocus {
	readonly #fieldId: string;
	readonly #view: () => unknown;
	readonly #pick: () => ChromePick | undefined;

	// Armed by a saved Add border: Width takes focus the first time it renders for that element.
	// Not state: the save's preview re-posts the pick, which re-runs the effect that reads it.
	#widthFocus: { frameId: string; sourceNumber: number } | undefined;
	// A re-render that removes the focused field (Gap hidden, the border fields gone) hands focus
	// to its section's header button, which never unmounts. Read before the DOM update, used after.
	#focusedSection: SectionId | undefined;
	// Tab to another inspector control: the blur commit re-renders while focus is on body, before it
	// lands, and can remove Tab's destination. Capture phase: recorded before the commit. Only a
	// removed destination hands off: a click on a control that stays must keep its focus move.
	#tabbed: { section: SectionId | undefined; to: Element } | undefined;

	constructor({
		fieldId,
		view,
		pick,
	}: {
		fieldId: string;
		view: () => unknown;
		pick: () => ChromePick | undefined;
	}) {
		this.#fieldId = fieldId;
		this.#view = view;
		this.#pick = pick;

		// Clears when the pick moves to another element or drops (a refusal reload), else on use.
		$effect(() => {
			void this.#view();
			const widthFocus = this.#widthFocus;
			if (widthFocus === undefined) {
				return;
			}
			const current = this.#pick();
			if (
				current?.frameId !== widthFocus.frameId ||
				current.edit?.sourceNumber !== widthFocus.sourceNumber
			) {
				this.#widthFocus = undefined;
				return;
			}
			const width = document.getElementById(`${this.#fieldId}-border-width`);
			if (width !== null) {
				this.#widthFocus = undefined;
				width.focus();
			}
		});

		$effect.pre(() => {
			void this.#view();
			const active = document.activeElement;
			this.#focusedSection =
				active instanceof HTMLElement && active.closest('[data-cd-inspector]') !== null
					? this.#sectionOf(active)
					: undefined;
		});

		$effect(() => {
			void this.#view();
			const removed =
				this.#tabbed !== undefined && !this.#tabbed.to.isConnected
					? this.#tabbed.section
					: undefined;
			this.#tabbed = undefined;
			const section = this.#focusedSection ?? removed;
			const active = document.activeElement;
			if (section !== undefined && (active === null || active === document.body)) {
				document.getElementById(this.actionId(section))?.focus();
			}
		});
	}

	// Inspector's template writes data-cd-section only from a SectionView's id.
	#sectionOf = (target: EventTarget | null): SectionId | undefined =>
		target instanceof HTMLElement
			? (target.closest<HTMLElement>('[data-cd-section]')?.dataset.cdSection as
					| SectionId
					| undefined)
			: undefined;

	actionId = (section: SectionId): string => `${this.#fieldId}-${section}-action`;

	recordTab = (event: FocusEvent & { currentTarget: HTMLElement }): void => {
		const { relatedTarget } = event;
		this.#tabbed =
			relatedTarget instanceof Element && event.currentTarget.contains(relatedTarget)
				? { section: this.#sectionOf(event.target), to: relatedTarget }
				: undefined;
	};

	armWidthFocus = (target: { frameId: string; sourceNumber: number }): void => {
		this.#widthFocus = target;
	};
}
