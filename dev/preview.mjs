/**
 * Offline harness for the browser half.
 *
 * Serves a stand-in for the DSH shell (same alias tokens, same boot protocol)
 * plus the real Host routes, so the client bundle can be rendered and
 * screenshotted without touching the running application.
 */
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply as applyHost } from '../lib/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientFile = path.join(here, '..', 'client', 'client.js')

const routes = new Map()
const webServer = {
  register(route) {
    routes.set(route.path, route)
    return () => routes.delete(route.path)
  },
}
const hostScope = {
  webServer,
  connection: { requestRejection: () => undefined },
  effect(fn) {
    fn()
  },
}
applyHost({ inject: (deps, cb) => cb(hostScope) }, {
  intensity: process.env.INTENSITY || 'medium',
  blur: 0,
  pollMs: 2000,
  imagePath: process.env.HARNESS_IMAGE || '',
  align: process.env.HARNESS_ALIGN !== '0',
})

const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>dsh-wallpaper-glass harness</title>
<style>
  :root{
    --dsw-alias-bg-base:#fff; --dsw-alias-bg-layer-1:#fff; --dsw-alias-bg-layer-2:#fff;
    --dsw-alias-bg-layer-3:#fff; --dsw-alias-bg-layer-4:#fff;
    --dsw-specific-sidebar-fill:#f9fafb; --dsw-specific-input-major:#fff;
    --dsw-specific-menu:#f8f9faf0; --dsw-specific-bubble:#edf3fe;
    --dsw-alias-label-primary:#0f1115; --dsw-alias-label-secondary:#61666b;
  }
  body[data-ds-dark-theme]{
    --dsw-alias-bg-base:#151517; --dsw-alias-bg-layer-1:#232324; --dsw-alias-bg-layer-2:#2c2c2e;
    --dsw-alias-bg-layer-3:#353638; --dsw-alias-bg-layer-4:#3c3c40;
    --dsw-specific-sidebar-fill:#1b1b1c; --dsw-specific-input-major:#2c2c2e;
    --dsw-specific-menu:#303136f0; --dsw-specific-bubble:#2c2c2e;
    --dsw-alias-label-primary:#ebeef2; --dsw-alias-label-secondary:#979da6;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%}
  body{font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:var(--dsw-alias-label-primary);
       background:var(--dsw-alias-bg-base)}
  .shell{display:flex;height:100vh}
  html[data-bare] .shell,html[data-bare] .menu,html[data-bare] #probe{display:none}
  html[data-noprobe] #probe{display:none}
  .side{width:248px;flex:none;background:var(--dsw-specific-sidebar-fill);padding:18px 14px;
        display:flex;flex-direction:column;gap:6px;border-right:1px solid rgba(0,0,0,.06)}
  .brand{font-weight:800;letter-spacing:.02em;font-size:18px;margin:8px 4px 18px}
  .brand span{font-size:10px;border:1px solid currentColor;border-radius:4px;padding:1px 4px;vertical-align:middle}
  .newchat{background:var(--dsw-alias-bg-layer-1);border:1px solid rgba(0,0,0,.08);border-radius:10px;
           padding:10px 12px;text-align:center;font-size:13px;margin-bottom:10px}
  .nav{padding:8px 10px;border-radius:8px;font-size:13px;color:var(--dsw-alias-label-primary)}
  .nav.sel{background:var(--dsw-alias-bg-layer-2)}
  .main{flex:1;padding:26px 30px;display:flex;flex-direction:column;gap:14px}
  .topbar{display:flex;align-items:baseline;gap:12px}
  .topbar h1{font-size:20px;margin:0}
  .meta{color:var(--dsw-alias-label-secondary);font-size:12px}
  .tabs{display:flex;gap:18px;font-size:13px;color:var(--dsw-alias-label-secondary);margin:2px 0 6px}
  .tabs b{color:#4176e6;border-bottom:2px solid #4176e6;padding-bottom:6px}
  .hero{background:var(--dsw-alias-bg-layer-1);border-radius:14px;padding:18px 20px}
  .hero h2{margin:0 0 6px;font-size:22px}
  .row{display:flex;gap:14px}
  .card{flex:1;background:var(--dsw-alias-bg-layer-1);border-radius:14px;padding:16px 18px;min-height:160px}
  .card h3{margin:0 0 10px;font-size:14px}
  .p{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
  .chip{display:inline-block;padding:4px 10px;border-radius:999px;font-size:12px;
        background:var(--dsw-alias-bg-layer-2);margin-right:6px}
  .bubble{background:var(--dsw-specific-bubble);border-radius:10px;padding:10px 12px;font-size:13px;max-width:520px}
  .menu{position:absolute;right:38px;top:150px;background:var(--dsw-specific-menu);border-radius:10px;
        padding:8px 0;box-shadow:0 8px 24px rgba(0,0,0,.16);font-size:13px;min-width:160px}
  .menu div{padding:7px 14px}
  #probe{position:fixed;left:12px;bottom:12px;z-index:99999;font:11px/1.5 ui-monospace,monospace;
         background:#0b0b0dcc;color:#e7e7ea;border-radius:8px;padding:8px 10px;max-width:540px;white-space:pre-wrap}
</style>
</head>
<body>
<div class="shell">
  <aside class="side">
    <div class="brand">deepseek <span>HARNESS</span></div>
    <div class="newchat">+ 新会话</div>
    <div class="nav">插件</div>
    <div class="nav">自动化任务</div>
    <div class="nav">上下文洞察</div>
    <div class="nav sel">Workbuddy 授权失败解决方法</div>
    <div class="nav">RSA private key shared</div>
  </aside>
  <main class="main">
    <div class="topbar"><h1>Workbuddy 授权失败解决方法</h1><div class="meta">标准化模式 ¥0.61</div></div>
    <div class="tabs"><b>对话</b><span>上下文</span><span>编队</span></div>
    <div class="hero"><h2>多 Agent 编队</h2><div class="p">在同一时间线上，观察 Agent 间的通讯、活跃泳道与委派工作。</div></div>
    <div class="row">
      <div class="card"><h3>Agent 网络</h3><div><span class="chip">1 个 Agent</span><span class="chip">1 个运行中</span></div>
        <div class="p">当前 Agent 与子 Agent 的实时上下文，点击节点高亮联动。</div>
        <div class="bubble">这张卡片检查气泡与二级表面的透明度是否一致。</div></div>
      <div class="card"><h3>跨 Agent 协作</h3><div class="p">0/0 条记录 · 1 条泳道</div></div>
    </div>
  </main>
</div>
<div class="menu"><div>重命名会话</div><div>导出对话</div><div>删除</div></div>
<div id="fixtures" hidden>
  <div role="dialog" aria-modal="true" style="position:fixed;left:50%;top:46%;transform:translate(-50%,-50%);width:340px;padding:20px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 20px 50px rgba(0,0,0,.3)">
    <b>对话框 / dialog</b>
    <div class="p" style="margin-top:8px">这个面板应保持原始不透明背景（role=dialog）。</div>
  </div>
  <div role="menu" style="position:fixed;left:60px;top:120px;width:190px;padding:8px;border-radius:10px;background:var(--dsw-specific-menu);box-shadow:0 12px 30px rgba(0,0,0,.2)">
    <div style="padding:6px 8px">重命名会话</div>
    <div style="padding:6px 8px">导出对话</div>
  </div>
  <div style="position:fixed;right:20px;top:120px;width:300px;height:220px;border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-base)">
    <div style="height:28px;display:flex;align-items:center;padding:0 8px;border-bottom:1px solid rgba(0,0,0,.1)">浏览器 / browser</div>
    <iframe title="fixture" style="width:100%;height:calc(100% - 28px);border:0" srcdoc="<body style='margin:0;font:13px sans-serif;padding:12px;background:#eef4ff'>内嵌网页内容</body>"></iframe>
  </div>
  <div style="position:fixed;left:60px;bottom:150px;width:280px">
    <div style="display:flex;align-items:center;gap:6px;padding:9px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1,#e5e5e5)">
      <input placeholder="搜索插件…" style="border:0;background:transparent;outline:none;width:100%;color:var(--dsw-alias-label-primary)">
    </div>
    <div class="p" style="margin-top:6px;color:var(--dsw-alias-label-secondary)">次要文字 secondary / <span style="color:var(--dsw-alias-label-tertiary)">三级文字 tertiary</span></div>
  </div>
  <div style="position:fixed;left:60px;bottom:24px;width:520px;padding:12px 14px;border-radius:14px;background:var(--dsw-specific-input-major);box-shadow:0 8px 24px rgba(0,0,0,.12)">
    <div contenteditable="true" style="outline:none;min-height:44px;color:var(--dsw-alias-label-primary)">对话输入框 composer…</div>
  </div>
</div>
<div id="probe">boot…</div>
<script>
  // Deterministic geometry for the alignment test: headless screens are tiny,
  // so allow the caller to pretend to be a specific display at a position.
  (function () {
    var params = new URLSearchParams(location.search)
    if (params.get('bare') === '1') document.documentElement.setAttribute('data-bare', '')
    if (params.get('noprobe') === '1') document.documentElement.setAttribute('data-noprobe', '')
    if (params.get('overlays') === '1') {
      var fixtures = document.getElementById('fixtures')
      if (fixtures) fixtures.hidden = false
    }
    var match = /^(\\d+)x(\\d+)(?:,(-?\\d+),(-?\\d+))?$/.exec(params.get('screen') || '')
    if (!match) return
    try {
      Object.defineProperty(window, 'screenX', { get: function () { return Number(match[3] || 0) } })
      Object.defineProperty(window, 'screenY', { get: function () { return Number(match[4] || 0) } })
      Object.defineProperty(window.screen, 'width', { get: function () { return Number(match[1]) } })
      Object.defineProperty(window.screen, 'height', { get: function () { return Number(match[2]) } })
      if (params.get('dpr')) {
        Object.defineProperty(window, 'devicePixelRatio', { get: function () { return Number(params.get('dpr')) } })
      }
    } catch (error) {
      /* a browser that refuses the override keeps its real geometry */
    }
  })()
  window.__ModuleLoader__ = { load: function (registration) { window.__PLUGIN__ = registration } }
</script>
<script src="/client.js"></script>
<script>
  var params = new URLSearchParams(location.search)
  if (params.get('theme') === 'dark') document.body.setAttribute('data-ds-dark-theme', '')

  var probe = document.getElementById('probe')
  function report(text) { probe.textContent = text }

  window.addEventListener('error', function (e) { report('JS ERROR: ' + e.message) })

  var mod = window.__PLUGIN__.factory(function () { throw new Error('unexpected require') })
  var fakeCtx = {
    effect: function (fn) { window.__DISPOSE__ = fn() },
    theme: {
      overrideTokens: function (source, tokens) {
        var dark = document.body.hasAttribute('data-ds-dark-theme')
        Object.keys(tokens).forEach(function (name) {
          document.body.style.setProperty(name, tokens[name][dark ? 'dark' : 'light'])
        })
        window.__TOKENS__ = tokens
        return function () {}
      }
    }
  }
  try {
    mod.apply(fakeCtx)
    report('applied')
  } catch (error) {
    report('APPLY FAILED: ' + (error && error.stack || error))
  }

  setInterval(function () {
    var layer = document.getElementById('dshp-wallpaper')
    if (!layer) { report('layer missing'); return }
    var style = getComputedStyle(layer)
    report([
      'dshp=' + (document.documentElement.getAttribute('data-dshp') || '-'),
      'visible=' + layer.getAttribute('data-visible'),
      'bg=' + (style.backgroundImage || 'none').slice(0, 72),
      'opacity=' + style.opacity,
      'veil=' + (layer.style.getPropertyValue('--dshp-veil') || '-'),
      'base=' + getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base'),
      'bodyBg=' + getComputedStyle(document.body).backgroundColor,
      'layerRect=' + Math.round(layer.getBoundingClientRect().width) + 'x' + Math.round(layer.getBoundingClientRect().height)
    ].join('\\n'))
  }, 500)
</script>
</body>
</html>`

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  if (url.pathname === '/' || url.pathname === '/index.html') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(html)
    return
  }
  if (url.pathname === '/client.js') {
    const body = await readFile(clientFile)
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(body)
    return
  }
  const route = routes.get(url.pathname)
  if (route) {
    Promise.resolve(route.handler(request, response)).catch((error) => {
      response.writeHead(500)
      response.end(String(error))
    })
    return
  }
  response.writeHead(404)
  response.end('not found')
})

server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => {
  console.log(`harness: http://127.0.0.1:${server.address().port}/`)
})
