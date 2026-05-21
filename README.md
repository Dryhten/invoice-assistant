# Invoice Assistant

发票打印与金额汇总助手。项目面向电子发票 PDF 的本地整理场景：上传发票后生成合并预览，自动提取中文大写金额，汇总总金额，并支持手动确认候选金额后下载或打印。

后端只读取 PDF 文本层，不调用外部 OCR、AI 或第三方识别服务。

## 功能

- 批量导入电子发票 PDF。
- 将多份发票合并为可预览、可下载、可打印的 PDF。
- 从 PDF 文本层提取中文大写金额，并换算为小写金额。
- 自动汇总已确认发票金额。
- 对无法唯一确认的金额提供候选项和手动确认入口。

## 技术栈

- 前端：Vue 3、Vite、TypeScript、pdf-lib。
- 后端：FastAPI、pypdfium2、uv。
- 测试：Vitest、pytest。

## 环境要求

- Node.js 18 或更高版本。
- npm 9 或更高版本。
- Python 3.10 到 3.12。
- uv。

## 快速开始

```powershell
npm install
npm run dev
```

默认访问地址：

- Web：`http://127.0.0.1:5173`
- API：`http://127.0.0.1:3001`

开发或验证结束后，用 `Ctrl+C` 停止前后端进程。

## 环境变量

复制 `.env.example` 为 `.env`，按需调整：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WEB_PORT` | `5173` | 前端开发与预览服务端口 |
| `PORT` | `3001` | 后端 API 端口 |
| `PDF_TEXT_REQUEST_TIMEOUT_MS` | `300000` | 单个 PDF 文本提取超时时间，单位毫秒 |
| `MAX_UPLOAD_MB` | `50` | 单个上传文件大小上限，单位 MB |

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm install` | 安装 Node 依赖，并通过 `postinstall` 同步后端 Python 依赖 |
| `npm run prepare:server` | 手动同步后端 Python 依赖 |
| `npm run dev` | 同时启动后端和前端开发服务 |
| `npm run build` | 类型检查并构建前端 |
| `npm run preview` | 预览前端构建产物 |
| `npm run test` | 运行前端 Vitest 和后端 pytest |
| `npm run type-check` | 运行前端类型检查和后端编译检查 |

## 目录结构

```text
.
├─ apps/
│  ├─ server/         # FastAPI 后端
│  └─ web/            # Vue 前端
├─ scripts/           # 项目辅助脚本
├─ .env.example       # 环境变量示例
├─ package.json       # 根项目脚本与 workspace 配置
└─ README.md
```

## 后端接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `POST` | `/api/invoices/extract-amount` | 上传单个 PDF，提取金额候选 |

开发环境下，Vite 会将 `/api` 请求代理到后端服务。

## 识别规则与限制

- 当前只支持带文本层的 PDF 发票。
- 扫描件、纯图片发票或文本层质量较差的 PDF 无法保证自动识别。
- 当提取到多个不同金额或没有可靠金额时，系统会进入待确认状态，需要人工选择候选项或手动输入金额。
- 上传文件仅在后端文本提取过程中写入临时文件，处理完成后会删除。

## 参考

使用流程参考了 [invoice-pdf-printer](https://github.com/EnjoyWT/invoice-pdf-printer.git)，本项目代码实现独立。
