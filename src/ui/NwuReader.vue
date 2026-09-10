<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import TiptapReaderPresentation from '../../packages/editor-vue/src/ui/TiptapReaderPresentation.vue'
import { hydrateCherryChartPreviews } from '../../packages/editor-vue/src/adapters/cherryChartPreviewRenderer'
import { APPEARANCE_THEME_IDS, isAppearanceTheme, type AppearanceTheme } from '../../packages/editor-vue/src/services/appearanceTheme'
import { createUiLocalizationStore, translateUi, type UiLocale, type UiMessageKey } from '../../packages/editor-vue/src/services/uiLocalization'
import { BrowserFileExporter, createMarkdownExport, createTiptapRenderedExportDocument, materializeRenderedExportDocument, createHtmlDerivedExportArtifacts, type ExportArtifact } from '../../packages/editor-vue/src/services/browserFileExport'
import { BrowserRenderedExportAdapter } from '../../packages/editor-vue/src/services/browserRenderedExport'
import type { NwuBootstrap } from '../nwu/adapter'
import './reader.css'

const props = defineProps<{config: NwuBootstrap}>()
const published = computed(() => props.config.readerDocument)
function preference(key: string): string | null { try { return localStorage.getItem(`nwu-reader:${key}`) } catch { return null } }
const initialTheme = preference('theme')
const theme = ref<AppearanceTheme>(isAppearanceTheme(initialTheme) ? initialTheme : 'default')
const initialLocale = preference('locale')
const locale = ref<UiLocale>(initialLocale === 'en' || initialLocale === 'ru' ? initialLocale : 'zh')
watch([theme, locale], () => { try { localStorage.setItem('nwu-reader:theme',theme.value); localStorage.setItem('nwu-reader:locale',locale.value) } catch { /* Session-only preferences remain usable. */ } })
const words = computed(() => ({
  zh: {skin:'皮肤', language:'语言', export:'导出', edit:'编辑', back:'笔记列表', empty:'本文暂无标题目录', failed:'操作失败，请重试。', image:'长图', loading:'正在导出…', sidebar:'切换侧栏', ready:'已导出', omitted:'部分跨域图片未包含在导出文件中'},
  en: {skin:'Skin', language:'Language', export:'Export', edit:'Edit', back:'Notes', empty:'No headings in this note', failed:'The operation failed. Please retry.', image:'Long image', loading:'Exporting…', sidebar:'Toggle sidebar', ready:'Exported', omitted:'Some cross-origin images were omitted'},
  ru: {skin:'Тема', language:'Язык', export:'Экспорт', edit:'Редактировать', back:'Заметки', empty:'В заметке нет заголовков', failed:'Не удалось выполнить действие. Повторите попытку.', image:'Длинное изображение', loading:'Экспорт…', sidebar:'Показать боковую панель', ready:'Экспортировано', omitted:'Некоторые внешние изображения пропущены'},
}[locale.value]))
const t = (key: UiMessageKey) => translateUi(locale.value,key)
const sidebarOpen = ref(window.innerWidth > 700)
const tab = ref<'articles'|'outline'>('articles')
function moveTab(event: KeyboardEvent) {
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
  event.preventDefault()
  tab.value=event.key==='Home'?'articles':event.key==='End'?'outline':tab.value==='articles'?'outline':'articles'
  document.getElementById(`reader-${tab.value}-tab`)?.focus()
}
const collapsed = ref<ReadonlySet<string>>(new Set())
const groups = computed(() => {
  const labels = props.config.categories ?? {other:'其他'}
  const order = (props.config.categoryOrder ?? Object.keys(labels)).map(key => labels[key]).filter((label): label is string => Boolean(label))
  const byLabel = new Map<string, NonNullable<NwuBootstrap['readerArticles']>>()
  for (const article of props.config.readerArticles ?? []) {
    const items = byLabel.get(article.group) ?? []
    items.push(article); byLabel.set(article.group,items)
  }
  return [...new Set([...order,...byLabel.keys()])].filter(label => byLabel.has(label)).map(label => ({label, articles:byLabel.get(label)!}))
})
function toggleGroup(label: string) { const values = new Set(collapsed.value); if(values.has(label)) values.delete(label); else values.add(label); collapsed.value=values }
const content = ref<HTMLElement|null>(null)
const presentation = ref<InstanceType<typeof TiptapReaderPresentation>|null>(null)
const headings = shallowRef<HTMLElement[]>([])
const message = ref('')
const busy = ref(false)
const exportMenu = ref<HTMLDetailsElement|null>(null)
function closeExport() { if(exportMenu.value) { exportMenu.value.open=false; exportMenu.value.querySelector('summary')?.focus() } }
onMounted(async () => {
  await nextTick()
  try {
    await presentation.value?.settle()
    headings.value = [...content.value?.querySelectorAll<HTMLElement>('.ProseMirror h1,.ProseMirror h2,.ProseMirror h3,.ProseMirror h4,.ProseMirror h5,.ProseMirror h6') ?? []]
  } catch { message.value=words.value.failed }
})
function jump(heading: HTMLElement) {
  const scroller=content.value
  if(scroller) scroller.scrollTop += heading.getBoundingClientRect().top-scroller.getBoundingClientRect().top-20
  heading.setAttribute('tabindex','-1'); heading.focus({preventScroll:true})
}
async function download(format: 'markdown'|'html'|'word'|'pdf'|'image') {
  if(busy.value || !published.value) return
  busy.value=true; message.value=''
  try {
    const snapshot={documentId:published.value.documentId,markdown:published.value.markdown,revision:1}
    let artifact: ExportArtifact
    let omitted=0
    if(format==='markdown') artifact=createMarkdownExport(snapshot)
    else {
      const rendered=createTiptapRenderedExportDocument(snapshot,{lineHeight:1.75,locale:locale.value,localization:createUiLocalizationStore(locale.value),theme:theme.value})
      if(format==='html'||format==='word') {
        const artifacts=createHtmlDerivedExportArtifacts(await materializeRenderedExportDocument(rendered,document))
        artifact=format==='html'?artifacts.html:artifacts.word
      } else {
        const exporter=new BrowserRenderedExportAdapter({document,window,hydrateRenderedContent:root=>hydrateCherryChartPreviews(root,{showToolbox:false,showTooltip:false})})
        const result=format==='pdf'?await exporter.capturePdf(rendered):await exporter.captureLongScreenshot(rendered)
        artifact=result; omitted=result.omittedRemoteImageCount
      }
    }
    const name=published.value.title.replace(/[<>:"/\\|?*\p{Cc}]/gu,'_').slice(0,100) || 'note'
    const extension=artifact.filename.split('.').at(-1) ?? 'md'
    new BrowserFileExporter({document,objectUrls:{createObjectURL:blob=>URL.createObjectURL(blob),revokeObjectURL:url=>URL.revokeObjectURL(url)}}).download({...artifact,filename:`${name}.${extension}`})
    message.value=omitted>0?words.value.omitted:words.value.ready
  } catch { message.value=words.value.failed }
  finally { busy.value=false; closeExport() }
}
</script>

<template>
  <main
    class="workspace-shell nwu-reader-shell w-editor-instance"
    :class="[`theme__${theme}`, { 'is-collapsed': !sidebarOpen }]"
    :data-theme="theme"
    data-testid="nwu-reader-workspace"
  >
    <aside
      class="article-panel nwu-reader-sidebar"
      :aria-label="t('workspace.articles')"
    >
      <header class="article-panel__header">
        <h2 v-if="sidebarOpen">
          {{ t('workspace.articles') }}
        </h2>
        <button
          class="icon-button"
          type="button"
          :aria-label="words.sidebar"
          :aria-expanded="sidebarOpen"
          @click="sidebarOpen=!sidebarOpen"
        >
          {{ sidebarOpen ? '‹' : '›' }}
        </button>
      </header>
      <template v-if="sidebarOpen">
        <div
          class="article-panel__tabs"
          role="tablist"
          @keydown="moveTab"
        >
          <button
            id="reader-articles-tab"
            role="tab"
            type="button"
            :aria-selected="tab==='articles'"
            :tabindex="tab==='articles'?0:-1"
            aria-controls="reader-articles"
            @click="tab='articles'"
          >
            {{ t('workspace.articles') }}
          </button>
          <button
            id="reader-outline-tab"
            role="tab"
            type="button"
            :aria-selected="tab==='outline'"
            :tabindex="tab==='outline'?0:-1"
            aria-controls="reader-outline"
            @click="tab='outline'"
          >
            {{ t('workspace.outline') }}
          </button>
        </div>
        <nav
          v-if="tab==='articles'"
          id="reader-articles"
          class="article-list"
          role="tabpanel"
          aria-labelledby="reader-articles-tab"
        >
          <section
            v-for="group in groups"
            :key="group.label"
            class="article-date-group"
          >
            <h3 class="article-category-heading">
              <button
                class="article-category-toggle"
                type="button"
                :aria-expanded="!collapsed.has(group.label)"
                :aria-controls="`reader-group-${encodeURIComponent(group.label)}`"
                @click="toggleGroup(group.label)"
              >
                <span aria-hidden="true">{{ collapsed.has(group.label)?'›':'⌄' }}</span><span class="article-category-label">{{ group.label }}</span><span class="article-category-count">{{ group.articles.length }}</span>
              </button>
            </h3>
            <div
              :id="`reader-group-${encodeURIComponent(group.label)}`"
              class="article-group-items article-group-items--category"
              :hidden="collapsed.has(group.label)"
            >
              <a
                v-for="article in group.articles"
                :key="article.documentId"
                class="article-card"
                :class="{'article-card--active':article.documentId===published?.documentId}"
                :href="article.url"
                :aria-current="article.documentId===published?.documentId?'page':undefined"
              ><span class="article-card__title">{{ article.title }}</span></a>
            </div>
          </section>
        </nav>
        <nav
          v-else
          id="reader-outline"
          class="article-outline article-panel__view"
          role="tabpanel"
          aria-labelledby="reader-outline-tab"
        >
          <p
            v-if="!headings.length"
            class="article-outline__empty"
          >
            {{ words.empty }}
          </p>
          <ol
            v-else
            class="article-outline__list"
          >
            <li
              v-for="(heading,index) in headings"
              :key="index"
              :style="{paddingInlineStart:`${(Number(heading.tagName.slice(1))-1)*10}px`}"
            >
              <button
                class="article-outline__item"
                type="button"
                @click="jump(heading)"
              >
                {{ heading.textContent }}
              </button>
            </li>
          </ol>
        </nav>
      </template>
    </aside>
    <section class="nwu-reader-main">
      <header class="nwu-reader-actions">
        <a
          :href="config.blogListUrl"
          class="nwu-reader-back"
        >{{ words.back }}</a>
        <h1>{{ published?.title }}</h1>
        <div class="nwu-reader-options">
          <label>{{ words.skin }}<select
            v-model="theme"
            :aria-label="words.skin"
          ><option
            v-for="value in APPEARANCE_THEME_IDS"
            :key="value"
            :value="value"
          >{{ t(`theme.${value}`) }}</option></select></label>
          <label>{{ words.language }}<select
            v-model="locale"
            :aria-label="words.language"
          ><option value="zh">中文</option><option value="en">English</option><option value="ru">Русский</option></select></label>
          <details
            ref="exportMenu"
            class="nwu-reader-export"
            @keydown.esc.prevent="closeExport"
          >
            <summary>{{ busy?words.loading:words.export }}</summary><div class="nwu-reader-export-menu">
              <button
                v-for="(label,format) in {markdown:'Markdown',html:'HTML',word:'Word',pdf:'PDF',image:words.image}"
                :key="format"
                type="button"
                :disabled="busy"
                @click="download(format)"
              >
                {{ label }}
              </button>
            </div>
          </details>
          <a
            v-if="config.readerEditUrl"
            :href="config.readerEditUrl"
            class="nwu-reader-edit"
          >{{ words.edit }}</a>
        </div>
      </header>
      <p
        v-if="message"
        class="nwu-reader-message"
        role="status"
      >
        {{ message }}
      </p>
      <div
        ref="content"
        class="nwu-reader-content"
        data-testid="desktop-reader-parity"
      >
        <TiptapReaderPresentation
          v-if="published"
          ref="presentation"
          :document-id="published.documentId"
          :markdown="published.markdown"
          :revision="1"
          :theme="theme"
          :locale="locale"
          @error="message=words.failed"
        />
        <p
          v-else
          role="alert"
        >
          {{ words.failed }}
        </p>
      </div>
    </section>
  </main>
</template>
