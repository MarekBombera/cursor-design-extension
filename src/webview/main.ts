// First, so the global layer precedes every component's scoped styles in chrome.css.
import './ui/theme.css';

import { mount } from 'svelte';

import App from './App.svelte';

const mountChrome = (): void => {
	const target = document.querySelector('#svelte-root');
	if (target === null) {
		return;
	}
	mount(App, { target });
};

mountChrome();
