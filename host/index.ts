import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Type-only：把 ctx.connection 的声明拉进程序；运行时不产生 import。
import type {} from '@deepseek-ai/dsh-client-connection'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { EXPORT_PATH, OPS_PATH, PROGRESS_PATH, SNAPSHOT_PATH, STATE_PATH } from '../shared/protocol.ts'
import { PanelPresence } from './presence.ts'
import { handleExport, handleOps, handleProgress, handleSnapshot, handleState } from './routes.ts'
import { ExportLedger, SnapshotLedger } from './snapshots.ts'
import { DeckStore } from './store.ts'
import { createDeckTool, createDrawTool, createExportTool, createReadTool, createShowTool, createSlideTool } from './tool.ts'

/** 插件名：overlay 行名与 lib 产物之外，它是 host 侧对外的身份。 */
export const name = 'sensei'

/** 需要的宿主服务：工具注册处与 exact Fetch route 注册处。 */
export const inject = ['tools', 'connection']

/** 插件配置。 */
export interface Config {
  /** ops 与快照文件目录；默认 `<dsh home>/sensei`。 */
  readonly dataDir?: string
}

/**
 * 挂四条 exact Fetch route 与六条工具。deck 数据不进 session log。
 * @param ctx - 宿主上下文。
 * @param config - 可选的 ops 目录覆盖。
 * @returns 无。
 */
export function apply(ctx: Context, config: Config = {}): void {
  const dataDir = config.dataDir ?? join(resolveDshHome(), 'sensei')
  const store = new DeckStore(dataDir)
  ctx.effect(() => () => store.dispose(), 'sensei: deck store')
  // 面板开着这件事只由 state 轮询表达，所以心跳表没有自己的定时器。
  const presence = new PanelPresence()
  // 两条产出请求账本：host 没有 canvas，图只能由面板产出，这里只记账与超时。
  const snapshots = new SnapshotLedger()
  const exports = new ExportLedger()
  ctx.effect(() => () => {
    snapshots.dispose()
    exports.dispose()
  }, 'sensei: panel request ledgers')
  ctx.effect(() => ctx.connection.fetch.register({
    path: STATE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request) => handleState(store, presence, { snapshots, exports }, request),
  }), 'sensei: state route')
  ctx.effect(() => ctx.connection.fetch.register({
    path: OPS_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => handleOps(store, request),
  }), 'sensei: ops route')
  ctx.effect(() => ctx.connection.fetch.register({
    path: SNAPSHOT_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => handleSnapshot(snapshots, request),
  }), 'sensei: snapshot route')
  ctx.effect(() => ctx.connection.fetch.register({
    path: EXPORT_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => handleExport(exports, request),
  }), 'sensei: export route')
  ctx.effect(() => ctx.connection.fetch.register({
    path: PROGRESS_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => handleProgress(exports, request),
  }), 'sensei: export progress route')
  // tools.register 自己就是注册即效应（先例 packages/todo/tool-todo/src/index.ts），这里不重复包一层。
  ctx.tools.register(createDeckTool(store, presence))
  ctx.tools.register(createSlideTool(store, presence))
  ctx.tools.register(createShowTool(store, presence))
  ctx.tools.register(createDrawTool(store, presence))
  ctx.tools.register(createReadTool(store, presence, snapshots, dataDir))
  ctx.tools.register(createExportTool(store, presence, exports))
}
