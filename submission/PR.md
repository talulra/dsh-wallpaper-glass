# Add talulra/dsh-wallpaper-glass (Themes & Appearance)

**Entry file:** `data/plugins/talulra__dsh-wallpaper-glass.yml`

```yaml
url: https://github.com/talulra/dsh-wallpaper-glass
name: talulra/dsh-wallpaper-glass
category: theme
description:
  en: 'Shows the local desktop wallpaper behind a translucent DeepSeek Harness window: the image is pixel-aligned with the desktop (edge-snaps, partially off-screen and maximized windows included), follows wallpaper and slideshow changes, and adapts the readability veil to the image brightness; dialogs, menus, the embedded browser, the composer and search fields keep their original opaque palette.'
  zh: '把本地系统壁纸显示在 DeepSeek Harness 主窗口背后并逐像素对齐桌面（贴边、移出屏幕、最大化都适用），跟随壁纸与幻灯片切换，按壁纸明暗自动调节可读性蒙层；对话框、菜单、内嵌浏览器、输入框与搜索框保持原本不透明配色。'
icon: https://raw.githubusercontent.com/talulra/dsh-wallpaper-glass/main/assets/icon-180.png
```

**Install:** `dsh plugin --profile web add github:talulra/dsh-wallpaper-glass`

## What it does

- Host half resolves the wallpaper the OS is displaying right now — Windows:
  `TranscodedWallpaper` → `HKCU\Control Panel\Desktop\WallPaper` → `Themes\CachedFiles`;
  macOS: `osascript`; Linux: `gsettings picture-uri`.
- Serves it over three session-guarded local routes (`/dsh-wallpaper/meta`, `/image`, `/ping`);
  the browser half fetches the bytes and paints them behind the app.
- Pixel alignment: a screen-sized plate inside a fixed layer, offset by the window's
  screen position, so the window shows the same region of the desktop. Negative origins
  (edge-snap, partly off-screen, Windows' `-8` maximized frame) stay aligned; only another
  monitor or an origin fully outside the display falls back to covering the window.
- Follows wallpaper changes (including slideshow ticks) by polling a revision, and follows
  the desktop fill mode (`WallpaperStyle` / `TileWallpaper`: fill / fit / stretch / center / tile).
- Rewrites the design-system surface tokens through `ctx.theme.overrideTokens`, and resets
  dialogs, menus, embedded-browser panels and input surfaces back to the original opaque palette.
- Drops one palette step from the light theme's secondary/tertiary/caption label tokens so text
  stays readable over a photo.
- A draggable corner pill switches intensity / blur / alignment / visibility; no build step —
  `client/client.js` is a ready lazy-CJS bundle.

## Repo checklist for the reviewer

- `package.json` declares `dsh.bundle` (`./cordis.patch.yml`, one `insert` row) and `dsh.client`.
- No build step, no `prepare` script, no runtime dependencies (host uses Node builtins only).
- `screenshots.json` → `assets/screenshot-1.png`; icon at `assets/icon-180.png`.
- Tested on DSH 0.2.1-rc.5 desktop (Windows 11, single 2560×1600 @150% display).
