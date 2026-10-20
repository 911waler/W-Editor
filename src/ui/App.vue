<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import UserPickerDialog from './UserPickerDialog.vue'
import AnnouncementSettingsDialog from './AnnouncementSettingsDialog.vue'
import type { PublicationInput, PublicationSettings } from '../nwu/publication'
import NwuReader from './NwuReader.vue'
import PlaygroundApp from '../../apps/playground/src/PlaygroundApp.vue'
import HistoryRestoreDialog from '../../apps/playground/src/HistoryRestoreDialog.vue'
import type { DocumentHistorySnapshot } from '../../packages/editor-vue/src/services/documentHistory'
import { scanReferences } from '../../packages/editor-core/src/codecs/references'
import { emptyReferenceLibrary, type LibraryEntry } from '../../packages/editor-vue/src/services/referenceEditorServices'
import { NwuAdapter, type NwuBootstrap, type Metadata } from '../nwu/adapter'
import { editorDocumentUrl } from '../nwu/navigation'
import type { ArticleDefinition } from '../../apps/playground/src/services/articleCatalog'

defineOptions({inheritAttrs:false})

const element = document.querySelector<HTMLScriptElement>('script#nwu-editor-bootstrap[type="application/json"]')
const config: NwuBootstrap | null = element ? JSON.parse(element.textContent ?? '{}') as NwuBootstrap : null
// The site header owns light/dark mode; keep the mounted document intact when
// its root attribute changes, including preferences received from another tab.
const readHostTheme = () => document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'default'
const hostTheme = ref<'dark' | 'default'>(readHostTheme())
const themeObserver = config ? new MutationObserver(() => { hostTheme.value = readHostTheme() }) : null
onMounted(() => {
  themeObserver?.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']})
  hostTheme.value = readHostTheme()
})
onBeforeUnmount(() => themeObserver?.disconnect())
const tutorialMode = config?.documentKind === 'tutorial'
const announcementMode = config?.documentKind === 'announcement'
const initiallyOpenPublication = new URLSearchParams(window.location.search).has('publication')
const adapter = config && !config.readonly ? new NwuAdapter(config) : null
const articles = shallowRef<readonly ArticleDefinition[] | null>(null)
const editor = ref<InstanceType<typeof PlaygroundApp> | null>(null)
const activeId = ref(config?.initialDocumentId ?? '')
const articleTitles = ref<Record<string,string>>({})
const articleGroupOverrides = ref<Record<string,string>>({})
const message = ref('')
const failed = ref(false)
const busy = ref(false)
const metadataOpen = ref(false)
const metadata = ref<Metadata>({title:'',category:'other',visibility:'private',allowedUsernames:[]})
const allowed = ref('')
const users = ref<{id:number;username:string}[]>([])
const picker = ref<'view'|'edit'|null>(null)
const pickerSelected = ref<number[]>([])
const pickerBusy = ref(false)
const canManageAccess = computed(() => metadata.value.canManageAccess !== false)
async function openUserPicker(kind:'view'|'edit') {
  if(!adapter || pickerBusy.value) return
  pickerBusy.value=true
  try {
    users.value=await adapter.users()
    pickerSelected.value=kind==='edit' ? [...(metadata.value.editorUserIds ?? [])] : users.value.filter(user=>allowed.value.split(/[\s,，]+/u).includes(user.username)).map(user=>user.id)
    picker.value=kind
  } catch { message.value='用户列表加载失败，请重试。' }
  finally { pickerBusy.value=false }
}
function confirmUsers(ids:number[]) {
  if(picker.value==='edit') metadata.value.editorUserIds=ids
  else {
    const known=new Set(users.value.map(user=>user.username))
    const unknown=allowed.value.split(/[\s,，]+/u).filter(name=>name && !known.has(name))
    allowed.value=[...unknown,...users.value.filter(user=>ids.includes(user.id)).map(user=>user.username)].join('\n')
  }
  picker.value=null
}
const recoveryAvailable = ref(false)
const announcementState = ref<Metadata['state']>()
const publication = ref<PublicationSettings|null>(null)
const publicationOpen = ref(false)
const publicationError = ref('')
const categoryKeys = computed(() => {
  const labels = config?.categories ?? {other: '其他'}
  const order = config?.categoryOrder ?? ['software_tutorial','scripts','server','rules','study','literature','other']
  return [...new Set([...order, ...Object.keys(labels)])].filter(key => key in labels)
})
const adapterProps = computed(() => adapter ? {
  ...(announcementMode ? {class:'announcement-editor',toolbarImport:true} : {}),
  articleSwitchPolicy: 'save-discard' as const,
  storage: adapter.storage,
  hideToolbarManualSave: true,
  savedMarkdown: (id: string) => adapter.savedMarkdown.get(id),
  articleTitles: articleTitles.value,
  ...(announcementMode ? {} : {
    articleGroupLabels: categoryKeys.value.map(key => config?.categories?.[key]).filter((label): label is string => Boolean(label)),
  }),
  articleGroupOverrides: articleGroupOverrides.value,
  articleModes: adapter.articleModes,
  ...(!tutorialMode && !announcementMode ? {
    createArticle: (input: {title:string}) => adapter.create(input),
    importArticle: (input: {title:string;markdown:string}) => adapter.create(input),
  } : {}),
  loadArticle: (id: string) => adapter.load(id),
  uploadAdapter: adapter.uploadAdapter,
  referenceServices: adapter.referenceServices,
  persistDrawio: (payload: {png:string;xml:string}) => adapter.persistDrawio(payload),
  persistence: {
    saveAutosave: (input: {documentId:string;markdown:string;revision:number}) => adapter.save(input,'autosave-draft'),
    saveManual: (input: {documentId:string;markdown:string;revision:number}) => adapter.save(input,'manual-save'),
    savePublish: (input: {documentId:string;markdown:string;revision:number}) => adapter.save(input,'publish'),
    saveWorkspace: (input: {documentId:string;mode:string;sidebar:Readonly<Record<string,unknown>>}) => adapter.saveWorkspace(input),
  },
} : {})
const returnUrl = computed(() => {
  if (announcementMode) return '/admin/announcements'
  if (!tutorialMode) return config?.blogListUrl
  const slug = activeId.value.slice('tutorial:'.length)
  return slug === 'usage-guide' ? '/usage-guide' : `/admin/software-tutorials/${slug}`
})
function navigateIdentity(id: string) {
  const url = editorDocumentUrl(id, window.location.href)
  window.history.replaceState(null,'',url)
}
async function initialize() {
  if(!config) return
  try {
    if(config.readonly) {
      const value=config.readerDocument
      if(!value) throw new Error('阅读内容不可用。')
      articles.value=[{documentId:value.documentId,title:value.title,initialMarkdown:value.markdown}]
      return
    }
    if(!adapter) return
    adapter.onIdentity=navigateIdentity
    adapter.onNotice=text=>{message.value=text}
    if(announcementMode && !config.initialDocumentId) throw new Error('公告编号不可用。')
    const initial=config.initialDocumentId ? await adapter.load(config.initialDocumentId) : await adapter.create({title:'未命名笔记'})
    activeId.value=initial.documentId
    if(announcementMode) {
      announcementState.value=adapter.metadata(initial.documentId).state
      publication.value=await adapter.publication(initial.documentId)
      announcementState.value=publication.value.state
    }
    navigateIdentity(initial.documentId)
    let catalog: ArticleDefinition[]=[]
    if(!announcementMode) {
      try { catalog=await adapter.list() } catch { message.value='目录暂不可用，当前笔记可以继续编辑。' }
    }
    articles.value=[initial,...catalog.filter(item=>item.documentId!==initial.documentId)]
    recoveryAvailable.value=adapter.recovery(initial.documentId)!==null
    if(announcementMode && initiallyOpenPublication) publicationOpen.value=true
  } catch(error) { failed.value=true; recoveryAvailable.value=adapter?.recovery(activeId.value)!==null && adapter!==null; message.value=error instanceof Error ? error.message : '加载失败。' }
}
onMounted(initialize)
function stateChanged(state: {documentId:string}) {
  if(activeId.value!==state.documentId) {
    activeId.value=state.documentId
    if(adapter) {
      const canonical=adapter.id(state.documentId)
      navigateIdentity(canonical)
      if(announcementMode) { announcementState.value=adapter.metadata(canonical).state; publication.value=null }
    }
  }
  recoveryAvailable.value=adapter?.recovery(state.documentId)!==null && adapter!==null
}
async function save() {
  if(!editor.value || busy.value) return
  busy.value=true
  try { await editor.value.saveForLifecycle(); message.value='已保存到服务器。' }
  catch(error) { message.value=error instanceof Error ? error.message : '保存失败，本地内容已保留。'; recoveryAvailable.value=true }
  finally { busy.value=false }
}
function acceptPublication(value: PublicationSettings) {
  publication.value=value
  announcementState.value=value.state
  articleTitles.value={...articleTitles.value,[activeId.value]:value.title}
}
async function openAnnouncementSettings() {
  if(!announcementMode || !adapter || busy.value) return
  busy.value=true; publicationError.value=''; message.value=''
  try { acceptPublication(await adapter.publication(activeId.value)); publicationOpen.value=true }
  catch(error) { message.value=error instanceof Error ? error.message : '设置载入失败，请重试。' }
  finally { busy.value=false }
}
async function saveAnnouncementSettings(input: PublicationInput) {
  if(!adapter || busy.value) return
  busy.value=true; publicationError.value=''
  try { acceptPublication(await adapter.savePublication(activeId.value,input)); publicationOpen.value=false; message.value='发布设置已保存。' }
  catch(error) { publicationError.value=error instanceof Error ? error.message : '设置保存失败，请重试。' }
  finally { busy.value=false }
}
async function publishAnnouncement() {
  if(!adapter || !editor.value || busy.value) return
  busy.value=true; message.value=''
  try {
    const id = activeId.value
    await editor.value.publishForLifecycle(async input => {
      await adapter!.save(input, 'manual-save')
      acceptPublication(await adapter!.publishAnnouncement(id))
    })
    message.value=publication.value?.state==='scheduled' ? '已加入定时发布。' : '公告已发布。'
  } catch(error) { message.value=error instanceof Error ? error.message : '发布失败，正文已保留。'; recoveryAvailable.value=true }
  finally { busy.value=false }
}
async function cancelAnnouncementSchedule() {
  if(!adapter || busy.value) return
  busy.value=true; publicationError.value=''
  try { acceptPublication(await adapter.cancelAnnouncementSchedule(activeId.value)); publicationOpen.value=false; message.value='已取消定时，可继续编辑。' }
  catch(error) { publicationError.value=error instanceof Error ? error.message : '取消定时失败。' }
  finally { busy.value=false }
}
async function publish() {
  if(!adapter || !editor.value || busy.value) return
  busy.value=true
  message.value=''
  try { await editor.value.publishForLifecycle(); message.value='已发布。' }
  catch(error) { message.value=error instanceof Error ? error.message : '发布失败，本地内容已保留。'; recoveryAvailable.value=true }
  finally {busy.value=false}
}
function openMetadata() {
  if(!adapter) return
  const value=adapter.metadata(activeId.value)
  metadata.value={...value,editorUserIds:[...(value.editorUserIds ?? [])],allowedUsernames:[...value.allowedUsernames]}
  allowed.value=value.allowedUsernames.join('\n')
  metadataOpen.value=true
}
async function saveMetadata() {
  if(!adapter || busy.value) return
  busy.value=true
  adapter.setMetadata(activeId.value,{...metadata.value,allowedUsernames:allowed.value.split(/[\s,，]+/u).filter(Boolean)})
  try { await editor.value?.publishForLifecycle(); articleTitles.value={...articleTitles.value,[activeId.value]:metadata.value.title}; articleGroupOverrides.value={...articleGroupOverrides.value,[activeId.value]:config?.categories?.[metadata.value.category] ?? config?.categories?.['other'] ?? '其他'}; metadataOpen.value=false; message.value='笔记及权限已保存。' }
  catch(error) { message.value=error instanceof Error ? error.message : '保存失败。' }
  finally {busy.value=false}
}
const historyOpen = ref(false)
const historyDocumentId = ref('')
const historyRecovery = shallowRef<DocumentHistorySnapshot | null>(null)
const historyError = ref('')
watch(activeId, () => { historyOpen.value = false })
function recover(): void {
  if (!adapter || busy.value || tutorialMode) return
  historyDocumentId.value = adapter.id(activeId.value)
  const value = adapter.recovery(activeId.value)
  historyRecovery.value = value ? { id: 'local-recovery', title: value.metadata.title, markdown: value.markdown, savedAt: value.savedAt ?? null, kind: 'recovery' } : null
  historyError.value = ''
  historyOpen.value = true
}
async function restoreHistory(value: DocumentHistorySnapshot): Promise<void> {
  if (!adapter || busy.value || adapter.id(activeId.value) !== historyDocumentId.value) return
  const sourceDocumentId = historyDocumentId.value
  busy.value = true
  historyError.value = ''
  let createdCopy: ArticleDefinition | null = null
  try {
    // Recheck history authorization at the action boundary, not just when preview opened.
    const selected = value.kind === 'recovery' ? value : await adapter.historyServices.get(sourceDocumentId, value.id)
    if (adapter.id(activeId.value) !== sourceDocumentId) throw new Error('文档已切换，请重新选择历史版本。')
    await editor.value?.flushForLifecycle()
    const services = adapter.referenceServices
    const sourceLibrary = services.loadLibrary && services.saveLibrary
      ? await services.loadLibrary(sourceDocumentId) : emptyReferenceLibrary()
    const sourceNotes = await services.loadNotes(sourceDocumentId)
    if (adapter.id(activeId.value) !== sourceDocumentId) throw new Error('文档已切换，请重新选择历史版本。')
    const entries = new Map<string, LibraryEntry>(sourceLibrary.entries.map(entry => [entry.id, entry]))
    const historicalReferences = scanReferences(selected.markdown)
    // Historical citations retain their stable IDs and exact historical payloads.
    for (const reference of historicalReferences) entries.set(reference.id, {
      id: reference.id, text: reference.text,
      ...(reference.metadata === undefined ? {} : { metadata: reference.metadata }),
      ...(reference.style === undefined ? {} : { style: reference.style }),
    })
    const title = `${selected.title || '未命名'}（${announcementMode ? '恢复草稿副本' : '私有恢复副本'}）`
    const article = await adapter.create({ title, markdown: selected.markdown })
    createdCopy = article
    historyOpen.value = false
    let copyError = ''
    try {
      if (services.loadLibrary && services.saveLibrary) await services.saveLibrary(article.documentId, {
        revision: 0, entries: [...entries.values()],
        deletedIds: sourceLibrary.deletedIds.filter(id => !entries.has(id)),
        highWater: Math.max(sourceLibrary.highWater, ...historicalReferences.map(reference => reference.number)),
      })
      for (const id of entries.keys()) {
        const note = sourceNotes[id]
        if (note?.text) await services.saveNote(article.documentId, id, { text: note.text, revision: 0 })
      }
    } catch (error) { copyError = error instanceof Error ? error.message : '资料保存失败。' }
    if (editor.value) await editor.value.openHostArticle(article, 'imported')
    else { navigateIdentity(article.documentId); window.location.reload() }
    message.value = announcementMode ? '已创建未发布公告草稿副本，原公告保留。' : '已创建私有恢复副本，原笔记保留。'
    if (copyError) message.value += `参考文献或备注未能完整复制：${copyError}。源文档资料保留，请核对并补齐副本中的资料。`
  } catch (error) {
    const detail = error instanceof Error ? error.message : '恢复失败。'
    historyError.value = createdCopy ? `副本已创建（${createdCopy.documentId}），但未能打开：${detail}。请从目录打开该副本，源文档资料保留。` : detail
    message.value = historyError.value
  }
  finally { busy.value = false }
}

</script>

<template>
  <PlaygroundApp
    v-if="!config"
    v-bind="$attrs"
  />
  <NwuReader
    v-else-if="config.readonly"
    :config="config"
    :host-theme="hostTheme"
  />
  <PlaygroundApp
    v-else-if="articles"
    ref="editor"
    :article-catalog="articles"
    v-bind="{...$attrs,...adapterProps}"
    :host-theme="hostTheme"
    :on-workspace-state-change="stateChanged"
  >
    <template #document-actions>
      <a
        :href="returnUrl"
        class="tool-button"
      >{{ announcementMode ? '公告管理' : tutorialMode ? '查看教程' : '笔记列表' }}</a>
      <button
        v-if="!tutorialMode && !announcementMode"
        class="tool-button"
        type="button"
        :disabled="busy"
        @click="openMetadata"
      >
        笔记属性
      </button>
      <button
        class="tool-button"
        type="button"
        :disabled="busy"
        :data-testid="announcementMode ? 'announcement-manual-save' : undefined"
        @click="save"
      >
        {{ announcementMode ? (announcementState === 'published' ? '保存修改' : '保存草稿') : '保存' }}
      </button>
      <button
        v-if="announcementMode"
        class="tool-button"
        type="button"
        :disabled="busy"
        data-testid="announcement-settings"
        @click="openAnnouncementSettings"
      >
        发布设置
      </button>
      <button
        v-if="announcementMode && announcementState==='draft'"
        class="tool-button announcement-publish"
        type="button"
        :disabled="busy || !publication"
        data-testid="announcement-direct-publish"
        @click="publishAnnouncement"
      >
        {{ publication?.scheduledFor ? '定时发布' : '发布公告' }}
      </button>
      <span v-if="announcementMode && announcementState==='scheduled'">已加入定时发布</span>
      <button
        v-if="!tutorialMode && !announcementMode"
        class="tool-button"
        type="button"
        :disabled="busy"
        data-testid="announcement-direct-publish"
        @click="publish"
      >
        发布
      </button>
      <button
        v-if="!tutorialMode"
        class="tool-button"
        type="button"
        :disabled="busy"
        data-testid="open-history-restore"
        @click="recover"
      >
        {{ announcementMode ? '恢复为公告草稿' : '恢复为副本' }}
      </button>
      <span role="status">{{ message }}</span>
    </template>
    <template #document-dialogs>
      <AnnouncementSettingsDialog
        v-if="publicationOpen && publication"
        :settings="publication"
        :busy="busy"
        :error="publicationError"
        @close="publicationOpen=false"
        @save="saveAnnouncementSettings"
        @cancel-schedule="cancelAnnouncementSchedule"
      />
      <div
        v-if="metadataOpen"
        class="dialog-backdrop"
        @click.self="metadataOpen=false"
      >
        <form
          class="dialog-panel note-properties"
          aria-label="笔记属性"
          role="dialog"
          aria-modal="true"
          @submit.prevent="saveMetadata"
        >
          <header class="note-properties__header">
            <h2>笔记属性</h2>
            <button
              type="button"
              class="note-properties__close"
              aria-label="关闭笔记属性"
              @click="metadataOpen=false"
            >
              ×
            </button>
          </header>
          <div class="note-properties__body">
            <div class="note-properties__fields">
              <label class="note-properties__field">标题<input
                v-model="metadata.title"
                required
                maxlength="200"
              /></label>
              <div class="note-properties__field-row">
                <label class="note-properties__field">分类<select
                  v-model="metadata.category"
                  required
                ><option
                  v-for="key in categoryKeys"
                  :key="key"
                  :value="key"
                >{{ config.categories?.[key] ?? '其他' }}</option></select></label>
                <label class="note-properties__field">可见性<select
                  v-model="metadata.visibility"
                  :disabled="!canManageAccess"
                ><option value="private">私有（作者及授权编辑者）</option><option value="public">公开</option><option value="selected">指定用户</option><option value="group">仅课题组内部查看</option></select></label>
              </div>
            </div>
            <div class="note-properties__permissions">
              <p
                v-if="metadata.visibility==='group'"
                class="note-properties__hint"
              >
                课题组成员、作者和已授权编辑者可查看，其他外部成员不可查看。
              </p>
              <div
                v-if="metadata.visibility==='selected'"
                class="note-properties__permission"
              >
                <div class="note-properties__permission-heading">
                  <label for="note-properties-viewers">允许查看的用户</label>
                  <button
                    v-if="config.isAdmin && canManageAccess"
                    type="button"
                    :disabled="pickerBusy || busy"
                    @click="openUserPicker('view')"
                  >
                    选择可查看用户
                  </button>
                </div>
                <textarea
                  id="note-properties-viewers"
                  v-model="allowed"
                  rows="3"
                  aria-describedby="note-properties-viewers-hint"
                  :disabled="!canManageAccess"
                ></textarea>
                <p
                  id="note-properties-viewers-hint"
                  class="note-properties__hint"
                >
                  每行填写一个用户名。
                </p>
              </div>
              <div
                v-if="canManageAccess"
                class="note-properties__permission grant-settings"
              >
                <div class="note-properties__permission-heading">
                  <p>允许编辑的用户：已选 {{ metadata.editorUserIds?.length ?? 0 }} 人</p>
                  <button
                    type="button"
                    :disabled="pickerBusy || busy"
                    @click="openUserPicker('edit')"
                  >
                    选择可编辑用户
                  </button>
                </div>
                <p class="note-properties__hint">
                  编辑者可查看和修改内容，不能删除文章、更改可见性或转授权。
                </p>
              </div>
              <p
                v-else
                class="note-properties__hint"
              >
                你可以编辑内容；可见性和授权由作者或管理员管理。
              </p>
            </div>
            <p
              class="note-properties__status"
              :class="{'note-properties__status--empty': !message}"
              role="status"
            >
              {{ message }}
            </p>
          </div>
          <footer class="note-properties__footer dialog-panel__actions">
            <button
              type="button"
              @click="metadataOpen=false"
            >
              取消
            </button>
            <button
              type="submit"
              class="primary-action"
              :disabled="busy"
            >
              保存并发布
            </button>
          </footer>
        </form>
      </div>
      <UserPickerDialog
        v-if="picker"
        :title="picker==='view' ? '选择可查看用户' : '选择可编辑用户'"
        :users="users"
        :selected="pickerSelected"
        @confirm="confirmUsers"
        @cancel="picker=null"
      />
    </template>
  </PlaygroundApp>
  <main
    v-else
    class="w-editor-instance"
    role="status"
  >
    <p>{{ failed ? message : announcementMode ? '正在加载公告…' : '正在加载笔记…' }}</p>
    <button
      v-if="failed && recoveryAvailable && !tutorialMode"
      type="button"
      :disabled="busy"
      @click="recover"
    >
      {{ announcementMode ? '恢复为公告草稿' : '恢复为私有副本' }}
    </button>
    <a
      v-if="failed && config"
      :href="returnUrl"
    >{{ announcementMode ? '返回公告管理' : tutorialMode ? '返回教程' : '返回笔记列表' }}</a>
  </main>
  <HistoryRestoreDialog
    v-if="historyOpen && adapter"
    :key="historyDocumentId"
    :document-id="historyDocumentId"
    :services="adapter.historyServices"
    :recovery="historyRecovery"
    :busy="busy"
    :error="historyError"
    @close="historyOpen = false"
    @restore="restoreHistory"
  />
</template>

<style>
.announcement-publish { font-weight:600; }
.announcement-editor .article-panel {
  display: none;
}

.announcement-editor .workspace-body {
  grid-template-columns: minmax(0, 1fr) !important;
}
</style>

<style>
.announcement-editor .announcement-import-button { margin-left: auto; }
</style>

<style>
.workspace-shell .dialog-panel.note-properties {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: calc(100dvh - 32px);
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--app-border-strong, #c3d8ce);
  border-radius: 12px;
  box-shadow: none;
  font: 14px/1.5 system-ui, sans-serif;
}
.note-properties__header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px 16px; flex-shrink: 0; }
.note-properties .note-properties__header h2 { margin: 0; font: 650 20px/1.4 system-ui, sans-serif; }
.note-properties__body { display: flex; flex-direction: column; gap: 24px; min-height: 0; padding: 0 24px 24px; overflow-y: auto; }
.note-properties__fields { display: flex; flex-direction: column; gap: 16px; }
.note-properties__field-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
.note-properties .note-properties__field { display: flex; flex-direction: column; gap: 8px; min-width: 0; margin: 0; font-size: 14px; line-height: 1.5; font-weight: 600; }
.dialog-panel.note-properties :is(input, select, textarea) { box-sizing: border-box; min-width: 0; min-height: 44px; padding: 10px 12px; font: 400 14px/1.5 system-ui, sans-serif; }
.dialog-panel.note-properties textarea { min-height: 96px; max-height: 240px; resize: vertical; }
.note-properties__permissions { display: flex; flex-direction: column; gap: 20px; padding-top: 24px; border-top: 1px solid var(--app-border, #d4e0d9); }
.note-properties__permission { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.note-properties__permission-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px 16px; flex-wrap: wrap; }
.note-properties .note-properties__permission-heading :is(label, p) { margin: 0; font-size: 14px; font-weight: 600; }
.note-properties .note-properties__hint { margin: 0; color: var(--app-text-secondary, #40574d); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.dialog-panel.note-properties button { min-height: 44px; padding: 10px 16px; border: 1px solid var(--app-border-strong, #c3d8ce); border-radius: 8px; background: var(--app-surface, #fff); color: var(--app-text, #17211d); font: 500 14px/1.5 system-ui, sans-serif; cursor: pointer; }
.dialog-panel.note-properties button:hover { background: var(--app-hover, #edf5f1); }
.dialog-panel.note-properties button:focus-visible { outline: 2px solid var(--app-focus, #176b4d); outline-offset: 2px; }
.dialog-panel.note-properties button:disabled { opacity: .6; cursor: wait; }
.dialog-panel.note-properties .note-properties__close { width: 44px; padding: 0; border: 0; background: transparent; color: var(--app-text-secondary, #40574d); font-size: 24px; font-weight: 400; }
.note-properties .note-properties__close:hover { background: var(--app-hover, #edf5f1); }
.note-properties .note-properties__footer { flex-shrink: 0; gap: 12px; margin: 0; padding: 16px 24px; border-top: 1px solid var(--app-border, #d4e0d9); background: var(--app-surface-muted, #f2f6f4); }
.note-properties__footer button { min-width: 96px; }
.dialog-panel.note-properties .note-properties__footer .primary-action { border-color: #176b4d; background: #176b4d; color: #fff; }
.dialog-panel.note-properties .note-properties__footer .primary-action:hover { border-color: #145b43; background: #145b43; }
.note-properties__status { margin: 0; padding: 12px; border-radius: 8px; background: var(--app-surface-muted, #f2f6f4); color: var(--app-text, #17211d); overflow-wrap: anywhere; }
.note-properties__status--empty { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
@media (max-width: 520px) {
  .note-properties__header { padding: 16px; }
  .note-properties__body { padding: 0 16px 16px; }
  .note-properties__field-row { grid-template-columns: minmax(0, 1fr); }
  .note-properties .note-properties__footer { padding: 16px; }
  .dialog-panel.note-properties .note-properties__footer button { flex: 1; min-width: 0; }
}
</style>
