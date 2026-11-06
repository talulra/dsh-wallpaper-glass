#!/usr/bin/env node
/**
 * Publish this plugin to GitHub and open the market listing PR.
 *
 *   GITHUB_TOKEN=ghp_xxx node dev/publish.mjs
 *
 * What it does, in order:
 *   1. resolves the account behind the token (`GET /user`);
 *   2. replaces the OWNER placeholder in package.json and the submission entry;
 *   3. creates the public repository when it does not exist yet;
 *   4. sets the `dsh-plugin` topic the listing expects;
 *   5. pushes `main` with the token in a one-shot git header (never in .git/config);
 *   6. forks awesome-dsh-plugin, adds data/plugins/<owner>__<repo>.yml;
 *   7. opens the pull request.
 *
 * The token needs: Administration (create repo), Contents (push),
 * Pull requests (open the PR). Nothing is written to disk except the files
 * this repository already tracks.
 */
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TOKEN = process.env.GITHUB_TOKEN || ''
const REPO = 'dsh-wallpaper-glass'
const UPSTREAM = 'awesome-dsh-plugin/awesome-dsh-plugin'
const API = 'https://api.github.com'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

if (!TOKEN) {
  console.error('GITHUB_TOKEN is required (scopes: repo, or fine-grained: Administration + Contents + Pull requests)')
  process.exit(1)
}

function git(args, extraHeader) {
  const options = { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  if (extraHeader) options.env = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  const command = extraHeader
    ? ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${TOKEN}`).toString('base64')}`, ...args]
    : args
  return execFileSync('git', command, options).trim()
}

async function api(method, endpoint, body) {
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
  return { ok: response.ok, status: response.status, data }
}

async function requireOk(method, endpoint, body, note) {
  const result = await api(method, endpoint, body)
  if (!result.ok && result.status !== 404) {
    throw new Error(`${note || endpoint} failed: ${result.status} ${typeof result.data === 'string' ? result.data : JSON.stringify(result.data)}`)
  }
  return result
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 1. Who owns the token?
const who = await requireOk('GET', '/user', undefined, 'GET /user')
const owner = who.data.login
console.log(`account: ${owner}`)

// 2. Fill in the placeholder owner.
for (const relative of ['package.json', 'submission/awesome-dsh-plugin.yml', 'submission/PR.md']) {
  const file = path.join(root, relative)
  const text = await readFile(file, 'utf8')
  const next = text.replaceAll('OWNER', owner)
  if (next !== text) {
    await writeFile(file, next, 'utf8')
    console.log(`updated ${relative}`)
  }
}

// 3. Create the repository when it is missing.
const existing = await api('GET', `/repos/${owner}/${REPO}`)
if (existing.status === 404) {
  await requireOk(
    'POST',
    '/user/repos',
    {
      name: REPO,
      description: 'Local desktop wallpaper behind a translucent DeepSeek Harness window',
      homepage: `https://github.com/${owner}/${REPO}`,
      private: false,
      has_issues: true,
    },
    'create repository',
  )
  console.log(`created ${owner}/${REPO}`)
  await sleep(1500)
} else if (!existing.ok) {
  throw new Error(`GET repo failed: ${existing.status}`)
} else {
  console.log(`repository already exists: ${owner}/${REPO}`)
}

// 4. Topics the listing asks for.
await requireOk(
  'PUT',
  `/repos/${owner}/${REPO}/topics`,
  { names: ['dsh', 'dsh-plugin', 'deepseek-harness', 'wallpaper', 'theme', 'glassmorphism'] },
  'set topics',
)

// 5. Push main.
git(['remote', 'remove', 'origin'], undefined)
git(['remote', 'add', 'origin', `https://github.com/${owner}/${REPO}.git`])
git(['add', '-A'], undefined)
try {
  git(['-c', 'core.autocrlf=false', 'commit', '-q', '-m', 'publish: set repository owner'], undefined)
} catch {
  /* nothing new to commit */
}
git(['push', '-u', 'origin', 'main', '--force'], true)
console.log(`pushed ${owner}/${REPO}#main`)

// 6. Fork the list and add the entry file.
const fork = await api('POST', `/repos/${UPSTREAM}/forks`, { default_branch_only: true })
if (!fork.ok && fork.status !== 422) throw new Error(`fork failed: ${fork.status}`)
for (let attempt = 0; attempt < 20; attempt += 1) {
  const check = await api('GET', `/repos/${owner}/awesome-dsh-plugin`)
  if (check.ok) break
  await sleep(1500)
}

const entryPath = `data/plugins/${owner}__${REPO}.yml`
const entry = await readFile(path.join(root, 'submission/awesome-dsh-plugin.yml'), 'utf8')
const branch = `add/${owner}__${REPO}`
const base = await api('GET', `/repos/${owner}/awesome-dsh-plugin/git/ref/heads/main`)
if (!base.ok) throw new Error(`cannot read the fork's main branch: ${base.status}`)
const headSha = base.data.object.sha
const branchRef = await api('GET', `/repos/${owner}/awesome-dsh-plugin/git/ref/heads/${branch}`)
if (branchRef.status === 404) {
  await requireOk(
    'POST',
    `/repos/${owner}/awesome-dsh-plugin/git/refs`,
    { ref: `refs/heads/${branch}`, sha: headSha },
    'create branch',
  )
}

const current = await api('GET', `/repos/${owner}/awesome-dsh-plugin/contents/${entryPath}?ref=${branch}`)
await requireOk(
  'PUT',
  `/repos/${owner}/awesome-dsh-plugin/contents/${entryPath}`,
  {
    message: `Add ${owner}/${REPO}`,
    content: Buffer.from(entry, 'utf8').toString('base64'),
    branch,
    ...(current.ok ? { sha: current.data.sha } : {}),
  },
  'commit entry',
)
console.log(`committed ${entryPath}`)

// 7. Open the pull request.
const body = await readFile(path.join(root, 'submission/PR.md'), 'utf8')
const pull = await api('POST', `/repos/${UPSTREAM}/pulls`, {
  title: `Add ${owner}/${REPO} (Themes & Appearance)`,
  head: `${owner}:${branch}`,
  base: 'main',
  body,
})
if (pull.ok) {
  console.log(`PR opened: ${pull.data.html_url}`)
} else if (pull.status === 422) {
  console.log('a pull request for this branch already exists — nothing else to do')
} else {
  throw new Error(`open PR failed: ${pull.status} ${JSON.stringify(pull.data)}`)
}
