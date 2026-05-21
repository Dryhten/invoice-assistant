# Invoice Assistant

发票打印与金额汇总助手。前端负责上传、预览、合并打印；后端直接读取 PDF 文本层提取中文大写金额，不调用外部服务。

## 快速开始

```powershell
npm install
npm run dev
```

默认地址：

- Web: `http://127.0.0.1:${WEB_PORT}`，默认 `5173`
- API: `http://127.0.0.1:${PORT}`，默认 `3001`

任务完成或验证结束后请停止服务进程。

## 环境变量

复制 `.env.example` 为 `.env` 或在 shell 中设置：

- `WEB_PORT`: 前端端口，默认 `5173`
- `PORT`: 后端端口，默认 `3001`
- `PDF_TEXT_REQUEST_TIMEOUT_MS`: PDF 文本提取请求超时，默认 `300000`
- `MAX_UPLOAD_MB`: 最大上传大小，默认 `50`

## 脚本

- `npm install`: 安装前端依赖，并通过 `postinstall` 自动同步后端 Python 依赖
- `npm run prepare:server`: 手动重新同步后端 Python 依赖
- `npm run dev`: 同时启动后端和前端
- `npm run build`: 构建前端
- `npm run test`: 前端和后端单元测试
- `npm run type-check`: 前端类型检查和后端编译检查

当前版本只支持带文本层的 PDF 发票；扫描件或纯图片发票会进入待确认或被拒绝。
