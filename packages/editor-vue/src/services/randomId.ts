let fallbackSequence = 0

/** Internal editor identities only: never use this fallback for secrets or access tokens. */
export function createRandomId(randomSource: { readonly randomUUID?: () => string } | null | undefined = globalThis.crypto): string {
  const randomUUID = randomSource?.randomUUID
  if (typeof randomUUID === 'function') {
    try {
      return randomUUID.call(randomSource)
    } catch (failure) {
      // Firefox can expose Web Crypto while its random source is unavailable.
      if (typeof failure !== 'object' || failure === null || !('name' in failure) || failure.name !== 'OperationError') throw failure
    }
  }
  fallbackSequence += 1
  return `${Date.now().toString(36)}-${fallbackSequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
