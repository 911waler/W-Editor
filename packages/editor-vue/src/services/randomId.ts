export function createRandomId(randomSource: Pick<Crypto, 'randomUUID'> | null | undefined = globalThis.crypto): string {
  const randomUUID = randomSource?.randomUUID
  if (typeof randomUUID === 'function') return randomUUID.call(randomSource)
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
