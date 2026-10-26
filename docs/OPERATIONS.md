# 运维与当前任务

> **参考资料范围（2026-10-22）**：下文继承自远端 server1 工程，历史服务状态、私有路径和实测结果不代表本机结果。本机配置入口、操作与当前验收以 [README](../README.md) 和本文件新增的“本机统一配置验收”节为准；不要直接执行旧用户目录部署命令。

## 当前本机统一栈

本仓库是 Gateway、advisor MCP Server、Tunnel client 的唯一维护源；本任务范围仅为本机，不操作 lap1，也不改 OpenAI Tunnel 配置。私有单一实例配置为 ~/.config/agent-mcp/instance.json（0600），Tunnel ID 与 API-key 文件引用沿用既有值。

- 回归：npm test；advisor fake-Tunnel 生命周期：npm run test:advisor:lifecycle。
- 私有配置迁移预览：node deploy/prepare-local-instance.mjs --dry-run；当前中央配置已创建，脚本不会覆盖已有文件。
- release/config 预检：node deploy/validate-instance.mjs <instance.json> <absolute-release-dir>；只读检查 caller L1/L2、Host/advisor roots、容器边界与私有文件权限。
- 本机入口：deploy/local-stack.sh preflight <release-dir> → cutover <release-dir> → verify/status；停止用 stop，故障回退用 rollback <manifest>。
- 唯一目标 Gateway unit 为 agent-mcp.service；cutover 会先停旧入口，再启动 Gateway、advisor MCP 与同一 Tunnel ID，不并行抢占 Tunnel。

**当前状态：** release 4c68cb6 已通过离线安装测试并由 agent-mcp.service 提供；advisor MCP/Tunnel 从同一release运行，旧unit已退出，same-ID与本机verifier通过。Container server.info 2.0.32/UID0与两个Host caller的kernel proof/server.info 2.0.32均通过。Host manager由独立的guarded host-v2-server.mjs进程运行，不属于Gateway/advisor/Tunnel lifecycle；本页其余性能/迁移记录为历史。完整验收见docs/ACCEPTANCE.md。

## title投影验证不能替代全部small_model语义

source.small_model经nativeModelSelection投影到agents.title.model，当前仅title-only映射。118lG3使用私有Native、全deny权限、两个都指向自有回环假模型的provider：主Flash回复DONE，title27B回复PUBLIC_TITLE_ROUTE。session未显式命名/选model，观察自动title变成该值；两请求模型各一次、工具与真实模型0，原cfg不应用。

assertNativeTitleRoute绑定实际title变化、不同model、精确两请求与无真实模型/工具使用；181回归。配置与回执保存可离线复核，不重放；native已停/fence。诊断私有入口title-routing-diagnostic.mjs，仅场景fixture，不作为发布执行器。锁定源码对title还存在primary失败回退分支，本次未测；small_model全部消费者/真实标题质量/full profile仍不宣称通过，主planner的泛运行标志保持false。

## 显式模型工具闭环与原隐式默认分开

`node tests/native-provider-wire-smoke.mjs PRIVATE_SOURCE PRIVATE_V2_ARTIFACT --provider 27b --explicit-tool-only`只补一个显式27B/low工具闭环，不运行variants/PNG/default Flash。它检查源tool声明与实际Native capability，仅允许wire_probe，物理队列忙/未知不提交；cfg默认仍原source.model，session仅覆盖本用例模型。不能与--default-tool-only或--vision-only组合。

--default-tool-only仍只用于原Flash默认且session不传model，既有默认语义不扩大；结果分别记explicit_tool_result/default_tool_result。eDKctq实际两SSE、同PID一次执行与同callID返回READY通过，metadata已保存/offline再验；不重复真实请求来补记录。178回归，私有组停/fence留，原MCP/Tunnel/DSH不动。未来工具模式自动留tool-execution-events.json，旧此次原事件由自有容器精确文件只读导出。

## 便携包闭合清单验证（离线，不是签名/运行沙箱）

当前源码`node deploy/verify-migration.mjs PORTABLE_ROOT`先拒绝非普通manifest/重复或非规范路径，递归仅枚举实际目录且不跟随符号目录；除root manifest外，所有文件/链接必须有声明，特殊文件拒绝，随后核既有大小/hash/内部链接目标。合法空目录不代表代码差异，允许保留；正常结果新增closed_inventory_verified=true。额外条目或经symlink目录跨界必须失败，不为通过自动删除包内容。

执行前确保包无并发写者，并独立核对可信archive摘要/来源；恶意方可重写文件+manifest，单凭此工具不是来源认证或并发TOCTOU防御。现有lap1 kgNFKg未被改写：本轮仅通过SSH将完整脚本作为内存模块读取原包，闭合清单+6661hash通过；其包内旧verify脚本仍不含增强，勿误以为已升级。新行为须进入最终共同release才可算部署生效。

最小复现/回归：`node --test tests/migration.test.mjs`。175本机回归；旧实现曾漏掉额外文件和中间外部符号目录，负例在修复前确实失败、修复后通过。

## 按所选provider补缺失真实wire/PNG，不重放已过案例

`node tests/native-provider-wire-smoke.mjs PRIVATE_SOURCE PRIVATE_V2_ARTIFACT --provider 27b`只测27B三档；`--provider 27b --vision-only`只测一次公开PNG传输。vision现在要求单选provider、原配置modalities.input含image并且实际Native元数据含image；按该provider检查物理后端running/waiting0，任何忙/未知不提交，不为通过改服务。default-tool-only仍严格限定原默认Flash，未改变其语义。

K3FllJ/evidence.json为真实27B三档请求参数与SSE（每例1请求、source output8192、无fallback）；6j15Jq为实际PNG传输，仅transport不评视觉质量。此前错误使用Flash-only vision入口在发请求前被拒绝，修复了selector适用范围，不靠去掉capability/load限制。170本机回归；不用现有Flash成功回执伪装新27B结果。两个私有Native停/fence留。

## 原namespace ask→reject受控拒绝链路（无生产授权）

从私有source确认dlvins_container_*为ask，在全新XDG/单独Native2.0.32中声明同namespace合成MCP（URL仅本任务回环临时端口，非18878，未绑定原MCP token）；container_exec只是无命令/文件效果夹具。global/build/session维持deny-all+原prefix ask，先按原生ID发布屏障。

vN9zsf PID2194727：Native实际请求action=dlvins_container_container_exec、resources=[*]、source.type=tool/source.id=public_fixture_dlvins_container并属于本次session。等待200ms仍tool_calls0，API只对其精确requestID执行reject；pending清空，下一合成模型请求带匹配callID的非READY结果，工具前后均0/真实模型0/原MCP0。session.outcome=succeeded仅因合成模型随后DONE，不是授权或工具成功。

168本机回归+deny-normalized/deny-validation独立复核，拒绝错误session/callID、once/always、任何调用、旧PID、原MCP realm或未关闭pending。只证明原命名pattern在此额外deny-all夹具中的拒绝链路，不证明原完整默认权限、实际参数schema、真实MCP命令、GUI人工点击/批准once或full profile；不存在生产授权。私有Native停/fence留。58轮timeout策略问题无答复仍未批准，不能把本轮对测试请求的reject当作该策略选择。

## Native execution受控特征：进度未续期，兼容策略待明确

复用z6Gqgs已验3000ms/1000ms wait成功基线，不重放该正例；只新增200ms无progress(m2gV1n PID2180951)与200ms/70ms周期progress(qcTnjM PID2181032)。模型驱动仍仅本地合成SSE、角色规则/工具ID/1s输入相同；每个原生进程各实际MCP wait1次、真实模型0、原MCP0。

| execution | progress | 实际观测 |
|---|---|---|
| 3000ms | 无 | 原正例1007ms READY，精确模型callID返回 |
| 200ms | 无 | request2于200ms收到匹配cancel，模型后续拿到非READY结果 |
| 200ms | 70ms周期 | 72/142ms进度已写出，request2仍于200ms取消，未观察续期 |

Native锁定client.ts明确execution hard wall，旧v1.19.0 catalog显式resetTimeoutOnProgress:true；同样的10000数值不因此获得完整语义等价。只证明本受控输入的固定限时/未续期特征，不声称每条progress已被客户端处理、远端工作停止或通用协议定理。qcTnjM/execution-matrix.json与execution-validation.json含三组原始回执定位、同PID原生ID、精确取消/返回ID、取消前progress写出验证；165本机回归，错ID/缺progress/空调用/旧PID/失败正例拒绝。两个临时Native均停/fence留。

兼容候选保持未应用：需用户决定接受Native同值硬deadline，或要求保留旧进度续期并先评估适配；未答复不改配置，不将characterization PASS当兼容PASS。源码：[Native2.0.32 client](https://github.com/anomalyco/opencode/blob/843a6c514e606b436a7fe713422ace0a93ad3d61/packages/core/src/mcp/client.ts)、[旧1.19.0执行适配](https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/mcp/catalog.ts)。

## Native工具发布屏障与受控单次执行基线（非真实模型验收）

官方v2.0.32 tag已解析为843a6c514e606b436a7fe713422ace0a93ad3d61，先前404是源码布局迁移而非tag不存在。`packages/core/src/tool/mcp.ts`中初始注册异步、更新100ms debounce；无需改权限，先以原生工具表的实际ID/PID建立可见基线。源码URI/SHA在private native-source-v2.0.32-843a6c5.json，不宣称二进制可复现构建。

RG67VO只读观察插件/发布屏障后，同PID工具表与模型请求均含exec_long_exec_long_public_wait。z6Gqgs PID2172746进一步由本地合成SSE驱动：真实Native MCP调用1次wait（1007ms）、下一请求携带public_fixture_exec_long及READY；原deny-all+窄exec规则不变，真实模型0、原MCP0。baseline-validation.json独立复核，execution deadline/progress仍false；这不是原profile/真实双模型/用户ask规则验收。观察插件可能同时触发服务初始化，未单独分离纯时间因果，不认定通用Native race bug。

现有`tests/fixtures/mcp-catalog-metadata.mjs`保留旧plain marker单次捕获，新增JSON请求`{"required_ids":["完整原生ID"]}`：缺目标继续有界轮询、ready为false；只在同Native PID与完整ID确实出现后接受。helper assertNativeMcpPublication拒绝connected-only、raw-name、缺目标及旧PID，不把发布视为权限/执行通过。更新后SYkoHg PID2175430实际shared fixture和模型请求含目标，工具0/真实模型0；162本机回归。三临时Native均停/fence留，主profile/旧服务不动。

源码：[锁定Native MCP发布实现](https://github.com/anomalyco/opencode/blob/843a6c514e606b436a7fe713422ace0a93ad3d61/packages/core/src/tool/mcp.ts)。

## 工具scope请求归属/静态声明对照（仅metadata，未证根因）

56轮只在私有诊断源码运行两次文本DONE回复，无tool-call响应：Dw0i0j动态add、CsBzHi启动前静态声明同一exec_long。两者请求含公开probe、模型qwen3.8-flash-next-local与session override一致、Native tools能力true；global/build/session窄exec_*规则相同。静态case配置文档已见exec_long，模型请求tools仍空，故仅增加静态声明在此fixture不充分。

仅有probe内容不等于主agent归属：session.agent是未设置的override，不把枚举build规则当实际agent已解析；辅助请求可能携带历史，仍不能完全排除。私有CsBzHi/metadata-comparison.json已限定为metadata事实，未保存完整prompt/系统词或凭据。agent目的/实际工具过滤与策略层仍需定位，不能断言Native bug或legacy规则失效。两进程组均停/fence留，真实模型0、MCP工具0，已验工程入口未改。

## 执行timeout合成驱动尚未建立基线（未验，不对外启用）

55轮不占忙碌27B，尝试仅本地合成SSE模型驱动Native MCP无副作用wait；exec_short在工具执行前失败，真实模型0/MCP工具0。initialize/tools-list已发生、所选Native模型tools capability显式复核true，但观察到的合成模型请求工具定义为空；原始工具名称加同一exec_*授权前缀的最后对照也未改变，不能把它当执行deadline试验或Native产品故障。未扩大deny-all+窄prefix grants。

失败roots2hthLn/Jsff9P/FN5wCl/OSwWua保留partial-evidence，OSwWua/evaluation.json及unvalidated-driver-source.mjs保存未验实现。停止此路径，工作入口已精确恢复6a60c31的已验版本（无该实验mode）；159回归不受影响，4个私有Native均停/fence留，旧服务未动。下一高信息量步骤是确认首个请求是否属于目标工具turn（模型ID、是否含公开用户probe、session/agent有效scope），不能再盲改权限/命名；这个诊断缺口不冒充全Goal阻塞。

## Native startup / resource catalog受控deadline（非执行超时）

入口：`node tests/native-mcp-timeout-smoke.mjs PRIVATE_ORIGINAL_JSONC PRIVATE_V2_ARTIFACT_JSON`。复用同一已核实容器和Native2启动器，新私有profile/进程，模型provider只指向本任务trap、global/build deny声明、零prompt/工具执行；不连原MCP，合成HTTP MCP只返回公开元数据。每对只改变相关timeout（200↔3000ms），响应延迟固定1000ms；classic protocol。

| 范围 | 200ms | 3000ms | 本次证据 |
|---|---|---|---|
| startup | initialize于199ms关闭且未完成，超过应答窗后failed | initialize1024ms完成、目录可见 | Dv6KP9 PID2131121 |
| resource catalog | request2在200ms收到匹配notifications/cancelled，客户端无资源 | resources/list1003ms完成、资源可见 | 同Native进程/版本2.0.32 |

cancel不等于断开HTTP或远端停工：合成端故意不服从取消，仍在1004ms完成响应。已证客户端deadline与匹配取消，不宣称远端工作停止。startup/resource-catalog与tools/list目录、tool execution、progress-reset、fallback/per-attempt及原10000全语义分开；其它项仍false。这里不是GPU/质量性能基准，仅本组回环合成输入、单次四case对照。

回执private native-mcp-timeout-Dv6KP9/evidence.json与strict-matrix-validation.json；159本机回归。早期XwTUpz在pending/应答前采样并过早remove，不能判startup通过；96Y9Kb拒绝了“catalog一定断socket”的错误判据。两者raw不改，evaluation.json解释，未改Native或原服务迁就测试。严格helper拒绝早采样、最终pending、无abort、错/迟cancelID和不全矩阵。三个私有Native均停/fence留，临时HTTP fixture关闭；没有把profile opt-in应用到主planner/服务。

## Legacy scalar timeout的版本限定候选（未应用）

公开v1.19.0 tag锁定commit733b2c627e5aec39cb33cc22373bdce33053ef2c：mcp/index.ts中remote/local connectTimeout取mcp.timeout、目录defs和watch传该值、tools() requestTimeout传给catalog.convertTool；catalog.ts执行client.callTool时timeout并resetTimeoutOnProgress:true。它不是单纯catalog配置，不能仅映射catalog或随意省略。public-source URI/逐文件SHA/行段在私有timeout-source-v1.19.0-733b2c6.json；未发送私人代码/配置给Web。

`projectLegacyMcp(source,{timeoutSourceVersion:"1.19.0"})`仅显式版本声明时把已存在正整数scalar映为candidate.timeout={startup:T,catalog:T,execution:T}，通过本机锁定Native schema2.0.32 decode；未知版本拒绝、未指定版本保持原先不猜映射、源缺字段不新增值。它不是自动版本检测，不可用于其它版本。所有路径仍timeout_scope_unresolved=true、progress/runtime等价false；目前主profile planner/运行配置未传该opt-in，未应用到任何服务。156默认回归。

Native官方文档列startup连接/初始化、catalog列表、execution工具/提示/资源读取；本文仅以已装2.0.32 SDK定义验证结构。此前未定位Native2.0.32源码；57轮已锁定官方tag843a6c5（上节），不能再把旧路径404当tag不存在；当前Web文档仍不能代替锁定实现与实测；progress重置、总时限、fallback每attempt及取消行为仍待实测，不因此关闭full profile门槛。

来源：[锁定旧连接/目录路径](https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/mcp/index.ts)、[锁定旧工具执行](https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/mcp/catalog.ts)、[Native timeout文档](https://opencode.ai/v2/docs/mcp-servers#timeouts)。

## 官方DSH连接器隔离验收与实际运行面

`node tests/dsh-official-bridge-smoke.mjs DSH_CHECKOUT PRIVATE_INSTANCE_JSON PROTECTED_COMMIT_RUNTIME API2_BACKEND_JSON`加载已有构建的官方Cordis Context、SystemPrompt、dsh-tools真实服务、dsh-mcp-client真实插件，不mock SDK；参考SDK只读chatgpt caller tools/list作为原始schema对照。临时Gateway仅从canonical ~/.local/share/agent-mcp/releases/<40hex>运行，固定Native2 backend登记，不调用OpenCode/模型。Root/配置/审计均独立，不重启现有实例。

1haNUf实际证据：官方DSH两个独立caller实例取得13个namespace工具，parameters逐项等于raw inputSchema；真实tools.execute完成Host L2创建/写入→L1读取、L1变更isError/L2_REQUIRED，容器Python公开fixture实际UID0，Host envelope aifly-server1/UID1001，CID be7a594d68fedbf75787cf5935f1a7aafe1a614c6d41251ed034a2a0b336514d，task1c76086a-8bed-416b-8e17-860449255536/exit0。官方插件dispose后工具0，再仅在此isolated Context重载工具13且schema完全一致。不是仅参考客户端，也不代表现有CLI/Web/IM已接入。

官方构建文件hash与回执在private shadow/dsh-official-bridge-1haNUf/evidence.json；实际保存数据经identity-verification.json复核，不重放成功业务。Host唯一marker删除，临时39729 listener已关闭，客户端/Context全部dispose；日志对token值脱敏，不改原profile、不启动新Web服务。153默认回归。

现有18879实际只列8core工具，且当前其instance.json没有agents（核心阶段配置），不要把源码13/隔离测试13当现有服务生效，不擅自重启/升级它。未来完成本机profile门槛后再显式启用编排。浏览器host首次及单次本任务reset后均SIGTRAP，匿名现有3080返回401；未读取登录凭据/重试认证/重启DSH。GUI/IM和主应用profile热接入仍NOT TESTED，隔离plugin dispose/reload不等于主应用HMR/页面刷新验收。

## 原MCP的Native实际认证与连接后目录（零执行）

既有Bili --setup-only --top-config-check --bind-container-credential CONTAINER_TOKEN_FILE入口可另加--mcp-readonly，仅允许唯一remote http://127.0.0.1:18878/mcp、oauth=false/codemode=false/disabled=false及原env宏；其它origin/port/query/userinfo/headers均拒绝。仅该测试网络guard额外允许18878；Native解析global/build都必须*deny+acp_status allow，原ask规则只留hidden audit agent，不全局提升。CLI不要当生产切换入口。

ugunTz/gJH0LC Native2.0.32 PID2058941，真实mcp.connect/list状态status.status=connected，实际源Bearer在容器内就地绑定，值不出Host；model0/tool execution0。初始Bili工具快照早于显式连接不能判缺目录；绑定后的signal仅触发同Native进程一次ctx.tool.list，输出id/name元数据、无schema内容/工具调用/新HTTP服务。三个Native IDs为dlvins_container_container_exec、dlvins_container_container_poll、dlvins_container_container_stop，display names是container_exec/poll/stop。旧action glob匹配这些ID只是结构证据，不是permission实际执行语义证明。

只读actual snapshot经严格同PID/工具集合验证，原回执不改，strict-catalog-verification.json补充；153回归。CLQTg0已真实认证但初始snapshot无名称，不能把旧空快照当目录失败。7PGpuv是测试fetch allow-list未列18878而blocked1，不能误判原key失效；没有更换凭据/开放任意网络。MCP连接只在新临时Native中，仍非完整profile/新Gateway13工具执行/原timeout或角色默认等价，原服务不停止不切换。

## 实际默认模型与无副作用工具闭环

`node tests/native-provider-wire-smoke.mjs SOURCE_JSON PRIVATE_ARTIFACT_JSON --provider flash --default-tool-only`不设置Session model、不调用switchModel，以已有默认配置发一个公开READY工具请求。运行前只读Flash queue，observer拒绝未选provider，禁止绕去忙碌27B。lX2zZi/cbyLNQ Native2.0.32 PID2046523，Session ses_ea4f0928dffeaK229HdoDZQGV8，实际模型qwen3.8-flash-next-local，两次SSE200、output8192、工具面仅wire_probe。SSE模型call-id/name、Native PID执行事件（恰1）和下一请求同call-id的READY工具回传三者对应，证明真实调用而非只有schema。只存call metadata，不存reasoning/参数/回答内容。

观察default effort=medium，但旧版本默认effort等价未验，full profile/13项Gateway真实工具仍不由此证明。SessionInfo.model是可选覆盖，不是创建时必有的已解析默认；JvoxWE在0wire前因错误假设该字段存在而退出。修正采样器，默认真实落点由已解析model.default及线上wire约束，而非把可选字段缺失当Native故障。147回归。

## Skills元数据基线与尚待选择的Native接入策略

原4096经exe元数据确认为VSCode Kilo7.7.3入口，不把其401当OpenCode目录API、不读取Kilo密码、不改该入口。只盘点已授权容器两用户根/root/.config/opencode/skills与/root/.agents/skills。官方glob找到64个SKILL.md、32同名逻辑技能，两份各同名文件SHA一致；E8w6gM私有manifest仅路径/身份哈希，无正文。宿主/proc正文read被拒绝后未重试正文通道，未提权；后续既定容器/Native处理仅输出元数据，不回传内容。

`tests/inventory-container-skills.mjs PATHS_JSON PRIVATE_ARTIFACT_JSON NEW_REPORT_JSON`只在固定CID里计算已列文件身份。Native观察入口为Bili smoke的--setup-only --skills-inventory MANIFEST，只列skill API、不调用技能/模型，源码/body不导出。strict verifier遇缺失/未知新增/重复名/不同字节同名拒绝，不允许空基线冒充保留。

实际结果尚未通过严格目录等价：广根o2bWll/883OWD得到32原技能（文件身份一致）+README；每技能目录kG1Y5D/nA3yC8得到32原技能+CHANGELOG/USER_GUIDE/SOURCE；直接64个md文件路径NN1TEs/97dly7得到0原技能。另有2个Native内置逻辑资源OpenCode/Report，path=/builtin/opencode.md及/builtin/report.md，不是OS文件、更不是之前假设的Bunfs路径。原Node sampler stat全目录因此ENOENT，现仅对授权源根做文件hash，内置ID精确核验另列，未知逻辑路径仍拒绝。

因此不继续堆局部scope补丁，不写skills验收PASS。需要人选择：仅原SKILL.md用只读影子索引并验证资源相对路径；或接受Native目录规则附带辅助Markdown条目。两者都不改原技能/Kilo/旧MCP，默认不得擅选。当前helper是诊断/拒绝性门槛，非可发布skills迁移器；项目级技能、原v1有效catalog/优先级、实际调用和资源行为均未验。

## 单provider覆盖与真实附件通道（不替代双模型验收）

Native wire可加`--provider flash`或`--provider 27b`，只运行指定三个effort用例，不把忙碌模型自动换为另一模型。receipt partial+selected/deferred/expected/observed；精确唯一case计数，空/重复/unknown不通过。默认无filter仍要求六项。

Z06ZWw/lOnhr1 Native2.0.32 PID1992598同Session真实Flash low/medium/high各一请求，low/medium/xhigh、stream=true、仅wire_probe、max_completion_tokens8192、SSE200，部分PASS，27B三项仍待。本轮开始27B running3，不占用。

`--provider flash --vision-only`仅运行一个64x64公开确定PNG附件，不重放三项参数业务：1ho8Vf/P786G1 PID1995362 Native files.uri→OpenAI image_url PNG，实际168bytes SHA与fixture一致，Flash low/SSE200/生成完成。后端只读props vision/video=true、audio=false不是视频实测；仅PNG通道通过，识别质量/其它格式/视频/音频未验。原raw case_count0是复用了参数results长度的诊断计数bug，coverage=1且wire1为真实证据；原件不改，counter-supplement.json记录推导，代码已改用coverage，不为改数字重复请求。

## 低占用模型验收与原插件共存准备

Native wire入口 `node tests/native-provider-wire-smoke.mjs SOURCE_JSON PRIVATE_ARTIFACT_JSON` 在每case Prompt前检查真实metrics，忙/未知即退出，不轮询抢槽。当前server1：27B用vllm:num_requests_running/waiting；Flash用llamacpp:requests_processing/deferred；n_busy_slots_per_decode不是当前忙碌。不得只凭health200或缺vLLM字段判空闲。X0A0ft首case忙退出，0Prompt/0wire，六case未验收。未来readiness snapshot在是否busy判定前保存；本次旧raw不补造数值。

不占生成槽的共存入口：`AGENT_MCP_MEM_CACHE_SOURCE=EXISTING_PRIVATE_CACHE node tests/billion-native-v2-smoke.mjs SOURCE_JSON PRIVATE_ARTIFACT_JSON --setup-only --compose-memory`。仅复用现有cache、fresh任务memory DB、CPU两核/offline，不开原DB、不下模型，mem help/list+auto capture off、Bili bootstrap off。YZcUeZ/Hdm2lK同PID1987644两原版本工具各一次，0模型；131回归。不是实际联合模型工具/注入/压缩owner/full profile通过。详见PLUGIN_COMPATIBILITY.md，成功效果不重复做昂贵推理验证。

## 容器就地凭据绑定（不复制令牌到宿主）

原容器MCP PID521412经cgroup确认在dlvins-dev，进程只读元数据给出的CONTAINER_MCP_TOKEN_FILE=/opt/container-mcp/runtime/access-token是容器路径；不是宿主/opt文件，也不是Tunnel control-plane key。后者对MCP返回401，不得混用/继续猜key。

可信backend新增container_credential_environment_files={CONTAINER_MCP_TOKEN:绝对容器文件路径}，仅允许此变量；nativeTarget固定CID/hostnet/mount，Host backend明确拒绝该绑定。`src/credential-environment.mjs`用固定Python descriptor读取：canonical/no-follow/nonblock、当前UID、private模式/regular/single-link、长度/ASCII/前后stat一致；仅该exec子进程os.environ赋值后execv Native。值不进Host进程、argv、shell文本、仓库、报告或日志，Docker全局env不改。路径/变量名是配置引用而非令牌副本，原无绑定backend仍直接执行。失败退出78、定向manager收尾，未增加任意env/LD_PRELOAD/OPENCODE_CONFIG通道。

只读认证：`node tests/native-credential-auth-smoke.mjs SOURCE_JSON PRIVATE_ARTIFACT_JSON CONTAINER_TOKEN_FILE`，在已验证CID内读取原file，仅SDK initialize/listTools/close。YJ9S5G实测schema3工具、tool_calls0、model_requests0，令牌不出容器；原节点未重启。

实际Native展开：原`--setup-only --top-config-check`追加`--bind-container-credential CONTAINER_TOKEN_FILE`，仍强制原MCP disabled，保留真实env宏而非fixture。8QB6X7/Pv1MaB Native2.0.32 PID1975109实测绑定成功；配置/文件比较留在容器，Parent仅收到脱敏metadata，header不落Host。没有启用旧MCP连接，不是完整profile激活/工具授权等价。原timeout/default-role/namespace/插件等门槛保留。

## 权限与原 MCP 声明映射（不等于角色/认证激活）

`deploy/native-policy-projection.mjs`：把源permission按原property顺序展开为Native action/resource/effect数组，allow/deny/ask不变；不插默认授权、不把旧dlvins_container_*重绑成gateway_*，不继承进Host L1角色。MCP映射至mcp.servers，保留server名/URI/headers或argv/env、enabled反转disabled，并要求direct codemode:false；未知字段/未解OAuth/非法类型拒绝。

旧单timeout10000与Native startup/catalog/execution三段作用域未确认，故不猜值，记unresolved；宏引用也仅字面保留并报告未绑定，不读取环境/文件填秘密。源码plan仍不允许激活。

真实Native声明probe bmNkBT/nWV7La PID1961307：原两权限规则只放hidden source_policy_audit，global仍deny；MCP强制disabled=true且headers替换明确非凭据fixture，解析成功/零模型/不连旧服务。118规则回归后补宏引用测试119。此覆盖不是原认证成功。较早2pKDvl/NaIeH0/kxwmVi原headers核对失败保留，秘密无值比较发现仅headers不同，源为CONTAINER_MCP_TOKEN环境宏；容器没有该env、launcher不注入。模板不能直接与展开结果做字节相等验收，必须另验可信凭据绑定。没有把失败改成忽略、没有复制真实key到代码/日志或给进程扩大env。

下一步需明确可信凭据引用/启动作用域及timeout语义、真实角色/工具命名验证。旧MCP配置与服务不动；新Gateway各级caller策略仍独立，不用旧ask/allow隐式扩权。

## Native 模型能力声明（声明解析不等于后端能力）

`deploy/native-model-capabilities.mjs` 统一原模型能力投影：reasoning布尔值严格映射capabilities.reasoning.supported，不添加toggle/effort/budget；tool_call与明确input/output保留。attachment不存在独立Native开关，沿用源明确模态并记账；true但无非text输入继续unresolved，不猜image；false却声明非text输入拒绝，错类型/重复模态/未知模态字段拒绝。后端图片/附件和实际推理行为仍需单独验证。

原源经`--setup-only --top-config-check`在fresh AmEyES/dpixuM Native2.0.32 PID1948089解析：两模型reasoning.supported=true、tools=true、input[text,image]/output[text]、原3variants保留且没有额外variant，零模型请求。111回归。当前行为5阻断仍保留，不能用metadata图像声明当多模态实测。

新增reasoning声明后的6case wire复测本轮未启动：27B当前运行/等待0，Flash metrics未提供可确认的vLLM队列字段；没有把未知当空闲、没有更改或占用模型服务。较早wire receipts保留为历史证据，不伪称已覆盖本次改动。

## Native 顶层投影与 source 保留记账（未开放应用）

`node deploy/native-profile-plan.mjs PRIVATE_NORMALIZED_SOURCE_JSON NEW_PRIVATE_REPORT_JSON --validate-native-schema`：只读源，输出新0600/wx秘密无值的plan，不写运行配置、不启服务。固定schema包2.0.32做严格unknown拒绝。仅投影已知provider声明、默认模型、small_model→agents.title.model（仅title用途）、compaction.auto和schema元数据；permission/plugin/mcp及provider reasoning/attachment语义逐项阻断。未知顶层、混合schema、未知compaction、缺失/禁用/未注册模型均拒绝，不猜测、不静默丢弃。

重要：Native配置模型对象字段是{providerID,model}，Session/Agent API返回引用是{providerID,id}。不能机械混用。schema decode成功只是已映射子集合法，不是full configuration preserved。当前真实源8字段/5阻断，activation_allowed/release_ready均false；不会改变原prepare-opencode-v2.mjs仍为legacy bootstrap-only的事实，也不允许覆盖已有目标。

零推理Native声明核对：`node tests/billion-native-v2-smoke.mjs PRIVATE_NORMALIZED_SOURCE_JSON PRIVATE_OFFICIAL_ARTIFACT_JSON --setup-only --top-config-check`。只用fresh private profile、原插件off-bootstrap诊断，Native config.get和agent.list确认默认/title选择；未生成标题、未证明旧small_model其它消费者。GwfuIK/rBwNRZ PID1941620已通过，model_requests0，106回归。原snapshot SHA前后不变。不得用此跳过原权限/MCP/插件/skills/能力标志及运行wire验收。

## 已核验厂商文件经现有 MCP 最小取回（单一样本隔离验收）

1. `node tests/gateway-context-delivery-smoke.mjs OWNED_NATIVE_ROOT`：从vendor-decompress-export.private.json绑定精确哈希原文件，复制到与控制目录分离的一文档read-only alias，用临时同源码Gateway验证13契约、L1读取/有界检索与写/越界/控制目录/链接/执行拒绝；收尾停止。当前已通过，不必重跑以制造新副本。
2. 已有交付根：`node tests/bili-native-live-resume.mjs OWNED_NATIVE_ROOT PRIVATE_OFFICIAL_ARTIFACT_JSON --gateway-delivery OWNED_DELIVERY_ROOT`：续接同Native/代理数据，model仅gateway_host_search+中性probe；通过官方mcp.add/connect与status.status连接确认后，实际检索一行，不调用compress/decompress/原生FS。收尾移除test MCP、停三服务、恢复私有全局配置。

AGO1oe+context-delivery-tFXlWG真实调用已通过，模型工具结果携带源文件第2435行，审计caller L1单次host_search，源哈希固定；b1保持压缩，不是整块inline展开。100默认回归。当前是固定合成Session/一文档域/独立临时实例验收，不是通用artifact服务或现有生产Gateway的新别名；不支持把本例外推为任意大文件、跨任务多caller准入。source/权限细节见PLUGIN_COMPATIBILITY.md。

## 原 Session 模型检索/厂商解压续验（禁止重压缩与重复导出）

验证入口：`node tests/bili-native-live-resume.mjs OWNED_NATIVE_ROOT PRIVATE_OFFICIAL_ARTIFACT_JSON`。仅接回原控制记录的数据/CID/端口，fresh代理/Native身份，刷新实际PID模型facts，模型只获search_context/decompress/acp_status+中性探针；禁止compress、原生read/shell/execute，decomp只允许该Session+b1+full:true、不接受toFile。

AGO1oe实际重连/模型检索和折叠视图已通过。大块decomp按原0.1.197设计自动写私有临时文件，虽数据可核验，模型上下文没有恢复，整链exit1。超过10000字符自动导出是厂商规则，不是显式toFile字段可禁掉；active不代表是否restoredInline。不得为过关直接放行原生FS或强迫IO错误。

已有vendor-decompress-export.private.json与精确vendor-restored-b1.private.txt证据，入口再次运行会拒绝重复导出。下一步仅评估既有Gateway的受控读取桥接，不能把任意temp/control目录暴露给模型。当前92回归，完整恢复/部署未通过；详情见PLUGIN_COMPATIBILITY.md。

## 原数据精确重启与只读恢复（零模型，不代表完整重连）

- 代理：`node tests/bili-proxy-lifecycle-smoke.mjs PRIVATE_OFFICIAL_ARTIFACT_JSON --resume-root OWNED_PROXY_ROOT --verify-session EXACT_NATIVE_SESSION --search-canary EXACT_CANARY`。从原control绑定CID/私有target/端口，拒锁冲突/链接/外部origin；检查旧marker已停/fence，fresh nonce/PGID/watchdog，保留原config/data/原raw，只写本次UUID收据。恢复态null revision在只读search请求中省略，不伪造、不放宽后续mutation条件。
- Native元数据：`node tests/bili-native-recovery-smoke.mjs OWNED_NATIVE_ROOT`。以原backend/Session精确重启，确认新PID/nonce、同模型variant和历史，零prompt/零新Session；不能当插件已重连。旧relay与PID绑定facts必须在下一次模型调用前重新绑定/核验。

q0xBN6/XGDSde实际恢复active b1且后端search命中；AGO1oe/vxH4vh原Session/模型/历史重启保留。两者均收尾停止/fence保留，88默认回归。下一步把这两份原数据在同一受控联测中重连，Native实际search/decompress/可见正文核对仍未通过，不要重跑compress或长夹具。

## 合成压缩夹具与已有块续验（整链未通过）

`node tests/billion-native-v2-smoke.mjs PRIVATE_NORMALIZED_SOURCE_JSON PRIVATE_OFFICIAL_ARTIFACT_JSON --compression-fixture [--setup-only]` 是隔离验收入口，不是用户日常压缩操作；非setup-only会生成固定合成历史并使用原增长/保护规则。新版compress仅数组/flat，decompress拒显式toFile路径；原版大块仍会自动私有临时输出，不等于模型上下文已恢复。小夹具没有推荐范围时拒绝，不造引用、不降低阈值。

本轮真实nudge已在AGO1oe/vxH4vh、Session ses_ea5a10cbeffe9V2PMpDHPyaOP0生成active b1；命令仍退出1，整链NOT PASS。原string调用被拒后array成功，成功mutation仅1；关键标识保留在摘要是正确行为，不可用它当正文已消失的判据。更新判据为重复原正文行，但尚未实测通过。

下一步必须从`compression-mutation-evidence.json`与该根`owned-proxy.private.json`定位既有q0xBN6/XGDSde数据与Session，精确owned restart后继续search_context/decompress/状态与实际wire核对，不要重放成功compress，不要重新生成长历史。续验脚本仍待实现，不能把本入口当完成交付。原始失败与partial证据见PLUGIN_COMPATIBILITY.md；84默认回归。

## Native 与自有 bili 代理联测（路由/身份/状态，不是压缩验收）

入口：`node tests/billion-native-v2-smoke.mjs PRIVATE_NORMALIZED_SOURCE_JSON PRIVATE_OFFICIAL_ARTIFACT_JSON --owned-proxy [--setup-only]`。内部先启动精确owned前台代理，再启动私有Native，relay只记录模型/Session/限额/工具名和响应状态，不保存prompt/response/鉴权；收尾Native→relay/observer→proxy，EOF及非零cleanup均处理。--setup-only不生成模型请求。

QxbnCP/Tn36E4实际2条请求均Session/模型/262144/8192正确，原acp_status真正执行并得到可用面板，真proxy按Native SID查询也ok。测试只暴露acp_status及中性bili_probe_ready，不开压缩/shell/execute；原插件包未改。

需显式保留的适配：ACP-only工具会被原proxy当泄漏工具剥离；中性工具避免该测试假象。首请求原异步窗口缓存缺头，用实际Native API PID绑定事实只补缺值、拒矛盾。禁止复活备用proxy采用原BILLION_CONTEXT_NODE非执行私有文件+内核EACCES自检，不使用失败的Bun monkeypatch，不是通用exec沙箱。详见PLUGIN_COMPATIBILITY.md，80默认回归。业务压缩/解压/恢复、完整配置及正式部署仍待，不得凭此切换旧服务。

## 独立自有 bili 前台代理生命周期（真实代理，不替换旧实例）

入口：`node tests/bili-proxy-lifecycle-smoke.mjs PRIVATE_OFFICIAL_ARTIFACT_JSON`。精确校验已有container ID/boundary，以现有Node22.23.2/builtin SQLite和0.1.197包直接前台start（不走默认发现/attach/detach）。新私有HOME/XDG/TMP/config和严格回环随机端口；禁下载/升级/advisory/release/MITM，父watchdog是同owned进程组shell而不是伪造外部PID。

先OS验证leader epoch/child epoch/PGID/exe/private env，再比health pid/version/watchdog/instance；只测空状态，不发模型请求。TERM时父进程等待子进程，保留精确KILL锚；child exec前检查cancel fence，停止后有界确认监听及该子进程epoch均消失。最终PU6h0w/2diKfH evidence/identity/config元数据私有留存，model_requests0。

18787原先不可达，报告not-observed/null，不虚称其健康或身份保持；不尝试处理旧进程。真实proxy生命周期通过不代替Native接入/压缩/恢复等功能验收，详见PLUGIN_COMPATIBILITY.md。

## 现有 billion V2 无代理诊断（仅装载/权限门槛）

入口：`node tests/billion-native-v2-smoke.mjs PRIVATE_NORMALIZED_SOURCE_JSON PRIVATE_OFFICIAL_ARTIFACT_JSON [--setup-only]`。原0.1.197原位装载，导入前BILI_NATIVE_OPENCODE=0关闭自动proxy拉起，保留plugin enabled以真正执行V2 setup；不使用旧proxy hint。只放行acp_status，默认模型实际调用一次，得到no proxy detected才按诊断通过；--setup-only不生成模型请求。

必须区分原6个tool声明与实际仅1个Bili注册/model-visible状态工具。源fixture已修正早期registered_tools命名，原始5Yb5MD收据仍原样保留，probe/event/wire独立对证。72默认回归含4项反假阳性控制：spawn/attach/respawn、意外fetch、其他ACP工具泄漏、模型口头叙述/错误结果不能被接受。真实proxy可用、压缩/恢复/单owner链仍未验证，不能据此替换旧配置。详见PLUGIN_COMPATIBILITY.md。

## 原生 provider 六档真实请求验证（当前限定范围）

入口（仓库cwd）：`node tests/native-provider-wire-smoke.mjs PRIVATE_NORMALIZED_SOURCE_JSON PRIVATE_OFFICIAL_ARTIFACT_JSON`。只在新自有profile加载原生providers/package/settings；两只回环观察器分别原样转发至既有同模型路由18100/18181，模型ID不符在转发前拒绝，不改请求body，不保存prompt/response正文或鉴权头。只有fixture只读wire_probe可见，其他工具/execute拒绝。

实际8q0ugC/h9gYo5、Native2.0.32 PID1832315/UID0、同一Session ses_ea5e35caaffenpwa41FGUbhwQ1：27B、Flash各low/medium/high共6case，逐档SDK switchModel后只发一次无业务动作READY，各一条请求。全部HTTP200、真实SSE数据chunk>0、stream=true，reasoning_effort为low/medium/xhigh，max_completion_tokens8192。实际转换模型/variant及Session ID均校验；原default Flash在显式Session选择前按API核验。未启第二模型作故障fallback，也不是模型能力/独立质量对比。

原始私有evidence.json/progress.json保存在/home/wkw/.config/agent-mcp/native-provider-wire-8q0ugC；只含参数/响应状态/计数，无正文和凭据。tests/helpers/native-wire-check.mjs对请求ID/variant、真实SSE、整数chunk、精确只读tool集、输出预算（含双token字段冲突）做确定性断言，负对照进入默认套件。收据可离线复核，无需重复推理；本轮已对6条真实旧收据用强化断言复核通过。

此通过的是原生候选的实际发送参数与响应流，不证明GPU内部如何解释effort、长上下文质量或small_model语义。原projection-ledger为纯声明不能自行宣称wire已验，须配此运行收据；完整原配置/插件/skills/Host/lap1/前端/发布仍未由此完成。测试管理器与两观察器均退出，旧入口未动。

## 原生 provider 声明投影（有限验证，不是完整配置）

内部映射 `deploy/native-provider-projection.mjs` 按已核对官方类型转换：provider→providers、npm→package、options→settings、model.options→model.settings、tool_call→capabilities.tools、modalities→capabilities.input/output、limit保留、variants字典→{id,settings}数组。已实测的兼容包由@ai-sdk/openai-compatible显式映射为原生@opencode/ai/providers/openai-compatible；不能只机械改npm字段名。未知provider/model/limit字段及未映射cost/variant控制字段拒绝，不悄悄吞掉。

验证入口（仓库cwd）：`node tests/native-provider-projection-smoke.mjs PRIVATE_NORMALIZED_SOURCE_JSON PRIVATE_OFFICIAL_ARTIFACT_JSON`。输入私有原快照和已验证2.0.32 artifact，仅在全新自有容器profile装载providers/package/settings原生结构，无provider/npm/options旧别名，不生成模型请求；检查API返回package、所有源provider/model设置、名称、上下文/输出、modalities/tool capability、三档variant设置、原default模型。输出路径和布尔计数，不打印凭据；输入快照/候选仅私有0600存储。只停止该测试manager。

实际结果N8f2MH/gJ68KM：2provider/2model、262144context/8192output、low/medium/high声明、原default Flash均API核对PASS；UID0/PID1826476/Native2.0.32，服务已退出。初始按旧npm字面值对比失败，实际API解析记录确认原生包标识后才更新映射，没有用放宽断言掩盖未知差异。evidence.json为结果，projection-ledger.json逐项留未完状态。

reasoning/attachment原旗标尚无完整语义等价证明，只保留在原私有快照并在ledger提示；small_model运行映射、原MCP/plugins/skills/permissions/其他顶层设置未由此投影完成，此前variants仅API元数据，本页上方新增的独立运行收据已补原生候选实际wire证据（纯投影ledger本身不自动升级）。release_ready=false。其他provider可保留声明，但其包/运行行为未经本双本地模型探针验证。现有bootstrap准备器/正在运行实例本轮均未替换为此投影。

## 原配置保留审计（正式接入前门槛）

`node deploy/audit-config-preservation.mjs PRIVATE_ORIGINAL_JSON PRIVATE_CANDIDATE_JSON NEW_PRIVATE_REPORT_JSON [PRIVATE_ROUTES_JSON]`

输入为私有、已正规化JSON快照（不是直接执行任意JSONC/插件）；只读比较输入，报告wx/0600，不覆盖现有报告/输入，不打印凭据值、动态provider ID、skills路径或未知字段值。可选routes映射27b/flash，缺省S3标准18100/18181。比较仅允许两个已知URL调整，检查所有原字段/provider/model/variants及未知字段；新增provider不当成原字段丢失。输出只是legacy源内容对账：raw字段相等不等于V2有效；native mapping/runtime/skills/plugin behaviour/release_ready始终未代为批准。native providers声明也不等于package/settings有效。

当前4099 bootstrap实际对账：2/2 provider原内容、默认/小模型原字段保留；原2插件变0，MCP与permission不同（bootstrap有意收紧，不误报为未知bug，也不能冒充完整保留）；source skills/tools无显式字段不代表磁盘skills不存在。结果 /home/wkw/.config/agent-mcp/config-preservation-N6NCuk/audit.json。完整V2映射/原插件+skills及实际行为仍需后续验收。

`prepare-opencode-v2.mjs`后续准备自动产出preservation-audit.json并标记full_configuration_preserved=false/native_mapping_verified=false/bootstrap_only=true。仅接受全新目标：目标config已存在即在写入前FRESH_V2_TARGET_REQUIRED_NO_OVERWRITE，不原位覆盖运行或停止的实例。已对实际4099目标做拒绝负测，前后hash相同；没有重新准备/修改该实例。成功准备新目标分支本轮未再次运行。

现有SDK2.0.26原生Config类型暴露providers、plugins、skills、permissions和model；该类型中无直接small_model字段。这不是2.0.32运行时必定删除small_model的证据（可能有兼容翻译），所以必须验证原小模型语义的实际映射/调用，不能仅复制旧key后声称保留。两份原件明确要求providers/package/settings原生结构；当前legacy alias可运行不抵消该门槛。

## 入口
- 安装：bash deploy/install.sh <git-tag-or-commit> <absolute-private-instance.json>。只准备独立 Release，不启动服务、不切隧道。
- 不从源码目录手工启动production Gateway。隔离调试必须使用独立私有fixture与空闲测试端口；正式运行统一经`deploy/local-stack.sh`，避免第二个Gateway/advisor/Tunnel进程占用同一入口。
- 本机单栈：`bash deploy/local-stack.sh preflight <release>`只读校验配置与release；`cutover <release>`切换到唯一`agent-mcp.service`，同时迁移advisor MCP/Tunnel并保留Tunnel ID；`verify`核对Gateway身份、advisor工具和Tunnel ready。失败会自动尝试恢复旧代码。
- 回归：`npm test`包含Gateway、advisor、L1/L2配置和fake-systemd服务管理测试；`npm run test:advisor:lifecycle`只用fake Tunnel与临时目录，不调用模型。
- 升级：`bash deploy/install.sh <commit> ~/.config/agent-mcp/instance.json`准备immutable release；`bash deploy/upgrade.sh <commit> ~/.config/agent-mcp/instance.json`只切换current指针，随后用`deploy/local-stack.sh cutover`完成已批准的本机入口切换；不改OpenAI Tunnel配置或DSH profile。
- 回滚：`bash deploy/local-stack.sh rollback <manifest>`恢复旧Gateway代码并使用同一中央配置与Tunnel ID；`deploy/rollback.sh`只恢复release指针，不负责运行时切换。

## 凭据
Tunnel控制平面API key仅通过中央配置 existing_tunnel.api_key_file 引用本机0600文件；它与容器MCP Bearer分属不同认证域。容器token继续独立保存在dlvins-dev容器内。凭据值不得进入源码/日志/报告，不跨机器复制；existing_tunnel.id保留当前Tunnel ID。Gateway caller.token_file必须由当前UID持有、权限0600、至少32字符；不同身份使用不同token，不得把模型key当MCP token或复用Bearer到不可信服务。

## 本机统一配置、参考客户端与模型配置保全

- `node deploy/prepare-local-instance.mjs --dry-run`：核对当前本机Gateway/advisor/Tunnel进程，规划唯一私有配置`~/.config/agent-mcp/instance.json`；保留既有caller token、后端引用与Tunnel ID，不显示密钥。移除`--dry-run`后仅在目标不存在时以0600创建；不启动或停止服务。
- `node deploy/validate-instance.mjs /absolute/private/instance.json /absolute/release-dir`：只读检查统一实例配置、caller层级、Host/advisor roots与容器边界；不启动服务、不调用模型。
- `node deploy/merge-opencode.mjs <existing-json> <router-urls-json> <new-private-output>`：只改两个既有provider的baseURL，保留default/small_model/variants/skills/MCP/其他provider及凭据引用，输出新0600文件；不覆盖原件，不自动重启Server。当前只接受可由JSON.parse读取的V1配置，真正JSONC或V2需用相应解析器/适配器，不机械覆盖。
- 参考客户端使用`config/client.example.json`。`node src/client.mjs schema`输出同一工具契约；调用参数从stdin读取，token仅从文件读取；不是ChatGPT或DSH插件真实调用证据。

## DSH / ChatGPT 接入与验收边界

- 官方客户端已核查：`@deepseek-ai/dsh-mcp-client`使用`transport: streamable-http`、`serverName/url/headers/toolCallTimeoutMs/failOnStartupError`；工具名为`mcp__<serverName>__<rawName>`。现有Web profile已用同一插件及`!!js`读取私有token文件，不能把整个profile替换成候选片段。
- `node deploy/dsh-config.mjs <private-client.json> <new-absolute-candidate.yml>`只生成新的0600候选，不读token值、不修改现有DSH、不停止服务。候选命名空间默认`agent_gateway`；本项目不切换DSH profile。
- 可选隔离接缝测试：设置`DSH_MCP_PLUGIN_ENTRY`为本机实际安装的MCP client模块，设置`AGENT_MCP_CLIENT_CONFIG`后运行`node tests/dsh-bridge.mjs`。已验证官方apply/register/execute/dispose和实际/tmp CRUD；测试使用隔离registry，不是当前Web/CLI/IM进程。第二台需核查其实际DSH插件版本，不硬依赖server1 checkout。
- CLI/Web/IM要相同L2，由同一本机Gateway的dsh caller策略保证；需要分别接入相应profile或实际共享的工具registry。源码支持effect-scoped连接生命周期不等于本机profile watcher已实测；未承诺无需刷新/重启就会自动生效。
- 本机切换保持同一Tunnel ID与127.0.0.1:8787/mcp目标；不改OpenAI侧配置、不注册新Tunnel。Tunnel /readyz和本地MCP tools/list通过后，ChatGPT Web真实任务仍须单独验证；本次不改DSH profile或运行DSH GUI。
- `node deploy/tunnel-inventory.mjs <new-private-absolute-json>`只读取当前用户官方runtime进程的元数据，筛选8787/18878目标；ID及key文件引用仅存私有文件，不读取/复制API key值。server1已确认2条既有隧道，私有清单`~/.config/agent-mcp/shadow/tunnel.inventory.json`；未选择、停用或切换任何一条。第三方SiYuan隧道不纳入该清单或操作。

## 运行与故障
healthz 仅报告活性，不表示功能验收。MCP POST /mcp 需 Bearer；工具错误统一 {ok:false,request_id,code}。审计仅记录时间、caller、级别、工具、状态和耗时，无参数/输出/密钥。任务重启丢失；容器ID在执行时固定，轮询按caller限制。

## 同版本离线源码交接包

`bash deploy/package.sh <verified-commit-or-tag> <artifact-dir>`生成Git bundle、manifest和SHA-256校验文件，仅含受版本控制的源码/历史，不含node_modules、实例配置、token、Tunnel key或会话数据。打包不等于完整验收，且不会上传远端或执行部署。若输入为tag，包保留该tag和原始commit。

接收机先校验SHA-256，再`git clone --branch release <bundle> <source-dir>`并核对`git rev-parse HEAD`等于manifest commit；若包含tag，`git checkout --detach <tag>`后再核对。随后在自己的Node/Python/Docker环境运行npm ci、npm test，以本机私有instance执行install和live smoke。**不能从被容器RW挂载的源码目录直接启动Gateway**。`v1.3.0-shadow-core.1`仅为当前core测试候选，明确不是整套v1.3通过标签。

## 迁移 lap1
使用完全相同tag，单独填写instance。现场查hostname/UID、容器与挂载、LAN/TS、已有隧道与模型地址；不得复制server1 token/key。先npm test、smoke，再验证两模型路由/Agent/双客户端，未经实测标NOT TESTED。不要求改DSH版本。
