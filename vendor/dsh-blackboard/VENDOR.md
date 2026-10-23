# vendor/dsh-blackboard

批注层的源码来源，**以普通文件的形式内联在本仓库**（不是 submodule）。

| 项 | 值 |
|---|---|
| 上游仓库 | <https://github.com/LYK-ce/dsh-blackboard> |
| 固定提交 | `ec9052f2799e45b6ceb3eadbbcff04f89a4021cd` |
| 收录范围 | `core/`、`shared/`、`LICENSE` |
| 许可 | MIT（见同目录 `LICENSE`） |

## 为什么内联

上游是独立插件，我们只借它的画板内核（元素、命令、场景、渲染、简化）和 op 流。早先用 submodule 固定 commit，但 pnpm 打包远端仓库时不会递归拉 submodule，从 `github:` 安装会缺文件、宿主加载直接失败。内联之后，`github:` 安装与 npm 发布都不再有这个坑。

## 约束

- 这些文件是**上游原样副本**，本仓库不修改它们。需要改动时去上游改，再整体覆盖回来。
- 覆盖方式：把上游对应 commit 的 `core/`、`shared/`、`LICENSE` 拷到这里，更新上表的提交号。
- 相对 import 路径保持不变（`../vendor/dsh-blackboard/core/render.ts`），因为路径就是这里。
