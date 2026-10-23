# dsh-sensei —— DeepSeek Harness 的 agent 讲演插件

agent 在右侧栏里给你讲一份现场生成的 HTML 幻灯片：它写页面、翻页、在透明批注层上圈画；你随时打断提问，也可以自己上手画，讲完让 agent 把整份 deck 导出成图片版 pptx。

这是一个独立的 dsh 插件包：node 半边（`host/`）注册六条工具与五条 exact Fetch 路由，浏览器半边（`client/`）在**右侧栏**提供讲演舞台。安装只需要一条命令——包里的 `dsh.bundle.patch` 指向那份 cordis overlay，overlay 里只插一行，不改动 dsh 自身的任何文件。

**状态：功能完成（M4）。** 六条工具、批注层、出图、导出、中英文案与漂移守卫都已落地；验收记录见「已验证」。

## 要求

- 一份 DeepSeek Harness（`dsh`）`0.2.1-rc.2` 版本线的 checkout，或同版本线的 `@deepseek-ai/dsh` 安装
- Node `^22.19 || >=24`、pnpm
- 浏览器：面板用 iframe 渲染内容层、canvas 画批注层，两者都只存在于浏览器里

## 安装

本包同时声明了 `dsh.bundle.patch`（指向 `sensei.cordis.yml`）与 `dsh.client`，所以它是一份**能直接装进 profile 的 bundle**：装完之后 dsh 自己按这份 overlay 接上 host 半边与浏览器半边，不需要手写 `--patch`。

用 GUI 的插件管理器装，或者走同一条路的命令行：

```sh
dsh plugin --profile <profile> add <spec>
```

`<spec>` 有三种形态：

| spec | 例 | 说明 |
|---|---|---|
| 本地路径 | `C:\src\dsh-sensei`、`/src/dsh-sensei`、`file:C:\src\dsh-sensei` | 开发时就地用。**GUI 里必须填绝对路径**——Host 的工作目录对浏览器里输入的人没有意义，相对路径会被拒；同一条 CLI 命令会把相对路径按调用方的当前目录锚成绝对路径 |
| git | `github:LYK-ce/dsh-sensei` | 一般用户走这条：pnpm 直接打包远端仓库、不跑任何构建。批注层源码以普通文件内联在 `vendor/dsh-blackboard`，没有 submodule，装的人不用额外操作 |
| npm | `dsh-sensei` | **还没发**。发出去以后是最省事的一条：产物与 vendor 源码都随包走 |

### 为什么包里没有构建步骤

`dsh.client` 一旦声明，`@deepseek-ai/dsh-client-modules` 会在启动时 `readFileSync` `exports["./client"]` 指向的那个文件；缺了就是 `MissingClientBundleError`，整个 `dsh web` 起不来。所以 **`lib/client.js` 进版本库**（`.gitignore` 用 `lib/*` + `!lib/client.js` 白名单放行），改了 `client/` 下的源码必须 `pnpm run build` 并把产物一起提交。本包因此刻意不放 `prepare`：安装路径上没有任何构建步骤。

想改这个插件本身，在 checkout 里：

```sh
pnpm install
pnpm run build      # 产出 lib/client.js
```

本仓库自带一份 `pnpm-workspace.yaml`（只有一个包，主要用来放 pnpm 设置），所以即使把它放在某个 dsh checkout 内部，它也是一个独立的 workspace root，直接 `pnpm install` 就行。

## 挂载

挂载就是 `dsh.bundle.patch` 那一行：`sensei.cordis.yml` 里只插一条 host 行。行名写成相对路径，app-boot 的 `anchorInsertedPluginNames` 会把它锚成该文件所在目录的 `file://` URL，换机器、换 checkout 位置都不用改；`@deepseek-ai/dsh-client-modules` 再按**行名**找到最近的 `package.json`（这里是同目录的 `package.json`），读它的 `dsh.client` 与 `exports["./client"]`，把 `lib/client.js` 作为动态客户端 bundle serve 出去——所以一条行就够，不需要第二条。

**开发时**可以绕过 profile，让源码启动的 `dsh` 直接吃这份 overlay（源码启动的 host 半边由 tsx 直接跑 `.ts` 源码）：

```powershell
pnpm dsh web --patch <本仓库路径>/sensei.cordis.yml --port 8123 --no-open
```

> **`--patch` 必须写在应用自己的 flag 之前。** `dsh` 启动器只解析自己的 flag，遇到第一个不认识的 token（例如 `--port`）就把后面**全部**原样交给 web 应用；写在后面会被应用当成未知选项报 `error: unknown option '--patch'`。
> （`dsh web --patch X --port 8123 --no-open` ✅；`dsh web --port 8123 --patch X` ❌。）

打开服务输出的带 token 的 URL，点右侧栏的 **+**，在 guide 里选「讲演 / Sensei」，即可开一个讲演标签页（和终端、文件预览并列，按会话记忆）。模型那一侧的工具目录里会多出六条 `sensei_*` 工具。

### host 半边由谁跑

`host/index.ts` 是 TypeScript 源码，加载它的运行时取决于是哪一种 dsh：

| dsh | 加载 host 半边的机制 |
|---|---|
| 源码启动（`pnpm dsh …`） | tsx 的 ESM hook（`node --import tsx/esm`） |
| 安装版（`@deepseek-ai/dsh` 或打包出来的可执行文件） | **Node 内建类型剥离**，安装里没有 tsx。Node ≥22.18 / 24 默认开启 |

所以安装版能直接跑 `.ts` 源码，靠的不是本包带了构建步骤，而是 Node 自己剥离类型。`NODE_OPTIONS=--no-experimental-strip-types` 会让它加载失败（`ERR_UNKNOWN_FILE_EXTENSION`）。

## 用法

- **开面板**：右侧栏 `+` → guide 里的「讲演 / Sensei」。面板没有 deck 时显示「还没有幻灯片 / No slides yet」。
- **agent 讲**：`sensei_deck` 建整份，`sensei_show` 翻页，`sensei_draw` 圈画；`sensei_slide` 在讲的过程中补一页或改一页，改已有页会保留那页的批注。
- **人也能画**：工具条切换手绘 / 直线 / 箭头 / 矩形 / 圆 / 文字，五个颜色、三档线宽。「撤销上一笔」删本页最后一个可见元素；「清空本页」清掉本页批注（另一页不受影响）。
- **翻页**：导航条 `‹ 3/7 ›`。人和 agent 共用同一份 `current`，谁翻都一样。翻页不重建 canvas，批注跟着页走。
- **打断**：由 dsh 核心自带——你随时输入，正在跑的 step 被取消，agent 回答后自己续讲。打断粒度是 **step 级**，不是逐字暂停。讲稿备注（`notes`）留在 deck 里，agent 被打断或上下文压缩后可以靠 `sensei_read` 接上。
- **导出**：由 `sensei_export` 工具触发（面板不提供导出按钮）；面板负责逐页栅格化并把结果交回 host。导出成功后状态行显示完整路径。
- **看当前页**：`sensei_read` 回页数、当前页、本页元素 id、溢出测量；`image: true` 再要 PNG（内容层 + 批注层），写到 `$DSH_HOME/sensei/` 下，agent 用 `read_image` 看。

## 六工具

页号一律 **1-based**（`current` 在空 deck 时为 0）；所有结果都带 `panelOpen`——面板每秒轮询一次 host，超过 3 秒没有心跳即为 `false`。

| 工具 | 参数 | 结果 |
|---|---|---|
| `sensei_deck` | `css?`, `slides[{html,title?,notes?}]` | `pages`, `current`, `panelOpen` |
| `sensei_slide` | `index`(1-based), `html`, `title?`, `notes?` | `pages`, `current`, `panelOpen` |
| `sensei_show` | `index`(1-based) | `pages`, `current`, `panelOpen` |
| `sensei_draw` | `slide?`(1-based，默认当前页), `commands[]` | `added`, `elements`, `panelOpen` |
| `sensei_read` | `image?`, `slide?`(1-based) | `pages`, `current`, `slide`, `elements`, `overflow`, `panelOpen`, `image?` |
| `sensei_export` | `dir?`, `name?`, `scale?`, `overwrite?` | `path`, `pages`, `bytes`, `blank`, `panelOpen` |

约束：

- **上限**：单页 `html` ≤ 64 KB（UTF-8）、页数 ≤ 60、`css` ≤ 32 KB、单次 `commands` ≤ 200 条。超限报错，不静默截断。
- **绘图词汇**：`line` / `arrow` / `rect` / `circle` / `text` / `stroke` / `erase`，与 dsh-blackboard 一致。`rect` / `circle` 可带 `fill`，`text` 可带 `align: start|middle|end`（省略按 `start`）。`clear` **不开放给模型**：它能一次抹掉整页，那是人手里按钮的语义。
- **页号越界**报错并带上页数与当前页，不自动夹取。`sensei_slide` 的 `index` 等于页数 + 1 时追加。
- **面板没开**：`sensei_read { image: true }` 与 `sensei_export` 明确报错（host 没有 canvas，图只能由面板产出）；其余工具正常，结果里 `panelOpen: false`，文案会提示去开面板。
- **`sensei_deck` 是整份重建**：清空全部批注、当前页回到第 1 页。只想改一页就用 `sensei_slide`。
- 工具注册在 **host 平面**，所有 preset（含 `minimal`）的模型工具目录里都会出现，不加开关。

## 导出

- **默认 1.5 倍** = 1920×1080；可选 `scale: 1`（1280×720）或 `2`（2560×1440）。页面固定 16:9。
- **落点**：`dir` 省略即会话工作区；相对路径按**会话工作区**解析，不跟随会话内 `cd`。目标目录不存在时自动创建。
- **文件名**：`name` 可带或不带 `.pptx`，不能含路径分隔符；默认 `sensei-deck.pptx`。
- **覆盖保护**：目标已存在且没有 `overwrite: true` 时报错，不覆盖。落点检查在发起栅格化**之前**，不会白等几十秒。
- **缺页**：单页栅格化失败只让那一页变空白，整份仍然产出；结果里的 `blank` 报出这些页码（1-based）。
- **体积闸**：面板在交回之前估算 base64 解码后的总字节，超过 **64 MiB** 直接失败并提示降低 `scale`，不会把上百 MB 的请求真的发出去。
- **超时**：host 等面板 **60 秒**。超时错误会带上「面板已处理到第几页 / 共几页」——面板每处理完一页报一次进度。
- **产物**：图片版 pptx，一页一张 PNG。**不可编辑、不含批注与讲稿备注**（设计如此：批注是"讲"的现场，不是交付物）。

## 数据

- 真相在 **`$DSH_HOME/sensei/<sessionId>.jsonl`**（append-only，每会话一份），不写 session log。仓库外插件的事件类型不在 dsh 的 `KNOWN_SESSION_EVENT_TYPES` 里，所以在"不改 dsh 仓库"的前提下拿不到投影 / 分叉 / 回放语义。
- 每次 `sensei_read { image: true }` 把 PNG 写到 **`$DSH_HOME/sensei/<sessionId>-p<页号>.png`**，同一页重复读会覆盖同一路径。
- 面板按 `revision`（= op 流长度）增量拉取并本地折叠；`sensei_*` 的工具调用本身照常进 session log（走正常工具管线），只有 deck 内容与人的手绘批注在 session log 之外。
- 批注的 `erase` / 清空页都是**软删除**（往流里追加 `patch` / scene `clear`），所以 jsonl 只增不减。

## 开发与验证

```sh
pnpm install
pnpm run verify   # = typecheck && build && test
```

| 命令 | 作用 |
|---|---|
| `pnpm run typecheck` | host / client 两个 program 各自 `tsc --noEmit`，各自解析自己那半的 `@deepseek-ai/*` 类型 |
| `pnpm run build` | esbuild 打 `lib/client.js`（模块表 lazy-CJS 协议；改动客户端代码后必须重跑，没有 HMR） |
| `pnpm run test` | `node --import tsx/esm --test tests/*.spec.ts` |
| `pnpm run verify` | 上面三步串起来；**build 排在 test 前面**，因为 `tests/manifest.spec.ts` 检查的是构建产物，全新 clone 上先 test 会 ENOENT |

发布前的额外核对：

```powershell
cmd /c "npm pack --dry-run --json"     # 确认 vendor/dsh-blackboard/{core,shared} 与 lib/client.js 在清单里
pnpm install --frozen-lockfile         # peer 范围不应触发 lockfile 漂移
```

**改完客户端代码必须 `pnpm run build` 再刷新页面**：dsh 的 registry serve 的是 `lib/client.js`，不是源码。

### 漂移守卫

- `tests/command-schema.spec.ts`：从 `sensei_draw.parameters` 读真实编译出的 `commands.items.oneOf`，与两份样例表（完整 / 最小）双向对账——属性名集合、必填集合、每个完整/最小样例都能执行、每个必填字段缺失都抛 `INVALID_ARGS`、`clear` 不在 schema 里。
- `tests/manifest.spec.ts`：`dsh.client` / `dsh.bundle.patch` / `exports["./client"]` 指向真实文件，`files` 覆盖 vendor 的两个目录，overlay 只插一行，README 的六工具表与工具集一致。
- `tests/locale.spec.ts`：中英键集与占位符逐键一致。

## 版本对齐

`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-home-paths`、`@deepseek-ai/dsh-session` 是**运行时**依赖，写成 **peerDependencies + devDependencies 两份、`dependencies` 里一个不留**：profile 用 `nodeLinker: hoisted` + `autoInstallPeers: false`，留在 `dependencies` 里的包会被平铺进 profile 的 `node_modules`，**遮蔽**整个 installation 里那份；写成 peer 就由 installation 提供，`dsh` 启动时的兼容性闸也正好按 peer 判版本。

- **peer 是范围 `^0.2.1-rc.2`**：范围才能让同一版本线上的 installation 都装（`0.2.1-rc.2`、`0.2.1`、`0.2.2` 都放行，`0.3.0` 拒绝）。精确值会让运行时升一个小版本就装不上。
- **devDependencies 钉精确 `0.2.1-rc.2`**，只服务类型检查，跟随本仓库当时编译所依据的类型。
- `@deepseek-ai/cordis` 的 peer 是 `^4.0.2`。
- 浏览器半边的 `@deepseek-ai/dsh-client-*` 与 `@deepseek-ai/dsh-api-session-controller` 只写在 devDependencies：客户端能力靠 TypeScript 声明合并挂在 `Context` 上，发布出去的包不会把它们装进 profile。加上 `skipLibCheck: true` 会静默掉 d.ts 里解析不到的 import，少一个包的表现就是某个 `ctx.xxx` 突然不存在——用到哪个服务的类型，就把它显式写进 devDependencies。

## 已验证

以下为本机（Windows，Edge headless + Playwright）实测，证据留在 `%TEMP%`，不提交仓库：

- `pnpm run verify`：typecheck 两个 program 零错误；build 产出 `lib/client.js`；test **162/162** 通过。
- `npm pack --dry-run --json`：清单包含 `lib/client.js`、`vendor/dsh-blackboard/core/*`、`vendor/dsh-blackboard/shared/*`、`sensei.cordis.yml`。
- `pnpm install --frozen-lockfile`：通过，peer 范围没有触发 lockfile 漂移。
- GUI 冒烟（`pnpm dsh web --patch …/sensei.cordis.yml --port 8123 --no-open`，从日志里取带 token 的 URL，Playwright + 本机 Edge headless；用临时 `DSH_HOME` 避免与现有 3080 实例争锁）：右侧栏 guide 里出现「讲演」，打开后标签页标题是「讲演」、正文是空状态「还没有幻灯片」；浏览器控制台无 error、无 `pageerror`。截图 `%TEMP%\sensei-smoke\03-sensei-empty.png`，浏览器日志 `%TEMP%\sensei-smoke\smoke.log`，服务日志 `%TEMP%\sensei-web-8123.log`；冒烟结束后 8123 已无监听。

## 已知限制

- **面板没开就没有图。** host 没有 canvas：`sensei_read { image: true }` 与 `sensei_export` 会立刻报错（不是静默失败），其余工具照常工作但 `panelOpen: false`。面板被后台节流或标签页冻结时同样算没开。
- **导出的 pptx 是图片版**：文字不可编辑、不含批注、不含讲稿备注；缩放倍率只在导出时生效。
- **host 半边的改动要重启 `dsh` 才生效**：host 源码在启动时加载（源码启动走 tsx、安装版走 Node 内建类型剥离），注册工具与路由后没有热重载；浏览器半边（`lib/client.js`）刷新页面即可。
- **1 秒轮询，不是推送**：agent 翻页到人看见最多迟 1 秒，空闲时每个会话每秒一次请求。
- **磁盘只增不减。** 每个会话在 `$DSH_HOME/sensei/` 下留一份 append-only 的 jsonl，加上每页最多一张 PNG（每次覆盖同一路径）。不随会话删除、不随插件卸载，也没有压缩或保留策略；清空/撤销都是软删除。
- **路由只做结构校验**：`sessionId` 由页面提供，只要通过 `/api` 的浏览器信任围栏就能读写对应会话的 deck。本地单用户场景可接受，多用户部署不行。
- **内容层无脚本**：iframe 用 `sandbox="allow-same-origin"`，不开 `allow-scripts`；净化禁 `script` / `iframe` / `object` / `link` / `meta` / `form` / `on*` 属性与 `href`，外链资源只允许 `data:`。所以页内不能放动画，也不能引用网络字体或图片。
- **固定舞台 1280×720、只做 16:9 fit**：没有缩放平移，超出舞台的内容靠 `sensei_read` 的 `overflow` 提示，不会自动排版。
- **单次导出回传上限 64 MiB**：60 页 × scale 2 可能触顶；降低 `scale` 再导。
- **工具在所有 preset 可见**：没有开关，也不需要开。
- **批注层是 vendored 副本**：`vendor/dsh-blackboard` 是上游固定 commit 的普通文件副本，不随上游自动更新；升级要手工覆盖并同步 `VENDOR.md` 里的提交号。

## 目录

```
sensei.cordis.yml       overlay：只插一条 host 行，行名是相对路径
package.json            dsh.bundle.patch + dsh.client + exports["./client"]，bundle id 必须等于包名
core/                   零依赖纯 TypeScript：deck 模型、文档骨架、舞台、导出 SVG
shared/                 wire 类型与请求校验
host/                   插件宿主半边：index / store / routes / tool / presence / snapshots / export
client/                 浏览器半边：index / panel / source / stage / annotator / rasterize / sanitize / locale
build/build-client.mjs  esbuild → lib/client.js（模块表 lazy-CJS 协议）
tests/                  node:test 单测
vendor/dsh-blackboard/  批注层源码副本（上游 ec9052f），只读；见同目录 VENDOR.md
lib/client.js           构建产物，已进版本库，必须与 client/ 源码一致
```

## 与 dsh-blackboard 的关系

`vendor/dsh-blackboard` 是 <https://github.com/LYK-ce/dsh-blackboard> 在固定 commit `ec9052f` 上的**源码副本**（普通文件，不是 submodule），许可见同目录 `LICENSE`，来源与覆盖方式见 `VENDOR.md`。它只作为**批注层源码来源**被相对路径 import，本仓库不修改它：

- `core/render.ts` 把场景画到 2D 上下文（透明，不画背景）；
- `core/commands.ts` / `core/elements.ts` / `core/scene.ts` / `shared/ops.ts` 提供命令词汇、元素与场景 reducer；
- `core/viewport.ts` 用正方形虚拟坐标，**不适用于 16:9**。sensei 只借用 `render` 需要的 `{ scale, offsetX, offsetY }`，fit 计算写在 `core/stage.ts` 自己这里。

## 发布

- 给这个 GitHub 仓库加上 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题——这是官方 README 指定的发现渠道。
- 要发 npm 的话：`name` / `version` / `repository` 自定；发布前跑 `pnpm run verify`，再 `npm pack --dry-run --json` 核对 vendor 与 `lib/client.js` 确实在包里。
- `LICENSE` 里的版权人占位符记得填。
