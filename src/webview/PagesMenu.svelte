<script lang="ts">
	import type { Attachment } from 'svelte/attachments';

	import { MAX_PAGE_TITLE_CHARS } from '../disk/layout';
	import { nextRowIndex, PAGE_REQUEST_PENDING_TEXT, pageRows } from './pagesMenu';
	import type { PagesMenuState } from './pagesMenuState.svelte';
	import Button from './ui/Button.svelte';
	import Icon from './ui/Icon.svelte';
	import IconButton from './ui/IconButton.svelte';
	import Message from './ui/Message.svelte';
	import Widget from './ui/Widget.svelte';

	// The page button and its Pages menu. All menu state is App's PagesMenuState; this view renders
	// it. Titles are user data: text only.
	type Props = {
		// The staged page.
		pageId: string;
		pages: PagesMenuState['pages'];
		open: PagesMenuState['open'];
		renaming: PagesMenuState['renaming'];
		request: PagesMenuState['request'];
		error: PagesMenuState['error'];
		now: PagesMenuState['now'];
		onToggle: PagesMenuState['toggle'];
		onClose: PagesMenuState['close'];
		onOpenPage: PagesMenuState['openPage'];
		onCreatePage: PagesMenuState['createPage'];
		onStartRename: PagesMenuState['startRename'];
		onEditRename: PagesMenuState['editRename'];
		onSubmitRename: PagesMenuState['submitRename'];
		onCancelRename: PagesMenuState['cancelRename'];
		onDeletePage: PagesMenuState['deletePage'];
	};

	let {
		pageId,
		pages,
		open,
		renaming,
		request,
		error,
		now,
		onToggle,
		onClose,
		onOpenPage,
		onCreatePage,
		onStartRename,
		onEditRename,
		onSubmitRename,
		onCancelRename,
		onDeletePage,
	}: Props = $props();

	const MENU_ID = 'cd-pages-menu';
	const RENAME_ERROR_ID = 'cd-page-rename-error';
	// Arrow-key stops, in order: each row's open button (or its rename field), then New blank page.
	const STOPS = '[data-cd-page-row], input, [data-cd-page-new]';
	const MENU_GAP_PX = 4;

	let wrapper: HTMLDivElement | undefined = $state();

	const attachWrapper: Attachment<HTMLDivElement> = (element) => {
		wrapper = element;
		return () => {
			wrapper = undefined;
		};
	};

	const busy = $derived(request !== undefined);
	const busyAttribute = $derived(busy ? 'true' : undefined);
	const rows = $derived(pageRows({ pages, openPageId: pageId, now }));
	// The raw id when the staged page is not listed.
	const title = $derived(pages.find((page) => page.id === pageId)?.title ?? pageId);
	const pendingText = $derived(request === undefined ? '' : PAGE_REQUEST_PENDING_TEXT[request.type]);
	const renameError = $derived(
		error?.type === 'page:rename' && error.pageId === renaming?.pageId ? error.message : undefined,
	);
	const menuError = $derived(error?.type === 'page:rename' ? undefined : error?.message);
	// Viewport px under the button: the Widget's containing block is the fixed root, so its height
	// cap is the panel's. Read when the menu opens (or mounts open after a page switch).
	const place = $derived.by(() => {
		if (!open || wrapper === undefined) {
			return undefined;
		}
		const rect = wrapper.getBoundingClientRect();
		return { left: rect.left, top: rect.bottom + MENU_GAP_PX };
	});

	const isOutside = (target: EventTarget | null): boolean =>
		wrapper !== undefined && !(target instanceof Node && wrapper.contains(target));

	// Escape on the button closes an open menu; a closed menu leaves Escape to the mode keys.
	const handleButtonKeydown = (event: KeyboardEvent): void => {
		if (open && event.key === 'Escape') {
			// Prevented, so DesignPage's window keys do not also leave Comment or Edit mode.
			event.preventDefault();
			onClose({ focusButton: true });
		}
	};

	const handleMenuKeydown = (event: KeyboardEvent & { currentTarget: HTMLElement }): void => {
		if (event.defaultPrevented || event.isComposing) {
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			onClose({ focusButton: true });
			return;
		}
		const { target } = event;
		if (!(target instanceof Node) || target instanceof HTMLInputElement) {
			return;
		}
		const stops = [...event.currentTarget.querySelectorAll<HTMLElement>(STOPS)];
		// A row's stop shares its row with Rename and Delete, so any of them steps from that row.
		const index = stops.findIndex((stop) => stop.parentElement?.contains(target) === true);
		if (index === -1) {
			return;
		}
		const next = nextRowIndex({ key: event.key, index, count: stops.length });
		if (next === undefined) {
			return;
		}
		event.preventDefault();
		stops[next]?.focus({ preventScroll: true });
	};

	const handleRenameKeydown = (event: KeyboardEvent): void => {
		if (event.isComposing) {
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			onSubmitRename();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			onCancelRename({ focusRename: true });
		}
	};

	// A window blur (the native modal, another app) keeps the field.
	const handleRenameBlur = (): void => {
		if (document.hasFocus()) {
			onCancelRename();
		}
	};

	const handleDocumentPointerdown = (event: PointerEvent): void => {
		if (open && isOutside(event.target)) {
			onClose();
		}
	};

	// Checked a task later: a removed focused control (the rename field after a save) drops focus to
	// body for a moment before the state moves it, and a window that lost focus keeps the menu.
	const handleFocusout = (): void => {
		setTimeout(() => {
			if (
				open &&
				wrapper?.isConnected === true &&
				document.hasFocus() &&
				isOutside(document.activeElement)
			) {
				onClose();
			}
		});
	};
</script>

<svelte:document onpointerdowncapture={handleDocumentPointerdown} />

<div class="pages" {@attach attachWrapper} onfocusout={handleFocusout}>
	<Button
		variant="ghost"
		icon="page"
		{title}
		aria-expanded={open}
		aria-controls={open ? MENU_ID : undefined}
		disabled={pages.length === 0}
		aria-disabled={busyAttribute}
		data-cd-page-button
		onclick={busy ? undefined : onToggle}
		onkeydown={handleButtonKeydown}
		><span class="visually-hidden">Page: </span><span class="page-title">{title}</span><Icon
			name="chevron-down"
			size={14}
		/></Button
	>
	{#if open}
		<Widget
			id={MENU_ID}
			left={place?.left}
			top={place?.top}
			role="dialog"
			aria-label="Pages"
			tabindex={-1}
			data-cd-pages-menu
			onkeydown={handleMenuKeydown}
		>
			{#snippet header()}
				<span class="heading">Pages</span>
			{/snippet}
			<ul class="rows">
				{#each rows as row (row.id)}
					<li class="row">
						{#if renaming !== undefined && renaming.pageId === row.id}
							<input
								aria-label="Page title"
								value={renaming.draft}
								maxlength={MAX_PAGE_TITLE_CHARS}
								readonly={busy}
								aria-invalid={renameError !== undefined}
								aria-describedby={renameError === undefined ? undefined : RENAME_ERROR_ID}
								oninput={(event) => onEditRename(event.currentTarget.value)}
								onkeydown={handleRenameKeydown}
								onblur={handleRenameBlur}
							/>
						{:else}
							<Button
								variant="ghost"
								icon={row.current ? 'check' : 'page'}
								block
								aria-current={row.current ? 'page' : undefined}
								aria-disabled={busyAttribute}
								data-cd-page-row={row.id}
								onclick={busy ? undefined : () => onOpenPage(row.id)}
								><span class={['row-label', { current: row.current }]}
									><span class="row-title">{row.title}</span>{#if row.time !== undefined}<span
											class="visually-hidden">edited</span
										><span class="time">{row.time}</span>{/if}</span
								></Button
							>
						{/if}
						<IconButton
							icon="edit"
							label={`Rename ${row.title}`}
							aria-disabled={busyAttribute}
							data-cd-page-rename={row.id}
							onclick={busy ? undefined : () => onStartRename(row.id)}
						/>
						<IconButton
							icon="trash"
							label={`Delete ${row.title}`}
							aria-disabled={busy || !row.canDelete ? 'true' : undefined}
							data-cd-page-delete={row.id}
							onclick={busy || !row.canDelete ? undefined : () => onDeletePage(row.id)}
						/>
						{#if renameError !== undefined && renaming?.pageId === row.id}
							<div class="row-error">
								<Message tone="error" role="alert" id={RENAME_ERROR_ID}>{renameError}</Message>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
			{#snippet footer()}
				<Button
					variant="ghost"
					icon="plus"
					block
					aria-disabled={busyAttribute}
					data-cd-page-new
					onclick={busy ? undefined : onCreatePage}>New blank page</Button
				>
				{#if menuError !== undefined}
					<Message tone="error" role="alert">{menuError}</Message>
				{/if}
				<span class="visually-hidden" aria-live="polite">{pendingText}</span>
			{/snippet}
		</Widget>
	{/if}
</div>

<style>
	/* A flex item's z-index lifts the menu over the stage without making this a containing block. */
	.pages {
		display: inline-flex;
		z-index: 1;
		min-width: 0;
	}
	.page-title {
		max-width: 180px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.heading {
		font-weight: var(--cd-weight-strong);
	}
	.rows {
		display: grid;
		gap: var(--cd-space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		align-items: center;
		gap: var(--cd-space-2);
	}
	.row-error {
		display: grid;
		grid-column: 1 / -1;
	}
	.row-label {
		display: flex;
		flex: 1 1 auto;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--cd-space-8);
		min-width: 0;
	}
	.row-title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.current .row-title {
		font-weight: var(--cd-weight-strong);
	}
	.time {
		flex: none;
		font-size: var(--cd-fs-sm);
	}
</style>
