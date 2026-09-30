/** getRandomValues remains available on the authorized LAN HTTP service. */
export function installRandomUuid(target: {getRandomValues: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array; randomUUID?: () => string} = globalThis.crypto): () => string {
  if(target.randomUUID) return target.randomUUID.bind(target)
  const randomUUID=()=>{
    const bytes=target.getRandomValues(new Uint8Array(16))
    bytes[6]=((bytes[6] ?? 0)&15)|64
    bytes[8]=((bytes[8] ?? 0)&63)|128
    const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('')
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
  }
  Object.defineProperty(target,'randomUUID',{value:randomUUID,configurable:true})
  return randomUUID
}
