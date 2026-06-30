# Docker 离线运行标准

本项目是纯前端静态应用。Docker 镜像构建时会执行 `npm ci` 和 `npm run build`，运行时只包含 Nginx 与 `apps/web/dist` 静态产物，不需要 Node.js、npm 或后端服务。

## 端口约定

- `WEB_PORT=5173` 只用于本地 Vite 开发和预览。
- Docker 启动默认使用宿主机 `DOCKER_WEB_PORT=18080`，容器内固定监听 `8080`。
- `scripts/docker-run.ps1` 会拒绝使用与 `.env` 中 `WEB_PORT` 相同的宿主机端口。

## 构建镜像

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/docker-build.ps1
```

默认镜像名为 `invoice-assistant:latest`。如需自定义：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/docker-build.ps1 -ImageName invoice-assistant:20260630
```

## 本机启动

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/docker-run.ps1
```

默认访问地址：

```text
http://127.0.0.1:18080
```

如需临时换端口，不要使用 `.env` 里的 `WEB_PORT`：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/docker-run.ps1 -HostPort 18081
```

## 停止服务

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/docker-stop.ps1
```

## 离线冒烟验证

该命令会用临时容器启动镜像，并使用 `--network none` 验证容器不依赖外网也能服务首页和健康检查；验证结束后会删除临时容器。

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/docker-smoke.ps1
```

## 导出离线包

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/docker-export.ps1
```

默认输出：

```text
D:\DockerImages\invoice-assistant\invoice-assistant-latest.tar
D:\DockerImages\invoice-assistant\invoice-assistant-latest.tar.sha256
```

## 离线机器导入与运行

把 `invoice-assistant-latest.tar` 和 `.sha256` 文件复制到离线机器后执行：

```powershell
Get-FileHash -Algorithm SHA256 .\invoice-assistant-latest.tar
Get-Content .\invoice-assistant-latest.tar.sha256
docker load -i .\invoice-assistant-latest.tar
docker run --pull never -d --name invoice-assistant -p 18080:8080 invoice-assistant:latest
```

验证：

```powershell
Invoke-WebRequest http://127.0.0.1:18080/healthz
```

停止：

```powershell
docker rm -f invoice-assistant
```
