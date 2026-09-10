# NWU 只读阅读工作区（2026-09-11）

`src/ui/NwuReader.vue` 直接使用共享 `TiptapReaderPresentation` reader profile。NWU只读路由不再创建Playground编辑会话，不使用草稿/自动保存适配器；展示服务器已发布正文。左侧为服务端授权的按专栏文章链接与从实际渲染标题生成的目录；标题跳转仅滚动正文区域。专栏可折叠，侧栏可收起，手机宽度可重新展开和使用目录。

右上角提供原有8种皮肤、中文/English/Русский界面语言、Markdown/HTML/Word/PDF/长图导出。使用共享导出渲染/下载实现，导出异常和跨域图片省略有提示；只保存外观偏好。正文不会被界面语言翻译。作者/管理员编辑URL由NWU服务端提供，点击进入既有编辑页面；文章链接整页导航并重新鉴权。

验证：NWU集成组件3项单元通过；新增浏览器有/无编辑权限2项通过，覆盖无编辑工具栏/contenteditable、无非GET请求、目录滚动、实际皮肤颜色、语言切换、五种下载文件、600px展开侧栏与键盘tab切换、目录定位后顶部入口可见。已检查最终截图。typecheck/lint通过；Web/editor-web/nwu-host构建通过。NWU权限/入口/旧接口定向14项通过。

此能力是NWU阅读适配，未改变独立Windows的桌面阅读入口；共享渲染和导出保持原实现。部署详情在NWU分支codex/nwu-reader-workspace的docs/ops/2026-09-11-reader-workspace-rollout.md。未push/Windows发布。
