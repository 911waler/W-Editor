<script setup lang="ts">
import { ref } from 'vue'
import { referenceUrl, type DocumentReference } from '@w-editor/editor-core'
defineProps<{ entries: readonly DocumentReference[]; selected: string | null; error: string; busy: boolean }>()
const emit = defineEmits<{ close: []; insert: [text: string]; jump: [id: string] }>()
const text = ref('')
</script>
<template>
  <aside
    class="reference-panel"
    aria-label="参考文献 / References"
    data-testid="reference-panel"
    @keydown.esc="emit('close')"
  >
    <header>
      <strong>参考文献 / References</strong><button
        type="button"
        aria-label="关闭 / Close"
        @click="emit('close')"
      >
        ×
      </button>
    </header>
    <p>编辑时编号递增；发布时按正文首次出现的顺序重排。</p>
    <form @submit.prevent="emit('insert', text)">
      <label for="reference-input">网址、DOI 或文献信息</label>
      <textarea
        id="reference-input"
        v-model="text"
        autofocus
        rows="4"
        placeholder="https://… / 10.… / 作者、标题等"
      ></textarea>
      <button
        type="submit"
        :disabled="busy || !text.trim()"
      >
        在光标处引用
      </button>
    </form>
    <p
      v-if="error"
      role="alert"
    >
      {{ error }}
    </p>
    <ol>
      <li
        v-for="entry in entries"
        :key="entry.id"
        :class="{ selected: entry.id === selected }"
        :data-reference-entry="entry.id"
      >
        <button
          type="button"
          @click="emit('jump', entry.id)"
        >
          [{{ entry.number }}]
        </button>
        <a
          v-if="referenceUrl(entry.text)"
          :href="referenceUrl(entry.text)!"
          target="_blank"
          rel="noopener noreferrer"
        >{{ entry.text }}</a>
        <span v-else>{{ entry.text }}</span>
        <button
          type="button"
          :disabled="busy"
          @click="emit('insert', entry.text)"
        >
          再次引用
        </button>
      </li>
    </ol>
    <p v-if="!entries.length">
      还没有参考文献。
    </p>
  </aside>
</template>
<style scoped>
.reference-panel { position: fixed; inset: 90px 16px 24px auto; z-index: 50; width: min(360px, calc(100vw - 32px)); overflow: auto; padding: 20px; background: var(--app-surface, #fff); color: var(--app-text, #24352c); border: 1px solid #9caaa2; border-radius: 10px; box-shadow: 0 8px 32px #0002; }
header { display: flex; justify-content: space-between; gap: 16px; align-items: center; }
p { font-size: 13px; }
textarea { display: block; width: 100%; box-sizing: border-box; margin: 8px 0; }
ol { list-style: none; padding: 0; }
li { padding: 12px 4px; border-bottom: 1px solid #ccc; overflow-wrap: anywhere; }
li.selected { background: #eaf3ef; }
button { cursor: pointer; margin: 4px; }
</style>
