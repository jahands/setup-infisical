import { vi } from 'vitest'

export interface MockHttpResponse {
	message: {
		statusCode?: number
		headers: Record<string, string | undefined>
	}
	readBody: () => Promise<string>
}

export const get = vi.fn<(url: string) => Promise<MockHttpResponse>>()

export function mockResponse(
	statusCode: number,
	headers: Record<string, string | undefined> = {}
): MockHttpResponse {
	return {
		message: { statusCode, headers },
		readBody: () => Promise.resolve(''),
	}
}

export class HttpClient {
	get = get
}
