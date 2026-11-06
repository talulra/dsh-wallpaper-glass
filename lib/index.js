/**
 * dsh-wallpaper-glass — Host half.
 *
 * Finds the wallpaper the operating system is currently showing, keeps no
 * background timers, and answers three read-only, session-guarded routes for
 * the browser half:
 *
 *   GET  /dsh-wallpaper/meta     current revision + plugin settings (JSON)
 *   GET  /dsh-wallpaper/image    the wallpaper bytes (rev-addressed, ETag)
 *   POST /dsh-wallpaper/ping     "the browser plugin really mounted" beacon
 *
 * Nothing here paints anything: the browser half owns the visual layer. The
 * host only resolves a stable file and reports when its bytes change, which is
 * what makes the background follow a wallpaper switch (or a slideshow tick)
 * without a restart.
 */
import { execFile } from 'node:child_process'
import { readFile, readdir, stat, writeFile, appendFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const NS = 'dsh-wallpaper-glass'
const VERSION = '0.5.4'
const ROUTE = '/dsh-wallpaper'

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const LOG_FILE = path.join(DSH_HOME, '.dsh-wallpaper-glass.log')
const STATE_FILE = path.join(DSH_HOME, '.dsh-wallpaper-glass.json')

const DEFAULTS = Object.freeze({
  enabled: true,
  intensity: 'medium',
  blur: 0,
  pollMs: 4000,
  imagePath: '',
  align: true,
  controls: true,
})

const INTENSITIES = new Set(['subtle', 'medium', 'strong'])

/** Append one diagnostic line; never throws and never rotates mid-request. */
async function log(line) {
  try {
    await appendFile(LOG_FILE, `${new Date().toISOString()} ${line}\n`, 'utf8')
  } catch {
    /* logging is best-effort */
  }
}

/** Coerce the loader-supplied config into the shape the routes assume. */
function normalizeConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const intensity = INTENSITIES.has(input.intensity) ? input.intensity : DEFAULTS.intensity
  const blur = Number.isFinite(input.blur) ? Math.min(40, Math.max(0, Math.round(input.blur))) : DEFAULTS.blur
  const pollMs = Number.isFinite(input.pollMs)
    ? Math.min(60000, Math.max(1500, Math.round(input.pollMs)))
    : DEFAULTS.pollMs
  return {
    enabled: input.enabled !== false,
    intensity,
    blur,
    pollMs,
    imagePath: typeof input.imagePath === 'string' ? input.imagePath.trim() : '',
    align: input.align !== false,
    controls: input.controls !== false,
  }
}

/** Expand %VAR% / ~ forms a user may have written in config. */
function expandUserPath(value) {
  let out = String(value || '').trim()
  if (out.startsWith('~')) out = path.join(os.homedir(), out.slice(1))
  if (process.platform === 'win32') {
    out = out.replace(/%([^%]+)%/g, (match, name) => process.env[name] ?? match)
  }
  return out
}

function windowsThemesDir() {
  const appData = process.env.APPDATA
  if (appData) return path.join(appData, 'Microsoft', 'Windows', 'Themes')
  if (process.env.USERPROFILE) return path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Themes')
  return ''
}

/* ------------------------------------------------------------------ *
 * Desktop registry: HKCU\Control Panel\Desktop
 * `WallPaper` is the configured file; `WallpaperStyle` / `TileWallpaper`
 * describe how Windows composes it. Cached for a minute so a 4 s browser
 * poll never spawns PowerShell more than once a minute.
 * ------------------------------------------------------------------ */
let registryCache = { at: 0, value: null, pending: null }

const WALLPAPER_STYLES = {
  0: 'center',
  2: 'stretch',
  6: 'fit',
  10: 'fill',
  22: 'span',
}

function queryRegistryDesktop() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null)
    const script =
      "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
      "$d=Get-ItemProperty -LiteralPath 'HKCU:\\\\Control Panel\\\\Desktop' -ErrorAction SilentlyContinue; " +
      "@{w=[string]$d.WallPaper;s=[string]$d.WallpaperStyle;t=[string]$d.TileWallpaper}|ConvertTo-Json -Compress"
    try {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { windowsHide: true, timeout: 5000, encoding: 'utf8', maxBuffer: 1 << 20 },
        (error, stdout) => {
          if (error) return resolve(null)
          try {
            const raw = JSON.parse(String(stdout || '').trim() || '{}')
            resolve({
              wallpaper: typeof raw.w === 'string' ? raw.w : '',
              style: typeof raw.s === 'string' ? raw.s : '',
              tile: typeof raw.t === 'string' ? raw.t : '',
            })
          } catch {
            resolve(null)
          }
        },
      )
    } catch {
      // Some environments deny process spawn; the transcoded copy still works.
      resolve(null)
    }
  })
}

function registryDesktop() {
  if (Date.now() - registryCache.at < 60_000) return Promise.resolve(registryCache.value)
  if (registryCache.pending) return registryCache.pending
  const pending = queryRegistryDesktop().then((value) => {
    registryCache = { at: Date.now(), value, pending: null }
    return value
  })
  registryCache = { ...registryCache, pending }
  return pending
}

/** How the desktop composes the image: fill (default), fit, stretch, center, tile, span. */
function fitModeOf(info) {
  if (!info) return 'fill'
  if (info.tile === '1') return 'tile'
  return WALLPAPER_STYLES[info.style] || 'fill'
}

/** Newest image inside a directory, used for the CachedFiles fallback. */
async function newestImageIn(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const images = entries
      .filter((entry) => entry.isFile() && /\.(jpe?g|png|bmp|webp)$/i.test(entry.name))
      .map((entry) => path.join(dir, entry.name))
    let best = ''
    let bestTime = -1
    for (const file of images) {
      try {
        const info = await stat(file)
        if (info.size > 1024 && info.mtimeMs > bestTime) {
          best = file
          bestTime = info.mtimeMs
        }
      } catch {
        /* a stale entry can disappear between readdir and stat */
      }
    }
    return best
  } catch {
    return ''
  }
}

/**
 * Resolve the wallpaper currently on screen. Order matters: the transcoded
 * copy is what Windows actually paints (and it is re-encoded on every
 * slideshow tick), the registry value is the configured file, and the cached
 * copies cover machines where the transcoded file was cleaned.
 */
async function resolveSource(config) {
  const candidates = []
  if (config.imagePath) candidates.push({ kind: 'custom', file: expandUserPath(config.imagePath) })

  if (process.platform === 'win32') {
    const themes = windowsThemesDir()
    if (themes) {
      candidates.push({ kind: 'transcoded', file: path.join(themes, 'TranscodedWallpaper') })
    }
    const desktop = await registryDesktop()
    if (desktop && desktop.wallpaper) candidates.push({ kind: 'registry', file: expandUserPath(desktop.wallpaper) })
    if (themes) {
      const cached = await newestImageIn(path.join(themes, 'CachedFiles'))
      if (cached) candidates.push({ kind: 'cached', file: cached })
    }
  } else if (process.platform === 'darwin') {
    candidates.push({ kind: 'macos', file: await macosWallpaperPath() })
  } else {
    candidates.push({ kind: 'linux', file: await linuxWallpaperPath() })
  }

  for (const candidate of candidates) {
    if (!candidate.file) continue
    try {
      const info = await stat(candidate.file)
      if (!info.isFile() || info.size <= 1024) continue
      return {
        kind: candidate.kind,
        file: candidate.file,
        size: info.size,
        mtimeMs: info.mtimeMs,
      }
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

/** macOS exposes the desktop picture through System Events. */
function macosWallpaperPath() {
  return new Promise((resolve) => {
    try {
      execFile(
        'osascript',
        ['-e', 'tell application "System Events" to get picture of current desktop'],
        { timeout: 4000, encoding: 'utf8' },
        (error, stdout) => resolve(error ? '' : String(stdout || '').trim()),
      )
    } catch {
      resolve('')
    }
  })
}

/** GNOME keeps the picture in a gsettings key. */
function linuxWallpaperPath() {
  return new Promise((resolve) => {
    try {
      execFile(
        'gsettings',
        ['get', 'org.gnome.desktop.background', 'picture-uri'],
        { timeout: 4000, encoding: 'utf8' },
        (error, stdout) => {
          if (error) return resolve('')
          const raw = String(stdout || '').trim().replace(/^'|'$/g, '')
          resolve(raw.startsWith('file://') ? decodeURIComponent(raw.slice('file://'.length)) : raw)
        },
      )
    } catch {
      resolve('')
    }
  })
}

/**
 * Windows rewrites TranscodedWallpaper in place when it re-encodes a slideshow
 * frame, so a read can lose the race with a truncate/rewrite. Retry briefly
 * before giving up: a transient lock must not blank the background.
 */
async function readWithRetry(file) {
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const bytes = await readFile(file)
      if (bytes.length > 0) return bytes
      lastError = new Error('wallpaper file is empty')
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  throw lastError
}

/** Detect the container from magic bytes: the transcoded copy has no extension. */
function sniffMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp'
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  if (bytes.length >= 6 && bytes.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif'
  return 'application/octet-stream'
}

export const name = NS

/**
 * Mount the routes. `webServer` and `connection` arrive through `ctx.inject`,
 * so a headless composition that has no HTTP server simply never activates
 * this half instead of failing the profile.
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  if (!config.enabled) return

  ctx.inject(['webServer', 'connection'], (scope) => {
    const web = scope.webServer
    const connection = scope.connection

    let lastClientSeenAt = 0
    let lastPingFileWrite = 0
    let cache = { key: '', mime: 'image/jpeg', bytes: null }

    /** Same admission test the other session-scoped routes use. */
    function admitted(request, response) {
      let rejection
      try {
        rejection = connection && typeof connection.requestRejection === 'function'
          ? connection.requestRejection(request)
          : 403
      } catch {
        rejection = 403
      }
      if (rejection === undefined) return true
      response.writeHead(rejection, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      })
      response.end(rejection === 401 ? 'unauthorized' : 'forbidden')
      return false
    }

    function sendJson(response, status, payload) {
      const body = Buffer.from(JSON.stringify(payload), 'utf8')
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(body.length),
        'Cache-Control': 'no-store',
      })
      response.end(body)
    }

    async function metaPayload() {
      const source = await resolveSource(config)
      const rev = source ? `${Math.round(source.mtimeMs)}-${source.size}` : ''
      const desktop = process.platform === 'win32' ? await registryDesktop() : null
      return {
        ok: Boolean(source),
        enabled: config.enabled,
        rev,
        kind: source ? source.kind : '',
        name: source ? path.basename(source.file) : '',
        bytes: source ? source.size : 0,
        updatedAt: source ? Math.round(source.mtimeMs) : 0,
        intensity: config.intensity,
        blur: config.blur,
        pollMs: config.pollMs,
        align: config.align,
        controls: config.controls,
        fit: fitModeOf(desktop),
        route: ROUTE,
        version: VERSION,
        clientSeenAt: lastClientSeenAt,
      }
    }

    /** Read the current wallpaper bytes, memoized by file + revision. */
    async function imagePayload(revHint) {
      const source = await resolveSource(config)
      if (!source) return null
      const key = `${source.file}|${source.size}|${Math.round(source.mtimeMs)}`
      if (cache.key === key && cache.bytes) {
        return { ...cache, rev: revHint || key }
      }
      const bytes = await readWithRetry(source.file)
      const mime = sniffMime(bytes)
      if (mime === 'application/octet-stream') {
        await log(`unsupported wallpaper container: ${source.file}`)
        return null
      }
      cache = { key, mime, bytes }
      return { ...cache, rev: key }
    }

    async function onMeta(request, response) {
      if (!admitted(request, response)) return
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' })
        response.end()
        return
      }
      try {
        sendJson(response, 200, await metaPayload())
      } catch (error) {
        await log(`meta failed: ${error && error.message}`)
        sendJson(response, 500, { ok: false, error: String(error && error.message) })
      }
    }

    async function onImage(request, response) {
      if (!admitted(request, response)) return
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' })
        response.end()
        return
      }
      try {
        const url = new URL(request.url || '/', 'http://dsh.invalid')
        const hint = url.searchParams.get('rev') || ''
        const image = await imagePayload(hint)
        if (!image) {
          response.writeHead(404, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' })
          response.end('no wallpaper available')
          return
        }
        const etag = `"${image.key.replace(/[^a-zA-Z0-9]/g, '')}"`
        if (request.headers['if-none-match'] === etag) {
          response.writeHead(304, { ETag: etag, 'Cache-Control': 'private, no-cache' })
          response.end()
          return
        }
        response.writeHead(200, {
          'Content-Type': image.mime,
          'Content-Length': String(image.bytes.length),
          'Cache-Control': 'private, no-cache',
          ETag: etag,
          'X-Content-Type-Options': 'nosniff',
        })
        if (request.method === 'HEAD') response.end()
        else response.end(image.bytes)
        log(`image served ${image.mime} ${image.bytes.length}B`).catch(() => {})
      } catch (error) {
        await log(`image failed: ${error && error.message}`)
        response.writeHead(500, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('wallpaper read failed')
      }
    }

    async function onPing(request, response) {
      if (!admitted(request, response)) return
      if (request.method !== 'POST') {
        response.writeHead(405, { Allow: 'POST' })
        response.end()
        return
      }
      const chunks = []
      let size = 0
      try {
        await new Promise((resolve) => {
          request.on('data', (chunk) => {
            size += chunk.length
            if (size <= 8192) chunks.push(chunk)
          })
          request.on('end', resolve)
          request.on('error', resolve)
        })
      } catch {
        /* a dropped body is not a failure for a beacon */
      }
      lastClientSeenAt = Date.now()
      let payload = {}
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      } catch {
        payload = {}
      }
      sendJson(response, 200, { ok: true, at: lastClientSeenAt })
      // The state file is the out-of-band proof that the browser half mounted;
      // it is rewritten at most once every 30 seconds.
      if (Date.now() - lastPingFileWrite > 30_000) {
        lastPingFileWrite = Date.now()
        try {
          await writeFile(
            STATE_FILE,
            JSON.stringify(
              {
                clientSeenAt: lastClientSeenAt,
                href: typeof payload.href === 'string' ? payload.href : '',
                rev: typeof payload.rev === 'string' ? payload.rev : '',
                ua: typeof payload.ua === 'string' ? payload.ua.slice(0, 200) : '',
                intensity: config.intensity,
                diag: payload && typeof payload.diag === 'object' ? payload.diag : null,
                version: VERSION,
              },
              null,
              2,
            ),
            'utf8',
          )
        } catch {
          /* diagnostics only */
        }
      }
    }

    scope.effect(
      () =>
        web.register({
          kind: 'exact',
          path: `${ROUTE}/meta`,
          handler: onMeta,
        }),
      `${NS}: meta route`,
    )
    scope.effect(
      () =>
        web.register({
          kind: 'exact',
          path: `${ROUTE}/image`,
          handler: onImage,
        }),
      `${NS}: image route`,
    )
    scope.effect(
      () =>
        web.register({
          kind: 'exact',
          path: `${ROUTE}/ping`,
          handler: onPing,
        }),
      `${NS}: ping route`,
    )

    log(`${VERSION} mounted: routes ${ROUTE}/meta, ${ROUTE}/image, ${ROUTE}/ping`).catch(() => {})
  })
}

/** Internals exposed for the offline self-test only; not part of the plugin API. */
export const __test = { normalizeConfig, resolveSource, sniffMime, expandUserPath }
