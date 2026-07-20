// File extension → color mapping
var EXT_COLORS = {
    // JavaScript / TypeScript
    js: '#f0db4f', ts: '#3178c6', jsx: '#61dafb', tsx: '#3178c6',
    mjs: '#f0db4f', cjs: '#f0db4f', mts: '#3178c6', cts: '#3178c6',

    // Styles / Markup
    css: '#2965f1', scss: '#c6538c', sass: '#c6538c', less: '#1d365d',
    html: '#e34f26', htm: '#e34f26', xml: '#e34f26', svg: '#ffb13b',
    md: '#083fa1', mdx: '#083fa1', markdown: '#083fa1',

    // Data / Config
    json: '#5b8dee', yaml: '#cb171e', yml: '#cb171e', toml: '#9c4221',
    ini: '#6c6c6c', cfg: '#6c6c6c', conf: '#6c6c6c', env: '#ecd53f',
    properties: '#6c6c6c', lock: '#5b8dee',

    // Images / Media
    png: '#e34f26', jpg: '#e34f26', jpeg: '#e34f26', gif: '#e34f26',
    webp: '#e34f26', ico: '#e34f26', bmp: '#e34f26', tiff: '#e34f26',
    tif: '#e34f26', psd: '#001e36', ai: '#ff9a00',

    // Audio / Video
    mp4: '#8b3a8b', mov: '#8b3a8b', avi: '#8b3a8b', mkv: '#8b3a8b',
    webm: '#8b3a8b', flv: '#8b3a8b', wmv: '#8b3a8b',
    mp3: '#8b3a8b', wav: '#8b3a8b', flac: '#8b3a8b', ogg: '#8b3a8b',
    aac: '#8b3a8b', wma: '#8b3a8b',

    // Archives
    zip: '#cfa256', rar: '#cfa256', '7z': '#cfa256', tar: '#cfa256',
    gz: '#cfa256', bz2: '#cfa256', xz: '#cfa256', zst: '#cfa256',

    // Documents
    pdf: '#e24032', doc: '#2b579a', docx: '#2b579a',
    xls: '#217346', xlsx: '#217346', ppt: '#d24726', pptx: '#d24726',
    txt: '#5a5a5a', csv: '#217346', tsv: '#217346',

    // Python
    py: '#3572A5', pyc: '#3572A5', pyo: '#3572A5', ipynb: '#3572A5',

    // C / C++
    c: '#555555', cpp: '#f34b7d', cc: '#f34b7d', cxx: '#f34b7d',
    cuh: '#555555', cu: '#76b900',
    h: '#555555', hpp: '#f34b7d', hxx: '#f34b7d', hh: '#f34b7d',

    // Java / Kotlin / Scala
    java: '#b07219', kt: '#A97BFF', kts: '#A97BFF', scala: '#c22d40',
    groovy: '#4298b8', clj: '#5881d8',

    // Go / Rust / Zig
    go: '#00ADD8', rs: '#dea584', rlib: '#dea584', zig: '#f7a41d',

    // Ruby
    rb: '#701516', erb: '#701516', rake: '#701516', gemspec: '#701516',

    // PHP
    php: '#4F5D95', phtml: '#4F5D95',

    // Swift / ObjC
    swift: '#F05138', m: '#438eff', mm: '#438eff',

    // C# / F# / VB
    cs: '#178600', fs: '#b845fc', fsi: '#b845fc', fsx: '#b845fc',
    vb: '#945db7',

    // Shell / Batch
    sh: '#89e051', bash: '#89e051', zsh: '#89e051', fish: '#89e051',
    bat: '#c1f12e', cmd: '#c1f12e', ps1: '#012456', psd1: '#012456',
    psm1: '#012456',

    // Docker / CI / IaC
    dockerfile: '#384d54', tf: '#5c4ee5', tfvars: '#5c4ee5',
    hcl: '#5c4ee5', proto: '#ff5757',

    // Compiled / Binary
    exe: '#808080', dll: '#808080', so: '#808080', wasm: '#654ff0',
    bin: '#808080', obj: '#808080', o: '#808080', a: '#808080',
    lib: '#808080', class: '#b07219',

    // Database / SQL
    sql: '#e38c00', sqlite: '#003b57', db: '#003b57',

    // Git / VCS
    gitignore: '#f1502f', gitattributes: '#f1502f', gitmodules: '#f1502f',

    // Misc
    log: '#5a5a5a', pid: '#5a5a5a', lock: '#5a5a5a', cache: '#5a5a5a',
    tmp: '#5a5a5a', temp: '#5a5a5a'
};

var DIR_COLOR = '#3a6fb5';
var OTHER_COLOR = '#6e7681';

function getNodeColor(d) {
    if (d.isDirectory) { return DIR_COLOR; }
    var ext = d.name.includes('.') ? d.name.split('.').pop().toLowerCase() : '';
    return EXT_COLORS[ext] || OTHER_COLOR;
}

function formatSize(bytes) {
    if (bytes === 0) { return '0 B'; }
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    var val = bytes / Math.pow(1024, i);
    return i === 0 ? bytes + ' B' : val.toFixed(1) + ' ' + units[i];
}

var vscode = acquireVsCodeApi();
var currentPath = '';
var currentTree = null;       // full serialized tree with nested children
var fullTree = null;          // always the full workspace tree (for types/largest views)
var activeView = 'structure'; // 'structure' | 'types' | 'largest'
var topN = 50;                // top-N count for largest files view
var selectedType = '';        // file extension filter for largest view ('' = all)

var treemapDiv = document.getElementById('treemap');
var tableView = document.getElementById('table-view');
var breadcrumb = document.getElementById('breadcrumb');
var tooltip = document.getElementById('tooltip');
var largestControls = document.getElementById('largest-controls');
var topnInput = document.getElementById('topn-input');
var typeFilter = document.getElementById('type-filter');
var tabs = document.querySelectorAll('.tab');

// ---- Render treemap (shared helper) ----

function renderTreemapSVG(dataArray, containerEl, getColorFn, onClickFn, onDblClickFn) {
    containerEl.innerHTML = '';
    var items = dataArray.filter(function(c) { return c.size > 0; });
    if (items.length === 0) {
        containerEl.innerHTML = '<div id="loading">No items with size to display</div>';
        return;
    }

    var width = containerEl.clientWidth;
    var height = containerEl.clientHeight;

    var root = d3.hierarchy({ children: items })
        .sum(function(d) { return d.size; })
        .sort(function(a, b) { return b.value - a.value; });

    d3.treemap()
        .size([width, height])
        .padding(2)
        .tile(d3.treemapSquarify)
        .round(true)(root);

    var svg = d3.select(containerEl).append('svg')
        .attr('viewBox', [0, 0, width, height]);

    var cell = svg.selectAll('g')
        .data(root.leaves())
        .enter().append('g')
        .attr('transform', function(d) { return 'translate(' + d.x0 + ',' + d.y0 + ')'; });

    cell.append('rect')
        .attr('width', function(d) { return d.x1 - d.x0; })
        .attr('height', function(d) { return d.y1 - d.y0; })
        .attr('fill', function(d) { return getColorFn ? getColorFn(d.data) : getNodeColor(d.data); })
        .attr('rx', 2)
        .on('click', function(event, d) {
            if (onClickFn) { onClickFn(d.data); }
        })
        .on('dblclick', function(event, d) {
            if (onDblClickFn) { onDblClickFn(d.data); }
        })
        .on('contextmenu', function(event, d) {
            event.preventDefault();
            if (onDblClickFn) { onDblClickFn(d.data); }
        })
        .on('mouseenter', function(event, d) {
            tooltip.classList.remove('hidden');
            var typeLabel = d.data.isDirectory ? '\uD83D\uDCC1 Folder: ' : '\uD83D\uDCC4 File: ';
            tooltip.innerHTML = typeLabel + '<strong>' + d.data.name + '</strong><br>' +
                formatSize(d.data.size) + ' (' + d.data.size.toLocaleString() + ' bytes)';
        })
        .on('mousemove', function(event) {
            var tx = event.clientX + 12;
            var ty = event.clientY - 28;
            tooltip.style.left = tx + 'px';
            tooltip.style.top = ty + 'px';
            var rect = tooltip.getBoundingClientRect();
            var vw = window.innerWidth, vh = window.innerHeight;
            if (rect.right > vw - 4) { tx = event.clientX - rect.width - 12; }
            if (rect.bottom > vh - 4) { ty = event.clientY - rect.height - 8; }
            if (ty < 4) { ty = 4; }
            if (tx < 4) { tx = 4; }
            tooltip.style.left = tx + 'px';
            tooltip.style.top = ty + 'px';
        })
        .on('mouseleave', function() { tooltip.classList.add('hidden'); });

    // Name labels
    cell.append('text')
        .attr('class', 'cell-label')
        .style('font-size', '11px')
        .style('font-weight', '500')
        .attr('x', function(d) { return (d.x1 - d.x0) / 2; })
        .attr('y', function(d) { return (d.y1 - d.y0) / 2 - 6; })
        .text(function(d) {
            var w = d.x1 - d.x0, h = d.y1 - d.y0;
            if (w < 16 || h < 12) { return ''; }
            var maxChars = Math.floor(w / 7);
            var prefix = d.data.isDirectory ? '\uD83D\uDCC1 ' : '';
            var name = prefix + d.data.name;
            if (name.length <= maxChars) { return name; }
            return name.substring(0, Math.max(0, maxChars - 2)) + '\u2026';
        });

    // Size labels
    cell.append('text')
        .attr('class', 'cell-label cell-size')
        .style('font-size', '10px')
        .style('opacity', '0.8')
        .attr('x', function(d) { return (d.x1 - d.x0) / 2; })
        .attr('y', function(d) { return (d.y1 - d.y0) / 2 + 10; })
        .text(function(d) {
            var w = d.x1 - d.x0, h = d.y1 - d.y0;
            if (w < 32 || h < 22) { return ''; }
            return formatSize(d.data.size);
        });
}

// ---- Collect all files from nested tree ----

function collectAllFiles(node) {
    var files = [];
    if (!node) { return files; }
    if (!node.isDirectory) {
        files.push(node);
    }
    if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
            files = files.concat(collectAllFiles(node.children[i]));
        }
    }
    return files;
}

// ---- View: File Structure (existing behavior) ----

function renderStructure(tree, dirPath) {
    currentPath = dirPath;
    renderBreadcrumb(dirPath);
    treemapDiv.classList.remove('hidden');
    tableView.classList.add('hidden');

    treemapDiv.innerHTML = '';
    if (!tree || !tree.children || tree.children.length === 0) {
        treemapDiv.innerHTML = '<div id="loading">This folder is empty</div>';
        return;
    }

    var children = tree.children.filter(function(c) { return c.size > 0; });
    if (children.length === 0) {
        treemapDiv.innerHTML = '<div id="loading">No files with size in this folder</div>';
        return;
    }

    var flatChildren = children.map(function(c) {
        return { name: c.name, path: c.path, size: c.size, isDirectory: c.isDirectory };
    });

    renderTreemapSVG(flatChildren, treemapDiv, null,
        function(d) {  // click
            if (d.isDirectory) { vscode.postMessage({ command: 'drillDown', path: d.path }); }
        },
        function(d) {  // dblclick / contextmenu
            vscode.postMessage({ command: 'revealInExplorer', path: d.path });
        }
    );
}

// ---- View: File Types ----

function renderFileTypes(tree, dirPath) {
    currentPath = dirPath;
    renderBreadcrumb(dirPath);
    treemapDiv.classList.remove('hidden');
    tableView.classList.add('hidden');

    var allFiles = collectAllFiles(tree);
    var typeMap = {};
    for (var i = 0; i < allFiles.length; i++) {
        var f = allFiles[i];
        var ext = f.name.includes('.') ? f.name.split('.').pop().toLowerCase() : '(no extension)';
        if (!typeMap[ext]) {
            typeMap[ext] = { name: ext, size: 0, count: 0, samplePath: f.path };
        }
        typeMap[ext].size += f.size;
        typeMap[ext].count += 1;
    }

    var typeArray = [];
    for (var key in typeMap) {
        if (typeMap.hasOwnProperty(key)) {
            typeMap[key].name = key + ' (' + typeMap[key].count + ' files)';
            typeMap[key].isDirectory = false;
            typeMap[key].ext = key;
            typeArray.push(typeMap[key]);
        }
    }

    renderTreemapSVG(typeArray, treemapDiv,
        function(d) { return EXT_COLORS[d.ext] || OTHER_COLOR; },
        function(d) {  // click: jump to Largest Files filtered by this type
            selectedType = d.ext;
            switchView('largest');
        },
        function(d) { vscode.postMessage({ command: 'revealInExplorer', path: d.samplePath }); }
    );
}

// ---- View: Largest Files Table ----

function renderLargestFiles(tree, dirPath, n) {
    currentPath = dirPath;
    renderBreadcrumb(dirPath);
    treemapDiv.classList.add('hidden');
    tableView.classList.remove('hidden');

    populateTypeFilter(tree);

    var allFiles = collectAllFiles(tree);

    // Filter by selected type
    if (selectedType) {
        allFiles = allFiles.filter(function(f) {
            var ext = f.name.includes('.') ? f.name.split('.').pop().toLowerCase() : '(no extension)';
            return ext === selectedType;
        });
    }

    allFiles.sort(function(a, b) { return b.size - a.size; });

    var limit = Math.min(n, allFiles.length);

    var html = '<table><thead><tr>' +
        '<th class="col-rank">#</th>' +
        '<th class="col-path">File</th>' +
        '<th class="col-size">Size</th>' +
        '</tr></thead><tbody>';

    for (var i = 0; i < limit; i++) {
        var f = allFiles[i];
        var ext = f.name.includes('.') ? f.name.split('.').pop().toLowerCase() : '';
        var color = EXT_COLORS[ext] || OTHER_COLOR;
        html += '<tr data-path="' + f.path.replace(/"/g, '&quot;') + '">' +
            '<td class="col-rank">' + (i + 1) + '</td>' +
            '<td class="col-path">' +
                '<span class="type-dot" style="background:' + color + ';"></span>' +
                '<span class="path-cell">' + f.path + '</span>' +
            '</td>' +
            '<td class="col-size">' + formatSize(f.size) + '</td>' +
            '</tr>';
    }
    html += '</tbody></table>';
    tableView.innerHTML = html;

    // Double-click table row → reveal in OS explorer
    tableView.querySelectorAll('tr[data-path]').forEach(function(tr) {
        tr.addEventListener('dblclick', function() {
            var fp = tr.getAttribute('data-path');
            if (fp) { vscode.postMessage({ command: 'revealInExplorer', path: fp }); }
        });
    });
}

// ---- View switching ----

function switchView(view) {
    activeView = view;
    tabs.forEach(function(t) {
        t.classList.toggle('active', t.getAttribute('data-view') === view);
    });
    largestControls.classList.toggle('hidden', view !== 'largest');

    if (currentTree) {
        refreshView();
    }
}

function refreshView() {
    if (!currentTree) { return; }
    var tree = currentTree;
    var path = currentPath;
    switch (activeView) {
        case 'structure':
            renderStructure(tree, path);
            break;
        case 'types':
            renderFileTypes(fullTree || tree, path);
            break;
        case 'largest':
            renderLargestFiles(fullTree || tree, path, topN);
            break;
    }
}

tabs.forEach(function(t) {
    t.addEventListener('click', function() {
        switchView(t.getAttribute('data-view'));
    });
});

topnInput.addEventListener('change', function() {
    var val = parseInt(topnInput.value, 10);
    if (val > 0) {
        topN = val;
        refreshView();
    }
});

typeFilter.addEventListener('change', function() {
    selectedType = typeFilter.value;
    refreshView();
});

// Populate the type filter dropdown from fullTree data
function populateTypeFilter(tree) {
    if (!tree) { return; }
    var allFiles = collectAllFiles(tree);
    var seen = {};
    var types = [];
    for (var i = 0; i < allFiles.length; i++) {
        var f = allFiles[i];
        var ext = f.name.includes('.') ? f.name.split('.').pop().toLowerCase() : '(no extension)';
        if (!seen[ext]) {
            seen[ext] = true;
            types.push(ext);
        }
    }
    types.sort();
    var html = '<option value="">All Types</option>';
    for (var j = 0; j < types.length; j++) {
        var sel = types[j] === selectedType ? ' selected' : '';
        html += '<option value="' + types[j] + '"' + sel + '>' + types[j] + '</option>';
    }
    typeFilter.innerHTML = html;
}

// ---- Breadcrumb ----

function renderBreadcrumb(dirPath) {
    if (!dirPath || dirPath === '/' || dirPath === '') {
        breadcrumb.innerHTML = '<span class="crumb" data-path="/">/</span>';
        return;
    }
    var parts = dirPath.replace(/\\/g, '/').split('/').filter(Boolean);
    var html = '';
    var accum = '';
    for (var i = 0; i < parts.length; i++) {
        if (i > 0) { html += '<span class="separator">/</span>'; }
        if (i === 0 && /^[A-Za-z]:$/.test(parts[i])) {
            accum = parts[i] + '/';
        } else {
            accum += '/' + parts[i];
        }
        html += '<span class="crumb" data-path="' + accum + '">' + parts[i] + '</span>';
    }
    breadcrumb.innerHTML = html;
    breadcrumb.querySelectorAll('.crumb').forEach(function(el) {
        el.addEventListener('click', function() {
            var targetPath = el.getAttribute('data-path');
            vscode.postMessage({ command: 'drillDown', path: targetPath });
        });
    });
}

// ---- Message handling ----

window.addEventListener('message', function(event) {
    var msg = event.data;
    switch (msg.type) {
        case 'scanning':
            treemapDiv.innerHTML = '<div id="loading">Scanning: ' + msg.path + '\u2026</div>';
            break;
        case 'treeData':
            currentTree = msg.tree;
            fullTree = msg.fullTree || msg.tree;
            currentPath = msg.currentPath;
            refreshView();
            break;
    }
});

// ---- Resize ----

window.addEventListener('resize', function() {
    refreshView();
});
