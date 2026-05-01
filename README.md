# HAPI

通过 Web / PWA 远程控制本机或自托管机器上的 Codex。

当前公开支持范围仅限 **Codex app-server**。Claude Code、Gemini、OpenCode 和历史 native/tmux 代码不作为当前支持面；如果还在仓库里出现，视为历史实现或内部兼容代码。

> **为什么是 HAPI？** HAPI 是 Happy 的 local-first 替代方案。核心差异见 [Why Not Happy?](docs/guide/why-hapi.md)。

## 特性

- **Codex app-server 主路径** - thread 历史、生命周期动作、review、skills、plugins、apps、MCP、memory 都优先走 Codex 原生 app-server。
- **Web / PWA 远控** - 手机或浏览器访问 HAPI，继续查看和操作远程 Codex session。
- **自托管访问** - 通过 Cloudflare Tunnel、反向代理或 VPS relay 暴露 HAPI。
- **集中式 Hub** - Hub 负责鉴权、会话列表、SSE 实时更新、Socket.IO RPC 和 SQLite 持久化。

## 当前边界

- 支持：Codex remote session、Codex app-server thread/read/actions、review、workspace 展示、管理面板。
- Codex history 可通过在线 runner 的 app-server catalog 读取；不要求已经存在一个打开的 HAPI session。
- 不支持：native `tmux` create / attach / resume / open。
- 旧 native/tmux session 已退役；相关 API 返回 `410 Gone`，旧 session URL 返回 not found。

## 快速开始

```bash
bun install
bun run dev
```

生产部署：

```bash
./scripts/public-deploy.sh start
```

然后打开 HAPI Web，在 `New Session` 中选择在线 runner 机器并创建 Codex session。

## 文档

- [安装说明](docs/guide/installation.md)
- [PWA / Web App](docs/guide/pwa.md)
- [工作原理](docs/guide/how-it-works.md)
- [公网 / Tunnel 部署](docs/guide/tunnel-deployment.md)
- [为什么是 HAPI](docs/guide/why-hapi.md)
- [常见问题](docs/guide/faq.md)

## 从源码构建

```bash
bun install
bun run build:single-exe
```

## 致谢

HAPI 读作“哈皮”，是 [Happy](https://github.com/slopus/happy) 的中文音译。原项目值得特别致谢。
