import * as httpClient from '../__fixtures__/http-client.js'

vi.mock('@actions/http-client', () => import('../__fixtures__/http-client.js'))

const { normalizeVersion, resolveLatest, resolveVersion } =
  await import('../src/version.js')

describe('normalizeVersion', () => {
  it('accepts a bare semver', () => {
    expect(normalizeVersion('0.43.114')).toEqual({
      tag: 'v0.43.114',
      semver: '0.43.114'
    })
  })

  it('accepts a v-prefixed semver', () => {
    expect(normalizeVersion('v0.43.114')).toEqual({
      tag: 'v0.43.114',
      semver: '0.43.114'
    })
  })

  it.each(['0.43', '0.43.114-beta', 'main', ''])('rejects %j', (input) => {
    expect(() => normalizeVersion(input)).toThrow(
      `Invalid version "${input}". Expected an exact version like "0.43.114" ` +
        '(optionally prefixed with "v") or "latest".'
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
      semver: '0.41.91'
    })
  })
})

describe('resolveLatest', () => {
  it('parses the version tag from the releases/latest redirect', async () => {
    httpClient.get.mockResolvedValueOnce(
      httpClient.mockResponse(302, {
        location: 'https://github.com/Infisical/cli/releases/tag/v0.43.114'
      })
    )
    await expect(resolveLatest()).resolves.toEqual({
      tag: 'v0.43.114',
      semver: '0.43.114'
    })
    expect(httpClient.get).toHaveBeenCalledWith(
      'https://github.com/Infisical/cli/releases/latest'
    )
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
        location: 'https://github.com/Infisical/cli/releases'
      })
    )
    await expect(resolveLatest()).rejects.toThrow(
      'could not parse a version tag from the redirect location'
    )
  })
})

describe('resolveVersion', () => {
  it.each(['latest', 'Latest '])(
    'resolves %j over the network',
    async (input) => {
      httpClient.get.mockResolvedValueOnce(
        httpClient.mockResponse(302, {
          location: 'https://github.com/Infisical/cli/releases/tag/v0.43.114'
        })
      )
      await expect(resolveVersion(input)).resolves.toEqual({
        tag: 'v0.43.114',
        semver: '0.43.114'
      })
      expect(httpClient.get).toHaveBeenCalledTimes(1)
    }
  )

  it('makes zero network calls for an exact version', async () => {
    await expect(resolveVersion('v0.42.5')).resolves.toEqual({
      tag: 'v0.42.5',
      semver: '0.42.5'
    })
    expect(httpClient.get).not.toHaveBeenCalled()
  })
})
