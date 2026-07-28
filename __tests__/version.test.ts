import * as httpClient from '../__fixtures__/http-client.js'

vi.mock('@actions/http-client', () => import('../__fixtures__/http-client.js'))

const { normalizeVersion, resolveLatest, resolveRange, resolveVersion } =
	await import('../src/version.js')

function mockReleasesPage(tags: string[], extras: object[] = []) {
	httpClient.get.mockResolvedValueOnce(
		httpClient.mockResponse(
			200,
			{},
			JSON.stringify([...tags.map((tag) => ({ tag_name: tag })), ...extras])
		)
	)
}

describe('normalizeVersion', () => {
	it('accepts a bare semver', () => {
		expect(normalizeVersion('0.43.114')).toEqual({
			tag: 'v0.43.114',
			semver: '0.43.114',
		})
	})

	it('accepts a v-prefixed semver', () => {
		expect(normalizeVersion('v0.43.114')).toEqual({
			tag: 'v0.43.114',
			semver: '0.43.114',
		})
	})

	it.each(['0.43', '0.43.114-beta', 'main', ''])('rejects %j', (input) => {
		expect(() => normalizeVersion(input)).toThrow(
			`Invalid version "${input}". Expected an exact version like "0.43.114" ` +
				'(optionally prefixed with "v"), a semver range like "0.43.x" or "0", ' +
				'or "latest".'
		)
	})

	it('rejects versions below the Infisical/cli floor', () => {
		expect(() => normalizeVersion('0.41.90')).toThrow(
			'Version 0.41.90 predates the Infisical/cli repository (oldest ' +
				'available: 0.41.91). Older CLI builds were published from the legacy ' +
				'Infisical/infisical monorepo and are not supported by this action.'
		)
	})

	it('accepts the floor version itself', () => {
		expect(normalizeVersion('0.41.91')).toEqual({
			tag: 'v0.41.91',
			semver: '0.41.91',
		})
	})
})

describe('resolveLatest', () => {
	it('parses the version tag from the releases/latest redirect', async () => {
		httpClient.get.mockResolvedValueOnce(
			httpClient.mockResponse(302, {
				location: 'https://github.com/Infisical/cli/releases/tag/v0.43.114',
			})
		)
		await expect(resolveLatest()).resolves.toEqual({
			tag: 'v0.43.114',
			semver: '0.43.114',
		})
		expect(httpClient.get).toHaveBeenCalledWith('https://github.com/Infisical/cli/releases/latest')
	})

	it('throws when the response is not a redirect', async () => {
		httpClient.get.mockResolvedValueOnce(httpClient.mockResponse(200))
		await expect(resolveLatest()).rejects.toThrow(
			'Failed to resolve the latest Infisical CLI version: expected a ' +
				'redirect from https://github.com/Infisical/cli/releases/latest but ' +
				'got HTTP 200. Pin an exact version via the "version" input to work ' +
				'around this.'
		)
	})

	it('throws when the redirect location has no version tag', async () => {
		httpClient.get.mockResolvedValueOnce(
			httpClient.mockResponse(302, {
				location: 'https://github.com/Infisical/cli/releases',
			})
		)
		await expect(resolveLatest()).rejects.toThrow(
			'could not parse a version tag from the redirect location'
		)
	})
})

describe('resolveRange', () => {
	it('picks the highest release satisfying the range', async () => {
		mockReleasesPage(['v0.43.114', 'v0.43.90', 'v0.42.5'])
		await expect(resolveRange('0.43.x', undefined)).resolves.toEqual({
			tag: 'v0.43.114',
			semver: '0.43.114',
		})
		expect(httpClient.get).toHaveBeenCalledWith(
			'https://api.github.com/repos/Infisical/cli/releases?per_page=100&page=1',
			{ accept: 'application/vnd.github+json' }
		)
	})

	it('sends the authorization header when provided', async () => {
		mockReleasesPage(['v0.43.114'])
		await resolveRange('0', 'Bearer token123')
		expect(httpClient.get).toHaveBeenCalledWith(expect.stringContaining('api.github.com'), {
			accept: 'application/vnd.github+json',
			authorization: 'Bearer token123',
		})
	})

	it('skips drafts, prereleases, and non-semver tags', async () => {
		mockReleasesPage(
			['v0.42.5'],
			[
				{ tag_name: 'v0.43.114', draft: true },
				{ tag_name: 'v0.43.113', prerelease: true },
				{ tag_name: 'nightly' },
				{},
			]
		)
		await expect(resolveRange('0.43.x || 0.42.x', undefined)).resolves.toEqual({
			tag: 'v0.42.5',
			semver: '0.42.5',
		})
	})

	it('paginates past a full page', async () => {
		mockReleasesPage(Array.from({ length: 100 }, (_, i) => `v0.43.${i}`))
		mockReleasesPage(['v0.42.5'])
		await expect(resolveRange('0.42.x', undefined)).resolves.toEqual({
			tag: 'v0.42.5',
			semver: '0.42.5',
		})
		expect(httpClient.get).toHaveBeenCalledTimes(2)
	})

	it('throws when no release satisfies the range', async () => {
		mockReleasesPage(['v0.43.114'])
		await expect(resolveRange('1.x', undefined)).rejects.toThrow(
			'No Infisical CLI release satisfies the version range "1.x". See ' +
				'https://github.com/Infisical/cli/releases for available versions.'
		)
	})

	it('throws with rate-limit guidance on HTTP 403', async () => {
		httpClient.get.mockResolvedValueOnce(httpClient.mockResponse(403))
		await expect(resolveRange('0.43.x', undefined)).rejects.toThrow(
			'Failed to list Infisical/cli releases from the GitHub API (HTTP 403). ' +
				'This is likely API rate limiting; pass a "github-token" or pin an ' +
				'exact version via the "version" input.'
		)
	})

	it('throws with generic guidance on other HTTP errors', async () => {
		httpClient.get.mockResolvedValueOnce(httpClient.mockResponse(500))
		await expect(resolveRange('0.43.x', undefined)).rejects.toThrow(
			'Failed to list Infisical/cli releases from the GitHub API (HTTP 500). ' +
				'Pin an exact version via the "version" input to work around this.'
		)
	})
})

describe('resolveVersion', () => {
	it.each(['latest', 'Latest '])('resolves %j over the network', async (input) => {
		httpClient.get.mockResolvedValueOnce(
			httpClient.mockResponse(302, {
				location: 'https://github.com/Infisical/cli/releases/tag/v0.43.114',
			})
		)
		await expect(resolveVersion(input)).resolves.toEqual({
			tag: 'v0.43.114',
			semver: '0.43.114',
		})
		expect(httpClient.get).toHaveBeenCalledTimes(1)
	})

	it('makes zero network calls for an exact version', async () => {
		await expect(resolveVersion('v0.42.5')).resolves.toEqual({
			tag: 'v0.42.5',
			semver: '0.42.5',
		})
		expect(httpClient.get).not.toHaveBeenCalled()
	})

	// v-prefixed ranges are accepted (semver's parser tolerates the prefix)
	// but intentionally undocumented.
	it.each(['0', '0.43', '0.43.x', '^0.43.0', 'v0', 'v0.43', 'v0.43.x', '^v0.43.0'])(
		'resolves the range %j via the releases API',
		async (input) => {
			mockReleasesPage(['v0.43.114', 'v0.42.5'])
			await expect(resolveVersion(input, 'Bearer token123')).resolves.toEqual({
				tag: 'v0.43.114',
				semver: '0.43.114',
			})
		}
	)

	it('rejects input that is neither a version, range, nor "latest"', async () => {
		await expect(resolveVersion('main')).rejects.toThrow('Invalid version "main".')
		expect(httpClient.get).not.toHaveBeenCalled()
	})
})
