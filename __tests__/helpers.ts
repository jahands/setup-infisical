import type { Result } from 'better-result'

/** Assert that a Result is Err and return its error, narrowed. */
export function expectErr<T, E>(result: Result<T, E>): E {
	if (result.isOk()) {
		expect.fail(`expected an Err result, got Ok(${JSON.stringify(result.value)})`)
	}
	return result.error
}
