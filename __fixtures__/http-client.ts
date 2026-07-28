import { vi } from 'vitest'

export interface MockHttpResponse {
	message: {
		statusCode?: number
		headers: Record<string, string | undefined>
	}
	readBody: () => Promise<string>
}

export const get =
	vi.fn<(url: string, headers?: Record<string, string>) => Promise<MockHttpResponse>>()

export function mockResponse(
	statusCode: number,
	headers: Record<string, string | undefined> = {},
	body = ''
): MockHttpResponse {
	return {
		message: { statusCode, headers },
		readBody: () => Promise.resolve(body),
	}
}

export class HttpClient {
	get = get
}
