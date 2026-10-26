# OpenCode 2.0 执行后端

> **参考资料范围（2026-10-22）**：下文继承自远端 server1 工程，历史服务状态、私有路径和实测结果不代表本机结果。本机配置入口、操作与当前验收以 [README](../README.md) 和本文件新增的“本机统一配置验收”节为准；不要直接执行旧用户目录部署命令。

完整交付状态以[ACCEPTANCE](ACCEPTANCE.md)为准。当前是私有影子/组件验收，不是生产切换；原CLI、MCP、Tunnel、DSH未替换。

## 当前已验证

| 项目 | 证据 |
|---|---|
| 版本与认证 | 官方@opencode/cli 2.0.32私有二进制；容器私有Server仅127.0.0.1:4099；无认证401、官方client认证200；PID/startticks/进程组与固定container ID相符 |
| 真执行 | /tmp真实Git仓库中FIRST→SECOND，两次原生read/write工具执行、同一Session恢复，native diff包含1个文件 |
| 统一MCP | 13工具Schema对L1/L2相同；L1不得start/abort，未登记容器拒绝、Host未隔离拒绝、其他caller不能读该Task；真实hostname/宿主UID1001、容器执行UID0/完整ID返回 |
| 持久恢复 | Gateway进程重启后按原task_id恢复原V2 Session，继续改同一文件，不搬运聊天或新建替代Session |
| 中止 | V2实际工具名shell；真实sleep 20进入running后interrupt，进程扫描无残留shell/sleep，唯一sentinel未写入；不承诺撤销已完成文件变更或清理用户主动daemon |
| 路由保护 | start/continue前读取V2实际解析模型配置；项目将27B指到Flash地址时，在提交任何Prompt前拒绝；只允许原期望路由及一层合法本地bili包装 |

完整MCP收据：~/.config/agent-mcp/shadow/native-contract-xiUYXh/evidence.json。专门中止回归：native-contract-9JOrjQ/v2-abort-evidence.json。真实项目路由拒绝收据在backend目录route-guard-evidence.json。均为SDK/实际HTTP控制链，不是DSH Web/IM或ChatGPT网页验收。

## 接口与权限边界

- src/agents.mjs只接受OpenCode V2，使用固定@opencode/client 2.0.32，不回退V1/session API。state格式version=2，旧V1记录拒绝混用。caller/level来自Gateway认证，不接受参数伪造。
- V2使用location对象及model={id,providerID,variant}，prompt返回原生inbox ID。只读status合并active、outcome/time.idle及有界消息；不暴露reasoning parts或SDK原始错误。
- abort取消该owned Session的排队输入并interrupt，不重放历史Prompt。新continue仍使用同一个Session；网络结果不确定时保留uncertain，不自动重试提交。
- native-v2.mjs验证容器内PID归属后才读取私有连接凭据并访问HTTP；容器PID不得传给宿主kill或Service.stop。只使用Service.headers纯认证函数，不调用账号级ensure/discover/stop。
- 运行代码、连接凭据和Gateway状态在容器RW挂载之外；每次实际调用固定container ID并复查挂载/host-network。现有两个目标已确认host网络，不能推广为任意bridge容器都能访问宿主127.0.0.1。
- Docker宿主CLI保留真实HOME/XDG/context；容器HOME/XDG仅通过docker exec -e目录值设置，不混淆两侧命名空间。秘密不放argv；原生stdout/stderr不原样落盘或转发。
- JSON响应有1MiB上限、禁止HTTP重定向；native diff与Git输出有界，Git固定参数禁用fsmonitor/hooks/external diff/textconv及可选index写入。

## 内部Host后端工具范围（集成准备）

Gateway可为内部caller配置allowed_tools：服务端固定白名单，不接受工具参数伪造；默认DSH/ChatGPT仍原L2、不受该可选字段影响。各caller列出的13工具Schema保持相同，执行时不在scope的工具返回TOOL_SCOPE_DENIED。HTTP实测内部native-host可操作授权Host文件、不能递归启动OpenCode、不能exec未登记容器，参数注入allowed_tools被拒绝。

host-runtime.mjs的hostGatewayConfig按[官方V2权限](https://opencode.ai/v2/docs/permissions/)生成“全deny，八个gateway_<tool> allow”，并在build agent重复限制以覆盖其默认例外；关闭原生文件、shell、Code Mode与自代理权限，只保留Host Tools/Container Executor。它保留模型及small_model/title配置，不修改原对象。该生成器与内部scope已单测，真实受限Host2.0.32经Gateway完成FIRST→SECOND同Session写入及登记容器Root执行已实测。请求wire断言仅八个gateway工具，无原生文件、shell、execute或opencode编排工具。**Host已接通probe-only start/continue/status/abort与有范围标记的diff；业务Git diff已通过有界只读快照；容器子任务task-scope联动中止与Gateway崩溃恢复已实测，正式Host仍未验收**，不能把组件探针当完整Host交付。

V2 MCP配置必须使用mcp.servers、disabled:false、oauth:false、codemode:false；旧mcp.<name>/enabled字段不能套用。以[官方MCP文档](https://opencode.ai/v2/docs/mcp-servers/)为准。此受限运行时还用官方client.mcp.add/connect显式注册私有Location，不把config.get可见等同于catalog已注册。观察到connected与模型tool projection不同时完成：首个请求工具列表为空，随后投影八工具。探针在同Session先做无工具/无文件更改的READY初始化，再提交真正任务；不重放业务Prompt。正式manager须保留这个就绪阶段和等效工具范围证据。

## 开发入口（当前内部组件，不是最终一键生产入口）

输入：私有V2 artifact元数据、旧配置只读快照。

1. node deploy/prepare-opencode-v2.mjs /private/artifact.json /private/original.jsonc：生成新private backend.json与配置，不启动Server。
2. 从已安装、不可变的private release运行node deploy/opencode-v2-server.mjs /private/backend.json：只启动该固定容器内私有Server，输出脱敏认证/版本就绪信息。
3. node deploy/opencode-v2-stop.mjs /private/backend.json：只停止该marker核验的进程组，不按端口杀进程，不动共享服务。
4. 私有instance.agents指定state_file、backends映射；当前诊断backend需显式allow_probe=true才可做MCP组件测试，正式实例默认拒绝probe-only后端。

server1当前backend：~/.config/agent-mcp/backends-v2/dlvins-dev-173c85ce-9247-4c2c-9df1-82922de609e6/backend.json。连接凭据在同目录0600 connection.private.json，不得输出。manager从private release运行；旧1.19 job66已定向关闭，原CLI1.19仍在，不再计作本任务2.0验收。

## Host内核边界进展（尚未启用Host后端）

- src/host-guard.c采用Landlock ABI>=4、no_new_privs、seccomp。仅授权私有状态目录写入、配置/运行时文件读取和指定ELF执行；不授予业务目录直读写。未连接Unix socket、datagram socketpair、raw/UDP socket、非名单TCP端口、ptrace/process_vm、namespace切换、io_uring、外部进程信号等受限。TCP规则按端口，**不是目的IP防火墙**，不夸大为完整网络命名空间隔离。
- server1 ABI8、lap1 6.8内核ABI4，同一C源码和tests/host-guard.test.mjs均通过17类路径/执行/socket/FD/信号/网络负向检查（含三种stream pair重连攻击），以及允许写/允许TCP/子进程继承正向检查。lap1旧userspace头文件用稳定UAPI常量兼容，运行时仍检查ABI，不升级内核/头文件、不依赖user namespace或sudo。
- 真实Host OpenCode2.0.32在该域内启动，实际UID1001、同PID、NoNewPrivs1/Seccomp2、认证401/200已验证。使用trace确认的窄运行时元数据读取；模型配置目录保持只读，启动前在私有service.json预置随机密码以免运行时写配置目录。秘密不输出。
- **不可据此宣布Host全功能验收**。原session.shell超时已定位为Bun spawn所需Unix stream socketpair被整体禁止，不是API格式错误；相同API在容器对照可成功。仅允许已连接的AF_UNIX/SOCK_STREAM/protocol0 pair作进程内IPC，仍禁止未绑定Unix socket与datagram pair；shutdown/关闭peer/AF_UNSPEC三种重新连接外部自有Unix listener攻击在ABI8/4均拒绝，外部连接计数0。Native实际execve(/usr/bin/bash)现在EACCES即时失败、未写sentinel，AbortSignal未超时；真实负向探针通过。早期超时误判收据仍不作证据。此仍不等于Host全功能MCP、真实推理/独立Review已通过。
- 重现：npm run test:host；认证组件：node tests/host-v2-runtime-smoke.mjs /private/original.jsonc --auth-only；完整Native负向测试不加--auth-only，现已通过即时内核exec拒绝；正式Host目标仍未启用。测试只创建自有临时进程与文件，结束停止自有Host探针，不留正式Host Server。
- lap1仅测试文件位于~/.local/share/agent-mcp-kernel-probe-VbYaAc；使用已存在Node24.21.0与cc，未部署正式Gateway/Router/Native服务，未改现有CLI/MCP/DSH。

## Host进程证据连接器（正式生命周期前置）

src/host-native-v2.mjs校验私有backend connection/proof、Host PID start_ticks/boot_id、真实exe路径、UID/GID、NoNewPrivs1/Seccomp2/CapEff0及私有HOME/XDG/TMP目录；校验受信Parent launcher记录的guard SHA与完整授权参数摘要，最后核对真实Native info PID/version，防止PID复用/端点暗换。凭据有1MiB响应上限且禁止重定向，控制证明/凭据不能位于Native可写子树。binary/guard须属当前用户、单链接常规文件、不可group/other写；本任务编译guard显式chmod0755，不能依赖当前umask。

信任边界：proc并不直接暴露Landlock规则；policy摘要证明来自受信Parent launcher，不是任意进程可自报的isolation=true，也不是远程内核认证。普通未隔离Node/fake证明、陈旧tick、policy变更、可写control路径都被拒绝。config边界同时保护可选agents.host_backend的root/binary/guard/proof/connection。

真实Host八工具MCP探针已通过该连接器及篡改负向，再完成Host文件同Session修改与UID0容器输出。此连接器现已接入Host probe分支，默认无host_backend时仍fail-closed；必须allow_probe=true、backend.bootstrap_only=true且frontend_caller_id与请求caller绑定。可用agents.host_backends按caller独立登记，fallback host_backend仍检查绑定。每task使用私有virtual directory，逻辑business cwd只允许命名write root的无symlink目录；业务IO仅走MCP。源函数与真实HTTP MCP已验证start/continue/status、持久恢复、L1/跨owner拒绝及Native队列/生成中止。Host diff已改为business git_summary，私有virtual snapshot内容全部redact防止泄露内部配置；配置host_git后可返回真实worktree status/stat/patch/log，L1通过host_diagnostic git_summary也能只读查询；Host callback现由server-side每task lease绑定；abort先撤销callback再按持久关联停止owned Container Executor进程组，Gateway崩溃后核验immutable CID与PID starttick/PGID恢复停止。用户自建setsid daemon仍不在该进程组保证内。

## Host只读Git边界

host_diagnostic(command=git_summary,root,path)与Host opencode_diff使用src/host-git.py。broker逐层O_NOFOLLOW打开命名read root/cwd，复制到受保护private scratch；拒绝symlink/hardlink/特殊文件，深度32、20000 entries、128MiB、复制8秒超限即fail-closed，源文件变更可拒绝。随后Git仅read该private snapshot、runtime libs/loader cache并read-write /dev/null sink，无business写权限、无网络端口授权。固定status/stat/patch/log参数，禁用fsmonitor/hooks/pager/external diff/textconv及可选index写入，系统/global配置不继承；每query5秒与128KiB stdout，原repo/index保持不变。snapshot不是跨文件原子事务；外置worktree metadata、带链接或超过预算的项目不保证成功，不能降级成无隔离Git。

使用前operator需配置host_git.guard_file和private0700 scratch_root，二者加入control-plane保护范围。真实HTTP diff与L1只读查询已验收，server1/lap1 ABI4同四文件SHA完全一致且隔离Git测试通过；仅lap1测试目录落盘，不是完整迁移交付。

## Host callback与子任务停止

agents.host_scopes_file为private0600，加入ControlPlane保护；server内部每task发行独立L2 callback，仅八core工具，不新增公共工具/权限级别。parent_task_id与frontend_owner来自认证上下文。Executor在spawn前持久reserve，再同步确认lease active，避免撤销/spawn竞态。记录immutable CID、marker与归属，不记录命令/输出。

Abort撤销callback后只停止该task受控进程组，再中止Native inbox；Gateway重启可按CID与marker starttick/PGID恢复，不向Host PID发信号。旧callback401；显式continue在同Session轮换token、重新注册位置、初始化，不复活旧token或重放取消Prompt。256 leases/1024 child记录上限，长期回收仍需正式manager整合。

实测自有Gateway SIGKILL crash<3秒，90秒owned child ready后重启/abort，group无非zombie存活、sentinel不生成、无关联任务正常完成。graceful close可能等任务自然完成，不能替代crash证据；探针具备finally owned-group清理。

## Host profile准备入口（不启动服务）

`node deploy/prepare-host-v2.mjs ARTIFACT PRIVATE_V1_SNAPSHOT GATEWAY_CONFIG FRONTEND_ID GUARD_BINARY ROUTES_JSON`

输入是已校验2.0.32 artifact、私有原始配置快照、待接入Gateway配置、其中L2 caller id、owned单链接guard与显式27b/flash loopback路由。Gateway必须已有agents.host_scopes_file。输出private0700 Host profile/backend_file，default/title/small_model保留、只允许八gateway权限、全局MCP为空，无共享callback key。原配置不覆盖，不注册Gateway、不监听端口、不启动Native。缺少frontend L2/任务scope/本地路由/受信binary即拒绝；旧backend若仍有gateway_token_file照样保护，但新profile不再要求该过时字段。

插件故意标记bootstrap pending，保留original.jsonc和原插件清单但当前profile关闭plugins；不能以准备成功宣称插件等价或正式常驻管理已完成。真实artifact准备host-eKhFvx与Gateway boundary preflight已验证，server_started=false。当前已有foreground manager：`node deploy/host-v2-server.mjs BACKEND_FILE`；启动锁/证明/认证/清理已实测，Gateway的caller→host_backends显式注册仍由私有实例配置完成，不自动改主入口。

## Host foreground manager（bootstrap）

`node deploy/host-v2-server.mjs BACKEND_FILE` 在终端前台或managed background job运行；Ctrl-C/SIGTERM只清理本manager自有ChildProcess，不使用discover/stop-all，不根据外部PID文件杀进程。重复manager.lock拒绝；stale lock/proof/connection拒绝且不盲删。根目录及顶层RW/config目录必须private/非symlink，proof/connection来自Parent创建，连接认证从sealed RO config/opencode/service.json取值，不读Native RW registration路径。Ready需完整kernel+API PID/version attestation。

正常停机等待自有Native退出后仅按inode删除本次connection/proof/lock；硬杀manager会遗留控制状态，需可信Operator恢复，不自动抢占。只验证idle任务之间clean restart；active工作须先显式abort/quiesce，不承诺后台任意daemon或半开业务安全续接。

Task保存Native epoch（boot_id:PID:starttick）；显式continue发现epoch变更会重新注册该task的MCP与初始化。2.0.32重启后首次初始化可能发送非法tools=[]被provider400拒绝：只对精确empty-tools400允许再发一次READY，无业务Prompt重放或模型切换；其他错误不重试。真实manager smoke验证同Session跨restart、两业务Prompt各1次、前后文件MANAGED_FIRST→MANAGED_SECOND。

`node tests/host-manager-smoke.mjs BACKEND_FILE` 仅用于本任务独立profile和未占用probe端口，会创建并清理自己的Gateway/Native，记录manager-evidence.json；不要指向生产实例。插件/memory/skills parity、正式激活及用户前端仍待，不因manager Ready视为整体完成。

## Native model variants wire复验

`node tests/variant-wire-smoke.mjs PRIVATE_V1_SNAPSHOT` 创建自己的private Host/Gateway/两路metadata-only observer，使用现有18100/18181 upstream；六model/variant用例完成后清理自己的服务。不要指向业务目录。省略model参数验证默认Flash；每模型同Session连续low/medium/high，assert线上reasoning_effort low/medium/xhigh、stream=true、工具面精确八项。快照输入SHA不变，输出evidence.json不保存Prompt/body/header/credential。fixture output512只限制探针，非原8192的配置修改。只证明实际参数投递和完成，不证明内部reasoning预算或质量。

## 保全与未完成项

- 私有probe保留原配置完整快照。Native V2实测默认Flash、title agent使用原small_model的27B；原ID、context262144/output8192及low/medium/high标签保留，解析的reasoningEffort为low/medium/xhigh。这仅是实际配置解析证据，发到模型服务的参数仍需wire实测，不能据此声称有效长上下文容量。
- 当前bootstrap_only=true：插件/MCP上游连接明确关闭，基础权限deny、仅对L2创建的原生Session赋容器开发权限；这是隔离探针而非“保留全部原功能”交付。原opencode-mem与billion-context未丢弃，正式启用前必须验证V2兼容、skills与单一billion-context链。
- opencode-mem@2.32.0有./v2导出；billion-context@0.1.202厂商README宣称支持1.x/2.x，但实际V2加载/钩子未验证。不能用旧/docs/plugins页面替代/v2/docs/build/plugins文档，更不能从./server导出就断言兼容。
- 正式常驻Host尚未启用；未配置caller绑定probe时target=host仍HOST_ISOLATION_NOT_PROVEN。已有探针HTTP生命周期及业务Git diff证据，但正式Host常驻管理入口、Codex独立Review、V2 variants wire、真实前端和lap1完整交付仍待。
- 容器完整root/RW数据/X11/host网络沿用用户原设计，可能影响共享数据；API目标名单不是恶意root的完整对抗沙箱，不夸大隔离范围。

官方依据：[V2迁移](https://opencode.ai/v2/docs/migrate-v1/)、[V2 Client](https://opencode.ai/v2/docs/build/client/)、[V2 API](https://opencode.ai/v2/docs/api/)。
