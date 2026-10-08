import vm from 'node:vm'

/**
 * Runs fn and returns its result, or throws if it takes longer than ms. A
 * plain test timeout can't stop an endless synchronous loop; a vm timeout
 * can, so a walker that hangs fails the test instead of freezing the run.
 */
export function withinMs<T>(ms: number, fn: () => T): T {
  return vm.runInNewContext('fn()', { fn }, { timeout: ms }) as T
}
