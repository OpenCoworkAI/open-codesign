# iOS frame starter template

When the user requests a mobile / iOS / iPhone screen ("mobile prototype", "App design", "iOS UI", "手机", "移动端"), use this exact iPhone 14 Pro frame as your starting structural skeleton, then design within `<main class="ios-screen">`.

DO NOT modify the frame skeleton (status bar, dynamic island, home indicator). DO add your design inside `<main>`.

```html
<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: #f5f5f7; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', sans-serif; -webkit-font-smoothing: antialiased; }
  .ios-status-bar {
    height: 54px;
    padding: 18px 28px 0;
    display: flex; align-items: center; justify-content: space-between;
    font-size: 17px; font-weight: 600; color: #000;
    position: sticky; top: 0; z-index: 100;
    background: inherit;
  }
  .ios-status-bar .time { font-variant-numeric: tabular-nums; }
  .ios-status-bar .icons { display: flex; gap: 6px; align-items: center; }
  .ios-status-bar .icons svg { display: block; }
  .ios-dynamic-island {
    position: absolute; top: 11px; left: 50%; transform: translateX(-50%);
    width: 124px; height: 36px;
    background: #000; border-radius: 999px;
    z-index: 200;
  }
  .ios-screen {
    /* Your design lives here. Default white; override as needed. */
    background: #ffffff;
    min-height: calc(100vh - 54px - 34px);
    padding: 0;
    overflow-y: auto;
  }
  .ios-home-indicator {
    height: 34px;
    display: flex; align-items: center; justify-content: center;
    position: sticky; bottom: 0;
    background: inherit;
  }
  .ios-home-indicator::after {
    content: ''; width: 134px; height: 5px; border-radius: 999px; background: #000;
  }
</style>
</head>
<body>
  <div class="ios-dynamic-island"></div>
  <header class="ios-status-bar">
    <span class="time">9:41</span>
    <span class="icons" aria-hidden="true">
      <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="0.5"/><rect x="5" y="5" width="3" height="7" rx="0.5"/><rect x="10" y="2" width="3" height="10" rx="0.5"/><rect x="15" y="0" width="3" height="12" rx="0.5"/></svg>
      <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1 4.5C3 2 5.5 1 8 1s5 1 7 3.5"/><path d="M3 7c1.5-1.5 3-2 5-2s3.5.5 5 2"/><path d="M5 9.5c1-1 1.8-1.3 3-1.3s2 0.3 3 1.3"/><circle cx="8" cy="11" r="0.7" fill="currentColor"/></svg>
      <svg width="26" height="12" viewBox="0 0 26 12" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="0.5" y="0.5" width="22" height="11" rx="3"/><rect x="2.5" y="2.5" width="18" height="7" rx="1.5" fill="currentColor"/><rect x="23" y="3.5" width="2" height="5" rx="0.5" fill="currentColor"/></svg>
    </span>
  </header>
  <main class="ios-screen">
    <!--
    Your design goes here. Use mobile-appropriate spacing (16-20px side padding),
    44pt touch targets, and the .ios-screen background as your canvas.
    Override .ios-screen { background: ... } if you want a non-white screen.
    -->
  </main>
  <footer class="ios-home-indicator"></footer>
</body>
</html>
```

After copying this skeleton, design your app's specific UI inside `<main class="ios-screen">`. Use the craft directives, density floor, and design system the user provides — but keep the iOS chrome (status bar, dynamic island, home indicator) untouched.

If the user requests Android instead, swap to a 360×800 viewport with Material Design status bar (height 24dp) and gesture nav (height 16dp) — use Material color tokens.
