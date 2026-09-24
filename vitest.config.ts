import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// Globals keep the suite CommonJS, so it can `require` the built dist the
		// way n8n loads it rather than through an ESM shim.
		globals: true,
		include: ['tests/**/*.test.js'],
	},
});
