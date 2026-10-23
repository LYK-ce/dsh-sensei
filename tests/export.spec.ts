import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { exportTarget, writePptx } from '../host/export.ts'

/** 一段形态合法的 base64（PNG 前 8 字节）；pptxgenjs 只把它嵌进 zip，不解码像素。 */
const PNG_BASE64 = 'iVBORw0KGgo='

/**
 * 在临时目录里跑一个测试体。
 * @param run - 收到临时目录路径的测试体。
 * @returns 测试体跑完后清理磁盘。
 */
async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sensei-export-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * 读 zip 的中央目录，列出全部条目名。
 * @param bytes - zip 文件字节。
 * @returns 条目名，按中央目录顺序。
 */
function zipEntries(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  // EOCD 只可能出现在最后 22 + 65535 字节里；从尾部往前找签名最省事。
  for (let at = bytes.byteLength - 22; at >= Math.max(0, bytes.byteLength - 65_557); at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      eocd = at
      break
    }
  }
  if (eocd < 0) throw new Error('the pptx has no zip end-of-central-directory record')

  const total = view.getUint16(eocd + 10, true)
  let at = view.getUint32(eocd + 16, true)
  const names: string[] = []
  for (let index = 0; index < total; index++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('the pptx has a malformed central directory')
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    names.push(new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)))
    at += 46 + nameLength + extraLength + commentLength
  }
  return names
}

test('exportTarget：dir 为绝对路径时原样使用，name 补 .pptx', async () => {
  await withTempDir(async (dir) => {
    assert.equal(exportTarget({ dir, name: 'deck', baseDir: dir }), join(dir, 'deck.pptx'))
    assert.equal(exportTarget({ dir, name: 'deck.pptx', baseDir: dir }), join(dir, 'deck.pptx'))
    assert.equal(exportTarget({ dir, name: 'DECK.PPTX', baseDir: dir }), join(dir, 'DECK.PPTX'))
  })
})

test('exportTarget：相对 dir 按 baseDir 解析，省略 dir 即 baseDir', async () => {
  await withTempDir(async (dir) => {
    assert.equal(exportTarget({ dir: 'out', name: 'slides', baseDir: dir }), resolve(dir, 'out', 'slides.pptx'))
    assert.equal(exportTarget({ baseDir: dir }), join(dir, 'sensei-deck.pptx'))
    assert.equal(exportTarget({ dir: '', name: 'x', baseDir: dir }), join(dir, 'x.pptx'), '空 dir 视为 baseDir')
  })
})

test('exportTarget：非法文件名一律拒绝，不把路径注入落到 dir 之外', async () => {
  await withTempDir(async (dir) => {
    for (const name of ['../evil', 'sub/deck', 'sub\\deck', '', '   ', '.', '..', 'a:b', 'a?b', 'a*b']) {
      assert.throws(() => exportTarget({ dir, name, baseDir: dir }), /is not a valid file name/, name)
    }
  })
})

test('exportTarget：已存在且没有 overwrite 时抛错，给了 overwrite 才放行', async () => {
  await withTempDir(async (dir) => {
    const target = exportTarget({ dir, name: 'taken', baseDir: dir })
    await writeFile(target, 'x')
    assert.throws(() => exportTarget({ dir, name: 'taken', baseDir: dir }), /already exists; pass overwrite: true/)
    assert.equal(exportTarget({ dir, name: 'taken', overwrite: true, baseDir: dir }), target)
  })
})

test('writePptx：生成 PK 开头的文件，页数等于 deck 页数，目录不存在时自己建', async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, 'nested', 'deeper', 'deck.pptx')
    const result = await writePptx({
      target,
      pages: [
        { index: 0, png: PNG_BASE64 },
        { index: 1, png: PNG_BASE64 },
        { index: 2, png: PNG_BASE64 },
      ],
      slideCount: 3,
    })

    const bytes = new Uint8Array(await readFile(target))
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 2)), 'PK')
    assert.ok(result.bytes > 0)
    assert.equal(result.bytes, bytes.byteLength)
    assert.equal(result.path, target)
    assert.deepEqual(result.blank, [])

    const slides = zipEntries(bytes).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    assert.equal(slides.length, 3)
  })
})

test('writePptx：缺页补空白页，并在结果里报 1-based 页码', async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, 'partial.pptx')
    const result = await writePptx({
      target,
      pages: [
        { index: 0, png: PNG_BASE64 },
        { index: 2, png: PNG_BASE64 },
      ],
      slideCount: 3,
    })

    assert.deepEqual(result.blank, [2])
    const slides = zipEntries(new Uint8Array(await readFile(target)))
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    assert.equal(slides.length, 3)
  })
})

test('writePptx：一页都没交回时整份仍是合法 pptx，全部页码进 blank', async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, 'empty.pptx')
    const result = await writePptx({ target, pages: [], slideCount: 2 })

    assert.deepEqual(result.blank, [1, 2])
    const bytes = new Uint8Array(await readFile(target))
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 2)), 'PK')
    const slides = zipEntries(bytes).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    assert.equal(slides.length, 2)
  })
})
