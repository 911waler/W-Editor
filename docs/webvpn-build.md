# WebVPN 兼容构建

本仓库保留 NWU 集成已有的 WebVPN 构建流程。它先生成 Vite 产物，再使用锁文件中的 Rolldown 1.2.5 将入口及其 JavaScript 依赖合并为 IIFE。原始资源仍保留；入口 HTML 指向带内容哈希的兼容脚本。Vite 的模块预加载辅助代码替换为既有 CSS 加载器，动态功能需要的 CSS 仍异步加载，并保留 CSP nonce 和 `vite:preloadError` 行为。

## 从源码构建

需要 PATH 中可用的 Node.js 24 或更新版本、项目声明的 pnpm 11.19.0、Python 3，以及 Git checkout 的 Git。Python 构建步骤只使用标准库。所有构建工具和依赖均从本 checkout 定位，无需另外的集成仓库或机器专用包装器。

在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
node scripts/build-webvpn.mjs artifacts/webvpn-build
node scripts/check-webvpn-entries.mjs artifacts/webvpn-build
```

输出目录必须尚不存在；再次构建时使用另一个目录。入口固定使用 `/w-editor/web/assets/` 资源前缀，与既有集成保持一致。此命令只构建本地文件，不部署、不重启服务，也不执行全仓库类型检查或应用测试。

构建结果包括 `index.html`、`drawio-bridge.html`、兼容脚本、原始 Vite 资源、`webvpn-compat-manifest.json`、许可证和 `source-commit.txt`。提交号记录当前 HEAD；构建包含工作区尚未提交的修改时，应另行记录实际源码差异。构建日志、兼容包和替换前的 HTML 备份保存在输出目录旁的随机 `.webvpn-` 目录，成功后会打印路径。

## 校验与回归测试

入口校验读取 HTML 实际选择的脚本并按经典脚本语法解析；目录里仅存在旧的兼容脚本不足以通过校验。它不代替真实 WebVPN 环境中的浏览器验收。

```sh
node --test frontend/webvpn-compat/*.test.mjs
python3 -m pytest tests/test_webvpn_static_release.py
```

Python 回归测试需要本机已有 `pytest`；它只用于测试，不是构建依赖。测试覆盖静态和动态导入合并、异步 CSS、原始资源保留、HTML 入口回归、来源漂移、包损坏、安装失败恢复及回退拒绝覆盖更新版本。

低层工具也保留原有接口：`build-webvpn-compat.mjs SOURCE_BUNDLE NEW_OUTPUT_DIR ROLLDOWN_MODULE` 生成带哈希清单的兼容包；`install-webvpn-compat.py ROOT PACKAGE BACKUP` 默认仅验证，`--apply` 备份并替换入口，`--rollback` 恢复入口。可移植构建入口自动解析当前 Vite 使用的 Rolldown，并只对刚生成的本地产物调用安装器。
