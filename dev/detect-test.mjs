import { readFile } from 'node:fs/promises'
import { __test } from '../lib/index.js'

const cfg = __test.normalizeConfig({ intensity: 'bogus', blur: 'x', pollMs: 10, imagePath: '  %APPDATA%/x.jpg  ' })
console.log('normalized:', cfg)
console.log('expanded:', __test.expandUserPath(cfg.imagePath))

const source = await __test.resolveSource({ ...cfg, imagePath: '' })
console.log('source:', source)

if (source) {
  const bytes = await readFile(source.file)
  console.log('bytes:', bytes.length, 'mime:', __test.sniffMime(bytes))
}
