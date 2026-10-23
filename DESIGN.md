# dsh-sensei 实现设计（v1）

状态：实现中。本文是实现依据。README.md 记录架构决策，本文记录已定的实现细节；两者冲突时以本文为准。

## 1. 目标

一个 DSH 插件：agent 在右侧栏"讲"一份自己现场生成的 HTML 幻灯片，翻页、在透明批注层上圈画；人随时打断提问，也能自己画；讲完可以把整份 deck 导出成图片版 pptx。

## 2. 已冻结的决策

| 项 | 决策 |
|---|---|
| 内容层 | agent 生成的 HTML，经**工具参数**传入，host 存进自己的数据目录 |
| 渲染 | iframe `srcDoc`，`sandbox="allow-same-origin"`，**不开** `allow-scripts` |
| 坐标 | 固定舞台 1280×720，只做 16:9 fit，无缩放平移 |
| 批注 | 透明 canvas 覆盖内容层，逐页独立；复用 `vendor/dsh-blackboard/core` |
| 持久化 | `$DSH_HOME/sensei/<sessionId>.jsonl`，append-only，不进 session log |
| 导出 | **图片版 pptx**，不带批注；由面板栅格化，host 用 pptxgenjs 组装 |
| 工具数量 | 6 支：`sensei_deck` / `sensei_slide` / `sensei_show` / `sensei_draw` / `sensei_read` / `sensei_export`（`sensei_read` 兼任状态与图） |
| 讲稿备注 | 保留 `notes`，供被打断或上下文压缩后恢复 |
| 导出分辨率 | 默认 1920×1080，可选 `scale` 1 / 1.5 / 2 |
| 导出落点 | **由 agent 传 `dir`**；相对路径按会话工作区解析，省略即会话工作区；拒绝覆盖已存在文件除非 `overwrite: true`；结果必须回报完整路径 |

## 3. 环境

| 名称 | 路径 |
|---|---|
| 本仓库（只改这里） | `C:\workspace\Tool\deepseek-harness\Workspace\dsh-sensei` |
| DSH 仓库（**只读参考，不许改**） | `C:\workspace\Tool\deepseek-harness` |
| blackboard 参考实现（有 node_modules，可运行） | `C:\workspace\Tool\deepseek-harness\Workspace\dsh-blackboard` |
| blackboard 固定副本（submodule，无 node_modules） | `<本仓库>/vendor/dsh-blackboard` |

`vendor/dsh-blackboard` 是 submodule，pin 在固定 commit，**只作为批注层源码来源**：用相对路径 import，例如 `../vendor/dsh-blackboard/core/render.ts`，不修改它、不往里写文件。

浏览器验证可用 Playwright + 本机 Edge：

```powershell
$env:NODE_PATH = 'C:\workspace\Tool\deepseek-harness\node_modules\.pnpm\playwright@1.61.1\node_modules'
# chromium.launch({ channel: 'msedge', headless: true })
```

## 4. 文件骨架

```
sensei.cordis.yml          overlay：只插一条 host 行，行名 './host/index.ts'
package.json               dsh.bundle.patch + dsh.client + exports["./client"]
pnpm-workspace.yaml        本仓库是独立 workspace root（同 blackboard）
tsconfig.json              host 面：core / shared / host / tests
tsconfig.client.json       浏览器面：core / shared / client
build/build-client.mjs     esbuild → lib/client.js（模块表协议，照抄 blackboard）
core/                      零依赖纯函数，host 与浏览器共用
shared/                    wire 类型与 scene op 透传
host/                      插件宿主半边
client/                    浏览器半边
tests/                     node:test
lib/client.js              构建产物，必须进版本库
```

`core/` 与 `shared/` 里不允许 import `node:` 或 DOM 才能用的东西以外的东西；`core` 不能依赖 `client`/`host`。

## 5. 数据模型

```ts
// core/deck.ts
export interface Slide {
  /** 只有 body 片段；样式走 deck.css 或行内 <style>。 */
  readonly html: string
  /** 状态行、导出文件名、模型自查用。 */
  readonly title?: string
  /** 模型自己的讲稿，被打断后靠它接上。 */
  readonly notes?: string
}

export interface Deck {
  /** 整份共享的样式，只写一次。 */
  readonly css: string
  readonly slides: readonly Slide[]
  /** 0-based；slides 为空时无意义。 */
  readonly current: number
  /** 与 slides 等长，逐页场景。 */
  readonly annotations: readonly Scene[]
  /** 最近一次导出的绝对路径，没有则 undefined。 */
  readonly lastExport?: string
}

export type DeckOp =
  | { op: 'deck'; css?: string; slides: readonly Slide[] }        // 整份重建，清空全部批注
  | { op: 'slide'; index: number; slide: Slide }                  // 单页 upsert；index === slides.length 追加
  | { op: 'show'; index: number }                                 // 翻页，人与 agent 共用
  | { op: 'annotate'; slide: number; ops: readonly SceneOp[] }     // host 已分配好 id 的批注增量
  | { op: 'clear'; slide: number }                                 // 清空某页批注
  | { op: 'exported'; path: string }                               // 记录最近落点
```

`foldDeck(deck, op)` 是纯函数，host 与面板各折叠一遍，结果必须一致。`revision = 流长度`；面板按 `since` 增量拉取，检测到缺口（`revision - ops.length > since`）就整份重拉。

`Scene` / `SceneOp` / `DrawCommand` 全部复用 `vendor/dsh-blackboard`，不要另造。

## 6. 幻灯片文档骨架

`core/document.ts` 负责把 `Slide` 包成完整文档，供 `srcDoc` 使用，也供导出栅格化使用：

```html
<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">
<style>{BASE_CSS}{deck.css}</style>
</head><body><div class="sensei-slide">{slide.html}</div></body></html>
```

- `BASE_CSS` 固定 `.sensei-slide` 为 1280×720、`box-sizing: border-box`、`overflow: hidden`、默认字体栈、边距 0。
- **根元素必须是 `.sensei-slide`，不能用 `body` 选择器承载版面**：导出时内容是包进 `<div>` 再塞 foreignObject 的，`html, body` 的规则不会生效。
- `slide.html` 在放进来之前用 DOMPurify 白名单净化：禁 `script` / `iframe` / `frame` / `object` / `embed` / `link` / `meta` / `base` / `form` / `noscript`，禁 `on*` 属性、`href` / `xlink:href`，外链资源只允许 `data:`。

## 7. 工具面

| 工具 | 参数 | 结果（模型可见） |
|---|---|---|
| `sensei_deck` | `css?`, `slides: [{html, title?, notes?}]` | 页数、当前页、`panelOpen` |
| `sensei_slide` | `index`(1-based), `html`, `title?`, `notes?` | 第几页/共几页、`panelOpen` |
| `sensei_show` | `index`(1-based) | 当前页、总页数、`panelOpen` |
| `sensei_draw` | `slide?`(默认当前页), `commands: DrawCommand[]` | 新增元素 id、本页元素数 |
| `sensei_read` | `image?`, `slide?` | 页数/当前页/本页元素 id/溢出警告；`image: true` 时给 PNG 路径 |
| `sensei_export` | `dir?`, `name?`, `scale?`, `overwrite?` | 完整路径、页数、字节数 |

约束：

- 命令词汇与 blackboard 完全一致（`line`/`arrow`/`rect`/`circle`/`text`/`stroke`/`erase`），`clear` 不开放给模型。
- 上限：单页 `html` ≤ 64 KB、页数 ≤ 60、`css` ≤ 32 KB、单次 `commands` ≤ 200 条。超限报错，不静默截断。
- 所有结果都带 `panelOpen`：面板心跳（每秒轮询）超过 3 秒没更新即为 false。面板没开时 `sensei_read`（要图）与 `sensei_export` 必须明确报错，而不是静默失败。
- 工具跑在 host 平面，所有 preset 都能看到；不加开关。

## 8. 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/sensei.state?sessionId&since` | `{ revision, ops, snapshotRequest, exportRequest }` |
| POST | `/api/sensei.ops?sessionId` | 人提交 `{ commands }` 或 `{ show }`；host 折成 op 落盘 |
| POST | `/api/sensei.snapshot?sessionId&requestId` | body 是 PNG 原始字节（内容层 + 批注层） |
| POST | `/api/sensei.export?sessionId&requestId` | body `{ pages: [{ index, png }] }`，`png` 是 base64（不带 data: 前缀）；host 组装后把路径交给等待中的工具 |

`exportRequest` / `snapshotRequest` 都走"账本 + 面板轮询发现 + 面板回传"的模式，照搬 blackboard 的 `host/snapshots.ts`。

## 9. 面板

```
┌────────────────────────────────────────────────┐
│ ‹ 3/7 ›  标题                    [导出] [清空页] │  导航条
├────────────────────────────────────────────────┤
│        ┌──────────────────────────┐            │
│        │ iframe 1280×720（缩放 fit）│            │  内容层
│        │ canvas 透明（同尺寸覆盖）  │            │  批注层
│        └──────────────────────────┘            │
├────────────────────────────────────────────────┤
│ ✎ ╱ ↗ ▭ ◯ T  ●●●○○○ ▁▂▃  撤销      状态行      │  工具条
└────────────────────────────────────────────────┘
```

- 外层 `ResizeObserver` 算 `fitStage(w, h)`；内层 1280×720 容器用 `transform: scale() translate()` 居中；canvas 按容器像素 × dpr 分配，`render(ctx, scene, viewport)` 用同一个 fit。
- 翻页即换 `srcDoc`（一页一个文档）。批注在 canvas 上，与 iframe 生命周期无关。
- 人工翻页允许，走 `POST /api/sensei.ops { show }`。
- 「导出」按钮不是 v1 必需：导出由 `sensei_export` 工具触发，面板只负责栅格化并显示结果路径。

## 10. 导出栅格化（spike 已验证，三个坑必须遵守）

```ts
const holder = doc.createElement('div')
holder.innerHTML = iframe.contentDocument.body.innerHTML
const body = new XMLSerializer().serializeToString(holder)   // ① 必须 XMLSerializer
const svg = `<svg xmlns="..." width="${W * s}" height="${H * s}" viewBox="0 0 ${W} ${H}">`
  + `<foreignObject x="0" y="0" width="${W}" height="${H}">`
  + `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${W}px;height:${H}px;overflow:hidden">`
  + `<style>${css}</style>${body}</div></foreignObject></svg>`
const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)  // ② 不能用 blob:
```

1. `innerHTML` 不是合法 XML（`<br>`），必须经 `XMLSerializer`；生成图之前先用 `DOMParser` 校验，否则只拿到 "cannot be decoded"。
2. **`blob:` URL 会让 canvas 变 tainted，`data:` 不会**（实测 Chromium/Edge，全特性复现）。
3. 导出前先 `await contentDocument.fonts.ready`，否则可能用回退字体量错位。

实测保真度：2560×1440 下平均通道差 0.246/255，差异像素 0.92%，全部落在字形抗锯齿上。

## 11. pptx 组装

host 侧用 `pptxgenjs`（纯 JS，不需要 LibreOffice / Python）：

```js
const pptx = new PptxGenJS()
pptx.defineLayout({ name: 'SENSEI', width: 13.333, height: 7.5 })
pptx.layout = 'SENSEI'
for (const page of pages) pptx.addSlide().addImage({ data: 'image/png;base64,' + page.png, x: 0, y: 0, w: 13.333, h: 7.5 })
await pptx.writeFile({ fileName: target })
```

- 页面顺序按 `index` 升序，缺页补一张空白页并在结果里报页码。
- 目标目录不存在时 `mkdir -p`；已存在同名文件且没有 `overwrite: true` 时报错，不覆盖。

## 12. 边界与失败模式

- 面板没开：`sensei_read`（要图）/`sensei_export` 明确报错；其余工具正常，结果里 `panelOpen: false`。
- 页码越界：报错并回当前页数与当前页，不自动夹取。
- `sensei_deck` 重建：清空全部批注（页号语义已变）。
- 文字溢出：面板测 `.sensei-slide` 的 `scrollHeight`/`scrollWidth`，`sensei_read` 时回给模型。
- 导出有页失败：该页空白 + 结果里报页码，不让整份失败。
- 磁盘：jsonl 只增不减，暂不做压缩。

## 13. 里程碑

### M0 骨架与占位面板

交付：`pnpm-workspace.yaml`、`package.json`、`sensei.cordis.yml`、双 tsconfig、`build/build-client.mjs`、最小 `host/index.ts`、最小 `client/index.tsx`（注册 tab 类型，面板显示占位文案）、`core/stage.ts` + 测试、构建出的 `lib/client.js`。

验收：`pnpm install && pnpm run typecheck && pnpm run build && pnpm run test` 全绿；`lib/client.js` 以 `window.__ModuleLoader__.load({ id: "dsh-sensei"` 开头；`package.json` 的 `dsh.bundle.patch` / `dsh.client.platform` / `exports["./client"]` 指向存在的文件。

### M1 deck 模型、三条内容工具、iframe 渲染

交付：`core/deck.ts`（类型 + `foldDeck`）、`core/document.ts`（骨架 + 基样式）、`host/store.ts`、`host/presence.ts`、`host/routes.ts`（state/ops）、`host/tool.ts`（deck/slide/show）、`client/source.ts`、`client/stage.ts`、`client/panel.tsx`（导航条 + 舞台 + 空状态）、净化。

验收：新增单测覆盖 `foldDeck` 每种 op 与非法索引、`document` 骨架包含 CSP 与 `.sensei-slide`；`pnpm run typecheck`、`pnpm run test`、`pnpm run build` 绿。

### M2 批注层与 sensei_draw

交付：`client/annotator.ts`（指针 → 舞台坐标 → DrawCommand，无平移缩放、透明底）、canvas 挂载与撤销/清空、`sensei_draw` 工具、ops 路由的 annotate 分支、逐页场景。

验收：单测覆盖 annotate/clear 折叠与页隔离；绘制手势在 1200×675 与 800×450 两种容器尺寸下坐标换算正确（纯函数测试）。

### M3 sensei_read 与导出

交付：`host/snapshots.ts`、`sensei_read`（状态 + 溢出测量 + 可选出图）、`client/rasterize.ts`（第 10 节实现）、`sensei_export`、`host/export.ts`（第 11 节）、export 路由与账本。

验收：单测覆盖 pptx 组装（用 pptxgenjs 在 Node 里生成到临时目录，断言 zip 里页数正确）；栅格化用 Playwright + Edge 做一次端到端：加载面板页 → 导出 → 断言 PNG 尺寸与内容非空。

### M4 打磨与验收

交付：locale 补齐（中英）、README 更新（用法、限制、导出）、`.gitignore`、`pnpm run verify`（typecheck + build + test）、必要的 schema 漂移守卫（`DrawCommand` 与工具 `oneOf` 对齐）。

验收：`pnpm run verify` 全绿；README 与实现一致；`git status` 只包含预期文件。

## 14. 编码约定

- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noUnusedLocals`（抄 blackboard 的 tsconfig）。
- 注释用中文，风格与 blackboard 一致：写"为什么"，不写"是什么"。
- 文件以单个换行结尾；不用 `console.log` 留在产物代码里。
- 不写 `as unknown`；跨边界（wire、磁盘、工具参数）做校验，同进程类型边界不重复校验。
- 测试用 `node --import tsx/esm --test`，文件放 `tests/*.spec.ts`。
- 不要 `git commit`、不要改 DSH 仓库、不要改 `vendor/dsh-blackboard` 里任何文件。

## 15. 依赖与版本

- host 运行时依赖：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-home-paths`、`@deepseek-ai/dsh-session`（按 peer + dev 双份写法，参照 blackboard 的 package.json）。
- 纯 JS 依赖：`pptxgenjs`（host 组装）、`perfect-freehand`（vendor `core/render.ts` 需要）、`dompurify`（浏览器净化）、`esbuild` + `tsx` + `typescript`（dev）。
- 版本对齐：先 `npm view` 确认可用版本；`@deepseek-ai/*` 若 `0.2.1-rc.2` 未发布就用 blackboard 里的 `0.2.1-alpha.1` / `0.1.6-alpha.1` 组合，并在 README 里记下依据。

## 16. M4 追加要求（M0 完成后补充）

- **`files` 必须覆盖 vendor 里被 import 的源码**。`core/` 会相对 import `vendor/dsh-blackboard/{core,shared}`，所以 `package.json` 的 `files` 要包含 `vendor/dsh-blackboard/core` 与 `vendor/dsh-blackboard/shared`，否则 `npm pack` / 安装后宿主加载会缺文件。M4 核对时用 `npm pack --dry-run` 的实际清单确认，不要只看配置。
- **发布前把 peerDependencies 改成范围**。`0.2.1-rc.2` 是开发期对着本 checkout 的精确对齐，可以用；一旦要发 npm，peer 换成 `^0.2.1-rc.2` 这类范围，否则同版本线的其它构建会被 dsh 启动时的兼容闸拒绝。devDependencies 保持精确值只服务类型检查。
- **`shared/` 目录尚不存在**：M0 的 `files` 里已经写了 `shared`，M1 建目录后这条才成立；M4 核对时确认它真的存在。
- **批注落页竞态必须修**（M2 遗留）：`POST /api/sensei.ops` 的 body 目前只有 `{ commands }`，页号取 host 的 `current`。人正在某一页画、agent 同一拍翻页时，这一笔会落到新页。修法很小：`CommandsBody` 增加可选 `slide`（0-based），面板总是带上它当前显示的那一页，host 优先用它、缺省才退回 `current`；补一条"sender 指定页号优先于 current"的测试。
- **`DeckStore.clearPage` 目前没有生产调用方**：面板「清空本页」走的是 `{ commands: [{ op: 'clear' }] }`。M4 二选一：要么让面板改走 deck 级 `clear` op（更省事、语义更直接），要么删掉这个死方法，不要两套都留着。
- **导出回传要加体积闸**（M3 遗留）：`{ pages: [...] }` 一次回传，60 页 × scale 2 的 base64 可达上百 MB。M4 在面板侧序列化前先估算总字节，超过 64 MiB 就报错并提示「降低 scale 或分批导出」，不要把一个 100 MB 的请求真的发出去。
- **导出超时从 15s 提到 60s**（M3 遗留）：15s 对慢机器上 60 页 scale 2 偏紧。超时时明确报错并说明已渲染到第几页，不要静默失败。
