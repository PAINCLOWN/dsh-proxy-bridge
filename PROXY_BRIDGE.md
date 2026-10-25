# DSH Proxy Bridge — 指令说明

`proxy_bridge` 是 DSH 插件注册的管理工具，用于控制反向代理 bridge。
Bridge 监听 `0.0.0.0:3083`，将 HTTP + WebSocket 转发到 DSH web 服务器（`127.0.0.1:3080`），
位于 nginx/TLS 之后，使 GUI 可从局域网和互联网访问。

## 指令列表

| 指令 | 作用 | 参数 | 说明 |
|------|------|------|------|
| `status` | 查看状态 | 无 | 只读，显示运行状态、端口、上游、协议、认证模式。默认指令。 |
| `enable` | 启动 bridge | `port?` | 启动监听器。幂等——已运行时无操作。 |
| `disable` | 停止 bridge | 无 | 停止监听器。幂等——已停止时无操作。 |
| `restart` | 重启 bridge | 无 | 先停后启。配置变更（端口、TLS）后使用。 |
| `config` | 更新配置 | 见下 | 更新任意配置项，持久化保存，跨 DSH 重启生效。 |

## 配置字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `port` | number | 3083 | bridge 监听端口 |
| `dshPort` | number | 3080 | 上游 DSH 端口 |
| `password` | string | — | bridge 登录密码（最少 8 位；空字符串清除） |
| `dshSecret` | string | — | DSH 浏览器会话密钥，用于自动注入 DSH 认证 cookie |
| `secureCookies` | boolean | false | 为会话 cookie 添加 Secure 标志（HTTPS 后启用） |
| `tlsEnabled` | boolean | false | 在 bridge 上启用自签名 TLS |
| `tlsDays` | number | 365 | 自签名证书有效期（天） |
| `tlsHosts` | string[] | [] | 自签名证书 SAN 主机名，如 `["dsh.poxx.top"]` |
| `lanCidrs` | string[] | [] | 受信任的局域网 CIDR，如 `["192.168.0.0/16"]` |
| `lanPasswordless` | boolean | false | 允许局域网/回环源跳过 bridge 登录 |

## 典型场景

```
# 查看状态
proxy_bridge status

# 启动 / 停止
proxy_bridge enable
proxy_bridge disable

# 改端口（需重启生效）
proxy_bridge config port: 3084
proxy_bridge restart

# 启用 TLS
proxy_bridge config tlsEnabled: true tlsHosts: ["dsh.poxx.top"] secureCookies: true
proxy_bridge restart

# 设置 DSH 密钥（自动注入认证 cookie）
proxy_bridge config dshSecret: "your-secret-here"

# 允许局域网免密
proxy_bridge config lanCidrs: ["192.168.0.0/16"] lanPasswordless: true
```

## 故障排查

- **WS 403 通过代理**：先 `status` 确认 bridge 运行中。bridge 只转发 `/api/remote.mux` WS 升级请求；确认 `dshSecret` 已设置以注入 cookie。
- **Models 标签页不可用**：检查 `dshSecret` 是否正确（应与 `~/.dsh/.credentials.yaml` 中的密钥一致）。
- **端口冲突**：`netstat -tlnp | grep 3083` 查看占用，用 `config port` 换端口后 `restart`。

## 架构

```
Internet/LAN → nginx (TLS 443/11007) → gateway (3081) → bridge (3083) → DSH (3080)
```

- Bridge 信任上游终结器（nginx），跳过严格的 same-site 检查，WS 升级干净中继
- 只转发 `/api/remote.mux` WebSocket 升级，其他 WS 路径返回 404
- 自动为请求注入 DSH 认证 cookie（3 段格式：`v1.<payload>.<hmac>`）
- 登录页：`POST /__bridge/login`，密码保护，速率限制 5 req/min/IP
