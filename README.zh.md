# Remote Device Hub for DeepSeek Harness

![Easelian](assets/icon.svg)

[English](README.md)

这是 Easelian 提供的 DeepSeek Harness 组合包（bundle），通过
Remote Device Hub 连接你已授权的设备。它提供：

- Remote Device Hub MCP 工具（`mcp__remote-device-hub__*`）；
- `remote-device-hub` 技能，说明安全的设备操作流程；
- 当前 profile 有审批通道时，可设置哪些工具调用需要批准。

它是 VS Code 和 Codex 版 Remote Device Hub 插件的 DSH 对应实现。运行时不需要
系统安装 Node.js，桥接进程直接使用 DSH 自身的运行时。

共享概念见[RDH 统一术语](docs/terminology.md)。

## 前置条件

- DeepSeek Harness `0.2.0` 或更新版本。
- 能访问任意一种分发渠道：私有 Git 仓库（SSH key，且 `github.com` 已加入
  `~/.ssh/known_hosts`）、公开 Git 仓库、npm 包，或已配置的插件市场索引。
- 需要 RDH 账户。每台受控设备都须配对并运行 Agent。支持的系统和配对步骤见
  [Agent 安装指南](https://github.com/easelian/remote-device-agent/blob/main/README-zhCN.md)。
- 首次登录需要浏览器。
- 允许在当前 DSH profile 安装插件。安装 bundle 会引入 Host 代码，插件管理器
  会要求 `danger-full-access` 批准。

## 安装

### Web 界面

1. 打开 DSH 侧边栏的 **插件 / Plugins**。
2. 选择从 Git 安装 bundle，填入：

   ```text
   git+ssh://git@github.com/easelian/remote-device-plugin-dsh.git
   ```

3. 保持 bundle 启用。插件管理器会把它写入当前 profile；开启 HMR 时无需重启
   DSH 即可挂载。

### 让 AI 助手安装

> 从 `git+ssh://git@github.com/easelian/remote-device-plugin-dsh.git`
> 安装 DSH 插件。

DSH 的 AI 助手会调用 `plugin_manager` 的 `install_bundle`，`target` 传入同一个 Git
地址。请安装仓库根包，不要指向子目录。

### 其他安装渠道

同一个 bundle 支持四种分发方式，在同一个 profile 中只安装其中一种即可。

| 渠道 | 安装目标 |
|---|---|
| 私有 Git（SSH） | `git+ssh://git@github.com/easelian/remote-device-plugin-dsh.git` |
| 公开 Git（HTTPS） | `git+https://github.com/easelian/remote-device-plugin-dsh.git` |
| npm | `dsh-remote-device-hub` 或 `dsh-remote-device-hub@0.3.12` |
| 市场索引 | 添加索引 URL 后从 Discover 安装 |

npm 渠道需要先发布包（见 [docs/publishing.md](docs/publishing.md)）。市场索引由
`npm run market` 生成；npm 发布后可直接使用：

```text
https://cdn.jsdelivr.net/npm/dsh-remote-device-hub@0.3.12/market/index.json
```

把该 URL 添加为市场索引源，然后在 Discover 中安装 **Remote Device Hub**。

### 首次连接

bundle 通过 stdio 启动 OAuth 桥接。桥接从 MCP 资源元数据发现认证服务，
支持认证服务与 MCP 使用不同的 origin。首次连接时，桥接会在浏览器打开 Remote
Device Hub 授权页，申请 `devices:control` scope。授权页会先说明申请方、
为什么需要 Easelian 登录，以及连接允许执行的设备操作。点击“继续登录”后，
使用拥有目标设备的账户登录，再确认该账户的访问授权；点击“取消”不会授予访问。
浏览器由 OAuth 桥接打开，插件无法控制宿主在打开浏览器前是否显示确认提示。
OAuth records are encrypted in `~/.mcp-auth/rdh-secure-v1/`; the system keyring
holds the random encryption key. No plaintext fallback is allowed.
See [credential storage](docs/credential-storage.md) for prerequisites and upgrades.

令牌刷新由 MCP 官方 SDK 的 OAuth 客户端处理，不使用 Hub 的刷新结果恢复接口。如果刷新响应
丢失，可能需要重新登录；不要手动重放已保存的刷新令牌。
如果认证服务的 issuer 发生变化，先停止桥接，按下方升级和移除章节仅清理该 MCP
入口的客户端和令牌缓存，再重新登录。

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
| `allow-all` | 所有工具均无需确认。 |

只读集合为：

```text
list_devices, get_billing_status, device_info, list_directory, read_file,
read_file_chunk, read_multiple_files, search_files, file_info, start_search,
list_searches, get_search_results, get_call_status, list_calls,
get_operation_status, list_operations, read_process, list_processes
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
    env:
      ELECTRON_RUN_AS_NODE: '1'
      RDH_OAUTH_PORT: '3335'
      RDH_MCP_URL: https://hub.example.test/mcp
    toolCallTimeoutMs: 90000
```

| 配置 | 默认值 | 含义 |
|---|---|---|
| `serverName` | `remote-device-hub` | MCP 工具命名空间，也是审批网关使用的前缀。MCP 行和 Host 行必须保持一致。 |
| `permissionMode` | `read-only` | `always-ask`、`read-only`、`low-risk` 或 `allow-all`。插件行页面也提供同一字段。 |
| `confirmMutations` | `true` | 未设置 `permissionMode` 时使用的布尔值；`false` 对应 `allow-all`。 |
| `RDH_OAUTH_PORT` | `3335` | 首选的 loopback 回调端口。`off` 或 `0` 表示由系统选择端口。端口被占用时，本次登录改用其他端口。 |
| `RDH_MCP_URL` | 发布配置中的 MCP 地址 | 覆盖 endpoint，例如 `https://hub.example.test/mcp`。 |
| `RDH_DIRECT_ORIGIN` | 不启用 | 同一 Hub 的可选直连 origin。只有显式设置才会改写服务端请求；`off` 或空字符串禁用。 |
| `RDH_PUBLIC_ORIGIN` | `RDH_MCP_URL` 的 origin | OAuth 公开 origin；只有与 MCP 入口不同且已确认属于同一 Hub 时才需设置。 |

发布默认值位于生成文件 [src/bin/deployment-defaults.mts](src/bin/deployment-defaults.mts)，
由 Easelian 的发布工具生成，请勿手工修改。
自建 Hub 通常只需设置 `RDH_MCP_URL`；桥接会从该 MCP 入口发现认证服务，
不会退回官方域名。
上面的 `hub.example.test` 是示例，使用前应替换成自己的地址。

启用直连后，launcher 会改写指定 Hub 的 OAuth 服务端路径和 MCP endpoint；
浏览器的 `/authorize` 仍使用公开入口。请求失败后不会自动重发到另一入口，
因为超时不能证明刷新令牌或写操作尚未执行。
如果 Auth 与 MCP 使用不同的公开 origin，只有直连入口同时提供两者的路由时，
才将 `RDH_PUBLIC_ORIGIN` 设置为 Auth origin。

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

选择后通过 DSH Settings 写入 `permissionMode`，也可通过 profile YAML 配置该字段。

控件注册在 `plugins.row.config`，key 为
`dsh-remote-device-hub#remote-device-hub`。`permissionMode` 是 Host 行
`Config` 的 volatile 字段，设置表单因此可用。

## 架构

```text
DSH MCP 客户端  ──stdio──▶  bin/launcher.mjs（MCP SDK 传输）
                                   │  OAuth + 刷新
                                   ▼
                          配置中的 MCP endpoint
```

`@deepseek-ai/dsh-mcp-client` 目前没有内置 OAuth，只支持 stdio 和带静态 header
的 Streamable HTTP。桥接是基于 MCP 官方 SDK 的小程序：SDK 提供两端传输、
服务发现、动态客户端注册、PKCE 和令牌刷新；桥接补上加密存储、loopback 回调
和多个桥接进程之间的协调。它用 `process.execPath` 运行：DSH Desktop 中是 Electron 可执行文件，
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
  `~/.mcp-auth/rdh-secure-v1/`，重新安装时可以复用授权。要撤销授权，请使用
  Remote Device Hub 账户设置；如只清理本 endpoint 的本地缓存，请先退出 DSH，
  再删除文件名以 endpoint URL 的 MD5 开头的文件（默认 URL 为
  `095db0f76015a5dc9e2dd8f20e97f440`）。

同一 profile 中的一个 Hub URL 只配置一个 MCP 桥接。两个桥接
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

在 `src/` 下修改 TypeScript 源码。`npm run build` 生成 `index.js`、
`client.js`、`permissions.js`、`bin/*.mjs` 和 `scripts/*.mjs` 入口。为支持 Git 分发，生成文件也
保留在版本控制中，CI 会检查它们与源码是否一致；请勿直接修改生成文件。浏览器
入口使用 DSH 模块加载器和宿主提供的 React。

两份编译配置均启用 `strict`、`noUncheckedIndexedAccess` 和
`exactOptionalPropertyTypes`。npm 包只携带预编译 ESM 和资源，TypeScript 及
类型声明仅作为开发依赖，使用者无需 TypeScript 运行时。测试覆盖审批模式、
设置更新、OAuth 路由与不重放行为、技能提供者及 launcher 行为。

## 品牌资源

插件和市场索引均使用 [Remote Device Hub 通用产品图标](assets/icon.svg)。图标由深灰底板和浅白色显示器、锁与双齿短钥匙组成，只使用两种纯色；显示器右上方留有开口。浅色和深色界面使用同一张图标，无需平台提供两套图标字段。随包 SVG 为 `assets/icon.svg`，发布者为 Easelian。

## 许可证

采用 Apache License 2.0，完整文本见 [LICENSE](LICENSE)。
