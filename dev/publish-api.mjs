#!/usr/bin/env node
/**
 * Publish through the GitHub REST API only — for environments where the
 * `git` binary cannot reach the network (sandboxed shells, blocked TLS).
 *
 *   GITHUB_TOKEN=ghp_xxx node dev/publish-api.mjs
 *
 * Same outcome as dev/publish.mjs: the working tree becomes the repository's
 * first commit, the list is forked, the entry file is committed and the pull
 * request is opened. No git binary, no credentials on disk.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TOKEN = process.env.GITHUB_TOKEN || ''
const REPO = 'dsh-wallpaper-glass'
const UPSTREAM = 'awesome-dsh-plugin/awesome-dsh-plugin'
const API = 'https://api.github.com'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKIP = new Set(['node_modules', '.git'])

if (!TOKEN) {
  console.error('GITHUB_TOKEN is required')
  process.exit(1)
}

async function api(method, endpoint, body, note) {
  const response = await fetch(`${API}${endpoint}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-wallpaper-glass-publisher',
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!response.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data)
    throw new Error(`${note || endpoint} failed: ${response.status} ${detail}`)
  }
  return data
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Every publishable file, as repo-relative paths. */
async function walk(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (SKIP.has(entry.name) || entry.name.endsWith('.tgz')) continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(abs, rel)))
    else if (entry.isFile()) files.push(rel)
  }
  return files
}

const user = await api('GET', '/user', undefined, 'GET /user')
const owner = user.login
console.log(`account: ${owner}`)

const repo = await api('GET', `/repos/${owner}/${REPO}`, undefined, 'read repository')
console.log(`repository: ${repo.full_name} (default ${repo.default_branch})`)

// The Git Data API refuses to create blobs while the repository has no
// commit at all, so seed one file through the Contents API first.
try {
  await api('GET', `/repos/${owner}/${REPO}/contents/README.md`, undefined, 'read seed')
} catch {
  await api(
    'PUT',
    `/repos/${owner}/${REPO}/contents/README.md`,
    { message: 'Initialize repository', content: Buffer.from('# dsh-wallpaper-glass\n').toString('base64') },
    'seed README',
  )
  console.log('seeded the first commit')
}

const files = await walk(root)
const tree = []
for (const relative of files) {
  const content = await readFile(path.join(root, relative))
  const blob = await api(
    'POST',
    `/repos/${owner}/${REPO}/git/blobs`,
    { content: content.toString('base64'), encoding: 'base64' },
    `blob ${relative}`,
  )
  tree.push({ path: relative, mode: '100644', type: 'blob', sha: blob.sha })
}
console.log(`uploaded ${tree.length} blobs`)

const newTree = await api('POST', `/repos/${owner}/${REPO}/git/trees`, { tree }, 'create tree')

let parents = []
try {
  const head = await api('GET', `/repos/${owner}/${REPO}/git/ref/heads/${repo.default_branch}`, undefined, 'read head')
  parents = [head.object.sha]
} catch {
  /* empty repository */
}

const commit = await api(
  'POST',
  `/repos/${owner}/${REPO}/git/commits`,
  { message: 'dsh-wallpaper-glass 0.5.4: wallpaper behind a translucent DSH window', tree: newTree.sha, parents },
  'create commit',
)

if (parents.length === 0) {
  await api('POST', `/repos/${owner}/${REPO}/git/refs`, { ref: `refs/heads/${repo.default_branch}`, sha: commit.sha }, 'create ref')
} else {
  await api('PATCH', `/repos/${owner}/${REPO}/git/refs/heads/${repo.default_branch}`, { sha: commit.sha, force: true }, 'update ref')
}
console.log(`pushed ${owner}/${REPO}@${repo.default_branch} -> ${commit.sha.slice(0, 7)}`)

// Fork the list and add the entry.
await api('POST', `/repos/${UPSTREAM}/forks`, { default_branch_only: true }, 'fork list').catch((error) => {
  if (!String(error.message).includes('422')) throw error
})
for (let attempt = 0; attempt < 20; attempt += 1) {
  try {
    await api('GET', `/repos/${owner}/awesome-dsh-plugin`, undefined, 'read fork')
    break
  } catch {
    await sleep(1500)
  }
}

const entryPath = `data/plugins/${owner}__${REPO}.yml`
const entry = await readFile(path.join(root, 'submission/awesome-dsh-plugin.yml'), 'utf8')
const branch = `add/${owner}__${REPO}`

let branchExists = true
try {
  await api('GET', `/repos/${owner}/awesome-dsh-plugin/git/ref/heads/${branch}`, undefined, 'read branch')
} catch {
  branchExists = false
}
if (!branchExists) {
  const base = await api('GET', `/repos/${owner}/awesome-dsh-plugin/git/ref/heads/main`, undefined, 'read base')
  await api('POST', `/repos/${owner}/awesome-dsh-plugin/git/refs`, { ref: `refs/heads/${branch}`, sha: base.object.sha }, 'create branch')
}

let existingSha = null
try {
  const current = await api('GET', `/repos/${owner}/awesome-dsh-plugin/contents/${entryPath}?ref=${branch}`, undefined, 'read entry')
  existingSha = current.sha
} catch {
  /* new file */
}

await api(
  'PUT',
  `/repos/${owner}/awesome-dsh-plugin/contents/${entryPath}`,
  {
    message: `Add ${owner}/${REPO}`,
    content: Buffer.from(entry, 'utf8').toString('base64'),
    branch,
    ...(existingSha ? { sha: existingSha } : {}),
  },
  'commit entry',
)
console.log(`committed ${entryPath}`)

const body = await readFile(path.join(root, 'submission/PR.md'), 'utf8')
try {
  const pull = await api('POST', `/repos/${UPSTREAM}/pulls`, {
    title: `Add ${owner}/${REPO} (Themes & Appearance)`,
    head: `${owner}:${branch}`,
    base: 'main',
    body,
  })
  console.log(`PR opened: ${pull.html_url}`)
} catch (error) {
  if (String(error.message).includes('422')) console.log('a pull request for this branch already exists')
  else throw error
}
