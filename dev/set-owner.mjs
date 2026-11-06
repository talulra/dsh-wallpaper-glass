#!/usr/bin/env node
/**
 * Fill in the GitHub owner everywhere it is still a placeholder.
 *
 *   node dev/set-owner.mjs <github-owner>
 *
 * Rewrites package.json's repository/homepage/bugs and the submission entry,
 * so one command turns this working copy into a publishable repository.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const owner = (process.argv[2] || '').trim()
if (!/^[A-Za-z0-9-]+$/.test(owner)) {
  console.error('usage: node dev/set-owner.mjs <github-owner>')
  process.exit(1)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = ['package.json', 'submission/awesome-dsh-plugin.yml', 'submission/PR.md']

for (const relative of files) {
  const file = path.join(root, relative)
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch {
    continue
  }
  const next = text.replaceAll('OWNER', owner)
  if (next !== text) {
    await writeFile(file, next, 'utf8')
    console.log(`updated ${relative}`)
  }
}

console.log(`owner set to ${owner}`)
