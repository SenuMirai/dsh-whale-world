# 本机微信模块

DSH 端代码在 `src/ecosystem/wechat/`，此目录只负责 Windows 微信收发。使用当前的家，不创建第二份 AI、人设或记忆。现有 `/bridge/say` 协议保持原样。

## 当前范围

- 接收文字与普通图片私聊、指定家庭群；首启从最新位置监听，不重放旧聊天。原生动图表情仍不接收。
- 私聊收到图片后缓冲最多 3 秒，合并紧随的同一聊天、同一发言人的最多两张图片及一条说明文字，作为一次模型请求处理；更多图片留给后续轮次。批次开始处理后才收到的文字留在微信数据库中，下一轮按序读取，不中断当前回复。
- 批次成员保留原平台消息 ID，在同一事务中进入待处理与完成状态；缓冲期间不推进游标，处理中断后保留待核对状态，不自动重跑模型。图片单发仅进入会话图片上下文；图片加文字时只把真实文字按原范围归档。图片及附件引用不写入共享记忆块，是否另行留存其中信息由她自己判断。
- 暂不接收视频号分享卡片：卡片会被跳过，不进入宿主会话或共享记忆。视频号卡片解析、视频内容读取，以及朋友圈浏览／发布，均预留为微信模块后续扩展，尚未实现；朋友圈发布需要独立接口，不能复用私聊／群聊发送接口。
- 后台原生发送文字、图片及 GIF 表情，不操作窗口、鼠标、键盘或剪贴板。当前仅支持 `engine/profile.json` 指纹锁定的 Windows 微信构建。
- 发言人使用真实 wxid，消息保持 `role: user`；昵称只作显示。
- 每个群按平台、登录账号、聊天类型和群 ID 绑定独立会话，列在原房间工作区下，重启继续复用；群名变化不产生新会话。QQ 的相同参数可使用同一映射结构，但本模块仍只提供微信传输。
- 群消息只在微信来源元数据的 `atuserlist` 包含她的真实 wxid 时触发，正文里手打 `@昵称` 不触发。回复携带当前消息之前最多 8 条、16KB 的同群上下文，保留各自的发言人 ID；每轮最多读取其中最近两张图片。
- 群图片使用所选账号、群和消息分片的本机缓存，注明原图、缓存版本或缩略图；不操作界面下载。图片尚未缓存或不可解码时，明确标记未读取。图片通过宿主附件服务保存，仅在群会话总日志的上下文事件中保留引用，不进入共享记忆归档。
- 账号和聊天必须显式绑定；进程只根据配置账号的数据库持有情况识别，不选择其他账号。微信退出时暂停收发，原账号重新登录后自动重新绑定进程、重建读取和发送连接，沿用原消息游标，不需要重启 DSH。
- 自动恢复只处理微信离线；账号或候选进程不唯一、其他运行错误仍明确停止。消息处理过程中中断且结果未确认时，保留待核对状态，不重跑模型、不重发消息，按下文 `Acknowledge` 流程处理。
- 微信请求依次进入原家或对应群会话；她自主调用工具决定是否回复、回复哪个已配置聊天，不广播到桌宠等其他出口。
- `Send` 可向已配置聊天主动发文字。首版需要先停止 `Start` 再单独使用，不支持多进程同时操作微信。
- 世界会话长期提供 `wechat_chats`（分页列目标）、`wechat_send`（指定 chatId 和 1–16 条 messages）和 `wechat_delivery`（按发送 ID 查询结果）。她在桌面聊天、闹钟唤醒或每日回顾时，也能主动联系已配置的私聊和群。主动联系与回复共用同一队列和发送函数，不需要先停监听。`Send` 命令只供停监听后的人工操作。
- 仅调用 `wechat_send` 才安排投递，普通最终文字不自动转发。每批消息按数组顺序发送，可穿插短句、图片和表情；不同批次按入队顺序处理。工具返回 queued 只表示排队，尚未确认发送，不能当作已发出或重复调用。
- 发送正文作为独立的微信出站上下文写入发起会话总日志，按原记忆范围记录真实正文和目标；普通工具参数、回执查询和群图片上下文仍不进入共享记忆。她留在 DSH 的最终文字与微信正文可以不同，归档分别保留。
- 生成时先记为待发送，适配器逐条核对目标聊天中的本人消息、内容及服务器消息编号，再更新同一条记忆的已确认条数。中断则记录已确认部分与结果不明项；这不是对方已读回执。
- 回执先保存在适配器本地，宿主暂时不可用时，重启监听只补报回执，不重发消息。旧版本的待发送记录不会凭空改成已发送。
- 宿主队列保存在世界目录 `wechat-outbox.sqlite`。适配器离线时已排队消息会等待恢复；已领取任务按同一 ID 恢复，适配器已有回执时只补报，不再发送。处理或发送中断且结果不明时仍停止并要求人工核对；主动发送的待核对消息 ID 为 `outgoing:<发送 ID>`。
- 群会话沿用现有归档范围：`archiveScope: home` 时能读取家的记忆，但群正文不写入共享记忆；群自己的宿主会话日志保留正文，发送状态单独保存，不绕过归档范围。
- `archiveScope: workspace` 会归档家所在工作区的普通会话，包括独立群会话；群图片上下文依旧不进入共享归档。控制台修改范围后重启 DSH 生效，回扫范围内历史并按时间重建近期记忆，保留原始日志和旧归档。

## 账号与风控风险

本模块不是微信官方 API。接收端解密读取所选账号的本地消息数据库；发送端向绑定的微信进程加载 DLL、写入内存并调用内部函数。即使不改微信安装文件、不安装接收 Hook，也不能据此保证账号安全，仍存在账号功能受限或封禁风险。

微信安全中心 [2026 年 1 月 29 日公告（媒体转载）](https://www.thepaper.cn/newsDetail_forward_32493057) 重点治理违规获取聊天记录、联系人数据，以及通过模拟按键、自动化脚本操控微信等行为，同时关注批量操作、营销骚扰及用户投诉。仅用于家庭群、低频聊天，或改用 Computer Use，都不能保证消除接入方式带来的风险。公开资料没有可靠的封号概率或安全发送阈值；进程绑定、版本校验和发送回执用于防止误发、重复发送，不代表通过微信官方授权或风控认证。

## 准备

从旧版升级时，需同时更新并重启 DSH 插件与 Windows 适配器；旧监听器不会消费新的发送队列或识别私聊图片。本版宿主连接文件的 `protocol` 为 `3`；旧宿主不能接收新的私聊图片请求，适配器会明确提示升级，不静默丢掉图片。重启前核对尚未确认的消息，沿用原配置和状态目录，不删除游标或回执。

1. 电脑端手动登录她的独立微信账号。不要把自己的账号填进配置。
2. 运行 `./src/ecosystem/wechat/windows/wechat.ps1 Install`，依赖只安装到 `.host/wechat/.venv`。然后运行 `./src/ecosystem/wechat/windows/wechat.ps1 Build`，需要本机 Visual Studio C++ x64 构建工具。原生桥仅编译到 `.host/wechat/engine`，不改微信安装文件。
3. 在 DSH 的 dsh-world 插件配置开启 `wechat: true`，重载插件/重启宿主并开始世界。模块会写 `<world>/wechat.json`，适配器每次请求都会读取最新地址和令牌。这个文件不得公开。
4. 新建 `.host/wechat/config.json`，按实际登录填写账号、数据库路径和目标聊天；进程自动核对。配置与运行状态不打进发布包。

```json
{
  "account": "wxid_bot_abcd",
  "selfId": "wxid_bot",
  "dbDir": "D:/WechatData/xwechat_files",
  "moduleFile": "C:/Users/you/.dsh/worlds/your-world/wechat.json",
  "pageSize": 50,
  "pollSeconds": 2,
  "stickerDir": "C:/Users/you/.dsh/memes",
  "mediaRoots": ["C:/Users/you/.dsh/worlds/your-world/room"],
  "chats": [{ "id": "family@chatroom", "name": "家庭群名称", "trigger": "mention" }],
  "people": { "wxid_family_member": "妈妈" }
}
```

`account` 是 `dbDir` 下她的账号目录名，`selfId` 是她的真实微信内部 ID，不是昵称。启动及重连只绑定唯一持有此账号数据库的微信进程，每个连接固定 PID 和启动时间，读取和发送前重复核对。旧配置中的 `processId` 可删除，保留时也不再固定选择旧进程。发送直接使用 `chats[].id`，`name` 仅供显示。`stickerDir` 复用已安装的表情包目录，`mediaRoots` 限制本地媒体发送范围。

统一身份参数如下。微信入站由本机数据库解析；QQ 一列按 [OneBot 11 消息事件](https://github.com/botuniverse/onebot-11/blob/master/event/message.md) 映射，未启用 QQ 传输。

| 内部参数 | 微信来源 | QQ / OneBot 来源 |
| --- | --- | --- |
| `channel` | `wechat` | `qq` |
| `accountId` | 她的 `selfId` | `self_id` 转字符串 |
| `conversationType` | 群为 `group`，私聊为 `private` | `message_type` |
| `conversationId` | 群的 `...@chatroom` 或私聊 wxid | 群用 `group_id`，私聊用 `user_id`，均转字符串 |
| `conversationName` | 配置的聊天显示名 | 群显示名（由适配器取得） |
| `speakerId` | `wechat:` + 本行分片解析出的 `sender_username` | `qq:` + `user_id` |
| `speakerName` | 显式 `people` 名称或联系人备注/昵称 | 群名片 `sender.card` 或昵称 |
| `platformMessageId` | 本行消息分片名 + `local_id`；与账号、会话一起定位 | `message_id` 转字符串 |
| `mentionIds` | 当前触发消息真实 `atuserlist`，每项加 `wechat:` 前缀 | `at` 消息段中的账号，加 `qq:` 前缀 |

平台账号 ID 不按同名自动合并。微信的分片内数字 `sender_id` 不能直接当人 ID。QQ 的 @ 使用 [消息段的 `at.data.qq`](https://github.com/botuniverse/onebot-11/blob/master/message/segment.md#某人)，同样不通过昵称判断。

`wechat_send` 的 `messages` 每项为 `{ "type": "text", "text": "一句话" }`、`{ "type": "image", "path": "绝对路径" }` 或 `{ "type": "sticker", "stickerId": "st_..." }`；表情也接受允许目录下的 `path`。图片会快照成 PNG，表情转成 GIF 并保留动画；每条文字最多 4094 UTF-8 字节，GIF 最大 1MB、1024 像素边长，过大时明确报错。

```powershell
./src/ecosystem/wechat/windows/wechat.ps1 Status
./src/ecosystem/wechat/windows/wechat.ps1 Probe # 原生账号/调度器校验，不发消息
./src/ecosystem/wechat/windows/wechat.ps1 Chats -Limit 20 -Offset 0
./src/ecosystem/wechat/windows/wechat.ps1 Start -AllowSend
# Ctrl+C 停止监听；然后才能单独主动发送。
./src/ecosystem/wechat/windows/wechat.ps1 Send -Chat 'family@chatroom' -Text '一条明确要发送的话' -AllowSend
# 隐藏后台窗口运行；停止时核对尚未完成的消息。
./src/ecosystem/wechat/windows/wechat.ps1 Start -AllowSend -Background
./src/ecosystem/wechat/windows/wechat.ps1 Stop
```

**让插件管理适配器（可选）**：在 dsh-world 配置里与 `wechat: true` 并列写入

```yaml
wechatAdapter:
  python: C:/path/to/.host/wechat/.venv/Scripts/python.exe
  config: C:/path/to/.host/wechat/config.json
```

两项都填才生效。微信模块启动时插件用等同于 `Start -AllowSend` 的参数拉起适配器，微信模块停止（控制台停止、重启 DSH、退出）时结束整个进程树，适配器意外退出则按 1 秒起翻倍、最长 30 秒的间隔自动重启；日志写在 `<world>/wechat-adapter.log`（超过 1MB 时清空）。**写下这两项即视为长期允许适配器发送消息**，默认关闭。启用前先用 `wechat.ps1 Stop` 停掉手动启动的实例，否则两个实例会争用单实例锁。适配器遇到需要人工核对的消息（结果不明，须在微信里确认后用 `acknowledge` 处理）时以退出码 2 退出，插件不会重复拉起；处理后在控制台「微信」卡片点「重启适配器」即可恢复。启动时若 Python、配置或脚本暂时缺失，插件会按同样的间隔重试，文件回来后自动启动。微信自身重启不需要插件处理：适配器会等待同一账号重新登录并沿用游标，控制台「微信」卡片会显示“微信离线，等待重新登录”。

`Start -AllowSend` 会把所选聊天的新文字交给家的 Agent，并实际发送回复。家仍有原来的工具权限，第一版不会把群成员自动变成独立权限主体；接入群聊前应决定允许哪些人向家下指令。

若提示待核对消息，先到家和对应微信聊天检查是否已处理、已发送。确认不需要自动再处理这一条后：

```powershell
./src/ecosystem/wechat/windows/wechat.ps1 Acknowledge -Chat 'family@chatroom' -MessageId 'message/message_0.db:123'
```

这会标记该条已核对并继续，不重发。其他消息记录保留。

## 验证边界

单元测试不连接微信。读取仍使用所选账号的本地数据库；发送桥加载到已绑定的微信进程，在微信自己的任务线程提交操作，不使用界面发送。停止适配器会取消尚未提交的原生任务；已交给微信的异步发送不能撤销，结果不确定时仍需人工核对。桥在微信退出时释放，未安装接收 Hook。

这不是微信官方 API。版本变更需重新校准，锁屏和群聊等实际条件必须分别验证。`engine/` 基于第三方原生 ABI 研究定制，保留独立的非商业许可与来源说明；该目录不适用仓库根目录的 MIT 许可。

2026-10-25 已在绑定的专用账号私聊中确认两条独立文字及一条原生表情（类型 47），并在选定家庭群补发确认一张原生表情和一条文字；均核对服务器消息编号，媒体内容同时核对 MD5。首次群会话的技能目录误判已修复并有回归测试。2026-10-26 已确认家庭群真实 @ 触发时读取两张缓存图片、模型描述图片并回群发送成功，附件引用保存在群会话日志，该群共享归档记录数仍为 0。独立图片发送、锁屏运行尚未实测。
