import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		globals: true,
		clearMocks: true,
		include: ['__tests__/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			reporter: ['text'],
		},
	},
})
