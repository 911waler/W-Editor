<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import UserPickerDialog from './UserPickerDialog.vue'
import AnnouncementSettingsDialog from './AnnouncementSettingsDialog.vue'
import type { PublicationInput, PublicationSettings } from '../nwu/publication'
import NwuReader from './NwuReader.vue'
import PlaygroundApp from '../../apps/playground/src/PlaygroundApp.vue'
import { NwuAdapter, type NwuBootstrap, type Metadata } from '../nwu/adapter'
import { editorDocumentUrl } from '../nwu/navigation'
import type { ArticleDefinition } from '../../apps/playground/src/services/articleCatalog'

defineOptions({inheritAttrs:false})

const element = document.querySelector<HTMLScriptElement>('script#nwu-editor-bootstrap[type="application/json"]')
const config: NwuBootstrap | null = element ? JSON.parse(element.textContent ?? '{}') as NwuBootstrap : null
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
    await editor.value.saveForLifecycle()
    acceptPublication(await adapter.publishAnnouncement(activeId.value))
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
async function recover() {
  if(!adapter || busy.value) return
  const value=adapter.recovery(activeId.value)
  if(!value) return
  busy.value=true
  try {
    const title=announcementMode ? `${value.metadata.title}（恢复草稿副本）` : `${value.metadata.title}（私有恢复副本）`
    const article=await adapter.create({title,markdown:value.markdown})
    if(editor.value) await editor.value.openHostArticle(article,'imported')
    else { navigateIdentity(article.documentId); window.location.reload() }
    message.value=announcementMode ? '已创建公告草稿副本，原公告仍保留在服务器。' : '已创建私有恢复副本，原笔记仍保留在服务器。'
  } catch(error) {message.value=error instanceof Error ? error.message : '恢复失败。'}
  finally {busy.value=false}
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
  />
  <PlaygroundApp
    v-else-if="articles"
    ref="editor"
    :article-catalog="articles"
    v-bind="{...$attrs,...adapterProps}"
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
        v-if="recoveryAvailable && !tutorialMode"
        class="tool-button"
        type="button"
        :disabled="busy"
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
          class="dialog-panel"
          aria-label="笔记属性"
          role="dialog"
          aria-modal="true"
          @submit.prevent="saveMetadata"
        >
          <h2>笔记属性</h2>
          <label>标题<input
            v-model="metadata.title"
            required
            maxlength="200"
          /></label>
          <label>分类<select
            v-model="metadata.category"
            required
          ><option
            v-for="key in categoryKeys"
            :key="key"
            :value="key"
          >{{ config.categories?.[key] ?? '其他' }}</option></select></label>
          <label>可见性<select
            v-model="metadata.visibility"
            :disabled="!canManageAccess"
          ><option value="private">私有（作者及授权编辑者）</option><option value="public">公开</option><option value="selected">指定用户</option></select></label>
          <label v-if="metadata.visibility==='selected'">允许查看的用户（每行一个用户名）<textarea
            v-model="allowed"
            :disabled="!canManageAccess"
          ></textarea></label>
          <button
            v-if="metadata.visibility==='selected' && config.isAdmin && canManageAccess"
            type="button"
            :disabled="pickerBusy || busy"
            @click="openUserPicker('view')"
          >
            选择可查看用户
          </button>
          <div
            v-if="canManageAccess"
            class="grant-settings"
          >
            <p>允许编辑的用户：已选 {{ metadata.editorUserIds?.length ?? 0 }} 人</p>
            <button
              type="button"
              :disabled="pickerBusy || busy"
              @click="openUserPicker('edit')"
            >
              选择可编辑用户
            </button>
            <p>编辑者可查看和修改内容，不能删除文章、更改可见性或转授权。</p>
          </div>
          <p v-else>
            你可以编辑内容；可见性和授权由作者或管理员管理。
          </p>
          <p role="status">
            {{ message }}
          </p>
          <button
            type="button"
            @click="metadataOpen=false"
          >
            取消
          </button>
          <button
            type="submit"
            :disabled="busy"
          >
            保存并发布
          </button>
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
