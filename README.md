# Invoice Assistant

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FDryhten%2Finvoice-assistant)

发票打印与金额汇总助手。项目现在是纯前端静态应用：PDF 只在浏览器本地读取、合并、预览和识别，不上传到本项目后端，也不依赖服务器带宽处理发票文件。

## 功能

- 批量导入电子发票 PDF。
- 在浏览器内将多份发票合并为可预览、可下载、可打印的 PDF。
- 浏览器本地优先解码 PDF 页面中的发票二维码，失败后从 PDF 文本层提取中文大写金额并换算为小写金额。
- 自动汇总已确认发票金额。
- 对无法唯一确认的金额提供候选项和手动确认入口。

## 技术栈

- Vue 3、Vite、TypeScript。
- pdf-lib：浏览器端合并 PDF。
- pdfjs-dist：浏览器端渲染 PDF 与读取文本层。
- jsQR：浏览器端从 canvas 图像数据解码二维码。
- Vitest：前端测试。

## 环境要求

- Node.js 18 或更高版本。
- npm 9 或更高版本。

## 快速开始

```powershell
npm install
npm run dev
```

默认访问地址：`http://127.0.0.1:5173`

开发或验证结束后，用 `Ctrl+C` 停止前端进程。

## 环境变量

复制 `.env.example` 为 `.env` 后可按需调整：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WEB_PORT` | `5173` | 前端开发与预览服务端口 |

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm install` | 安装前端依赖 |
| `npm run dev` | 启动 Vite 前端开发服务 |
| `npm run build` | 类型检查并构建静态前端产物 |
| `npm run preview` | 预览前端构建产物 |
| `npm run test` | 运行前端 Vitest |
| `npm run type-check` | 运行前端类型检查 |

## 静态部署

```powershell
npm run build
```

构建产物位于 `apps/web/dist`，可部署到任意静态站点服务、对象存储或 CDN。运行时不需要 Python、FastAPI 或 API 服务器。

### Vercel CD

项目已包含 `vercel.json` 和 GitHub Actions 生产部署流程。推送到 `main` 分支或手动触发 `Deploy to Vercel` workflow 时，会执行类型检查、测试，并通过 Vercel CLI 部署到生产环境。

需要在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 中配置以下 secrets：

| Secret | 说明 |
| --- | --- |
| `VERCEL_TOKEN` | Vercel 账号访问令牌 |
| `VERCEL_ORG_ID` | Vercel 项目所属账号或团队的 ID，也就是 `.vercel/project.json` 里的 `orgId` |
| `VERCEL_PROJECT_ID` | Vercel 项目 ID |

本地首次关联 Vercel 项目时可运行：

```powershell
npx vercel link
```

完成后可从 `.vercel/project.json` 中查看 `orgId` 和 `projectId`，并填入 GitHub secrets。`.vercel` 不需要提交到仓库。

## 目录结构

```text
.
├─ apps/
│  └─ web/            # Vue 纯前端应用
├─ scripts/           # 项目辅助脚本
├─ .env.example       # 环境变量示例
├─ package.json       # 根项目脚本与 workspace 配置
└─ README.md
```

## 识别规则与限制

- 当前只支持电子发票 PDF。
- 二维码解码和文本层提取都在浏览器本地执行；不会上传 PDF 到本项目后端。
- 扫描件、纯图片发票或文本层质量较差的 PDF 无法保证自动识别。
- 当提取到多个不同金额或没有可靠金额时，系统会进入待确认状态，需要人工选择候选项或手动输入金额。

## 参考

使用流程参考了 [invoice-pdf-printer](https://github.com/EnjoyWT/invoice-pdf-printer.git)，本项目代码实现独立。
