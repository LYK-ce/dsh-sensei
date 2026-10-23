/**
 * 导出落点解析与 pptx 组装。
 *
 * 落点在发起栅格化之前就定下来：覆盖保护要尽早失败，否则面板白栅格化几十页之后才发现
 * 目标文件已经存在，那几十秒的等待就完全白费。
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import PptxImport from 'pptxgenjs'
import type { ExportPage } from '../shared/protocol.ts'

/**
 * pptxgenjs 的构造函数。
 *
 * 它的 `exports.import` 指向 `dist/pptxgen.es.js`，但包的 package.json 里没有 `"type": "module"`：
 * Node 24 按语法检测把它当 ESM，默认导出就是构造函数；tsx（测试与 `dsh` 源码启动用的加载器）
 * 按扩展名把它当 CJS 包了一层，默认导出变成 `{ default: 构造函数 }`。两条路都得能跑，
 * 所以只在模块入口拆一次，其余代码只认构造函数。
 */
const PptxGenJS = unwrapDefault(PptxImport)

/**
 * 拆掉加载器可能多加的一层 `default`。
 * @param value - 模块的默认导出。
 * @returns 真正的构造函数。
 */
function unwrapDefault<T>(value: T): T {
  if (typeof value === 'function') return value
  // 走到这里说明加载器把 ESM 包成了 CJS：默认导出是个带 `default` 的普通对象。
  const nested: T | undefined = Object(value)['default']
  return nested ?? value
}

/** 省略 `name` 时的文件名；补 `.pptx` 之前不带扩展名，避免出现 `.pptx.pptx`。 */
const DEFAULT_NAME = 'sensei-deck'

/** 页面的物理尺寸（英寸）。13.333×7.5 是 16:9 的宽屏，与舞台的 1280×720 只差单位。 */
const SLIDE_WIDTH_INCHES = 13.333
const SLIDE_HEIGHT_INCHES = 7.5

/** 文件名里不能出现的字符：路径分隔符会让落点跑出 `dir`，其余是 Windows 的保留字符。 */
const ILLEGAL_NAME = /[<>:"/\\|?*\u0000-\u001f]/

/** 解析落点用的参数。 */
export interface ExportTargetOptions {
  /** 模型给的目录；相对路径按 `baseDir` 解析，省略即 `baseDir`。 */
  readonly dir?: string | undefined
  /** 模型给的文件名，可省略 `.pptx` 扩展名；必须是单个文件名，不能带目录。 */
  readonly name?: string | undefined
  /** 允许覆盖已存在的文件。 */
  readonly overwrite?: boolean | undefined
  /** 基准目录，通常是会话工作区。 */
  readonly baseDir: string
}

/**
 * 解析导出落点并做覆盖保护。
 *
 * 相对 `dir` 按 `baseDir` 解析而不是按进程 cwd：模型说的"会话工作区"是它自己那个会话，
 * 与 host 进程从哪儿启动无关。`name` 只收单个文件名，路径注入在这里就挡住。
 * @param options - 目录、文件名、覆盖开关与基准目录。
 * @returns 绝对路径。
 * @throws Error 文件名非法，或目标已存在且没给 `overwrite: true` 时抛出。
 */
export function exportTarget(options: ExportTargetOptions): string {
  const name = baseName(options.name)
  const dir = options.dir === undefined
    ? resolve(options.baseDir)
    : isAbsolute(options.dir) ? resolve(options.dir) : resolve(options.baseDir, options.dir)
  const target = join(dir, name)
  if (existsSync(target) && options.overwrite !== true) {
    throw new Error(`sensei_export: ${target} already exists; pass overwrite: true to replace it`)
  }
  return target
}

/**
 * 把模型给的文件名收窄成"单个文件名 + .pptx"。
 * @param name - 模型给的文件名，可省略。
 * @returns 合法文件名。
 * @throws Error 名字为空、带目录，或含保留字符时抛出。
 */
function baseName(name: string | undefined): string {
  const trimmed = (name ?? DEFAULT_NAME).trim()
  if (trimmed === '' || trimmed === '.' || trimmed === '..' || ILLEGAL_NAME.test(trimmed)) {
    throw new Error(`sensei_export: ${JSON.stringify(name ?? '')} is not a valid file name`)
  }
  // 大小写不敏感：Windows 上 `.PPTX` 与 `.pptx` 是同一个扩展名，补两次就成 `x.pptx.PPTX`。
  return trimmed.toLowerCase().endsWith('.pptx') ? trimmed : `${trimmed}.pptx`
}

/** 一次 pptx 组装。 */
export interface PptxWriteOptions {
  /** 目标绝对路径；目录不存在时这里创建。 */
  readonly target: string
  /** 面板交回的页面；顺序无关，靠 `index` 定位。 */
  readonly pages: readonly ExportPage[]
  /** deck 的页数；没交回的页补一张空白页。 */
  readonly slideCount: number
}

/** 组装结果。 */
export interface PptxWriteResult {
  /** 实际写入的绝对路径。 */
  readonly path: string
  /** 文件字节数。 */
  readonly bytes: number
  /** 补成空白页的页码，1-based。 */
  readonly blank: readonly number[]
}

/**
 * 用 pptxgenjs 把一批 PNG 组装成图片版 pptx。
 *
 * 每页一张整幅图片，不带批注层（DESIGN §2：导出的是内容）。缺页补空白并在结果里报页码，
 * 不让一页失败把整份导出拖垮。
 * @param options - 落点、页面与页数。
 * @returns 落点、字节数与补白的页码。
 */
export async function writePptx(options: PptxWriteOptions): Promise<PptxWriteResult> {
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'SENSEI', width: SLIDE_WIDTH_INCHES, height: SLIDE_HEIGHT_INCHES })
  pptx.layout = 'SENSEI'

  const pictures = new Map<number, string>()
  for (const page of options.pages) pictures.set(page.index, page.png)

  const blank: number[] = []
  for (let index = 0; index < options.slideCount; index++) {
    const slide = pptx.addSlide()
    const png = pictures.get(index)
    if (png === undefined) {
      blank.push(index + 1)
      continue
    }
    slide.addImage({
      data: `image/png;base64,${png}`,
      x: 0,
      y: 0,
      w: SLIDE_WIDTH_INCHES,
      h: SLIDE_HEIGHT_INCHES,
    })
  }

  await mkdir(dirname(options.target), { recursive: true })
  await pptx.writeFile({ fileName: options.target })
  // 字节数从磁盘上量：writeFile 的返回值是演示文稿名，不是大小。
  const bytes = (await readFile(options.target)).byteLength
  return { path: options.target, bytes, blank }
}
