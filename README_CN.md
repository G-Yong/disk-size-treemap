# Disk Size Treemap

[English](https://github.com/G-Yong/disk-size-treemap/blob/main/README.md) | 中文

- [GitHub](https://github.com/G-Yong/disk-size-treemap)
- [Marketplace](https://marketplace.visualstudio.com/items?itemName=G-Yong.disk-size-treemap)

## 功能特性

- 📁 **文件结构视图** — 交互式 squarified treemap，按文件/文件夹大小比例展示。点击文件夹可下钻，点击文件可在 VS Code 资源管理器中打开。
- 🎨 **文件类型视图** — 按扩展名聚合的 treemap，一眼看出哪些类型的文件占用最多空间。点击任意类型可跳转到该类型的最大文件列表。
- 📊 **最大文件视图** — 按大小排序的表格，列出工作区中最大的文件，支持按文件类型过滤。单击行可在资源管理器中选中该文件。

![](image/operation.webp)

## 使用方法

### 打开 Treemap

在**资源管理器**中右键，选择 **"Show Disk Size Treemap"**：

- **空白区域** — 展示完整工作区树
- **文件夹上** — 直接展示该文件夹的内容
- **文件上** — 展示文件所在父目录的内容，便于查看同级文件

也可以通过命令面板（`Ctrl+Shift+P`）运行同名命令，默认扫描工作区根目录。

### 图标

文件和文件夹图标使用 [VS Code Codicons](https://microsoft.github.io/vscode-codicons/)，与编辑器风格保持一致。根据文件扩展名自动选择合适的图标：

| 图标 | 类别 | 示例 |
|------|------|------|
| `codicon-file-code` | 源代码 | `.js`, `.ts`, `.py`, `.cpp`, `.java`, `.rs`, `.go`, `.css`, `.html` |
| `codicon-file-media` | 图片和媒体 | `.png`, `.jpg`, `.gif`, `.mp4`, `.mp3`, `.wav` |
| `codicon-file-zip` | 压缩包 | `.zip`, `.rar`, `.7z`, `.tar.gz` |
| `codicon-file-binary` | 二进制 | `.exe`, `.dll`, `.wasm`, `.class` |
| `codicon-file-pdf` | PDF | `.pdf` |
| `codicon-file` | 其他文件 | `.txt`, `.docx`, `.xlsx`, `.log` |

### 切换视图

使用面板顶部的选项卡切换视图：

| 选项卡 | 说明 |
|--------|------|
| 📁 文件结构 | 文件夹层级导航，面积比例 treemap |
| 🎨 文件类型 | 按扩展名聚合，点击可查看该类型的最大文件 |
| 📊 最大文件 | Top-N 表格，按类型过滤，双击打开文件位置 |

### 最大文件过滤

在 **最大文件** 视图中，使用下拉菜单按特定文件扩展名过滤，或保留"所有类型"查看全部文件。调整 "Top N" 数值来控制显示的文件数量。

### 交互操作

- **单击**文件结构视图中的文件夹可下钻进入
- **单击**任意文件方块或表格行可在 VS Code 资源管理器中选中
- 悬停在方块上可查看详细的大小信息


### 扫描控制

扫描过程中，可使用工具栏的 **暂停 / 继续** 按钮暂停或恢复扫描。点击 **刷新** 可手动重新扫描当前文件夹。本扩展不会自动监听文件系统变化——对大型目录自动重扫开销过大。

对于超大目录，为避免界面卡顿，treemap 只渲染按大小排序的前 2000 个项目。

## 颜色图例

| 类别 | 扩展名 | 颜色 |
|------|--------|------|
| JavaScript / TypeScript | `.js`, `.ts`, `.jsx`, `.tsx`, `.mjs`, `.cjs` | 黄 / 蓝 |
| 样式 / 标记 | `.css`, `.scss`, `.html`, `.xml`, `.md` | 蓝 / 橙 |
| 数据 / 配置 | `.json`, `.yaml`, `.toml`, `.env` | 青 / 红 |
| 图片 / 媒体 | `.png`, `.jpg`, `.gif`, `.svg`, `.mp4`, `.mp3` | 橙 / 紫 |
| 压缩包 | `.zip`, `.rar`, `.7z`, `.tar.gz` | 金 |
| 文档 | `.pdf`, `.docx`, `.xlsx`, `.pptx` | 红 / 蓝 / 绿 |
| Python | `.py`, `.ipynb` | 深蓝 |
| C / C++ | `.c`, `.cpp`, `.h`, `.hpp` | 粉 / 灰 |
| Go / Rust | `.go`, `.rs` | 青 / 橙 |
| Java / Kotlin | `.java`, `.kt` | 棕 / 紫 |
| Shell / Batch | `.sh`, `.ps1`, `.bat` | 绿 |
| 目录 | （文件夹） | 蓝 |

## 安装

1. 打开 VS Code
2. 进入扩展面板（`Ctrl+Shift+X`）
3. 搜索 "Disk Size Treemap"
4. 点击安装

## 开发

```bash
# 安装依赖
npm install

# 编译 TypeScript
npm run compile

# 监听模式
npm run watch

# 打包为 .vsix
npx @vscode/vsce package
```

在 VS Code 中按 `F5` 启动扩展开发宿主进行测试。

## 许可

MIT
