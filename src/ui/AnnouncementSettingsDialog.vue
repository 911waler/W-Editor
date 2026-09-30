<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AnnouncementTimeField from './AnnouncementTimeField.vue'
import type { PublicationInput, PublicationSettings } from '../nwu/publication'
const props=defineProps<{settings:PublicationSettings; busy:boolean; error:string}>()
const emit=defineEmits<{close:[]; save:[input:PublicationInput]; cancelSchedule:[]}>()
const dialog=ref<HTMLDialogElement|null>(null)
const form=ref<PublicationInput>({title:props.settings.title,level:props.settings.level,sendEmail:props.settings.sendEmail,
  scheduledFor:props.settings.scheduledFor,reminderEndsAt:props.settings.reminderEndsAt})
const trigger=document.activeElement as HTMLElement|null
onMounted(()=>dialog.value?.showModal())
onBeforeUnmount(()=>{ dialog.value?.close();trigger?.focus() })
function close() { if(!props.busy) emit('close') }
function submit() { if(!props.busy) emit('save',{...form.value,sendEmail:form.value.level==='important' && form.value.sendEmail}) }
</script>
<template>
  <dialog
    ref="dialog"
    class="announcement-settings-dialog"
    aria-labelledby="announcement-settings-title"
    @cancel.prevent="close"
  >
    <form @submit.prevent="submit">
      <header>
        <div>
          <h2 id="announcement-settings-title">
            发布设置
          </h2><p>所有时间均为北京时间 · 24 小时制</p>
        </div><button
          type="button"
          aria-label="关闭发布设置"
          :disabled="busy"
          @click="close"
        >
          关闭
        </button>
      </header>
      <fieldset
        class="announcement-settings-fields"
        :disabled="busy"
      >
        <label>公告标题<input
          v-model="form.title"
          name="title"
          required
          maxlength="120"
          autofocus
        /></label>
        <label>公告级别<select v-model="form.level"><option value="normal">普通公告</option><option value="important">重要公告</option></select></label>
        <AnnouncementTimeField
          v-if="settings.state!=='published'"
          v-model="form.scheduledFor"
          label="定时发布时间（可选）"
        />
        <AnnouncementTimeField
          v-model="form.reminderEndsAt"
          label="提醒截止时间（可选）"
        />
        <p class="announcement-settings-hint">
          截止时间须晚于发布时间；提醒结束后仍可查看公告正文。
        </p>
        <label class="announcement-email"><input
          v-model="form.sendEmail"
          type="checkbox"
          :disabled="form.level!=='important'"
        />发送邮件提醒（仅重要公告）</label>
        <p class="announcement-settings-hint">
          {{ settings.mailLabel }} · 有效邮箱 {{ settings.recipientCount }} 个
        </p>
        <p
          v-if="settings.state==='published'"
          class="announcement-settings-hint"
        >
          修改已发布公告不会重发邮件。
        </p>
      </fieldset>
      <p
        v-if="error"
        class="announcement-settings-error"
        role="alert"
      >
        {{ error }}
      </p>
      <footer>
        <button
          v-if="settings.state==='scheduled'"
          type="button"
          :disabled="busy"
          @click="emit('cancelSchedule')"
        >
          取消定时
        </button><span></span><button
          type="button"
          :disabled="busy"
          @click="close"
        >
          取消
        </button><button
          class="announcement-settings-save"
          type="submit"
          :disabled="busy"
        >
          {{ busy ? '正在保存…' : '保存设置' }}
        </button>
      </footer>
    </form>
  </dialog>
</template>
<style>
.announcement-settings-dialog { box-sizing:border-box; width:min(560px,calc(100vw - 32px)); max-height:calc(100dvh - 32px); margin:auto; padding:24px; overflow:auto; border:1px solid var(--app-border,#cbd3d0); border-radius:12px; background:var(--app-panel,#f4f7f5); color:var(--app-text,#17211d); box-shadow:0 16px 48px #0003; font:14px/1.5 system-ui,sans-serif; }
.announcement-settings-dialog::backdrop { background:#0006; }
.announcement-settings-dialog header { display:flex; align-items:start; justify-content:space-between; gap:16px; margin-bottom:20px; }
.announcement-settings-dialog h2 { margin:0; font:600 20px/1.4 system-ui,sans-serif; }
.announcement-settings-dialog p { margin:6px 0; }
.announcement-settings-dialog header p,.announcement-settings-hint { color:var(--app-text-secondary,#4d6258); font-size:12px; }
.announcement-settings-fields { border:0; margin:0; padding:0; display:grid; gap:14px; }
.announcement-settings-dialog label { display:grid; gap:5px; min-width:0; }
.announcement-settings-dialog input:not([type=checkbox]),.announcement-settings-dialog select { width:100%; box-sizing:border-box; min-width:0; min-height:38px; padding:6px 9px; border:1px solid var(--app-border,#cbd3d0); border-radius:6px; background:var(--app-surface,#fff); color:inherit; font:inherit; }
.announcement-settings-dialog :is(button,input,select):focus-visible { outline:2px solid var(--app-accent,#176b4d); outline-offset:2px; }
.announcement-time-field { border:0; margin:0; padding:0; min-width:0; }
.announcement-time-field legend { padding:0; margin-bottom:6px; }
.announcement-time-fields { display:grid; grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr); gap:10px; }
.announcement-time-fields label { font-size:12px; }
.announcement-settings-dialog .announcement-email { display:flex; align-items:center; gap:8px; }
.announcement-settings-dialog input[type=checkbox] { width:16px; height:16px; margin:0; }
.announcement-settings-dialog footer { display:flex; gap:10px; margin-top:22px; flex-wrap:wrap; }
.announcement-settings-dialog footer span { flex:1; }
.announcement-settings-dialog button { padding:7px 12px; border:1px solid var(--app-border,#cbd3d0); border-radius:6px; background:var(--app-surface,#fff); color:inherit; font:inherit; cursor:pointer; }
.announcement-settings-dialog button:disabled { cursor:wait; opacity:.6; }
.announcement-settings-dialog .announcement-settings-save { color:#fff; background:#176b4d; border-color:#176b4d; }
.announcement-settings-dialog .announcement-time-clear { padding:3px 0; margin-top:4px; border:0; background:transparent; font-size:12px; text-decoration:underline; }
.announcement-settings-error { color:var(--app-danger,#b42318); }
@media(max-width:420px) { .announcement-settings-dialog { padding:16px; } .announcement-time-fields { grid-template-columns:1fr 1fr; } .announcement-time-fields label:first-child { grid-column:1/-1; } }
</style>
