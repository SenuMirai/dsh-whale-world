# 交给她的安装说明

这份文件不是给人看的，是给 **DSH 里的陪伴角色**看的：谁把仓库地址发过来，谁就照着这份说明，把 `dsh-world` 装进 DSH、把 `qq-bridge` 接上，最后让 QQ 里的她和人说话。

一句话说清边界：**下面第一到第四步你自己做。第五步有两个动作必须人来做，你替不了。**

---

## 第零步：先摸清四件事

动任何文件之前，先把这四样查出来，后面每条命令都要用。

| 要知道的 | 怎么查 |
|---|---|
| `DSH_HOME` | Windows 默认 `C:\Users\<用户名>\.dsh`；看目录里有没有 `profiles`、`worlds` |
| 用哪个 profile | 列 `<DSH_HOME>/profiles/` 下的目录，挑 `package.json` 里 `dependencies` 有你正在跑的那些插件的那个 |
| node 版本 | `node -v`，必须 ≥ 22.16（dsh-world 要求，qq-bridge 要求 ≥ 22.13） |
| pnpm 在哪 | 先试 `pnpm -v`；没有就用 DSH 自带的：`<DSH 安装目录>\resources\runtime\x64\primary-runtime\dependencies\pnpm\bin\pnpm.cjs`，用 `node <那个 pnpm.cjs> <命令>` 调用 |

> macOS / Linux 的路径换成对应位置即可，命令不变。

---

## 第一步：把 dsh-world 装进 profile

```bash
git clone https://github.com/chenkezhen480/dsh-world.git

cd dsh-world
npm ci        # 仓库带 package-lock.json，能装全 devDependencies
npm pack      # 会先 typecheck + build，产出 dsh-world-<版本>.tgz
```

拿到 `dsh-world-0.5.2.tgz` 的**绝对路径**，然后：

```bash
cd <DSH_HOME>/profiles/<你的 profile>
node <pnpm.cjs 路径> add <tgz 的绝对路径>
```

**不要用 `link:` 指向 clone 下来的目录。** 那样会加载项目自带的一份 Cordis，和 DSH 自己的打架。README 里也写了这句，别忽略。

接着改两个文件：

**1. `<profile>/package.json`** —— 在 `dsh.profile.bundles` 数组里加一项 `"dsh-world"`：

```json
"dsh": { "profile": { "bundles": [ "…", "dsh-world" ] } }
```

**2. `<profile>/cordis.patch.yml`** —— 让插件知道桥在哪：

- 文件里**已经有** `- id: dsh-world` 的话，只补 `config` 下这几行
- **没有**的话，整段贴到文件末尾

```yaml
- insert:
    - id: dsh-world
      name: dsh-world
      config:
        qqBridgeDir: '<第二步 clone 下来的 qq-bridge 绝对路径>'
        qqBridgePort: 3100
        qqBridgeAutoStart: false
```

> `qqBridgeDir` 留空 = 不接 QQ，控制台里那张 QQ 卡整个不出现。这是刻意的。
> `qqBridgeAutoStart` 写 `false` 时，插件只在启动时把 DSH 的地址写回桥的 config，不主动拉起桥；想让它跟着 DSH 一起起来就写 `true`。
> 路径写 Windows 绝对路径，用正斜杠或单反斜杠都行。

---

## 第二步：装 qq-bridge

```bash
# ⚠ 真停（POST /api/stop）也在 PR #95 里，没合进上游 main。合入之前用这一条：
git clone -b feat/wake-and-history https://github.com/Wz0xx/qq-bridge.git
# 合入之后换成官方地址：
# git clone https://github.com/Derpyu520/qq-bridge.git

cd qq-bridge
npm install                  # postinstall 会自动修补 @snowluma/sdk 的 ESM 打包 bug
copy config.example.json config.json      # macOS/Linux 用 cp
```

`config.json` 先放这儿。`snowluma` 段和 `allow` 白名单现在填不了——等第五步人把参数给你，第六步再填。

**这一步之后一定要跑 DSH 端安装**，否则 QQ 上不会有任何反应：

```bash
node scripts/setup-dsh.mjs
```

它做的事：把 `qq-chat` / `qq-chat-v2` 两个 preset 装进 DSH，把桥的 MCP 挂上。跳过的话桥不崩，但群会话拿不到 preset，桥会**主动拒绝建会话**（有意的安全设计，不回退到带文件工具的默认 preset）。

---

## 第三步：重启一次 DSH

前两步改的都是「DSH 启动时才读」的东西：`bundles`、`cordis.patch.yml`、preset、MCP。

所以现在**重启 DSH**。重启后验证两件事：

1. 打开 DSH 设置里的「世界控制台」，能看到世界卡——说明 dsh-world 起来了
2. 控制台里能找到 **QQ 卡**，状态是「● 没在跑」——说明 `qqBridgeDir` 指对了，只是桥还没启动（第六步才起）

---

## 第四步：确认你自己能做的都做完了

跑一遍这个判断，全绿再进第五步：

| 检查 | 怎么验 | 期望 |
|---|---|---|
| dsh-world 已加载 | 浏览器打开 `http://127.0.0.1:<DSH 端口>/dsh-world/console/snapshot` | 返回 JSON，有 `worldId`、`life`、`qq` |
| 插件认识桥 | `http://127.0.0.1:<DSH 端口>/dsh-world/qq/console` | `qq` 字段有 `url`（带 token），不是 `error` |
| 桥的目录对 | 上一条的 `url` 里 token 和 `<桥目录>/state/console-token` 一致 | 一致 |

> 用浏览器而不是 curl：DSH 的 webServer 会校验 Host 头，curl 直接打会被挡。同源请求不受影响。

到这里，**你这一侧全部就绪**。剩下的是人必须插手的部分。

---

## 第五步：只有人能做的那部分

这两个动作**不能**由脚本或你代做，原因写在下面对应位置。做完之后你接手继续。

### 5.1 装 SnowLuma 并扫码登录 QQ

- 下载：<https://github.com/SnowLuma/SnowLuma/releases/latest> 选 `SnowLuma-v<版本>-win-x64.zip`（完整版自带 Node 运行时；Lite 版要本机 Node 22.13+）
- 解压到任意目录，双击 `launcher.bat`
- 用**启动日志里打印的初始密码**登录 WebUI（地址也在日志里，通常是 `http://localhost:5099`）
- 按引导：同意条款 → 设置新密码 → **接入 QQ 进程（扫码）**

> **为什么这一步不能自动化**：SnowLuma 的 EULA §5.4 明确禁止「通过自动化脚本部署」和「并入第三方安装包」。所以 qq-bridge 从 v0.1.5 起就移除了 `start_snowluma` / `stop_snowluma` 这类工具，只探活、不部署。这不是我们偷懒，是对面写死的规矩。
> 另外扫码本身也要人拿手机。装好一次之后，以后重启不用再扫。

### 5.2 在 SnowLuma 里开 OneBot，把参数交给你

让人在 SnowLuma WebUI 里：

1. 开启 **WebSocket 服务端** → 记下端口（默认 `3001`）
2. 开启 **HTTP API** → 记下端口（默认 `3000`）
3. 如果设了 accessToken，记下来

然后人把这三个值告诉你：**WS 端口、HTTP 端口、accessToken（可能为空）**。

---

## 第六步：接上（你来做）

拿到参数后，改 `qq-bridge/config.json`：

```json
"snowluma": {
  "wsUrl": "ws://127.0.0.1:3001",
  "httpUrl": "http://127.0.0.1:3000",
  "accessToken": "有就填，没有留空"
},
"allow": {
  "private": [主人的QQ号],
  "groups": [要放行的群号]
},
"socialV2": {
  "bindHomeSession": "owner"
}
```

两个坑，都会让人以为「装坏了」：

- **`wsUrl` 和 `httpUrl` 不能填同一个端口。** 填错会报 `HTTP 426`。
- **`allow` 留空等于什么都不回。** 模板里 `allowAllWhenEmpty` 是 `false`，白名单空着就 fail-closed，一条消息也不理。这是故意的，别改成 `true`——那等于把 QQ 账号交给模型。

### 谁和谁共用一个会话

`socialV2.bindHomeSession` 管的是这件事，值得单独说清楚：

| 值 | 效果 |
|---|---|
| `"owner"`（模板默认） | 主人私聊用她的「家会话」（`~/.dsh/worlds/<世界>/life.json` 里的 `homeSessionId`），**每个群各自一个独立会话**。群里聊的不会串到私聊，私聊里的记忆也不会漏进群 |
| `"all"` | 所有入口都用家会话，记忆完全共享；群里人多的时候上下文容易串味 |
| 删掉这个键 | 谁都不绑家会话，私聊也另建一个独立的 |

改完要重启桥才生效。**已经绑过的不会自动拆**：想让某一条换个会话，就在桥的控制台里「清除会话上下文」（`POST /api/session/reset`，参数 `{"key":"group:<群号>"}`），把它退役，下一条消息来了按新规则重绑。

> 这条命令会把旧会话**归档**（不是删）。要恢复，在 DSH 里取消归档：`workspace/unarchiveSession`，参数 `{"request":{"sessionId":"<会话号>"}}`。

> **不用手改桥的文件**：dsh-world 自己有一个同名开关 `qqBridgeBindHomeSession`（取值 `owner` / `all` / `none` / 留空），填在 `cordis.patch.yml` 里那条 insert 的 `config:` 下面就行。它会趁桥启动前把这个键写进桥的 `config.json`；留空表示不碰。注意 Bridge 只在启动时读这份 config，所以「重载插件」和「重启桥」最好连在一起做。

然后起桥，二选一：

- 让插件拉：控制台 QQ 卡上按「拉起桥」
- 自己起：`cd <桥目录> && npm start`（前台；Windows 想要崩溃自动重启用 `start.bat`）

**成功的标志**：桥的日志里出现 `SnowLuma 已连接`，控制台 QQ 卡显示在线。

---

## 验证清单

按顺序过一遍，哪条不过就查下表：

1. 进 `<桥目录>`，`curl "http://127.0.0.1:3100/api/status?token=$(cat state/console-token)"` → `connected: true`、`accountOnline: true`
2. DSH 里「世界控制台」→ QQ 卡：桥在跑、DSH 已连上、QQ 在线
3. QQ 上给机器人号发一条消息 → 她回
4. 群里 @ 她 → 她回
5. 关掉桥（控制台「停桥」）→ 卡上变「已停（不会自动拉起）」→ 再「拉起桥」→ 回来

## 出问题看这里

| 现象 | 真正的原因 |
|---|---|
| 世界卡在，但完全没有 QQ 卡 | ① 装的是不含 QQ 模块的旧版本（0.5.2 及之前的上游 `main`）→ 按第 1 步用当前仓库重新打包安装；② `qqBridgeDir` 没填或路径里没有 `src/bridge.js` |
| 桥起来了，QQ 上毫无反应 | 没跑 `node scripts/setup-dsh.mjs`，或者跑了但没重启 DSH |
| 桥报 `HTTP 426` | `wsUrl` / `httpUrl` 填成了同一个端口 |
| 桥连上了，但 DSH 收不到 | `config.json` 的 `dsh.baseUrl` 端口不对。正常情况下插件每次启动会自己写回正确地址；如果手动改过就重启一次 DSH |
| 白名单填了群号，群里还是不回 | 群号要是数字，别加引号以外的字符；还要确认那个群在 `allow.groups` 里 |
| 按「停桥」报「桥没有 /api/stop」 | 桥是旧版本，或者装的是上游 `main`。用第 2 步里 PR 分支那条命令重装 |

---

## 一句话总结给主人听

「装好了。以后重启电脑只要三件事：DSH 起来、桥起来（控制台按一下就行）、QQ 那边 SnowLuma 自己重连。除非换 QQ 号，否则不用再扫码。」