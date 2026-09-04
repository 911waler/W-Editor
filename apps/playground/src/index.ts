import { createApp } from 'vue'

import PlaygroundApp from './PlaygroundApp.vue'
import '@w-editor/editor-vue/styles.css'
import './shell.css'

createApp(PlaygroundApp).mount('#app')

/** Playground shell boundary; seeds and browser compatibility live here. */
export const PLAYGROUND_PACKAGE = '@w-editor/playground' as const
