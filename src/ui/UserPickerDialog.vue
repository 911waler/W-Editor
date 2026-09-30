<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
const props = defineProps<{title:string; users:readonly {id:number;username:string}[]; selected:readonly number[]}>()
const emit = defineEmits<{confirm:[ids:number[]]; cancel:[]}>()
const dialog = ref<HTMLDialogElement|null>(null)
const search = ref('')
const selected = ref([...props.selected])
const users = computed(() => props.users.filter(user => user.username.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())))
onMounted(() => dialog.value?.showModal())
onBeforeUnmount(() => dialog.value?.close())
</script>
<template>
  <dialog
    ref="dialog"
    class="grant-picker"
    aria-labelledby="grant-picker-title"
    @cancel.prevent="emit('cancel')"
  >
    <form @submit.prevent="emit('confirm', [...selected])">
      <h2 id="grant-picker-title">
        {{ title }}
      </h2>
      <label>搜索用户<input
        v-model="search"
        type="search"
        autofocus
        placeholder="输入用户名"
      /></label>
      <p
        class="grant-picker-summary"
        role="status"
      >
        已选 {{ selected.length }} 人 · 确认后保存笔记属性生效
      </p>
      <div class="grant-picker-users">
        <label
          v-for="user in users"
          :key="user.id"
          class="grant-picker-user"
        >
          <input
            v-model="selected"
            type="checkbox"
            :value="user.id"
          />
          <span>{{ user.username }}</span>
        </label>
        <p v-if="!users.length">
          没有匹配的用户。
        </p>
      </div>
      <footer>
        <button
          type="button"
          @click="emit('cancel')"
        >
          取消
        </button><button type="submit">
          确认选择
        </button>
      </footer>
    </form>
  </dialog>
</template>
<style scoped>
.grant-picker { width:min(440px,calc(100vw - 32px)); max-height:calc(100dvh - 48px); box-sizing:border-box; overflow:auto; padding:24px; border:1px solid var(--app-border-strong,#b8c9c0); border-radius:8px; background:var(--app-surface,#fff); color:var(--app-text,#202b25); }
.grant-picker::backdrop { background:rgb(0 0 0 / 35%); }
.grant-picker h2 { margin:0 0 16px; font-size:1.25rem; }
.grant-picker input[type="search"] { display:block; width:100%; box-sizing:border-box; margin-top:6px; padding:8px; }
.grant-picker-summary { font-size:.875rem; }
.grant-picker-users { max-height: min(45dvh,360px); overflow:auto; border-block:1px solid var(--app-border-strong,#b8c9c0); padding-block:6px; }
.grant-picker .grant-picker-user { display:flex; align-items:center; gap:10px; min-height:40px; overflow-wrap:anywhere; cursor:pointer; }
.grant-picker-user input { width:18px; height:18px; flex-shrink:0; }
.grant-picker footer { display:flex; justify-content:flex-end; gap:8px; margin-top:16px; }
.grant-picker button { min-height:36px; padding:6px 14px; cursor:pointer; }
</style>
