import { createApp } from 'vue'

import DesktopApp from './DesktopApp.vue'
import '@w-editor/editor-vue/styles.css'
import '../../playground/src/shell.css'
import './desktop.css'

const app = createApp(DesktopApp)
app.config.errorHandler = (error, _instance, info) => {
  document.documentElement.dataset['desktopError'] = `${info}: ${error instanceof Error ? error.message : String(error)}`
  console.error(error)
}
app.mount('#app')

/** Desktop shell boundary; platform ports are kept outside shared editor packages. */
export const DESKTOP_PACKAGE = '@w-editor/desktop' as const
