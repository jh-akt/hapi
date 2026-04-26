# HAPI

在本地运行原生 Codex session，并通过 Web / PWA 在电脑和手机之间无缝切换。

当前这条分支主打 **原生 Codex session**：让 Codex 继续跑在你自己的终端 / `tmux` 里，再从手机打开同一个 session，PC 和手机之间来回切换，不重启 agent，也不丢上下文。

> **支持范围**：当前公开支持仅限 **Codex**。Claude Code、Gemini 和其它 agent 相关代码不作为当前支持面；如果还在仓库里出现，视为历史实现或实验路径。

> **为什么是 HAPI？** HAPI 是 Happy 的 local-first 替代方案。核心差异见 [Why Not Happy?](docs/guide/why-hapi.md)。

## 特性

- **同一个 Codex Session，两个设备无缝切换** - 在 PC 上用原生 Codex 终端工作，出门后从手机或浏览器接着看，再随时切回桌面端。
- **原生 `tmux + codex` 工作流** - HAPI 附着到你真实运行的 Codex 进程，而不是用一个浏览器里的伪终端去替代它。
- **创建 / 附着 / 恢复** - 可以直接在 Web 里创建原生 Codex session、附着已有 `tmux` pane，或者在 `tmux` / Codex 退出后按 session ID 恢复。
- **离开工位也不断流** - 人不在电脑前时，也能直接从手机批准原生 Codex 的权限请求。
- **自托管远程访问** - Codex 继续跑在你自己的机器上，通过 Cloudflare Tunnel、反向代理或 VPS relay 暴露 HAPI。

## 原生 Codex 工作流

这一版的核心使用方式是：

1. 在你自己的终端或 `tmux` 里运行 Codex，或者直接让 HAPI 为某个目录创建一个新的原生 Codex session。
2. 在 PC 或手机上打开 HAPI Web / PWA。
3. 附着这个原生 session，继续远程聊天、查看输出、批准命令。
4. 回到 PC 上的终端，继续在同一个 Codex session 里工作。
5. 如果 `tmux` pane 或 Codex 进程挂掉，HAPI 可以基于保存的 Codex session ID 恢复这个原生 session。

当前范围：

- 原生创建 / 附着 / 恢复目前只面向 `codex`
- Claude Code、Gemini 和其它 agent 暂不支持

## 快速开始

```bash
./scripts/public-deploy.sh start
tmux new -s work-a
codex
```

然后打开 HAPI Web，在 `Create Session` 里选择：

- `Create New Native Session`
- `Attach Native Session`

如果你要把这套工作流暴露到手机上，先看：

- [安装说明](docs/guide/installation.md)
- [公网 / Tunnel 部署](docs/guide/tunnel-deployment.md)
- [VPS 中转部署](docs/guide/vps-relay-deployment.md)

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
