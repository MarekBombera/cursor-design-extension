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
