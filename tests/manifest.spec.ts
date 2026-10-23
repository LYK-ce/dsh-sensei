// 这个包同时是 npm 包、git 仓库和 dsh bundle：三者任一缺文件都只在"装到别处"时才炸。
// 本 spec 在仓库内把那些前提固定下来——产物存在、vendor 源码进了 files、overlay 行指向真实入口、
// README 的六工具表没有漂移。它不启动 dsh，也不碰网络。
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

/** 本插件目录。 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** package.json 里本 spec 读到的部分。 */
interface Manifest {
  readonly name: string
  readonly exports: Record<string, string>
  readonly files: readonly string[]
  readonly scripts: Record<string, string>
  readonly dsh: {
    readonly client: { readonly platform: string }
    readonly bundle: { readonly patch: string }
  }
  readonly peerDependencies: Record<string, string>
  readonly devDependencies: Record<string, string>
}

/** 本包的 manifest。 */
const manifest: Manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

/** 客户端产物的相对路径；缺导出时留空串，让断言报出更好懂的错误。 */
const CLIENT_EXPORT = manifest.exports['./client'] ?? ''

/**
 * 判断一个路径是否是真实文件。
 * @param path - 相对本包的路径。
 * @returns 存在且是普通文件时为 true。
 */
function isFile(path: string): boolean {
  const absolute = resolve(ROOT, path)
  return existsSync(absolute) && statSync(absolute).isFile()
}

/**
 * 判断一个路径是否是真实目录。
 * @param path - 相对本包的路径。
 * @returns 存在且是目录时为 true。
 */
function isDirectory(path: string): boolean {
  const absolute = resolve(ROOT, path)
  return existsSync(absolute) && statSync(absolute).isDirectory()
}

test('manifest：dsh.client 声明为 web，bundle patch 与 ./client 导出都指向真实文件', () => {
  assert.notEqual(manifest.name, '')
  assert.equal(manifest.dsh.client.platform, 'web')
  // loader 扫描这个包靠的是 exports["./client"] 指向的真实文件；没有它启动就失败。
  assert.equal(typeof CLIENT_EXPORT, 'string')
  assert.ok(isFile(CLIENT_EXPORT), `${String(CLIENT_EXPORT)} does not exist; run pnpm run build`)
  assert.ok(isFile(manifest.dsh.bundle.patch), `${manifest.dsh.bundle.patch} does not exist`)
})

test('bundle：以 package.json 的 name 作为模块表 id 注册', () => {
  const bundle = readFileSync(resolve(ROOT, CLIENT_EXPORT), 'utf8')
  const registered = /__ModuleLoader__\.load\(\{\s*id:\s*"([^"]+)",\s*factory:/.exec(bundle)
  assert.ok(registered !== null, 'bundle does not register a module-table factory')
  // 两个 id 必须一致，否则 modules 宿主半侧会 serve 一份没人认领的 bundle。
  assert.equal(registered[1], manifest.name)
})

test('files：覆盖 vendor 里被 import 的源码，且那些目录真的存在', () => {
  // `core/` 与 `shared/` 相对 import vendor；只写自己的 core/shared 时 npm 包里会缺这两个目录，
  // 安装后宿主加载直接失败。README「安装」一节也写明 git 装法要先初始化 submodule。
  for (const path of ['vendor/dsh-blackboard/core', 'vendor/dsh-blackboard/shared']) {
    assert.ok(manifest.files.includes(path), `files 缺 ${path}`)
    assert.ok(isDirectory(path), `${path} 不存在；submodule 没有初始化？`)
  }
  for (const path of ['core/render.ts', 'shared/ops.ts']) {
    assert.ok(isFile(`vendor/dsh-blackboard/${path}`), `vendor/dsh-blackboard/${path} 不存在`)
  }
  for (const path of ['core', 'shared', 'host', 'client', 'lib', 'README.md']) {
    assert.ok(manifest.files.includes(path), `files 缺 ${path}`)
  }
})

test('overlay：只插一行，指向本目录里真实存在的 host 入口', () => {
  const overlay = readFileSync(resolve(ROOT, manifest.dsh.bundle.patch), 'utf8')
  const ids = [...overlay.matchAll(/^\s*-\s*id:\s*(\S+)\s*$/gm)].map((match) => match[1])
  const names = [...overlay.matchAll(/^\s*name:\s*'([^']+)'\s*$/gm)].map((match) => match[1])
  assert.deepEqual(ids, ['sensei-host'])
  assert.equal(names.length, 1)

  const entry = names[0] ?? ''
  // 相对路径由 app-boot 锚成 patch 文件所在目录；裸包名会要求 node 解析能命中，那正是它不依赖的。
  assert.match(entry, /^\.\.?\//)
  assert.ok(isFile(entry), `${entry} does not exist next to the overlay`)
})

test('scripts：verify 是 typecheck → build → test，build 必须先于 test', () => {
  assert.equal(manifest.scripts['verify'], 'pnpm run typecheck && pnpm run build && pnpm run test')
  // manifest.spec 检查的就是 lib/client.js；全新 clone 上先 test 会 ENOENT。
  const verify = manifest.scripts['verify'] ?? ''
  assert.ok(verify.indexOf('run build') < verify.indexOf('run test'))
})

test('版本对齐：peer 是范围、dev 是精确值，两条线各自成立', () => {
  for (const name of ['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-home-paths', '@deepseek-ai/dsh-session']) {
    assert.equal(manifest.peerDependencies[name], '^0.2.1-rc.2', `${name} 的 peer 必须是范围`)
    assert.equal(manifest.devDependencies[name], '0.2.1-rc.2', `${name} 的 dev 必须钉精确值`)
  }
  assert.equal(manifest.peerDependencies['@deepseek-ai/cordis'], '^4.0.2')
  assert.equal(manifest.devDependencies['@deepseek-ai/cordis'], '^4.0.2')
})

test('README：六工具表与 host/tool.ts 的工具集一致，且每行都有 panelOpen', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  const rows = readme.split('\n').flatMap((line) => {
    const match = /^\|\s*`(sensei_[a-z]+)`\s*\|([^|]*)\|([^|]*)\|$/.exec(line)
    return match === null ? [] : [{ name: match[1], result: match[3] ?? '' }]
  })

  assert.deepEqual(rows.map((row) => row.name), [
    'sensei_deck',
    'sensei_slide',
    'sensei_show',
    'sensei_draw',
    'sensei_read',
    'sensei_export',
  ])
  for (const row of rows) {
    assert.match(row.result, /`panelOpen`/, `${row.name} 的结果列必须列出 panelOpen`)
  }
})
