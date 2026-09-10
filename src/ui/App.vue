<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import NwuReader from './NwuReader.vue'
import PlaygroundApp from '../../apps/playground/src/PlaygroundApp.vue'
import { NwuAdapter, type NwuBootstrap, type Metadata } from '../nwu/adapter'
import { editorDocumentUrl } from '../nwu/navigation'
import type { ArticleDefinition } from '../../apps/playground/src/services/articleCatalog'

defineOptions({inheritAttrs:false})

const element = document.querySelector<HTMLScriptElement>('script#nwu-editor-bootstrap[type="application/json"]')
const config: NwuBootstrap | null = element ? JSON.parse(element.textContent ?? '{}') as NwuBootstrap : null
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
const recoveryAvailable = ref(false)
const categoryKeys = computed(() => {
  const labels = config?.categories ?? {other: '其他'}
  const order = config?.categoryOrder ?? ['software_tutorial','scripts','server','rules','study','literature','other']
  return [...new Set([...order, ...Object.keys(labels)])].filter(key => key in labels)
})
const adapterProps = computed(() => adapter ? {
  storage: adapter.storage,
  savedMarkdown: (id: string) => adapter.savedMarkdown.get(id),
  articleTitles: articleTitles.value,
  articleGroupLabels: categoryKeys.value.map(key => config?.categories?.[key]).filter((label): label is string => Boolean(label)),
  articleGroupOverrides: articleGroupOverrides.value,
  articleModes: adapter.articleModes,
  createArticle: (input: {title:string}) => adapter.create(input),
  importArticle: (input: {title:string;markdown:string}) => adapter.create(input),
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
    const initial=config.initialDocumentId ? await adapter.load(config.initialDocumentId) : await adapter.create({title:'未命名笔记'})
    activeId.value=initial.documentId
    navigateIdentity(initial.documentId)
    let catalog: ArticleDefinition[]=[]
    try { catalog=await adapter.list() } catch { message.value='目录暂不可用，当前笔记可以继续编辑。' }
    articles.value=[initial,...catalog.filter(item=>item.documentId!==initial.documentId)]
    recoveryAvailable.value=adapter.recovery(initial.documentId)!==null
  } catch(error) { failed.value=true; recoveryAvailable.value=adapter?.recovery(activeId.value)!==null && adapter!==null; message.value=error instanceof Error ? error.message : '加载失败。' }
}
onMounted(initialize)
function stateChanged(state: {documentId:string}) {
  if(activeId.value!==state.documentId) {
    activeId.value=state.documentId
    if(adapter) navigateIdentity(adapter.id(state.documentId))
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
  metadata.value={...value,allowedUsernames:[...value.allowedUsernames]}
  allowed.value=value.allowedUsernames.join('\n')
  metadataOpen.value=true
}
async function saveMetadata() {
  if(!adapter || busy.value) return
  busy.value=true
  adapter.setMetadata(activeId.value,{...metadata.value,allowedUsernames:allowed.value.split(/[\s,，]+/u).filter(Boolean)})
  try { await editor.value?.publishForLifecycle(); articleTitles.value={...articleTitles.value,[activeId.value]:metadata.value.title}; articleGroupOverrides.value={...articleGroupOverrides.value,[activeId.value]:config?.categories?.[metadata.value.category] ?? config?.categories?.['other'] ?? '其他'}; metadataOpen.value=false; message.value='笔记及可见性已发布。' }
  catch(error) { message.value=error instanceof Error ? error.message : '保存失败。' }
  finally {busy.value=false}
}
async function recover() {
  if(!adapter || busy.value) return
  const value=adapter.recovery(activeId.value)
  if(!value) return
  busy.value=true
  try {
    const article=await adapter.create({title:`${value.metadata.title}（私有恢复副本）`,markdown:value.markdown})
    if(editor.value) await editor.value.openHostArticle(article,'imported')
    else { navigateIdentity(article.documentId); window.location.reload() }
    message.value='已创建私有恢复副本，原笔记仍保留在服务器。'
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
        :href="config.blogListUrl"
        class="tool-button"
      >笔记列表</a>
      <button
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
        @click="save"
      >
        保存
      </button>
      <button
        class="tool-button"
        type="button"
        :disabled="busy"
        @click="publish"
      >
        发布
      </button>
      <button
        v-if="recoveryAvailable"
        class="tool-button"
        type="button"
        :disabled="busy"
        @click="recover"
      >
        恢复为副本
      </button>
      <span role="status">{{ message }}</span>
    </template>
    <template #document-dialogs>
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
          <label>可见性<select v-model="metadata.visibility"><option value="private">仅自己</option><option value="public">公开</option><option value="selected">指定用户</option></select></label>
          <label v-if="metadata.visibility==='selected'">允许的用户名（每行一个）<textarea v-model="allowed"></textarea></label>
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
    </template>
  </PlaygroundApp>
  <main
    v-else
    class="w-editor-instance"
    role="status"
  >
    <p>{{ failed ? message : '正在加载笔记…' }}</p>
    <button
      v-if="failed && recoveryAvailable"
      type="button"
      :disabled="busy"
      @click="recover"
    >
      恢复为私有副本
    </button>
    <a
      v-if="failed && config"
      :href="config.blogListUrl"
    >返回笔记列表</a>
  </main>
</template>
