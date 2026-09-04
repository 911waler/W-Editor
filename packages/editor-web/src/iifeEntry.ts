import * as publicApi from './publicEntry'

export function createWEditorIifeApi() {
  return Object.freeze({ ...publicApi })
}

export default createWEditorIifeApi()
