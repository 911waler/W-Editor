import type { Component } from 'vue'

export async function loadCapabilityProbe(capability: string | null): Promise<Component | null> {
  if (capability === 'cherry') return (await import('./CherryCapabilityProbe.vue')).default
  if (capability === 'cherry-adapter') return (await import('./CherrySourceAdapterProbe.vue')).default
  return null
}
