# dsh-sensei —— DeepSeek Harness 的 agent 讲演插件

agent 在右侧栏里给你讲一份幻灯片：它生成页面、翻页、在透明画布上写写画画；你随时打断提问，也可以自己上手画。

**状态：架构已定，尚未实现。**

## 已定的架构决策

### 两层结构

- **内容层**：agent 生成的 HTML 幻灯片，固定 16:9、不滚动
- **批注层**：一块**透明** canvas 盖在内容层上，人和 agent 都在这上面画

两层共用同一个坐标空间：舞台是 1280×720（16:9）CSS 像素，canvas 的 backing store 按 devicePixelRatio 放大，因此批注坐标就是幻灯片本地坐标。

### 内容层（HTML）

- 舞台固定 16:9、等比 fit 居中。**不滚动是批注对齐的硬前提**
- **无脚本**：iframe 用 `sandbox="allow-same-origin"`，**不开** `allow-scripts`
  - 这个组合同时给到三件事：CSS 被 iframe 关住（`position: fixed` 也逃不出 iframe 视口）、脚本不执行、同源让父页面能读 `contentDocument` 做元素测量
  - 危险组合是 `allow-same-origin` + `allow-scripts`；我们不使用后者
- 严格白名单净化：禁 `script` / `iframe` / `object` / `link` / `meta` / `form` / `on*` / `javascript:`；外链资源只放 `data:` 与本插件自己的文件路由

### 批注层（复用 dsh-blackboard）

批注层就是 blackboard 的画板 `core/`，**原样消费、零改动**：

| 文件 | 用途 |
|---|---|
| `core/render.ts` | 把场景画到 2D 上下文；透明、不画背景 |
| `core/elements.ts` / `core/commands.ts` | 元素与绘图命令词汇（line / arrow / rect / circle / text / stroke / erase） |
| `core/scene.ts` | 命令 → 元素的纯 reducer，不含任何板面尺寸假设 |
| `core/simplify.ts` / `core/assert.ts` / `core/types.ts` | 纯几何与工具 |
| `shared/ops.ts` | `SceneOp` 流（add / patch / clear），不含页概念 |

两条边界：

- **16:9 的 fit 计算写在 sensei 自己这里。** blackboard 的 `core/viewport.ts` 用 `VIRTUAL_SIZE = 1000`，是**正方形**虚拟坐标系，不适用于 16:9；而 `render.ts` 只需要一个 `{ scale, offsetX, offsetY }`，所以只借用类型形状，不引用它的 fit 函数。
- **页维度用 sensei 自己的薄包装** `{ slideIndex, op }`，不改 blackboard 的 `SceneOp`。

### 其它

- **人也能画**：批注层对人是可交互的（对称，与 blackboard 相同）
- **打断**由核心自带：用户随时输入 → 正在跑的 step 取消 → agent 回答后自己续讲。打断粒度是 **step 级**，不是逐字暂停
- **数据不进 session log**：仓库外插件的自定义事件不在 dsh 的已知事件表里，所以真相在 `$DSH_HOME/sensei/<sessionId>.jsonl`，客户端按 revision 增量折叠。代价是拿不到投影 / 分叉 / 回放语义（blackboard 同样如此）
- **模型可见性**：agent 的工具调用本身照常进 session log（走正常工具管线），所以它看得到自己讲过哪页、画了什么；只有 deck 内容与人的手绘批注在 session log 之外

## 与 dsh-blackboard 的关系

`vendor/dsh-blackboard` 是指向 <https://github.com/LYK-ce/dsh-blackboard> 的 **submodule**，pin 在固定 commit 上。它只作为**批注层的源码来源**被引用，本仓库不修改它。

## 目录规划

```
sensei.cordis.yml       overlay：只插一条 host 行
package.json            dsh.bundle.patch + dsh.client 声明 + exports["./client"]
core/                   sensei 自己的：舞台/页模型、16:9 fit、op 包装
host/                   插件宿主半边：store / routes / tool
client/                 浏览器半边：panel（HTML iframe + 透明 canvas）/ source
build/                  esbuild → lib/client.js
vendor/dsh-blackboard/  submodule：批注层源码
lib/client.js           构建产物，必须进版本库
```

## 待定

- deck 的传输方式：agent 写文件（倾向）还是走工具参数
- 工具命名与签名
- 模型是否需要"看当前页"的快照能力
