<script lang="ts">
	type Props = {
		errorMessage: string | undefined;
		commentsError: string | undefined;
		mcpUnavailable: boolean;
	};

	let { errorMessage, commentsError, mcpUnavailable }: Props = $props();
</script>

<!-- Every live region stays mounted and toggles hidden: it must exist before its content. -->
<p class="error" role="alert" hidden={errorMessage === undefined}>{errorMessage ?? ''}</p>
<!-- comments.json failures get their own line: a canvas:updated never clears it. -->
<p class="error" role="alert" data-cd-comments-error hidden={!commentsError}>
	{commentsError ?? ''}
</p>
<p class="mcp" role="status" hidden={!mcpUnavailable}>
	{mcpUnavailable ? 'MCP unavailable. Artboard still loads from disk.' : ''}
</p>

<style>
	p {
		margin: 0;
		padding: 0.5rem 0.75rem;
		flex: 0 0 auto;
	}
	p[hidden] {
		display: none;
	}
	.error {
		color: var(--vscode-errorForeground);
	}
	.mcp {
		color: var(--vscode-editorWarning-foreground, var(--vscode-inputValidation-warningForeground));
	}
</style>
