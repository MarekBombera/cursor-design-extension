<script lang="ts">
	type Props = {
		errorMessage: string | undefined;
		mcpUnavailable: boolean;
	};

	let { errorMessage, mcpUnavailable }: Props = $props();
</script>

<!-- Both live regions stay mounted and toggle hidden: they must exist before their content. -->
<p class="error" role="alert" hidden={errorMessage === undefined}>{errorMessage ?? ''}</p>
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
