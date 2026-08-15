# Disk Size Treemap

English | [中文](https://github.com/G-Yong/disk-size-treemap/blob/main/README_CN.md)

- [GitHub](https://github.com/G-Yong/disk-size-treemap)
- [Marketplace](https://marketplace.visualstudio.com/items?itemName=G-Yong.disk-size-treemap)

## Features

- 📁 **File Structure View** — Interactive squarified treemap showing files and folders proportional to their size. Click folders to drill down, click files to reveal in VS Code Explorer.
- 🎨 **File Types View** — Aggregate treemap by file extension, showing which types consume the most disk space. Click any type to jump to its largest files.
- 📊 **Largest Files View** — Table of the largest files, sorted by size and filterable by file type. Click rows to reveal in explorer.

![](image/operation.webp)

## Usage

### Open the Treemap

Right-click in the **Explorer** and select **"Show Disk Size Treemap"**:

- **Empty area** — shows the full workspace tree
- **On a folder** — shows that folder's contents directly
- **On a file** — shows the file's parent folder, so you can see its siblings in context

You can also open the Command Palette (`Ctrl+Shift+P`) and run the same command to scan the workspace root.

### Icons

File and folder icons use [VS Code Codicons](https://microsoft.github.io/vscode-codicons/), keeping the visual style consistent with the rest of your editor. Icons are automatically chosen based on file extension:

| Icon | Category | Examples |
|------|----------|----------|
| `codicon-file-code` | Source code | `.js`, `.ts`, `.py`, `.cpp`, `.java`, `.rs`, `.go`, `.css`, `.html` |
| `codicon-file-media` | Images & media | `.png`, `.jpg`, `.gif`, `.mp4`, `.mp3`, `.wav` |
| `codicon-file-zip` | Archives | `.zip`, `.rar`, `.7z`, `.tar.gz` |
| `codicon-file-binary` | Binaries | `.exe`, `.dll`, `.wasm`, `.class` |
| `codicon-file-pdf` | PDF | `.pdf` |
| `codicon-file` | Other files | `.txt`, `.docx`, `.xlsx`, `.log` |

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
- **Click** any file tile or table row to reveal it in the VS Code Explorer
- Hover over tiles for detailed size information


### Scan Controls

While a scan is running, use the toolbar **Pause / Resume** button to pause or resume the scan. Use **Refresh** to manually rescan the current folder. The extension intentionally does not watch the filesystem — automatically rescanning a large tree would be too expensive.

For very large folders, the treemap renders the top 2000 items by size to keep the UI responsive.

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
