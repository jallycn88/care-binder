# 家人病历管理（Care Binder）

部署在飞牛 NAS 上的家庭病历管理工具。游戏化书柜主界面 + 白大褂医生立绘 + 资料册，点击进入家人的病历页，支持资料上传与书本翻页动画。

## 技术栈

- 前端：Vue 3 + Vite，原生 CSS 3D 翻页
- 后端：Node.js 22 + Express + 内置 `node:sqlite`（零原生依赖，ARM 友好）
- 部署：飞牛 NAS 原生 `docker compose` 构建 arm64 单架构镜像
- 访问控制：账号 + 密码登录（Cookie Session，环境变量 `APP_USER` / `APP_PASSWORD`）

## 目录结构

- `server/` — Node 后端（API、鉴权、数据库、上传）
- `frontend/` — Vue 3 前端，`frontend/public/assets/` 为 AI 生成的美术素材（WebP）
- `deploy/` — 预留扩展
- `docs/` — 环境验证清单与开发计划

## 飞牛 NAS 部署步骤

**前置**：飞牛 NAS 已开启 Docker（飞牛应用中心安装 Docker 管理器），架构为 `aarch64`（RK3566），并已开启 SSH。

**第一步：把代码放到 NAS 上（二选一）**

- **方式 A（推荐，无需 git）**：把 `care-binder-deploy.tar.gz` 通过飞牛文件管理器上传到 `/vol1/1000/docker/`，然后 SSH 登录 NAS 解压：
  ```bash
  cd /vol1/1000/docker
  mkdir -p care-binder
  tar -xzf care-binder-deploy.tar.gz -C care-binder
  cd care-binder
  ```
- **方式 B（有 git 仓库时）**：
  ```bash
  git clone <你的仓库地址> /vol1/1000/docker/care-binder
  cd /vol1/1000/docker/care-binder
  ```

**第二步：准备数据目录**（病历文件与数据库都在这里，重装不丢）：
```bash
mkdir -p /vol1/1000/docker/care-binder/data
chown -R 1000:1000 /vol1/1000/docker/care-binder/data
```

**第三步：设置账号密码**（**密码务必修改**，并建议设置会话密钥），创建 `.env`：
```bash
cat > .env << 'EOF'
APP_USER=admin
APP_PASSWORD=换成你的强密码
SESSION_SECRET=换成一段随机长字符串
EOF
```
- `APP_USER` 不填默认 `admin`；`SESSION_SECRET` 不填会自动生成并持久化，多实例部署才必须显式设置。
- 密码用 12 位以上、含大小写字母+数字+符号的强密码。

**第四步：构建并启动**（在 NAS 原生 arm64 构建，约 1-3 分钟）：
```bash
docker compose up -d --build
```

**第五步：访问**：浏览器打开 `http://<NAS的IP>:31688`，输入账号密码进入书柜。

> 如果打不开：检查飞牛 NAS 防火墙/安全设置是否放行 31688 端口；用 `docker compose logs -f` 看启动日志。

### 常用运维

```bash
docker compose logs -f          # 查看日志
docker compose restart          # 重启
docker compose down             # 停止（数据保留在 data/）
docker compose up -d --build    # 更新代码后重新构建
```

### 备份

直接备份 `/vol1/1000/docker/care-binder/data` 目录即可——内含 `care-binder.db`（元数据）和 `uploads/`（病历文件）。

## 本地开发

```bash
npm install                       # 后端依赖
npm --prefix frontend install     # 前端依赖
npm run build                     # 构建前端到 frontend/dist
APP_USER=admin APP_PASSWORD=devpass npm start    # 启动服务 http://localhost:31688
```

前端热更新开发：`npm --prefix frontend run dev`（API 代理已配到 31688 端口）。

## 安全说明

- 病历数据、数据库、`.env` 均已被 `.gitignore` 排除，不会进 git 仓库
- 登录账号与密码都不硬编码，仅从环境变量读取（账号默认 `admin`，可用 `APP_USER` 自定义）
- **防暴力破解**：同一 IP 连续输错 5 次密码会临时锁定 15 分钟；成功登录后计数清零
- **密码强度**：启动时会检测弱密码（过短/纯数字/常见口令）并告警，请使用 12 位以上、含大小写字母+数字+符号的强密码
- **会话安全**：登录有效期 7 天；会话签名密钥与登录密码解耦（自动生成并持久化到数据目录，可用 `SESSION_SECRET` 指定），降低 token 泄露风险
- 文件类型白名单 + 80MB 大小限制；文件路径隔离到各自资料册目录
- 建议仅在家庭内网使用；如需外网访问，请配合 NAS 的反向代理与 HTTPS

## 开发阶段

P0 环境验证 → P1 后端骨架 → P2 书柜主界面 → P3 资料页与上传 → P4 翻页动画 → P5 Docker 部署 → P6 搜索/权限/备份增强
