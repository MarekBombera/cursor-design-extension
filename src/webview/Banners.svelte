<script lang="ts">
	import Message from './ui/Message.svelte';

	type Props = {
		errorMessage: string | undefined;
		commentsError: string | undefined;
		mcpUnavailable: boolean;
	};

	let { errorMessage, commentsError, mcpUnavailable }: Props = $props();
</script>

<!-- Every live region stays mounted and toggles hidden: it must exist before its content. -->
<Message tone="error" variant="banner" role="alert" hidden={errorMessage === undefined}
	>{errorMessage ?? ''}</Message
>
<!-- comments.json failures get their own line: a canvas:updated never clears it. -->
<Message
	tone="warning"
	variant="banner"
	role="alert"
	data-cd-comments-error=""
	hidden={!commentsError}>{commentsError ?? ''}</Message
>
<Message tone="warning" variant="banner" icon="plug" role="status" hidden={!mcpUnavailable}>
	{#if mcpUnavailable}<b>MCP unavailable.</b> Artboard still loads from disk.{/if}
</Message>
