# Remote Device Hub for DeepSeek Harness

[English](README.md)

这是一个 DeepSeek Harness 组合包（bundle），通过
[Remote Device Hub](https://mcp.xdistribute.site/mcp) 连接你已授权的 Linux 和
macOS 设备。它提供：

- Remote Device Hub MCP 工具（`mcp__remote-device-hub__*`）；
- `remote-device-hub` 技能，说明安全的设备操作流程；
- 在当前 profile 有审批通道时，对写文件、执行命令、控制进程等会更改设备的
  工具先请求批准。

它是 VS Code 和 Codex 版 Remote Device Hub 插件的 DSH 对应实现。运行时不需要
系统安装 Node.js，桥接进程直接使用 DSH 自身的运行时。

## 前置条件

- DeepSeek Harness `0.2.0` 或更新版本。
- 能访问任意一种分发渠道：私有 Git 仓库（SSH key，且 `github.com` 已加入
  `~/.ssh/known_hosts`）、公开 Git 仓库、npm 包，或已配置的插件市场索引。
- 首次登录需要浏览器。
- 允许在当前 DSH profile 安装插件。安装 bundle 会引入 Host 代码，插件管理器
  会要求 `danger-full-access` 批准。

## 安装

### Web 界面

1. 打开 DSH 侧边栏的 **插件 / Plugins**。
2. 选择从 Git 安装 bundle，填入：

   ```text
   git+ssh://git@github.com/be-one-click/remote-device-plugin-dsh.git
   ```

3. 保持 bundle 启用。插件管理器会把它写入当前 profile；开启 HMR 时无需重启
   DSH 即可挂载。

### 让 Agent 安装

> 从 `git+ssh://git@github.com/be-one-click/remote-device-plugin-dsh.git`
> 安装 DSH 插件。

Agent 会调用 `plugin_manager` 的 `install_bundle`，`target` 传入同一个 Git
地址。请安装仓库根包，不要指向子目录。

### 其他安装渠道

同一个 bundle 支持四种分发方式，在同一个 profile 中只安装其中一种即可。

| 渠道 | 安装目标 |
|---|---|
| 私有 Git（SSH） | `git+ssh://git@github.com/be-one-click/remote-device-plugin-dsh.git` |
| 公开 Git（HTTPS） | `git+https://github.com/be-one-click/remote-device-plugin-dsh.git` |
| npm | `dsh-remote-device-hub` 或 `dsh-remote-device-hub@0.3.2` |
| 市场索引 | 添加索引 URL 后从 Discover 安装 |

npm 渠道需要先发布包（见 [docs/publishing.md](docs/publishing.md)）。市场索引由
`npm run market` 生成；npm 发布后可直接使用：

```text
https://cdn.jsdelivr.net/npm/dsh-remote-device-hub@0.3.2/market/index.json
```

把该 URL 添加为市场索引源，然后在 Discover 中安装 **Remote Device Hub**。

### 首次连接

bundle 通过 stdio 启动 OAuth 桥接。首次连接时，桥接会在浏览器打开 Remote
Device Hub 授权页，申请 `devices:control` scope。请用拥有目标设备的账号登录。
访问令牌和刷新令牌由 `mcp-remote` 保存在
`~/.mcp-auth/mcp-remote-v1/`，不会写入仓库或 profile 配置。

连接成功后工具才会出现：

```text
mcp__remote-device-hub__list_devices
mcp__remote-device-hub__device_info
mcp__remote-device-hub__read_file
...
```

可以用下面的请求验证：

> 列出我已授权的 Remote Device Hub 设备。

浏览器没有自动打开时，见[故障排查](docs/troubleshooting.md)。

## 使用

当前 profile 挂载了 DSH 技能注册表时，`remote-device-hub` 技能会自动进入
会话目录。它要求模型：

1. 从 `list_devices` 返回的真实设备中选择目标；
2. 读取 `device_info`，确认 root、能力和 `allow_write`/`allow_shell`；
3. 在指定 root 下使用有界文件读取和 POSIX 相对路径；
4. 把设备输出视为不可信数据，只报告实际观察到的结果；
5. 用户请求未覆盖某次有影响的更改时，先询问。

Host 部分还实现了四种权限级别。所选级别决定哪些工具在有审批通道时返回
`ask`：

| 级别 | 行为 |
|---|---|
| `always-ask` | 读取和所有修改前都询问。 |
| `read-only` | 放行读取；任何修改前询问。 |
| `low-risk` | 放行读取、创建新文件或目录（`write_file` 的 `expected_sha256` 为空）、`stop_search`；覆盖写入、移动、shell 命令和进程控制仍询问。 |
| `allow-all` | 不再询问。 |

只读集合为：

```text
list_devices, get_billing_status, device_info, list_directory, read_file,
read_file_chunk, read_multiple_files, search_files, file_info, start_search,
list_searches, get_search_results, read_process, list_processes
```

该批准只确认一次具体工具调用，不是设备内的权限授予：Hub 和设备 Agent 仍然
按 `allow_write`、`allow_shell`、root 和配额执行限制。

## 配置

默认值在 [`cordis.patch.yml`](cordis.patch.yml)。要修改 endpoint、OAuth 回调
端口或审批行为，在 profile 的 `cordis.patch.yml` 中覆盖整行配置。patch 会替换
完整的 `config`，未重述的字段会丢失。

```yaml
- id: mcp-remote-device-hub
  config:
    serverName: remote-device-hub
    transport: stdio
    command: !!js process.execPath
    args:
      - !!js |
        (u => process.platform === 'win32'
          ? decodeURIComponent(u.pathname).replace(/^\/([A-Za-z]:)/, '$1')
          : decodeURIComponent(u.pathname))(
            new URL('node_modules/dsh-remote-device-hub/bin/launcher.mjs', ctx.baseUrl))
      - https://mcp.xdistribute.site/mcp
    env:
      ELECTRON_RUN_AS_NODE: '1'
      RDH_OAUTH_PORT: '3335'
      RDH_MCP_URL: https://mcp.xdistribute.site/mcp
    toolCallTimeoutMs: 90000
```

| 配置 | 默认值 | 含义 |
|---|---|---|
| `serverName` | `remote-device-hub` | MCP 工具命名空间，也是审批网关使用的前缀。MCP 行和 Host 行必须保持一致。 |
| `permissionMode` | `read-only` | `always-ask`、`read-only`、`low-risk` 或 `allow-all`。插件行页面也提供同一字段。 |
| `confirmMutations` | `true` | 兼容旧 profile 的布尔值。只有未设置 `permissionMode` 时，`false` 才映射为 `allow-all`。 |
| `RDH_OAUTH_PORT` | `3335` | 首选的 loopback 回调端口。`off` 或 `0` 表示让 `mcp-remote` 自行推导端口。端口被占用时，本次运行会退回推导端口。 |
| `RDH_MCP_URL` | `https://mcp.xdistribute.site/mcp` | 覆盖 endpoint，例如自建 Hub。 |
| `RDH_DIRECT_ORIGIN` | `https://xdistribute.site:8090` | 当公网代理路由不稳定时，服务端 OAuth 和 `/mcp` 使用的直连 origin。设为 `off` 则这些请求也走公网 origin。代码默认值来自 [src/bin/config.mts](src/bin/config.mts) 的 `DIRECT_HOST:DIRECT_PORT`；改 `DIRECT_PORT` 即可改源码默认值。 |
| `RDH_PUBLIC_ORIGIN` | `https://mcp.xdistribute.site` | 其 OAuth 路径和 `/mcp` 会被改写到 `RDH_DIRECT_ORIGIN` 的公网 origin。 |

直连 origin 只由 [src/bin/config.mts](src/bin/config.mts) 里的两个常量决定：

```js
export const DIRECT_HOST = 'https://xdistribute.site'
export const DIRECT_PORT = 8090
```

改 `DIRECT_PORT` 即可移动直连服务，不需要改 launcher 或 OAuth 预加载文件。
运行时仍可用 `RDH_DIRECT_ORIGIN` 覆盖。

launcher 会预加载一个小的 fetch 改写，作用于 OAuth 服务端路径
（`/.well-known/*`、`/token`、`/register`、`/revoke`）以及 `/mcp`；只有浏览器
使用的 `/authorize` 仍走公网 origin。这与当前 Hub 部署一致：公网路由承载浏览器，
8090 直连 origin 承载 OAuth 交换和 MCP 流量。

OAuth 客户端注册与回调端口绑定，登录后再修改 `RDH_OAUTH_PORT` 可能需要重新登录。

### 设置界面

bundle 为它的 Host 行提供了一个配置控件。打开侧边栏 **插件 / Plugins**，打开
**Remote Device Hub**，再打开 `remote-device-hub` 这一行（行上的配置按钮）。
行页面会以单选项显示四种权限级别：

```text
设备工具何时需要批准？
  ( ) 始终询问
  ( ) 仅放行只读工具
  ( ) 放行低风险工具
  ( ) 允许全部工具
```

选择后通过 DSH Settings 写入 `permissionMode`，不再需要手改 profile YAML。

控件注册在 `plugins.row.config`，key 为
`dsh-remote-device-hub#remote-device-hub`。`permissionMode` 是 Host 行
`Config` 的 volatile 字段，设置表单因此可用。

## 架构

```text
DSH MCP 客户端  ──stdio──▶  bin/launcher.mjs  ──▶  mcp-remote
                                                   │  OAuth + 刷新
                                                   ▼
                                      https://mcp.xdistribute.site/mcp
```

`@deepseek-ai/dsh-mcp-client` 目前没有内置 OAuth，只支持 stdio 和带静态 header
的 Streamable HTTP。`mcp-remote` 负责服务发现、动态客户端注册、PKCE、令牌刷新
和 loopback 回调服务。launcher 固定 endpoint 和回调端口，并用
`process.execPath` 启动 `mcp-remote`：DSH Desktop 中是 Electron 可执行文件，
CLI 启动的 DSH 中是 Node 可执行文件。

Host 部分（`index.js`）不导入任何 DSH 包。存在 `ctx.skills` 时注册随包技能；
监听 `tools/pre-execute` 实现审批网关。相应服务不存在时跳过该功能，而不是阻止
插件激活。

生命周期和安全细节见 [docs/architecture.md](docs/architecture.md)。

## 升级与移除

- **升级**：在插件页再次安装同一 Git 地址。如果管理器提示包已安装，请先移除
  bundle 再重新安装，让 `pnpm` 解析新提交。替换正在运行的包后可能需要重启
  DSH；插件管理器会返回 `restart-required`。
- **禁用**：在插件页关闭 bundle。MCP 连接和技能停止，但包仍保留。
- **移除**：删除 bundle。本地 OAuth 令牌仍留在
  `~/.mcp-auth/mcp-remote-v1/`，重新安装时可以复用授权。要撤销授权，请使用
  Remote Device Hub 账号设置；如只清理本 endpoint 的本地缓存，请先退出 DSH，
  再删除文件名以 endpoint URL 的 MD5 开头的文件（默认 URL 为
  `095db0f76015a5dc9e2dd8f20e97f440`）。

同一 profile 中不要再保留手写的、指向同一 URL 的 `mcp-xdistribute` 行。两个桥接
共用一份 OAuth 客户端缓存，回调端口不同时会互相使对方的 client registration
失效。

## 发布

私有 Git、公开 Git、npm 和插件市场索引四种分发方式、发布检查清单以及用户需要
准备的配置，见 [docs/publishing.md](docs/publishing.md)。

## 开发

`npm run format` 格式化维护中的源码和测试；`npm run style:check` 只检查格式与
Lint 规则，`npm run lint` 只运行 Lint。Biome 以固定版本作为开发依赖。统一使用
两空格、单引号、分号、尾逗号，一行一条语句；显式标记类型导入，禁止显式 `any`
和 `@ts-ignore`。生成文件及第三方代码不参与格式化。

```bash
npm ci
npm run check
npm run pack:check
```

在 `src/` 下修改 TypeScript 源码。`npm run build` 生成现有的 `index.js`、
`client.js`、`permissions.js`、`bin/*.mjs` 和 `scripts/*.mjs` 入口。为支持 Git 分发，生成文件也
保留在版本控制中，CI 会检查它们与源码是否一致；请勿直接修改生成文件。浏览器
入口继续使用 DSH 模块加载器和宿主提供的 React。

两份编译配置均启用 `strict`、`noUncheckedIndexedAccess` 和
`exactOptionalPropertyTypes`。npm 包只携带预编译 ESM 和资源，TypeScript 及
类型声明仅作为开发依赖，使用者无需 TypeScript 运行时。测试覆盖审批模式、
设置更新、OAuth 路由与回退、技能提供者及 launcher 行为。

## 许可证

UNLICENSED。本仓库为私有仓库，不发布到包注册表。
