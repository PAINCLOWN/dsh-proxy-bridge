# @painclown/dsh-proxy-bridge

轻量级 DSH 反向代理桥，专为 nginx 等 TLS 终结反代后面的 WebSocket 转发设计。

> 理念参考 [@riceawa/dsh-lan-gateway](https://github.com/rice-awa/dsh-lan-gateway)，感谢 riceawa 的启发。

## 解决什么问题

DSH Web GUI 的 WebSocket 连接在通过 nginx → 网关 → DSH 链路时会因 Origin/Host 不匹配返回 403。本插件跳过 same-site 检查，信任上游终结器（nginx）做访问控制，直接转发 HTTP + WebSocket 到 DSH。

## 架构

```
浏览器 ──HTTPS──> nginx (TLS 终结) ──HTTP──> Bridge (0.0.0.0:3083) ──HTTP──> DSH (127.0.0.1:3080)
                                              │
                                              ├── 密码门 (可选)
                                              ├── DSH Cookie 自动注入
                                              ├── WebSocket 透传 (raw TCP splice)
                                              └── 速率限制 / 会话撤销
```

- **HTTP**: 转发时重写 Host/Origin 到 `127.0.0.1:3080`
- **WebSocket**: socket 直接 splice 到上游，无 same-site 检查
- **密码门**: 可选的第二层认证（在 nginx 之上）
- **DSH Cookie 注入**: 自动为请求注入 DSH 认证 Cookie，无需手动处理 DSH 登录

## 安装

```bash
# 通过 DSH 插件命令安装
dsh plugin --profile web add @painclown/dsh-proxy-bridge

# 或手动安装
cd ~/.dsh/profiles/web
npm install @painclown/dsh-proxy-bridge
```

## 快速开始

```
# 1. 启用桥（默认 3083 → 3080）
proxy_bridge enable

# 2. 设置密码
proxy_bridge config password=dsh2026

# 3. 配置 DSH Secret（从 ~/.dsh/.credentials.yaml 读取）
proxy_bridge config dshSecret=<your-secret>

# 4. 检查状态
proxy_bridge status
```

## 命令

| 命令 | 说明 |
|------|------|
| `proxy_bridge status` | 查看桥状态 |
| `proxy_bridge enable` | 启动桥 |
| `proxy_bridge disable` | 停止桥 |
| `proxy_bridge restart` | 重启桥 |
| `proxy_bridge config` | 更新配置 |

### 配置示例

```
# 设置密码（至少 8 位）
proxy_bridge config password=dsh2026

# 配置 DSH Secret（自动注入 DSH 认证 Cookie）
proxy_bridge config dshSecret=vGIxivMEJblP1teRqVymk6sefy7wHMzxds9T0Unv6rE

# 启用自签名 TLS
proxy_bridge config tlsEnabled=true tlsHosts=["dsh.poxx.top","192.168.123.254"]

# 允许 LAN 免登录
proxy_bridge config lanPasswordless=true lanCidrs=["192.168.123.0/24"]

# 清除密码
proxy_bridge config password=
```

## 配置字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `false` | 是否启动监听 |
| `port` | number | `3083` | 监听端口 (0.0.0.0) |
| `dshPort` | number | `3080` | DSH 上游端口 |
| `password` | string | `''` | 密码门（空 = 无密码） |
| `cookieName` | string | `dsh_bridge_auth` | 会话 Cookie 名 |
| `cookieMaxAgeDays` | number | `30` | Cookie 有效期（天） |
| `dshSecret` | string | `''` | DSH browser-session secret |
| `secureCookies` | boolean | `false` | Cookie 加 Secure 标志 |
| `tlsEnabled` | boolean | `false` | 启用自签名 TLS (HTTPS) |
| `tlsDays` | number | `365` | 自签名证书有效期（天） |
| `tlsHosts` | string[] | `[]` | 证书 SAN 主机列表 |
| `lanCidrs` | string[] | `[]` | 信任的 LAN CIDR |
| `lanPasswordless` | boolean | `false` | LAN/loopback 源免登录 |

## 安全特性

### 密码门

- 设置密码后，所有请求必须携带有效会话 Cookie
- 登录页：`/__bridge_login`（GET 显示表单，POST 验证密码）
- 登出：`/__bridge_logout`（POST 撤销当前会话）
- 速率限制：每 IP 每 60 秒最多 5 次登录尝试
- 密码使用 scrypt 哈希存储，明文不保存

### 会话管理

- 每个会话有唯一 ID（16 字节随机数）
- 会话 Cookie 使用 HMAC-SHA256 签名
- 登出只撤销当前会话，不影响其他
- 修改密码递增 epoch，撤销所有会话
- 状态持久化到 `~/.dsh/proxy-bridge/state.json`（0600 权限）

### DSH Cookie 注入

当客户端请求不携带 `dsh-auth-*` Cookie 时，Bridge 使用配置的 secret 自动生成并注入，使 DSH 认证透明化。

## 文件结构

```
~/.dsh/proxy-bridge/
├── state.json          # 持久化状态（Cookie secret、密码哈希、会话 epoch、已撤销会话）
└── tls/
    ├── selfsigned.crt  # 自签名证书（tlsEnabled=true 时生成）
    └── selfsigned.key  # 私钥
```

## nginx 配置示例

```nginx
server {
    listen 11007 ssl;
    server_name dsh.poxx.top;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3083;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 支持
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout 86400;
    }
}
```

## 开发

```bash
# 构建
npx tsdown

# 部署到 DSH profile
rm -rf ~/.dsh/profiles/web/node_modules/@riceawa/dsh-proxy-bridge/lib/
cp -r lib/ ~/.dsh/profiles/web/node_modules/@riceawa/dsh-proxy-bridge/lib/
```

### 源码结构

```
src/
├── index.ts            # 插件入口，工具注册，生命周期管理
├── proxy.ts            # 核心代理逻辑（HTTP 转发 + WS 透传 + 认证）
├── auth.ts             # 源分类、会话签名、速率限制
├── state.ts            # 持久化状态（scrypt 密码、Cookie secret、会话管理）
├── tls.ts              # 自签名证书生成和加载
├── login.ts            # 登录页渲染、登出路径、速率限制处理
├── config-fields.ts    # 配置 schema
└── client/
    ├── index.ts        # 客户端入口
    └── bridge-card.tsx # React 配置卡片
```

## 与 dsh-lan-gateway 的区别

| 特性 | dsh-lan-gateway | dsh-proxy-bridge |
|------|----------------|-----------------|
| Same-site 检查 | 严格（Origin/Host 必须匹配） | 跳过（信任 nginx） |
| 适用场景 | 直接暴露到 LAN | 放在 nginx 后面 |
| WS 403 问题 | 需要配置 Origin 白名单 | 自动解决 |
| DSH Cookie 注入 | 无 | 有 |
| 复杂度 | 较高（request policy、upstream session） | 较低 |

## License

MIT
