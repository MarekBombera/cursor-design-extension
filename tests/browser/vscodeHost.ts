// Test-only host emulation (never imported by src/): what Cursor gives every webview, so browser
// specs can run the chrome the way Cursor renders it.
//
// The --vscode-* values are Cursor's bundled Default Dark Modern / Light Modern themes plus the
// VS Code registry defaults. DEFAULT_STYLES is the unlayered
// _defaultStyles sheet Cursor prepends to every webview, copied verbatim from
// Cursor.app/Contents/Resources/app/out/vs/workbench/contrib/webview/browser/pre/index.html.

export type VscodeTheme = 'dark' | 'light';

const DARK_MODERN = {
	'--vscode-font-family': "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
	'--vscode-font-size': '13px',
	'--vscode-editor-font-family': "Menlo, Monaco, 'Courier New', monospace",
	'--vscode-foreground': '#cccccc',
	'--vscode-descriptionForeground': '#9d9d9d',
	'--vscode-disabledForeground': '#cccccc80',
	'--vscode-focusBorder': '#0078d4',
	'--vscode-textLink-foreground': '#4daafc',
	'--vscode-editor-background': '#1f1f1f',
	'--vscode-editor-foreground': '#cccccc',
	'--vscode-sideBar-background': '#181818',
	'--vscode-editorWidget-background': '#202020',
	'--vscode-editorWidget-border': '#454545',
	'--vscode-widget-border': '#313131',
	'--vscode-widget-shadow': '#0000005c',
	'--vscode-panel-border': '#2b2b2b',
	'--vscode-toolbar-hoverBackground': '#5a5d5e50',
	'--vscode-toolbar-activeBackground': '#63666750',
	'--vscode-list-hoverBackground': '#2a2d2e',
	'--vscode-button-background': '#0078d4',
	'--vscode-button-foreground': '#ffffff',
	'--vscode-button-hoverBackground': '#026ec1',
	'--vscode-button-border': '#ffffff12',
	'--vscode-button-secondaryBackground': '#313131',
	'--vscode-button-secondaryForeground': '#cccccc',
	'--vscode-button-secondaryHoverBackground': '#3c3c3c',
	'--vscode-inputOption-activeBackground': '#2489db82',
	'--vscode-inputOption-activeBorder': '#2488db',
	'--vscode-inputOption-activeForeground': '#ffffff',
	'--vscode-input-background': '#313131',
	'--vscode-input-foreground': '#cccccc',
	'--vscode-input-border': '#3c3c3c',
	'--vscode-input-placeholderForeground': '#989898',
	'--vscode-dropdown-background': '#313131',
	'--vscode-dropdown-border': '#3c3c3c',
	'--vscode-dropdown-foreground': '#cccccc',
	'--vscode-badge-background': '#616161',
	'--vscode-badge-foreground': '#f8f8f8',
	'--vscode-activityBarBadge-background': '#0078d4',
	'--vscode-activityBarBadge-foreground': '#ffffff',
	'--vscode-keybindingLabel-background': '#8080802b',
	'--vscode-keybindingLabel-border': '#33333399',
	'--vscode-keybindingLabel-foreground': '#cccccc',
	'--vscode-charts-purple': '#b180d7',
	'--vscode-charts-green': '#89d185',
	'--vscode-editorInfo-foreground': '#3794ff',
	'--vscode-editorWarning-foreground': '#cca700',
	'--vscode-editorError-foreground': '#f14c4c',
	'--vscode-inputValidation-infoBackground': '#063b49',
	'--vscode-inputValidation-warningBackground': '#352a05',
	'--vscode-inputValidation-errorBackground': '#5a1d1d',
	'--vscode-progressBar-background': '#0078d4',
} as const satisfies Record<`--vscode-${string}`, string>;

// Same keys as the dark theme, so a variable added to one and not the other fails to type-check.
const LIGHT_MODERN: Record<keyof typeof DARK_MODERN, string> = {
	'--vscode-font-family': "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
	'--vscode-font-size': '13px',
	'--vscode-editor-font-family': "Menlo, Monaco, 'Courier New', monospace",
	'--vscode-foreground': '#3b3b3b',
	'--vscode-descriptionForeground': '#3b3b3b',
	'--vscode-disabledForeground': '#61616180',
	'--vscode-focusBorder': '#005fb8',
	'--vscode-textLink-foreground': '#005fb8',
	'--vscode-editor-background': '#ffffff',
	'--vscode-editor-foreground': '#3b3b3b',
	'--vscode-sideBar-background': '#f8f8f8',
	'--vscode-editorWidget-background': '#f8f8f8',
	'--vscode-editorWidget-border': '#c8c8c8',
	'--vscode-widget-border': '#e5e5e5',
	'--vscode-widget-shadow': '#00000029',
	'--vscode-panel-border': '#e5e5e5',
	'--vscode-toolbar-hoverBackground': '#b8b8b850',
	'--vscode-toolbar-activeBackground': '#a6a6a650',
	'--vscode-list-hoverBackground': '#f2f2f2',
	'--vscode-button-background': '#005fb8',
	'--vscode-button-foreground': '#ffffff',
	'--vscode-button-hoverBackground': '#0258a8',
	'--vscode-button-border': '#0000001a',
	'--vscode-button-secondaryBackground': '#e5e5e5',
	'--vscode-button-secondaryForeground': '#3b3b3b',
	'--vscode-button-secondaryHoverBackground': '#cccccc',
	'--vscode-inputOption-activeBackground': '#bed6ed',
	'--vscode-inputOption-activeBorder': '#005fb8',
	'--vscode-inputOption-activeForeground': '#000000',
	'--vscode-input-background': '#ffffff',
	'--vscode-input-foreground': '#3b3b3b',
	'--vscode-input-border': '#cecece',
	'--vscode-input-placeholderForeground': '#767676',
	'--vscode-dropdown-background': '#ffffff',
	'--vscode-dropdown-border': '#cecece',
	'--vscode-dropdown-foreground': '#3b3b3b',
	'--vscode-badge-background': '#cccccc',
	'--vscode-badge-foreground': '#3b3b3b',
	'--vscode-activityBarBadge-background': '#005fb8',
	'--vscode-activityBarBadge-foreground': '#ffffff',
	'--vscode-keybindingLabel-background': '#dddddd66',
	'--vscode-keybindingLabel-border': '#cccccc66',
	'--vscode-keybindingLabel-foreground': '#3b3b3b',
	'--vscode-charts-purple': '#652d90',
	'--vscode-charts-green': '#388a34',
	'--vscode-editorInfo-foreground': '#1a85ff',
	'--vscode-editorWarning-foreground': '#bf8803',
	'--vscode-editorError-foreground': '#e51400',
	'--vscode-inputValidation-infoBackground': '#d6ecf2',
	'--vscode-inputValidation-warningBackground': '#f6f5d2',
	'--vscode-inputValidation-errorBackground': '#f2dede',
	'--vscode-progressBar-background': '#005fb8',
};

export const VSCODE_THEME_VARIABLES: Record<VscodeTheme, Record<string, string>> = {
	dark: DARK_MODERN,
	light: LIGHT_MODERN,
};

export const DEFAULT_STYLES = `
html {
	scrollbar-color: var(--vscode-scrollbarSlider-background) var(--vscode-editor-background);
}

body {
	overscroll-behavior-x: none;
	background-color: transparent;
	color: var(--vscode-editor-foreground);
	font-family: var(--vscode-font-family);
	font-weight: var(--vscode-font-weight);
	font-size: var(--vscode-font-size);
	margin: 0;
	padding: 0 20px;
}

img, video {
	max-width: 100%;
	max-height: 100%;
}

a, a code {
	color: var(--vscode-textLink-foreground);
}

p > a {
	text-decoration: var(--text-link-decoration);
}

a:hover {
	color: var(--vscode-textLink-activeForeground);
}

a:focus,
input:focus,
select:focus,
textarea:focus {
	outline: 1px solid -webkit-focus-ring-color;
	outline-offset: -1px;
}

code {
	font-family: var(--monaco-monospace-font);
	color: var(--vscode-textPreformat-foreground);
	background-color: var(--vscode-textPreformat-background);
	padding: 1px 3px;
	border-radius: 4px;
}

pre code {
	padding: 0;
}

blockquote {
	background: var(--vscode-textBlockQuote-background);
	border-color: var(--vscode-textBlockQuote-border);
}

kbd {
	background-color: var(--vscode-keybindingLabel-background);
	color: var(--vscode-keybindingLabel-foreground);
	border-style: solid;
	border-width: 1px;
	border-radius: 3px;
	border-color: var(--vscode-keybindingLabel-border);
	border-bottom-color: var(--vscode-keybindingLabel-bottomBorder);
	box-shadow: inset 0 -1px 0 var(--vscode-widget-shadow);
	vertical-align: middle;
	padding: 1px 3px;
}

::-webkit-scrollbar {
	width: 10px;
	height: 10px;
}

::-webkit-scrollbar-corner {
	background-color: var(--vscode-editor-background);
}

::-webkit-scrollbar-thumb {
	background-color: var(--vscode-scrollbarSlider-background);
}
::-webkit-scrollbar-thumb:hover {
	background-color: var(--vscode-scrollbarSlider-hoverBackground);
}
::-webkit-scrollbar-thumb:active {
	background-color: var(--vscode-scrollbarSlider-activeBackground);
}
::highlight(find-highlight) {
	background-color: var(--vscode-editor-findMatchHighlightBackground);
}
::highlight(current-find-highlight) {
	background-color: var(--vscode-editor-findMatchBackground);
}`;
