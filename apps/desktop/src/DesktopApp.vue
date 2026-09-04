<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import type { ExportArtifact } from '@w-editor/editor-vue/services'

import PlaygroundApp from '@w-editor/playground/workspace'
import {
  DesktopLibraryBridge,
  type DesktopArticleDefinition,
  type DesktopDataRootStatus,
  type DesktopReleaseInfo,
} from './desktopBridge'
import { desktopText, desktopValue, type DesktopLocale, type DesktopMessageKey } from './desktopLocalization'

const dataRootStatus = shallowRef<DesktopDataRootStatus | null>(null)
const desktopLocale = ref<DesktopLocale>('zh')
const bootstrapError = ref<string | null>(null)
const parentPath = ref('')
const selectingRoot = ref(false)
const folderPickerTarget = ref<'first-use' | 'migration' | null>(null)
const folderPickerError = ref<string | null>(null)
const bootstrapData = shallowRef<Awaited<ReturnType<DesktopLibraryBridge['bootstrap']>> | null>(null)
const nativeError = ref<string | null>(null)
const migrationParentPath = ref('')
const settingsPanelOpen = ref(false)
const settingsEntry = ref<HTMLButtonElement | null>(null)
const settingsClose = ref<HTMLButtonElement | null>(null)
const settingsDialog = ref<HTMLElement | null>(null)
const readerPreviewOpen = ref(false)
const releaseInfo = shallowRef<DesktopReleaseInfo | null>(null)
const workspaceState = shallowRef<Readonly<{
  readonly autosaveStatus: string
  readonly dirty: boolean
  readonly documentId: string
  readonly errorCode: string | null
  readonly synchronizationStatus: string
  readonly title: string
}>>({
  autosaveStatus: 'loading',
  dirty: false,
  documentId: '',
  errorCode: null,
  synchronizationStatus: 'loading',
  title: 'W-Editor',
})
type WorkspaceAppHandle = Readonly<{
  readonly exportForLifecycle: () => Promise<void>
  readonly focusForLifecycle: () => Promise<void>
  readonly flushForLifecycle: () => Promise<void>
  readonly openHostArticle: (definition: DesktopArticleDefinition, activity?: 'created' | 'imported') => Promise<void>
  readonly saveForLifecycle: () => Promise<void>
}>
const workspaceApp = ref<WorkspaceAppHandle | null>(null)
type CloseChoice = 'cancel' | 'draft' | 'export' | 'save'
type LifecycleOperation = 'close' | 'migrate'
const closeDialogOpen = ref(false)
const closeBusy = ref(false)
const closeError = ref<string | null>(null)
const lifecycleOperation = ref<LifecycleOperation>('close')
let closeEventUnlisten: UnlistenFn | null = null
let fileRequestUnlisten: UnlistenFn | null = null
let nativeDirtyQueue: Promise<void> = Promise.resolve()
const pendingFileRequests: string[] = []
let pollTimer: ReturnType<typeof setInterval> | null = null
let bootstrapAttemptRoot: string | null = null
let bootstrapRunning = false

const bridge = new DesktopLibraryBridge((error) => {
  const message = error instanceof Error ? error.message : String(error)
  if (bootstrapData.value === null) bootstrapError.value = message
  else nativeError.value = message
})
const persistence = bridge.persistence()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function dt(key: DesktopMessageKey): string {
  return desktopText(desktopLocale.value, key)
}

function dv(value: unknown): string {
  return desktopValue(desktopLocale.value, value)
}

function handleLocaleChange(locale: DesktopLocale): void {
  desktopLocale.value = locale
}

function exportExtension(filename: string): string | null {
  const separator = filename.lastIndexOf('.')
  if (separator < 0 || separator === filename.length - 1) return null
  return filename.slice(separator + 1).toLocaleLowerCase()
}

async function saveExportArtifact(artifact: ExportArtifact): Promise<void> {
  const extension = exportExtension(artifact.filename)
  const destinationPath = await saveDialog({
    defaultPath: artifact.filename,
    ...(extension === null ? {} : {
      filters: [{ extensions: [extension], name: extension.toLocaleUpperCase() }],
    }),
    title: dt('exportSaveTitle'),
  })
  if (destinationPath === null) return
  const bytes = new Uint8Array(await artifact.blob.arrayBuffer())
  await bridge.writeExportFile(destinationPath, bytes)
}

async function chooseParentFolder(target: 'first-use' | 'migration'): Promise<void> {
  if (folderPickerTarget.value !== null) return
  folderPickerTarget.value = target
  folderPickerError.value = null
  const current = target === 'first-use' ? parentPath.value.trim() : migrationParentPath.value.trim()
  try {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      ...(current.length === 0 ? {} : { defaultPath: current }),
      title: dt(target === 'first-use' ? 'firstUseFolderTitle' : 'migrationFolderTitle'),
    })
    if (selected !== null) {
      if (target === 'first-use') parentPath.value = selected
      else migrationParentPath.value = selected
    }
  } catch (error) {
    folderPickerError.value = `${dt('folderPickerFailed')} ${errorMessage(error)}`
  } finally {
    folderPickerTarget.value = null
  }
}

async function bootstrapIfReady(status: DesktopDataRootStatus): Promise<void> {
  const sameFailedRoot = bootstrapError.value !== null && bootstrapAttemptRoot === status.root
  if (bootstrapRunning || sameFailedRoot || bootstrapData.value !== null || status.state !== 'ready') return
  bootstrapRunning = true
  bootstrapAttemptRoot = status.root
  bootstrapError.value = null
  try {
    const data = await bridge.bootstrap()
    bootstrapData.value = data
    document.documentElement.dataset['desktopReady'] = 'true'
    await nextTick()
    for (const path of pendingFileRequests.splice(0)) void importFilePath(path)
  } catch (error) {
    bootstrapError.value = errorMessage(error)
  } finally {
    bootstrapRunning = false
  }
}

function updateWindowTitle(input: Readonly<{ dirty: boolean; title: string }>): void {
  const title = `${input.dirty ? '* ' : ''}${input.title} — W-Editor`
  document.title = title
  try {
    void getCurrentWindow().setTitle(title)
  } catch (error) {
    nativeError.value = errorMessage(error)
  }
}

function closeReaderPreview(): void {
  readerPreviewOpen.value = false
}

function handleWorkspaceStateChange(input: Readonly<{
  readonly autosaveStatus: string
  readonly dirty: boolean
  readonly documentId: string
  readonly errorCode: string | null
  readonly synchronizationStatus: string
  readonly title: string
}>): void {
  workspaceState.value = input
  updateWindowTitle(input)
  const shouldBlockClose = input.dirty
    || input.autosaveStatus === 'pending'
    || input.autosaveStatus === 'saving'
    || input.autosaveStatus === 'failed'
    || input.synchronizationStatus !== 'synchronized'
  nativeDirtyQueue = nativeDirtyQueue
    .then(() => bridge.setWindowDirty(shouldBlockClose))
    .catch((error: unknown) => { nativeError.value = errorMessage(error) })
}

async function openSettingsPanel(): Promise<void> {
  settingsPanelOpen.value = true
  await nextTick()
  settingsClose.value?.focus()
  if (releaseInfo.value === null) {
    try {
      releaseInfo.value = await bridge.releaseInfo()
    } catch (error) {
      nativeError.value = errorMessage(error)
    }
  }
}

async function closeSettingsPanel(): Promise<void> {
  settingsPanelOpen.value = false
  await nextTick()
  settingsEntry.value?.focus()
}

function handleSettingsKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    void closeSettingsPanel()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = Array.from(settingsDialog.value?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
  ) ?? []).filter((element) => !element.hasAttribute('hidden'))
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable.at(-1)
  if (first === undefined || last === undefined) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function openCloseDialog(): void {
  if (closeBusy.value) return
  closeError.value = null
  lifecycleOperation.value = 'close'
  closeDialogOpen.value = true
}

function requestDataRootMigration(): void {
  if (closeBusy.value || migrationParentPath.value.trim().length === 0) return
  closeError.value = null
  lifecycleOperation.value = 'migrate'
  closeDialogOpen.value = true
}

async function settleClose(choice: CloseChoice): Promise<void> {
  if (closeBusy.value) return
  if (choice === 'cancel') {
    closeDialogOpen.value = false
    lifecycleOperation.value = 'close'
    await workspaceApp.value?.focusForLifecycle()
    return
  }
  closeBusy.value = true
  closeError.value = null
  try {
    const app = workspaceApp.value
    if (app === null) throw new Error('The shared workspace is not ready to close.')
    if (choice === 'save') await app.saveForLifecycle()
    else if (choice === 'draft') await app.flushForLifecycle()
    else {
      await app.flushForLifecycle()
      await app.exportForLifecycle()
    }
    await nativeDirtyQueue
    await bridge.setWindowDirty(false)
    if (lifecycleOperation.value === 'migrate') {
      await bridge.migrateDataRoot(migrationParentPath.value.trim())
      dataRootStatus.value = await bridge.dataRootStatus()
      migrationParentPath.value = ''
      closeDialogOpen.value = false
      lifecycleOperation.value = 'close'
      await workspaceApp.value?.focusForLifecycle()
      return
    }
    const result = await bridge.requestWindowClose()
    if (result.state !== 'allowed') throw new Error(`The Desktop window is still ${result.state}.`)
  } catch (error) {
    closeError.value = errorMessage(error)
    await workspaceApp.value?.focusForLifecycle()
  } finally {
    closeBusy.value = false
  }
}

async function refreshStatus(): Promise<void> {
  try {
    const status = await bridge.dataRootStatus()
    dataRootStatus.value = status
    if (bootstrapData.value === null) await bootstrapIfReady(status)
    else if (status.state !== 'ready') nativeError.value = status.message ?? `Data Root is ${status.state}.`
    else if (nativeError.value?.includes('Data Root') === true) nativeError.value = null
  } catch (error) {
    if (bootstrapData.value === null) bootstrapError.value = errorMessage(error)
    else nativeError.value = errorMessage(error)
  }
}

function supportedImportPath(path: string): boolean {
  return /\.(?:md|markdown|txt)$/iu.test(path)
}

function enqueueFileRequest(path: string): void {
  if (!supportedImportPath(path)) return
  const trace = globalThis as typeof globalThis & { __desktopForwardedRequest__?: Readonly<{ path: string }> }
  trace.__desktopForwardedRequest__ = Object.freeze({ path })
  if (bootstrapData.value === null || workspaceApp.value === null) {
    if (!pendingFileRequests.includes(path)) pendingFileRequests.push(path)
    return
  }
  void importFilePath(path)
}

async function importFilePath(path: string): Promise<void> {
  try {
    const definition = await bridge.importArticleFromPath(path)
    await workspaceApp.value?.openHostArticle(definition, 'imported')
    nativeError.value = null
  } catch (error) {
    nativeError.value = errorMessage(error)
  }
}

async function selectDataRoot(): Promise<void> {
  const path = parentPath.value.trim()
  if (path.length === 0 || selectingRoot.value) return
  selectingRoot.value = true
  bootstrapAttemptRoot = null
  bootstrapError.value = null
  try {
    const status = await bridge.selectDataRoot(path)
    dataRootStatus.value = status
    await bootstrapIfReady(status)
  } catch (error) {
    bootstrapError.value = errorMessage(error)
  } finally {
    selectingRoot.value = false
  }
}

async function createArticle(input: Readonly<{ title: string }>): Promise<DesktopArticleDefinition> {
  return bridge.createArticle(input.title)
}

async function importArticle(input: Readonly<{ markdown: string; title: string }>): Promise<DesktopArticleDefinition> {
  return bridge.importArticle(input.markdown, input.title)
}

onMounted(async () => {
  void listen('desktop-close-blocked', openCloseDialog).then((unlisten) => {
    closeEventUnlisten = unlisten
  }).catch((error: unknown) => {
    nativeError.value = errorMessage(error)
  })
  void listen<{ args?: unknown; cwd?: unknown }>('desktop-file-request', (event) => {
    const args = Array.isArray(event.payload?.args) ? event.payload.args : []
    for (const path of args) if (typeof path === 'string') enqueueFileRequest(path)
  }).then((unlisten) => {
    fileRequestUnlisten = unlisten
  }).catch((error: unknown) => {
    nativeError.value = errorMessage(error)
  })
  await refreshStatus()
  try {
    const startupRequests = await bridge.takeStartupFileRequests()
    for (const path of startupRequests) enqueueFileRequest(path)
  } catch (error) {
    nativeError.value = errorMessage(error)
  }
  pollTimer = setInterval(() => { void refreshStatus() }, 350)
})

onBeforeUnmount(() => {
  closeEventUnlisten?.()
  closeEventUnlisten = null
  fileRequestUnlisten?.()
  fileRequestUnlisten = null
  if (pollTimer !== null) clearInterval(pollTimer)
  pollTimer = null
  delete document.documentElement.dataset['desktopReady']
})
</script>

<template>
  <div
    class="desktop-app-shell"
    data-testid="desktop-library-shell"
    :data-data-root-state="dataRootStatus?.state ?? 'loading'"
  >
    <header
      class="desktop-app-header"
      data-testid="desktop-primary-bar"
    >
      <div
        class="desktop-app-header__status"
        data-testid="desktop-library-status"
        aria-live="polite"
      >
        <span class="desktop-app-header__status-label">{{ dt('library') }}</span>
        <span
          class="desktop-app-header__status-path"
          :title="dataRootStatus?.root ?? dt('dataRootNotSelected')"
        >
          {{ dataRootStatus?.root ?? dt('dataRootNotSelected') }}
        </span>
      </div>
      <nav
        class="desktop-app-header__actions"
        :aria-label="dt('desktopQuickActions')"
      >
        <button
          :aria-expanded="readerPreviewOpen"
          data-testid="desktop-reader-entry"
          :disabled="bootstrapData === null"
          type="button"
          @click="readerPreviewOpen = true"
        >
          {{ dt('reader') }}
        </button>
      </nav>
    </header>

    <div
      v-if="closeDialogOpen"
      class="desktop-dialog-backdrop"
      data-testid="desktop-close-dialog-backdrop"
    >
      <section
        aria-labelledby="desktop-close-dialog-title"
        aria-modal="true"
        class="desktop-dialog"
        data-testid="desktop-close-dialog"
        role="dialog"
      >
        <p class="desktop-app-eyebrow">
          {{ dt('protectedClose') }}
        </p>
        <h2 id="desktop-close-dialog-title">
          {{ lifecycleOperation === 'migrate' ? dt('moveDataRoot') : dt('unsavedChanges') }}
        </h2>
        <p>
          {{ lifecycleOperation === 'migrate' ? dt('moveGuard') : dt('closeGuard') }}
        </p>
        <p
          v-if="closeError"
          class="desktop-app-error"
          role="alert"
        >
          {{ closeError }}
        </p>
        <div class="desktop-dialog__actions">
          <button
            data-testid="desktop-close-cancel"
            :disabled="closeBusy"
            type="button"
            @click="settleClose('cancel')"
          >
            {{ dt('cancel') }}
          </button>
          <button
            data-testid="desktop-close-draft"
            :disabled="closeBusy"
            type="button"
            @click="settleClose('draft')"
          >
            {{ dt('keepDraft') }}
          </button>
          <button
            data-testid="desktop-close-export"
            :disabled="closeBusy"
            type="button"
            @click="settleClose('export')"
          >
            {{ dt('exportAndClose') }}
          </button>
          <button
            class="desktop-app-primary"
            data-testid="desktop-close-save"
            :disabled="closeBusy"
            type="button"
            @click="settleClose('save')"
          >
            {{ closeBusy ? dt('working') : lifecycleOperation === 'migrate' ? dt('saveAndMove') : dt('saveAndClose') }}
          </button>
        </div>
      </section>
    </div>

    <section
      v-if="bootstrapData === null"
      class="desktop-app-setup"
      data-testid="desktop-data-root-setup"
      aria-live="polite"
    >
      <p class="desktop-app-eyebrow">
        {{ dt('localLibrary') }}
      </p>
      <h2>{{ dt('chooseDataRoot') }}</h2>
      <p>
        {{ dt('setupDescription') }}
      </p>
      <p
        v-if="dataRootStatus?.message"
        :data-testid="dataRootStatus?.state === 'unavailable' || dataRootStatus?.state === 'read_only' ? 'desktop-data-root-recovery' : undefined"
        class="desktop-app-error"
        role="alert"
      >
        {{ dataRootStatus.message }}
      </p>
      <label for="desktop-data-root-parent">{{ dt('parentFolder') }}</label>
      <input
        id="desktop-data-root-parent"
        v-model="parentPath"
        data-testid="desktop-data-root-parent"
        autocomplete="off"
        placeholder="C:\Users\you\Documents"
        type="text"
        @keydown.enter.prevent="selectDataRoot"
      />
      <button
        data-testid="desktop-browse-data-root"
        :disabled="folderPickerTarget !== null"
        type="button"
        @click="chooseParentFolder('first-use')"
      >
        {{ folderPickerTarget === 'first-use' ? dt('working') : dt('chooseFolder') }}
      </button>
      <button
        class="desktop-app-primary"
        data-testid="desktop-select-data-root"
        :disabled="selectingRoot || parentPath.trim().length === 0"
        type="button"
        @click="selectDataRoot"
      >
        {{ selectingRoot ? dt('checking') : dt('useThisFolder') }}
      </button>
      <p
        v-if="folderPickerError"
        class="desktop-app-error"
        data-testid="desktop-folder-picker-error"
        role="alert"
      >
        {{ folderPickerError }}
      </p>
      <p
        v-if="bootstrapError"
        class="desktop-app-error"
        role="alert"
      >
        {{ bootstrapError }}
      </p>
      <p
        v-if="nativeError"
        class="desktop-app-error"
        role="alert"
      >
        {{ nativeError }}
      </p>
    </section>

    <PlaygroundApp
      v-else
      ref="workspaceApp"
      :article-catalog="bootstrapData.definitions"
      :create-article="createArticle"
      :export-artifact="saveExportArtifact"
      :import-article="importArticle"
      :persistence="persistence"
      :storage="bootstrapData.storage"
      :on-locale-change="handleLocaleChange"
      :on-reader-preview-close="closeReaderPreview"
      :on-workspace-state-change="handleWorkspaceStateChange"
      :show-reader-preview="readerPreviewOpen"
    >
      <template #toolbar-after-export>
        <section
          class="desktop-settings-toolbar-slot"
          :aria-label="dt('desktopLibraryTools')"
          data-testid="desktop-settings-toolbar-slot"
        >
          <button
            ref="settingsEntry"
            aria-controls="desktop-settings-destination"
            :aria-expanded="settingsPanelOpen"
            :aria-label="dt('settings')"
            class="desktop-settings-entry"
            data-testid="desktop-settings-entry"
            :title="dt('settings')"
            type="button"
            @click="openSettingsPanel"
          >
            <span
              aria-hidden="true"
              class="desktop-settings-icon"
            >⚙</span>
          </button>
        </section>
      </template>
    </PlaygroundApp>

    <footer
      v-if="bootstrapData !== null"
      class="desktop-state-strip"
      data-testid="desktop-document-status"
      :aria-label="dt('documentStatus')"
      aria-live="polite"
      role="status"
    >
      <span data-testid="desktop-save-state">{{ dt('save') }}：{{ dv(workspaceState.dirty ? 'dirty' : 'clean') }}</span>
      <span data-testid="desktop-draft-state">{{ dt('draft') }}：{{ dv(workspaceState.autosaveStatus) }}</span>
      <span data-testid="desktop-sync-state">{{ dt('sync') }}：{{ dv(workspaceState.synchronizationStatus) }}</span>
      <span
        data-testid="desktop-error-state"
        :data-error-code="workspaceState.errorCode ?? undefined"
      >
        {{ workspaceState.errorCode ?? nativeError ?? dt('errorNone') }}
      </span>
    </footer>

    <div
      v-if="settingsPanelOpen && bootstrapData !== null"
      class="desktop-settings-backdrop"
      data-testid="desktop-settings-backdrop"
      @mousedown.self="closeSettingsPanel"
    >
      <section
        id="desktop-settings-destination"
        ref="settingsDialog"
        aria-labelledby="desktop-settings-title"
        aria-modal="true"
        class="desktop-settings-destination"
        data-testid="desktop-settings-destination"
        role="dialog"
        @keydown="handleSettingsKeydown"
      >
        <header class="desktop-settings-destination__header">
          <div>
            <h2 id="desktop-settings-title">
              {{ dt('settings') }}
            </h2>
            <p>{{ dt('settingsDescription') }}</p>
          </div>
          <button
            ref="settingsClose"
            data-testid="desktop-settings-close"
            type="button"
            @click="closeSettingsPanel"
          >
            {{ dt('close') }}
          </button>
        </header>

        <div class="desktop-settings-destination__content">
          <section
            class="desktop-settings-section"
            data-testid="desktop-settings-migration"
            aria-labelledby="desktop-settings-migration-title"
          >
            <h3 id="desktop-settings-migration-title">
              {{ dt('dataMigration') }}
            </h3>
            <div class="desktop-settings-field">
              <label for="desktop-migration-parent">{{ dt('parentFolder') }}</label>
              <input
                id="desktop-migration-parent"
                v-model="migrationParentPath"
                data-testid="desktop-migration-parent"
                autocomplete="off"
                placeholder="C:\Users\you\Documents"
                type="text"
              />
              <button
                data-testid="desktop-browse-migration-parent"
                :disabled="folderPickerTarget !== null"
                type="button"
                @click="chooseParentFolder('migration')"
              >
                {{ folderPickerTarget === 'migration' ? dt('working') : dt('chooseFolder') }}
              </button>
              <button
                data-testid="desktop-migrate-data-root"
                :disabled="closeBusy || migrationParentPath.trim().length === 0"
                type="button"
                @click="requestDataRootMigration"
              >
                {{ dt('moveLibrary') }}
              </button>
              <p
                v-if="folderPickerError"
                class="desktop-app-error"
                data-testid="desktop-folder-picker-error"
                role="alert"
              >
                {{ folderPickerError }}
              </p>
            </div>
          </section>

          <section
            class="desktop-settings-section"
            data-testid="desktop-settings-updates"
            aria-labelledby="desktop-settings-updates-title"
          >
            <h3 id="desktop-settings-updates-title">
              {{ dt('aboutUpdates') }}
            </h3>
            <p data-testid="desktop-update-version">
              {{ dt('version') }} {{ releaseInfo?.version ?? '…' }}
            </p>
            <p data-testid="desktop-update-manual">
              {{ dt('manualUpdates') }}
            </p>
            <p data-testid="desktop-update-automatic">
              {{ dt('automaticUpdatesDisabled') }}
            </p>
            <p v-if="releaseInfo?.signed === false">
              {{ dt('unsignedPackage') }}
            </p>
          </section>
        </div>
      </section>
    </div>
  </div>
</template>
