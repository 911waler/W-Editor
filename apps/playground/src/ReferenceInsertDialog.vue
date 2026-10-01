<script setup lang="ts">
import { referenceDialogFocus as vReferenceDialogFocus } from './referenceDialogFocus'
import type { DocumentReference, ReferenceMetadata, ReferenceStyle } from '@w-editor/editor-core'
import ReferenceForm from './ReferenceForm.vue'
defineProps<{
  defaultStyle?: ReferenceStyle | null
  busy: boolean; error: string
  lookupDoi?: ((doi: string, signal: AbortSignal) => Promise<ReferenceMetadata>) | undefined
}>()
const emit = defineEmits<{ insert: [reference: Pick<DocumentReference, 'text' | 'metadata' | 'style'>]; collect: [reference: Pick<DocumentReference, 'text' | 'metadata' | 'style'>]; close: [] }>()
</script>
<template>
  <div
    class="reference-insert-overlay"
    @keydown.esc.stop="emit('close')"
  >
    <section
      v-reference-dialog-focus
      class="reference-insert-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="新增参考文献"
      data-testid="reference-insert-dialog"
    >
      <header>
        <strong>新增参考文献</strong><button
          type="button"
          aria-label="关闭 / Close"
          @click="emit('close')"
        >
          ×
        </button>
      </header>
      <ReferenceForm
        :busy="busy"
        :default-style="defaultStyle"
        :lookup-doi="lookupDoi"
        submit-label="在光标处引用"
        allow-collect
        @save="emit('insert', $event)"
        @collect="emit('collect', $event)"
      />
      <p
        v-if="error"
        role="alert"
      >
        {{ error }}
      </p>
    </section>
  </div>
</template>
<style scoped>
.reference-insert-overlay { position: fixed; inset: 0; z-index: 70; background: #0005; display: flex; align-items: flex-start; justify-content: center; padding: 16vh 16px 24px; }
.reference-insert-dialog { width: min(480px, 100%); max-height: 70vh; overflow: auto; padding: 20px; background: var(--app-surface, #fff); color: var(--app-text, #24352c); border: 1px solid #9caaa2; border-radius: 10px; box-shadow: 0 8px 32px #0002; }
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
button { cursor: pointer; padding: 5px 8px; border: 1px solid #aab6af; border-radius: 4px; background: var(--app-surface, #fff); color: inherit; }
p { font-size: 13px; }
</style>
