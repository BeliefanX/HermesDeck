# HermesDeck PWA / 手机端使用

HermesDeck 已内置 PWA 能力：

- `/manifest.webmanifest`：安装清单
- `/sw.js`：Service Worker，缓存应用外壳与离线页
- `/offline`：离线降级页
- `public/icons/*`：Android / iOS / maskable 图标
- 移动端底部导航、safe-area、`100dvh` 布局与聊天输入栏适配

## 重要限制：手机安装 PWA 需要安全上下文

浏览器只会在安全上下文启用 Service Worker 和「添加到主屏幕」安装能力：

- ✅ `https://...`
- ✅ `http://localhost`
- ❌ 普通局域网 HTTP，例如 `http://10.10.10.253:6117`

所以当前 LAN 地址可以作为移动端网页使用，但要真正安装成 PWA，需要给 HermesDeck 前面加 HTTPS。

## 推荐 HTTPS 方式

用 Caddy/Nginx/Traefik 在同一台机器上做反代：

```caddyfile
hermesdeck.example.com {
  reverse_proxy 127.0.0.1:6117
}
```

然后手机访问：

```text
https://hermesdeck.example.com/chat
```

如果只在内网使用，也可以用局域网域名 + 受信任证书。iOS/Android 需要信任证书后才会完整启用 PWA 安装。

## 验证

```bash
cd ~/HermesDeck
npm run verify:pwa
npm run typecheck -- --pretty false
npm run build
PORT=6117 npm start
curl -I http://127.0.0.1:6117/manifest.webmanifest
curl -I http://127.0.0.1:6117/sw.js
```

浏览器 DevTools 中确认：

```js
fetch('/manifest.webmanifest').then(r => r.json())
fetch('/sw.js').then(r => r.status)
isSecureContext
'serviceWorker' in navigator
```

在 `http://10.10.10.253:6117` 下，`isSecureContext` 会是 `false`，这是浏览器安全策略，不是 HermesDeck 代码问题。
