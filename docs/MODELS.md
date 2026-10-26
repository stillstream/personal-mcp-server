# 两模型路由与实测

事实进度统一以[ACCEPTANCE](ACCEPTANCE.md)为准；本文只给使用入口和当前模型证据。模型服务启动参数、GPU分配均未改动。

| 模型 | 上游端口 | 稳定本机Router | 服务配置上下文 | 当前模式 |
|---|---:|---|---:|---|
| Qwen3.8-27B-NVFP4-RTX5090 | 18000 | http://127.0.0.1:18100/v1 | 262144（服务max_model_len） | local |
| qwen3.8-flash-next-local | 18081 | http://127.0.0.1:18181/v1 | 262144（props n_ctx，单slot） | local |

上述配置不是最大长上下文实用性评测。保留两个原有provider/model ID，网络失败绝不换成另一模型。

## 路由

使用Ubuntu发行版HAProxy2.8.16，用户目录解包运行，未apt安装系统包、未启停系统HAProxy服务。既有通用HAProxy 18100/18181配置保持不变；当前server1 Host/Container OpenCode Server profiles绕过该通用路由，直接使用本机loopback模型端口18000/18081，因此本阶段不使用Tailscale。lap1后续再根据最终代码单独配置/验收。

- 健康检查只读/health，fall/rise均2；连接超时2s，生成/流式15min；retries=0且不配置redispatch。
- 在独立测试代理中，两模型分别模拟LAN失效/恢复，以及local→LAN→Tailscale→local，均自动切换**新请求**。没有改变生产网络或停止真实模型。
- 真实HAProxy验证SSE在上游尚未完成时已送出首片；流中断不把Prompt重放到backup；所有线路失效返回JSON503 MODEL_NETWORK_UNAVAILABLE。另一个模型不受影响。
- stats报告UP 1/2仍属于可用状态，不能提前误报已切备用；该滞回状态已加默认单测。

## 使用入口

输入：本机私有router instance（示例config/router.instance.example.json），填写实际IP、用户端口及HAProxy路径。不能把server1私有配置/凭据复制到lap1。

1. 生成：node deploy/router-config.mjs /private/router/instance.json /private/router/haproxy.cfg（仅创建新文件）。
2. 校验/启动：/private/haproxy -c -f /private/router/haproxy.cfg；/private/haproxy -db -f /private/router/haproxy.cfg。实际server1当前由DSH自建job59管理，未替换任何旧服务。
3. 查询：node deploy/router-status.mjs /private/router/instance.json。输出每模型的local/LAN/Tailscale/unavailable、各线路健康和最后失败原因。
4. 诊断：先health/models，再看stats；服务1日志为~/.config/agent-mcp/router/haproxy.log，仅健康/错误元数据，不记录Prompt或Authorization。

## 已验证与限制

- 两模型在server1对loopback、LAN地址、TS地址的真实非流式请求均PASS；分别经Router的真实SSE及auto工具调用PASS。
- Flash经Router识别64×64纯红/纯蓝两幅合成PNG均正确；只代表该最小图像链路，不是视觉准确率基准。
- Flash初次120s超时保留FAIL记录。诊断时单slot正在处理DSH进程的94223-token上下文、n_predict32768；本任务长子Agent取消并确认空闲后，以新唯一请求逐项复验全部PASS，未重启DSH/模型。健康200不代表队列空闲，也不能把生成排队当网络故障。
- 28项默认单测、真实HAProxy完整故障矩阵及无重放测试通过。原始证据/tmp/agent-mcp-routes-25aUL6，模型私有收据位于~/.config/agent-mcp/router/model-probe.jsonl和flash-idle-probe.jsonl。
- OpenCode全局原配置hash保持不变，独立Server实际保留default Flash/small_model 27B；其原有billion-context集成把路径包装成127.0.0.1:18787/bili/<Router URL>，该既有链路予以保留，不再叠加另一套代理或压缩库。
- 三档variants在配置中保留，**实际请求参数验证尚待**；lap1实际跨机调用/自动主备尚待，不能把本机访问LAN/TS地址当跨机通过。
