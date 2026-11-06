/*!
 * dsh-wallpaper-glass — browser half.
 *
 * Two things live here:
 *
 *  1. A wallpaper layer behind the whole app. By default it is ALIGNED with
 *     the desktop: the layer holds a plate the size of the screen, offset by
 *     the window's own screen position, so the window behaves like a hole cut
 *     into the desktop and the image continues seamlessly across its edges.
 *     It falls back to `cover` inside the window when the geometry cannot be
 *     trusted (secondary display, negative origin, no window metrics).
 *
 *  2. A small control pill for transparency, blur, alignment and visibility,
 *     persisted in localStorage so a reload keeps the user's choice.
 *
 * The image travels through `fetch` and a blob URL: the shell's dsh-app://
 * protocol layer only guarantees static assets, not plugin bytes.
 */
window.__ModuleLoader__.load({
  id: 'dsh-wallpaper-glass',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var NS = 'dsh-wallpaper-glass'
    var ROUTE = '/dsh-wallpaper'
    var LAYER_ID = 'dshp-wallpaper'
    var PLATE_ID = 'dshp-plate'
    var STYLE_ID = 'dshp-style'
    var CONTROLS_ID = 'dshp-controls'
    var PREFS_KEY = 'dsh-wallpaper-glass:prefs'
    var BUILD = '0.5.4'

    /** Per-intensity surface opacity ladder: base, layer-1..4. */
    var LADDER = {
      subtle: [0.84, 0.88, 0.91, 0.94, 0.96],
      medium: [0.52, 0.6, 0.68, 0.74, 0.8],
      strong: [0.26, 0.34, 0.44, 0.52, 0.58]
    }

    /** Color anchors taken from the design system's own palettes. */
    var LIGHT = {
      base: [255, 255, 255],
      l1: [255, 255, 255],
      l2: [255, 255, 255],
      l3: [255, 255, 255],
      l4: [255, 255, 255],
      sidebar: [249, 250, 251],
      input: [255, 255, 255],
      menu: [248, 249, 250],
      bubble: [237, 243, 254]
    }
    var DARK = {
      base: [21, 21, 23],
      l1: [35, 35, 36],
      l2: [44, 44, 46],
      l3: [53, 53, 56],
      l4: [60, 60, 64],
      sidebar: [27, 27, 28],
      input: [44, 44, 46],
      menu: [48, 49, 54],
      bubble: [44, 44, 46]
    }

    var STYLE = [
      'html,body,#root{background-color:transparent !important}',
      // Original palette for surfaces that must stay opaque: embedded browsers,
      // dialogs and menu panels read these instead of the translucent tokens.
      'body{--dshp-solid-base:#fff;--dshp-solid-layer-1:#fff;--dshp-solid-layer-2:#fff;',
      '--dshp-solid-layer-3:#fff;--dshp-solid-menu:#f8f9fa}',
      'body[data-ds-dark-theme]{--dshp-solid-base:#151517;--dshp-solid-layer-1:#232324;',
      '--dshp-solid-layer-2:#2c2c2e;--dshp-solid-layer-3:#353638;--dshp-solid-menu:#303136}',
      '[data-dshp-solid],[role="dialog"]:not([class*="backdrop"]),[role="alertdialog"]',
      '{--dsw-alias-bg-base:var(--dshp-solid-base);',
      '--dsw-alias-bg-layer-1:var(--dshp-solid-layer-1);--dsw-alias-bg-layer-2:var(--dshp-solid-layer-2);',
      '--dsw-alias-bg-layer-3:var(--dshp-solid-layer-3);--dsw-alias-bg-layer-4:var(--dshp-solid-layer-3);',
      '--dsw-specific-sidebar-fill:var(--dshp-solid-base)}',
      'iframe,webview{background-color:var(--dshp-solid-base)}',
      '#' + LAYER_ID + '{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;',
      'opacity:0;transition:opacity .8s ease}',
      '#' + LAYER_ID + '[data-visible="1"]{opacity:1}',
      '#' + LAYER_ID + '[data-blur="1"] #' + PLATE_ID + '{filter:blur(var(--dshp-blur,0px));transform:scale(1.06);transform-origin:center}',
      '#' + LAYER_ID + '::after{content:"";position:absolute;inset:0;pointer-events:none;',
      'background:var(--dshp-veil,rgba(0,0,0,.12));transition:background .8s ease}',
      '#' + PLATE_ID + '{position:absolute;left:0;top:0;width:100%;height:100%;',
      'background-position:center center;background-size:cover;background-repeat:no-repeat;will-change:transform}'
    ].join('')

    var CONTROL_STYLE = [
      '#' + CONTROLS_ID + '{position:fixed;right:16px;bottom:16px;z-index:2147483000;',
      'font:12px/1.4 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#0f1115;user-select:none}',
      '#' + CONTROLS_ID + '[data-dark="1"]{color:#ebeef2}',
      '#' + CONTROLS_ID + ' *{box-sizing:border-box;font:inherit;color:inherit;margin:0}',
      '#' + CONTROLS_ID + ' .dshp-fab{width:34px;height:34px;border-radius:50%;border:1px solid rgba(127,127,127,.35);',
      'background:rgba(255,255,255,.72);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);',
      'box-shadow:0 4px 16px rgba(0,0,0,.18);cursor:pointer;display:flex;align-items:center;justify-content:center;',
      'font-size:15px;line-height:1;padding:0;transition:transform .15s ease,background .2s ease}',
      '#' + CONTROLS_ID + '[data-dark="1"] .dshp-fab{background:rgba(32,32,36,.72)}',
      '#' + CONTROLS_ID + ' .dshp-fab:hover{transform:scale(1.06)}',
      '#' + CONTROLS_ID + ' .dshp-panel{position:absolute;right:0;bottom:44px;width:224px;padding:10px 12px;',
      'border-radius:12px;border:1px solid rgba(127,127,127,.28);background:rgba(255,255,255,.86);',
      'backdrop-filter:blur(18px) saturate(1.2);-webkit-backdrop-filter:blur(18px) saturate(1.2);',
      'box-shadow:0 12px 34px rgba(0,0,0,.24);display:flex;flex-direction:column;gap:8px}',
      '#' + CONTROLS_ID + '[data-dark="1"] .dshp-panel{background:rgba(30,30,34,.88)}',
      '#' + CONTROLS_ID + ' .dshp-panel[hidden]{display:none}',
      '#' + CONTROLS_ID + '[data-flip="1"] .dshp-panel{bottom:auto;top:44px}',
      '#' + CONTROLS_ID + ' .dshp-fab{cursor:grab;touch-action:none}',
      '#' + CONTROLS_ID + ' .dshp-row{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '#' + CONTROLS_ID + ' .dshp-label{opacity:.72;font-size:11px;letter-spacing:.02em}',
      '#' + CONTROLS_ID + ' .dshp-seg{display:flex;gap:2px;padding:2px;border-radius:8px;background:rgba(127,127,127,.16)}',
      '#' + CONTROLS_ID + ' .dshp-seg button{border:0;background:transparent;border-radius:6px;padding:3px 7px;cursor:pointer;font-size:11px}',
      '#' + CONTROLS_ID + ' .dshp-seg button[data-on="1"]{background:rgba(255,255,255,.92);box-shadow:0 1px 3px rgba(0,0,0,.14)}',
      '#' + CONTROLS_ID + '[data-dark="1"] .dshp-seg button[data-on="1"]{background:rgba(255,255,255,.2);box-shadow:none}',
      '#' + CONTROLS_ID + ' .dshp-link{border:0;background:transparent;cursor:pointer;font-size:11px;opacity:.8;padding:0}',
      '#' + CONTROLS_ID + ' .dshp-link:hover{opacity:1;text-decoration:underline}'
    ].join('')

    function rgba(rgb, alpha) {
      return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + Math.round(alpha * 1000) / 1000 + ')'
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value))
    }

    /** Build the alias-token override layer for one intensity. */
    function buildTokens(intensity) {
      var a = LADDER[intensity] || LADDER.medium
      var extra = Math.min(a[3] + 0.04, 0.97)
      return {
        '--dsw-alias-bg-base': { light: rgba(LIGHT.base, a[0]), dark: rgba(DARK.base, a[0]) },
        '--dsw-alias-bg-layer-1': { light: rgba(LIGHT.l1, a[1]), dark: rgba(DARK.l1, a[1]) },
        '--dsw-alias-bg-layer-2': { light: rgba(LIGHT.l2, a[2]), dark: rgba(DARK.l2, a[2]) },
        '--dsw-alias-bg-layer-3': { light: rgba(LIGHT.l3, a[3]), dark: rgba(DARK.l3, a[3]) },
        '--dsw-alias-bg-layer-4': { light: rgba(LIGHT.l4, extra), dark: rgba(DARK.l4, extra) },
        '--dsw-alias-bg-module-platform': { light: rgba(LIGHT.l1, a[1]), dark: rgba(DARK.l1, a[1]) },
        '--dsw-specific-sidebar-fill': {
          light: rgba(LIGHT.sidebar, Math.max(a[0] - 0.08, 0.28)),
          dark: rgba(DARK.sidebar, Math.max(a[0] - 0.08, 0.28))
        },
        '--dsw-specific-bubble': {
          light: rgba(LIGHT.bubble, Math.min(a[1] + 0.06, 0.92)),
          dark: rgba(DARK.bubble, Math.min(a[1], 0.86))
        },
        // Composer / search fields keep their original opaque surface, so the
        // input text sits on the palette it was designed for.
        // Secondary and tertiary labels drop one palette step in the light
        // theme: over a photo those grays were too faint to read.
        '--dsw-alias-label-secondary': { light: '#353638', dark: '#cfd3d6' },
        '--dsw-alias-label-tertiary': { light: '#61666b', dark: '#adb2b8' },
        '--dsw-alias-label-caption': { light: '#81858c', dark: '#81858c' },
        '--dsw-alias-menu-icon': {
          light: '#2c2c2e',
          dark: 'var(--dsw-alias-label-primary-dimmed)'
        }
      }
    }

    function readPrefs() {
      try {
        var raw = window.localStorage.getItem(PREFS_KEY)
        return raw ? JSON.parse(raw) : {}
      } catch (error) {
        return {}
      }
    }

    function writePrefs(prefs) {
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
      } catch (error) {
        /* private mode or a denied storage origin */
      }
    }

    function ensureStyle(doc) {
      var existing = doc.getElementById(STYLE_ID)
      if (existing) return existing
      var style = doc.createElement('style')
      style.id = STYLE_ID
      style.textContent = STYLE + CONTROL_STYLE
      doc.head.appendChild(style)
      return style
    }

    function ensureLayer(doc) {
      var layer = doc.getElementById(LAYER_ID)
      if (layer) return layer
      layer = doc.createElement('div')
      layer.id = LAYER_ID
      layer.setAttribute('aria-hidden', 'true')
      var plate = doc.createElement('div')
      plate.id = PLATE_ID
      layer.appendChild(plate)
      var parent = doc.body || doc.documentElement
      parent.insertBefore(layer, parent.firstChild)
      return layer
    }

    function apiUrl(pathname) {
      try {
        return new URL(ROUTE + pathname, document.baseURI || location.href).href
      } catch (error) {
        return ROUTE + pathname
      }
    }

    function fetchMeta() {
      return fetch(apiUrl('/meta'), {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' }
      }).then(function (response) {
        if (!response.ok) throw new Error('meta HTTP ' + response.status)
        return response.json()
      })
    }

    /** Fetch the wallpaper bytes and turn them into a decodable object URL. */
    function loadImage(rev) {
      var url = apiUrl('/image?rev=' + encodeURIComponent(rev))
      return fetch(url, { credentials: 'same-origin', cache: 'no-store' })
        .then(function (response) {
          if (!response.ok) throw new Error('image HTTP ' + response.status)
          return response.blob()
        })
        .then(function (blob) {
          if (!blob || blob.size === 0) throw new Error('image is empty')
          var objectUrl = URL.createObjectURL(blob)
          return new Promise(function (resolve, reject) {
            var probe = new Image()
            probe.onload = function () {
              resolve({ objectUrl: objectUrl, image: probe, bytes: blob.size })
            }
            probe.onerror = function () {
              URL.revokeObjectURL(objectUrl)
              reject(new Error('image decode failed'))
            }
            probe.src = objectUrl
          })
        })
    }

    /** Average luminance (0..1) of a decoded image, for the readability veil. */
    function analyze(image) {
      try {
        var width = 32
        var height = Math.max(1, Math.round((32 * image.height) / Math.max(1, image.width)))
        var canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        var context = canvas.getContext('2d', { willReadFrequently: true })
        context.drawImage(image, 0, 0, width, height)
        var data = context.getImageData(0, 0, width, height).data
        var sum = 0
        var count = 0
        for (var i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 8) continue
          sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
          count += 1
        }
        return count > 0 ? sum / count : 0.5
      } catch (error) {
        return null
      }
    }

    /**
     * Readability veil: a light theme hazes a dark wallpaper and a dark theme
     * deepens a bright one, so the contrast between text and its surface stays
     * roughly constant whatever the user has on their desktop.
     */
    function veilFor(luminance, dark) {
      if (typeof luminance !== 'number' || !isFinite(luminance)) return ''
      if (dark) return 'rgba(11,11,13,' + (Math.round(clamp(0.08 + 0.22 * luminance, 0.08, 0.32) * 1000) / 1000) + ')'
      return 'rgba(255,255,255,' + (Math.round(clamp(0.05 + 0.2 * (1 - luminance), 0.05, 0.26) * 1000) / 1000) + ')'
    }

    function start(ctx) {
      var doc = document
      var style = ensureStyle(doc)
      var layer = ensureLayer(doc)
      var plate = doc.getElementById(PLATE_ID)
      var prefs = readPrefs()
      var alive = true
      var timer = 0
      var geomTimer = 0
      var meta = null
      var currentRev = ''
      var intensity = ''
      var tokensDisposer = null
      var tone = null
      var objectUrl = ''
      var imageState = 'idle'
      var imageWidth = 0
      var imageHeight = 0
      var visible = true
      var lastGeom = ''
      var trace = []
      /** Keep the last few distinct geometry samples for out-of-band diagnosis. */
      function traceGeometry(mode, sx, sy, sw, sh, dpr) {
        var entry = mode + ':' + Math.round(sx) + ',' + Math.round(sy) + ' ' + Math.round(sw) + 'x' + Math.round(sh) + '@' + dpr
        if (trace[trace.length - 1] === entry) return
        trace.push(entry)
        if (trace.length > 6) trace.shift()
      }

      /** Effective choice: explicit user preference first, Host config second. */
      function effective() {
        return {
          intensity: prefs.intensity || (meta && meta.intensity) || 'medium',
          blur: typeof prefs.blur === 'number' ? prefs.blur : (meta && meta.blur) || 0,
          align: prefs.align !== undefined ? prefs.align !== false : !(meta && meta.align === false),
          fit: (meta && meta.fit) || 'fill',
          hidden: prefs.hidden === true
        }
      }

      function isDark() {
        return Boolean(doc.body && doc.body.hasAttribute('data-ds-dark-theme'))
      }

      function syncTokens() {
        var choice = effective()
        if (choice.hidden) {
          if (tokensDisposer) {
            try {
              tokensDisposer()
            } catch (error) {
              /* theme already gone */
            }
            tokensDisposer = null
            intensity = ''
          }
          return
        }
        if (choice.intensity === intensity) return
        intensity = choice.intensity
        try {
          tokensDisposer = ctx.theme.overrideTokens(NS, buildTokens(choice.intensity))
        } catch (error) {
          imageState += '|token:error'
        }
      }

      /**
       * Geometry: a plate the size of the screen, shifted by the window's own
       * screen position, reproduces what Windows paints behind the window.
       * Anything we cannot trust falls back to covering the window itself.
       */
      function applyGeometry() {
        var choice = effective()
        var sx = window.screenX
        var sy = window.screenY
        var screenObject = window.screen
        var sw = screenObject && screenObject.width
        var sh = screenObject && screenObject.height
        var availLeft = screenObject && typeof screenObject.availLeft === 'number' ? screenObject.availLeft : 0
        var availTop = screenObject && typeof screenObject.availTop === 'number' ? screenObject.availTop : 0
        var dpr = window.devicePixelRatio || 1

        /*
         * A window at the left edge — or dragged partly off it, or maximized
         * (Windows reports -8 for the invisible frame) — keeps the same plate
         * offset, so negative origins stay aligned while they remain inside
         * this display. Only another monitor (its available area starts
         * elsewhere) or an origin fully outside the screen falls back to
         * covering the window.
         */
        var sameDisplay = Math.abs(availLeft) < 1 && Math.abs(availTop) < 1
        var inRange = isFinite(sx) && isFinite(sy) && sw > 0 && sh > 0 &&
          sx > -sw && sy > -sh && sx < sw && sy < sh
        var usable = choice.align === true && sameDisplay && inRange

        traceGeometry(usable ? 'on' : sameDisplay ? 'range' : 'display', sx, sy, sw, sh, dpr)
        layer.setAttribute('data-align', usable ? 'on' : (choice.align === true ? 'fallback' : 'off'))

        if (!usable) {
          plate.style.left = '0px'
          plate.style.top = '0px'
          plate.style.width = '100%'
          plate.style.height = '100%'
          plate.style.backgroundSize = 'cover'
          plate.style.backgroundPosition = 'center center'
          plate.style.backgroundRepeat = 'no-repeat'
          return
        }

        plate.style.left = (-sx) + 'px'
        plate.style.top = (-sy) + 'px'
        plate.style.width = sw + 'px'
        plate.style.height = sh + 'px'
        plate.style.backgroundRepeat = 'no-repeat'
        plate.style.backgroundPosition = 'center center'

        if (choice.fit === 'fit') {
          plate.style.backgroundSize = 'contain'
        } else if (choice.fit === 'stretch') {
          plate.style.backgroundSize = '100% 100%'
        } else if (choice.fit === 'center' || choice.fit === 'tile') {
          // Windows draws these at native pixels, so CSS px must be divided by dpr.
          var w = imageWidth > 0 ? imageWidth / dpr : 0
          var h = imageHeight > 0 ? imageHeight / dpr : 0
          plate.style.backgroundSize = w > 0 ? (w + 'px ' + h + 'px') : 'auto'
          if (choice.fit === 'tile') plate.style.backgroundRepeat = 'repeat'
        } else {
          plate.style.backgroundSize = 'cover'
        }
      }

      function applyBlur() {
        var blur = effective().blur
        layer.setAttribute('data-blur', blur > 0 ? '1' : '0')
        layer.style.setProperty('--dshp-blur', blur + 'px')
      }

      function paint() {
        var choice = effective()
        var hasImage = Boolean(objectUrl)
        visible = !choice.hidden && hasImage
        layer.setAttribute('data-visible', visible ? '1' : '0')
        syncTokens()
        applyBlur()
        applyGeometry()
        layer.style.setProperty('--dshp-veil', veilFor(tone, isDark()) || 'rgba(0,0,0,0)')
        syncControls()
        refreshControls()
      }

      /** The Host may forbid the pill; mount or unmount it accordingly. */
      function syncControls() {
        var wanted = !meta || meta.controls !== false
        if (!wanted) {
          if (controls && controls.parentNode) controls.parentNode.removeChild(controls)
          controls = null
          panel = null
          placeControls = null
          return
        }
        if (!controls && doc.body) buildControls()
      }

      function showImage(rev) {
        loadImage(rev)
          .then(function (loaded) {
            if (!alive) {
              URL.revokeObjectURL(loaded.objectUrl)
              return
            }
            if (objectUrl) URL.revokeObjectURL(objectUrl)
            objectUrl = loaded.objectUrl
            imageWidth = loaded.image.naturalWidth
            imageHeight = loaded.image.naturalHeight
            plate.style.backgroundImage = 'url("' + objectUrl + '")'
            tone = analyze(loaded.image)
            imageState = 'ok:' + loaded.bytes + ':' + imageWidth + 'x' + imageHeight
            paint()
          })
          .catch(function (error) {
            imageState = 'fail:' + (error && error.message ? error.message : 'unknown')
            layer.setAttribute('data-visible', '0')
          })
      }

      /* ------------------------------ controls ------------------------------ */

      var controls = null
      var panel = null
      var placeControls = null

      function buildControls() {
        if (doc.getElementById(CONTROLS_ID)) return
        controls = doc.createElement('div')
        controls.id = CONTROLS_ID
        controls.innerHTML =
          '<button class="dshp-fab" type="button" title="壁纸设置" aria-label="壁纸设置">◐</button>' +
          '<div class="dshp-panel" hidden>' +
          '<div class="dshp-row"><span class="dshp-label">壁纸</span>' +
          '<button class="dshp-link" type="button" data-act="hidden">显示/隐藏</button></div>' +
          '<div class="dshp-row"><span class="dshp-label">透明度</span>' +
          '<div class="dshp-seg" data-group="intensity">' +
          '<button type="button" data-val="subtle">弱</button>' +
          '<button type="button" data-val="medium">中</button>' +
          '<button type="button" data-val="strong">强</button></div></div>' +
          '<div class="dshp-row"><span class="dshp-label">虚化</span>' +
          '<div class="dshp-seg" data-group="blur">' +
          '<button type="button" data-val="0">0</button>' +
          '<button type="button" data-val="8">8</button>' +
          '<button type="button" data-val="16">16</button>' +
          '<button type="button" data-val="28">28</button></div></div>' +
          '<div class="dshp-row"><span class="dshp-label">对齐桌面</span>' +
          '<div class="dshp-seg" data-group="align">' +
          '<button type="button" data-val="on">开</button>' +
          '<button type="button" data-val="off">关</button></div></div>' +
          '<div class="dshp-row"><span class="dshp-label">恢复</span>' +
          '<button class="dshp-link" type="button" data-act="reset">重置本机设置</button></div>' +
          '</div>'
        doc.body.appendChild(controls)
        panel = controls.querySelector('.dshp-panel')

        var drag = { active: false, moved: false, startX: 0, startY: 0, originX: 0, originY: 0 }

        /** Place the pill: the stored drag position, else the bottom-right corner. */
        function positionControls() {
          if (!controls) return
          var limitX = Math.max(4, window.innerWidth - 38)
          var limitY = Math.max(4, window.innerHeight - 38)
          if (prefs.pos && typeof prefs.pos.x === 'number' && typeof prefs.pos.y === 'number') {
            var x = clamp(prefs.pos.x, 4, limitX)
            var y = clamp(prefs.pos.y, 4, limitY)
            controls.style.left = x + 'px'
            controls.style.top = y + 'px'
            controls.style.right = 'auto'
            controls.style.bottom = 'auto'
            controls.setAttribute('data-flip', y < 200 ? '1' : '0')
          } else {
            controls.style.left = ''
            controls.style.top = ''
            controls.style.right = '16px'
            controls.style.bottom = '16px'
            controls.setAttribute('data-flip', '0')
          }
        }

        var fab = controls.querySelector('.dshp-fab')
        fab.addEventListener('pointerdown', function (event) {
          drag.active = true
          drag.moved = false
          drag.startX = event.clientX
          drag.startY = event.clientY
          var box = controls.getBoundingClientRect()
          drag.originX = box.left
          drag.originY = box.top
          try {
            fab.setPointerCapture(event.pointerId)
          } catch (error) {
            /* older engines without pointer capture still get the click path */
          }
        })
        fab.addEventListener('pointermove', function (event) {
          if (!drag.active) return
          var dx = event.clientX - drag.startX
          var dy = event.clientY - drag.startY
          if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
          if (!drag.moved) return
          prefs.pos = { x: drag.originX + dx, y: drag.originY + dy }
          positionControls()
        })
        fab.addEventListener('pointerup', function () {
          if (!drag.active) return
          drag.active = false
          if (drag.moved) writePrefs(prefs)
          else panel.hidden = !panel.hidden
        })
        fab.addEventListener('pointercancel', function () {
          drag.active = false
        })

        panel.addEventListener('click', function (event) {
          event.stopPropagation()
          var target = event.target
          if (!target || target.tagName !== 'BUTTON') return
          var group = target.parentNode && target.parentNode.getAttribute('data-group')
          if (group === 'intensity') prefs.intensity = target.getAttribute('data-val')
          else if (group === 'blur') prefs.blur = Number(target.getAttribute('data-val'))
          else if (group === 'align') prefs.align = target.getAttribute('data-val') === 'on'
          else if (target.getAttribute('data-act') === 'hidden') prefs.hidden = !effective().hidden
          else if (target.getAttribute('data-act') === 'reset') {
            prefs = {}
          }
          writePrefs(prefs)
          paint()
        })
        doc.addEventListener('keydown', function (event) {
          if (event.key === 'Escape' && panel && !panel.hidden) panel.hidden = true
        })
        positionControls()
        placeControls = positionControls
      }

      function refreshControls() {
        if (!controls) return
        controls.setAttribute('data-dark', isDark() ? '1' : '0')
        if (placeControls) placeControls()
        var choice = effective()
        var segs = controls.querySelectorAll('.dshp-seg')
        for (var i = 0; i < segs.length; i += 1) {
          var group = segs[i].getAttribute('data-group')
          var buttons = segs[i].querySelectorAll('button')
          for (var j = 0; j < buttons.length; j += 1) {
            var value = buttons[j].getAttribute('data-val')
            var on = false
            if (group === 'intensity') on = value === choice.intensity
            else if (group === 'blur') on = Number(value) === choice.blur
            else if (group === 'align') on = (value === 'on') === choice.align
            buttons[j].setAttribute('data-on', on ? '1' : '0')
          }
        }
      }

      /* -------------------------------- poll -------------------------------- */

      function schedule(delay) {
        if (!alive) return
        clearTimeout(timer)
        timer = setTimeout(tick, Math.max(1500, delay || 4000))
      }

      function diagnostics() {
        var rect = layer.getBoundingClientRect()
        var computed = window.getComputedStyle ? window.getComputedStyle(layer) : null
        var bodyStyle = window.getComputedStyle ? window.getComputedStyle(document.body) : null
        return {
          image: imageState,
          build: BUILD,
          layer: layer.isConnected === true,
          rect: Math.round(rect.width) + 'x' + Math.round(rect.height),
          align: layer.getAttribute('data-align'),
          screen: [
            window.screenX,
            window.screenY,
            window.screen && window.screen.width,
            window.screen && window.screen.height,
            window.screen && window.screen.availLeft,
            window.screen && window.screen.availTop,
            window.devicePixelRatio
          ].join(','),
          opacity: computed ? computed.opacity : '',
          zIndex: computed ? computed.zIndex : '',
          bodyBgBase: bodyStyle ? bodyStyle.getPropertyValue('--dsw-alias-bg-base') : '',
          labelSecondary: bodyStyle ? bodyStyle.getPropertyValue('--dsw-alias-label-secondary') : '',
          trace: trace.join(' | '),
          theme: isDark() ? 'dark' : 'light',
          tone: typeof tone === 'number' ? Math.round(tone * 100) / 100 : null,
          veils: layer.style.getPropertyValue('--dshp-veil'),
          intensity: intensity,
          prefs: prefs,
          controls: controls
            ? (function () {
                var box = controls.getBoundingClientRect()
                return Math.round(box.x) + ',' + Math.round(box.y) + ',' + Math.round(box.width) + ',' + Math.round(box.height)
              })()
            : 'missing',
          probe: controls
            ? (function () {
                var box = controls.getBoundingClientRect()
                var hit = document.elementFromPoint(Math.round(box.x + 17), Math.round(box.y + 17))
                return hit ? (hit.id || hit.className || hit.tagName) : 'none'
              })()
            : '',
          fab: controls
            ? (function () {
                var fab = controls.querySelector('.dshp-fab')
                if (!fab) return 'no-fab'
                var cs = window.getComputedStyle(fab)
                return [cs.opacity, cs.visibility, cs.display, cs.backgroundColor, cs.zIndex, cs.position].join('|')
              })()
            : '',
          base: document.body ? window.getComputedStyle(document.body).backgroundColor : ''
        }
      }

      function tick() {
        if (!alive) return
        if (doc.hidden) {
          schedule(15000)
          return
        }
        fetchMeta()
          .then(function (payload) {
            if (!alive) return
            meta = payload
            if (payload.rev && payload.rev !== currentRev) {
              currentRev = payload.rev
              showImage(payload.rev)
            } else if (!payload.rev && currentRev) {
              currentRev = ''
              objectUrl = ''
              plate.style.backgroundImage = ''
              paint()
            }
            paint()
            markSolidIslands()
            doc.documentElement.setAttribute('data-dshp', 'on')
            return fetch(apiUrl('/ping'), {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                rev: payload.rev || '',
                href: location.href,
                ua: navigator.userAgent,
                diag: diagnostics()
              })
            })
          })
          .catch(function (error) {
            doc.documentElement.setAttribute('data-dshp', 'error')
            imageState = 'meta-fail:' + (error && error.message)
            if (window.console && console.debug) {
              console.debug('[dsh-wallpaper-glass] host route unavailable:', error && error.message)
            }
          })
          .then(function () {
            schedule(meta && meta.pollMs ? meta.pollMs : 6000)
          })
      }

      // Keep the veil in step with the user's light/dark choice.
      var observer = null
      if (typeof MutationObserver === 'function') {
        observer = new MutationObserver(function () {
          paint()
        })
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
      }

      /**
       * Embedded browsers and document previews must keep the original
       * palette: mark the panel around each web frame as a solid island, but
       * never promote a node that has grown to the size of the whole shell.
       */
      var solidObserver = null
      var solidPending = 0
      function markSolidIslands() {
        var frames = doc.querySelectorAll('iframe, webview')
        for (var i = 0; i < frames.length; i += 1) {
          var node = frames[i]
          for (var hop = 0; hop < 2; hop += 1) {
            node = node.parentElement
            if (!node || node === doc.body || node === doc.documentElement) break
            var box = node.getBoundingClientRect()
            if (box.width > 0 && box.width >= window.innerWidth * 0.9) break
            node.setAttribute('data-dshp-solid', '')
          }
        }

        // Text fields and search boxes: mark whichever ancestor actually paints
        // their surface, so the field keeps the palette it was designed for.
        var fields = doc.querySelectorAll('input, textarea, [role="searchbox"], [role="combobox"]')
        var skip = { checkbox: 1, radio: 1, range: 1, color: 1, file: 1, hidden: 1, submit: 1, button: 1, image: 1 }
        for (var f = 0; f < fields.length; f += 1) {
          var field = fields[f]
          if (skip[(field.getAttribute('type') || '').toLowerCase()]) continue
          var current = field
          for (var depth = 0; depth < 4 && current && current !== doc.body; depth += 1) {
            var style = window.getComputedStyle(current)
            var background = style.backgroundColor
            var paints = background && background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)'
            if (paints) {
              var rect = current.getBoundingClientRect()
              if (rect.width * rect.height <= window.innerWidth * window.innerHeight * 0.4) {
                current.setAttribute('data-dshp-solid', '')
              }
              break
            }
            current = current.parentElement
          }
        }
      }
      function scheduleSolidScan() {
        if (!alive || solidPending) return
        solidPending = setTimeout(function () {
          solidPending = 0
          if (alive) markSolidIslands()
        }, 120)
      }
      if (typeof MutationObserver === 'function') {
        solidObserver = new MutationObserver(scheduleSolidScan)
        solidObserver.observe(document.body, { childList: true, subtree: true })
      }

      // Window moves and display changes do not fire DOM events; a cheap
      // compare of the screen metrics is the portable way to follow them.
      geomTimer = setInterval(function () {
        if (!alive) return
        var s = window.screen
        var key = [
          window.screenX,
          window.screenY,
          s && s.width,
          s && s.height,
          s && s.availLeft,
          s && s.availTop,
          window.devicePixelRatio
        ].join(',')
        if (key !== lastGeom) {
          lastGeom = key
          applyGeometry()
        }
      }, 250)

      function onVisibility() {
        if (!doc.hidden) schedule(600)
      }
      doc.addEventListener('visibilitychange', onVisibility)
      function onResize() {
        applyGeometry()
        if (placeControls) placeControls()
      }
      window.addEventListener('resize', onResize)

      lastGeom = ''
      paint()
      markSolidIslands()
      tick()

      return function dispose() {
        alive = false
        clearTimeout(timer)
        clearInterval(geomTimer)
        doc.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('resize', onResize)
        if (observer) observer.disconnect()
        if (solidObserver) solidObserver.disconnect()
        clearTimeout(solidPending)
        if (tokensDisposer) {
          try {
            tokensDisposer()
          } catch (error) {
            /* the theme may already be gone */
          }
        }
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        if (controls && controls.parentNode) controls.parentNode.removeChild(controls)
        if (layer && layer.parentNode) layer.parentNode.removeChild(layer)
        if (style && style.parentNode) style.parentNode.removeChild(style)
        doc.documentElement.removeAttribute('data-dshp')
      }
    }

    exports.name = NS
    exports.inject = ['theme']
    exports.apply = function apply(ctx) {
      if (typeof document === 'undefined' || typeof window === 'undefined') return
      ctx.effect(function () {
        return start(ctx)
      }, 'dsh-wallpaper-glass: wallpaper layer')
    }

    return module.exports
  }
})
