import http from 'node:http'
import { once } from 'node:events'
import { apply } from '../lib/index.js'

const routes = new Map()
const webServer = {
  register(route) {
    routes.set(route.path, route)
    return () => routes.delete(route.path)
  },
}
const scope = {
  webServer,
  connection: { requestRejection: () => undefined },
  effect(fn) {
    fn()
  },
}
const ctx = { inject: (deps, cb) => cb(scope) }

apply(ctx, { intensity: 'strong', blur: 12, pollMs: 2500 })

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x')
  const route = routes.get(pathname)
  if (!route) {
    res.writeHead(404)
    res.end('nope')
    return
  }
  Promise.resolve(route.handler(req, res)).catch((error) => {
    res.writeHead(500)
    res.end(String(error))
  })
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}`

const meta = await (await fetch(`${base}/dsh-wallpaper/meta`)).json()
console.log('meta:', meta)

const image = await fetch(`${base}/dsh-wallpaper/image?rev=${encodeURIComponent(meta.rev)}`)
console.log('image:', image.status, image.headers.get('content-type'), image.headers.get('content-length'))
const bytes = Buffer.from(await image.arrayBuffer())
console.log('image bytes:', bytes.length, 'jpeg?', bytes[0] === 0xff && bytes[1] === 0xd8)

const ping = await fetch(`${base}/dsh-wallpaper/ping`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ rev: meta.rev, href: 'http://127.0.0.1/', ua: 'route-test' }),
})
console.log('ping:', ping.status, await ping.json())

server.close()
