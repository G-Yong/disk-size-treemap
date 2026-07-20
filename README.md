# Disk Size Treemap

> Interactive treemap visualization — see where your disk space goes at a glance. 交互式 Treemap 可视化工具 — 一眼看清工作区文件和文件夹的磁盘占用分布。

English | [中文](https://github.com/G-Yong/disk-size-treemap/blob/main/README_CN.md)

- [GitHub](https://github.com/G-Yong/disk-size-treemap)
- [Marketplace](https://marketplace.visualstudio.com/items?itemName=G-Yong.disk-size-treemap)

## Features

- 📁 **File Structure View** — Interactive squarified treemap showing files and folders proportional to their size. Click folders to drill down, double-click to reveal in OS explorer.
- 🎨 **File Types View** — Aggregate treemap by file extension, showing which types consume the most disk space. Click any type to jump to its largest files.
- 📊 **Largest Files View** — Sortable table of the largest files in the workspace, filterable by file type. Double-click rows to open in explorer.

## Usage

### Open the Treemap

Right-click in the **Explorer** empty area and select **"Show Disk Size Treemap"**.

Alternatively, open the Command Palette (`Ctrl+Shift+P`) and run the same command.

### Switch Views

Use the tabs at the top of the treemap panel:

| Tab | Description |
|-----|-------------|
| 📁 File Structure | Navigate folder hierarchy, proportional area treemap |
| 🎨 File Types | Aggregate by extension, click to see largest files of that type |
| 📊 Largest Files | Top-N table, filter by type, double-click to reveal |

### Largest Files Filter

In the **Largest Files** view, use the dropdown to filter by a specific file extension, or leave as "All Types" to see everything. Adjust the "Top N" number to control how many files are shown.

### Interact

- **Click** a folder in File Structure view to drill down
- **Double-click** any tile/row to reveal the file in your OS file explorer
- **Right-click** any tile to reveal in OS explorer
- Hover over tiles for detailed size information

## Color Legend

| Category | Extensions | Color |
|----------|-----------|-------|
| JavaScript / TypeScript | `.js`, `.ts`, `.jsx`, `.tsx`, `.mjs`, `.cjs` | Yellow / Blue |
| Styles / Markup | `.css`, `.scss`, `.html`, `.xml`, `.md` | Blue / Orange |
| Data / Config | `.json`, `.yaml`, `.toml`, `.env` | Teal / Red |
| Images / Media | `.png`, `.jpg`, `.gif`, `.svg`, `.mp4`, `.mp3` | Orange / Purple |
| Archives | `.zip`, `.rar`, `.7z`, `.tar.gz` | Gold |
| Documents | `.pdf`, `.docx`, `.xlsx`, `.pptx` | Red / Blue / Green |
| Python | `.py`, `.ipynb` | Dark Blue |
| C / C++ | `.c`, `.cpp`, `.h`, `.hpp` | Pink / Gray |
| Go / Rust | `.go`, `.rs` | Cyan / Orange |
| Java / Kotlin | `.java`, `.kt` | Brown / Purple |
| Shell / Batch | `.sh`, `.ps1`, `.bat` | Green |
| Directories | (folders) | Blue |

## Extension Settings

This extension currently has no configurable settings. All views are available out of the box.

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode
npm run watch

# Package as .vsix
npx @vscode/vsce package
```

Press `F5` in VS Code to launch the Extension Development Host and test the extension.

## License

MIT
