import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const mainPath = join(root, packageJson.main)
const typesPath = join(root, packageJson.types)
const lockPath = join(root, 'package-lock.json')

function assert(condition, message) {
  if (!condition) throw new Error(`release check failed: ${message}`)
}

assert(packageJson.private === true, 'package.json must remain private:true')
assert(existsSync(mainPath), `package main is missing: ${packageJson.main}`)
assert(existsSync(typesPath), `package types are missing: ${packageJson.types}`)
const lock = await readFile(lockPath, 'utf8')
assert(!lock.includes('dsh-type-meta'), 'package-lock.json contains dsh-type-meta')

async function jsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await jsFiles(path))
    else if (entry.isFile() && path.endsWith('.js')) files.push(path)
  }
  return files
}

const rootRuntimeFiles = await jsFiles(join(root, 'lib'))
assert(rootRuntimeFiles.length > 0, 'no root lib runtime files found')
const packageEntries = (await readdir(join(root, 'packages'), { withFileTypes: true }))
  .filter(entry => entry.isDirectory() && entry.name.startsWith('dsh-tool-'))
  .map(entry => entry.name)
  .sort()
assert(packageEntries.length === 10, `expected 10 vendored tool packages, found ${packageEntries.length}`)
const packageRuntimeFiles = []
for (const name of packageEntries) {
  const entry = join(root, 'packages', name, 'lib', 'index.js')
  assert(existsSync(entry), `package runtime entry is missing: packages/${name}/lib/index.js`)
  packageRuntimeFiles.push(...await jsFiles(join(root, 'packages', name, 'lib')))
}
for (const path of [...rootRuntimeFiles, ...packageRuntimeFiles]) {
  const source = await readFile(path, 'utf8')
  assert(!/(?:from|import\s*\()\s*["'][^"']*\.ts["']/.test(source), `${path} has a .ts runtime import`)
}

const runtime = await import(pathToFileURL(mainPath).href)
assert(runtime.name === packageJson.name, `runtime package name is ${runtime.name ?? '<missing>'}`)
assert(typeof runtime.apply === 'function', 'runtime apply export is missing')
const registered = []
const ctx = {
  tools: {
    register(def) {
      registered.push(def.name)
      return () => {}
    },
  },
}
await runtime.apply(ctx)
assert(
  JSON.stringify(registered) === JSON.stringify([
    'time', 'encoding', 'json', 'calculator', 'csv',
    'regex', 'markdown', 'diff', 'stat', 'schema',
  ]),
  `root runtime registered unexpected tools: ${registered.join(', ')}`,
)

console.log(`ok: ${packageJson.name} main/types exist, lockfile is clean, all package runtimes are clean, and apply registered 10 tools`)
