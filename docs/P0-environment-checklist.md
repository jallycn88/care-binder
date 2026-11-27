# P0 环境验证清单

目标：确认飞牛 NAS 的软件环境与构建链路可用，全绿后进入 P1。本阶段不写业务代码。

## A. NAS 端（需 SSH 登录）

- [ ] A1 SSH 连通，`uname -m` 返回 `aarch64`
- [ ] A2 `docker version` / `docker info`：Server 正常、架构 arm64、版本 ≥ 20.10
- [ ] A3 `docker run --rm hello-world` 与 `docker run --rm alpine:3.20 uname -m` 均返回 `aarch64`
- [ ] A4 数据卷 `/vol1/1000/docker/care-binder/data` 挂载读写通过，记录容器 UID/GID
- [ ] A5 对外端口（暂定 `31688`，避开 8080/3000 等常用端口）未被占用，局域网可访问

## B. 本地开发机

- [x] B1 git 仓库初始化完成，本地首次提交完成
- [x] B2 技术栈调整：Go → Node.js 22 + 内置 node:sqlite（本地无 Go/Docker，改后本地可完整验证；零原生依赖、ARM 友好）
- [x] B3 前端 `npm run build` 产出 `dist/`（gzip 后约 35KB）
- [x] B4 后端 API 冒烟全通过：鉴权/CRUD/上传/文件服务/类型白名单/重排/删除清理/册间隔离
- [x] B5 端到端回归通过：静态资源 + API 全链路
- [ ] B6 git 仓库 push 到远程，拿到 clone 地址（待用户提供远程仓库）

## C. git → NAS 链路（待 NAS 环境执行）

- [ ] C1 NAS 上 `git --version` 可用
- [ ] C2 NAS 上 `git clone <仓库地址> /vol1/1000/docker/care-binder` 成功
- [ ] C3 构建路径锁定：NAS 原生 `docker compose build && docker compose up -d`

> 说明：B2-B5 已完成意味着完整成品已在本地验证通过。A 组与 C 组需在飞牛 NAS 上实际执行，本地无法代替。Dockerfile 与 compose 已通过静态校验（YAML 解析、lock 文件齐全、语法检查），但镜像实际构建需在有 Docker 的 NAS 上完成。

## 产出

环境结论：各项通过/失败、Docker 版本、卷路径与 UID/GID、git 链路是否通畅。

## 决策记录

- 镜像构建：NAS 原生构建 arm64 单架构，不走本地 buildx 交叉构建
- 数据卷路径：飞牛规范 `/vol1/1000/docker/care-binder/data`
- 源码同步：git（非 scp）
- 美术资源：AI 生成，导出 WebP 压缩，CSS 实现微动画
- 访问控制：单一密码，环境变量 `APP_PASSWORD`
- 资料册：按家人分册
- 交付节奏：P0→P6 分期，每期验证后再进下一期
