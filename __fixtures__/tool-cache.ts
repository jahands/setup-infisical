import { vi } from 'vitest'

import type * as tc from '@actions/tool-cache'

export const find = vi.fn<typeof tc.find>()
export const downloadTool = vi.fn<typeof tc.downloadTool>()
export const extractTar = vi.fn<typeof tc.extractTar>()
export const extractZip = vi.fn<typeof tc.extractZip>()
export const cacheFile = vi.fn<typeof tc.cacheFile>()

export class HTTPError extends Error {
	readonly httpStatusCode: number | undefined

	constructor(httpStatusCode: number | undefined) {
		super(`Unexpected HTTP response: ${httpStatusCode}`)
		this.httpStatusCode = httpStatusCode
	}
}
