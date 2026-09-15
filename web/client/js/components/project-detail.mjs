/**
 * 项目详情与可视化 Canvas 编辑器组件
 */

export class ProjectDetailComponent {
  constructor(app, container) {
    this.app = app;
    this.container = container;
    this.project = null;
    this.currentBlockId = null;
    this.layout = null;
    this.selectedIndex = -1;
    this.zoom = 0.45; // 默认缩放比例以适配屏幕
    this.showGrid = true;
    this.activeSidebarTab = 'layers'; // layers | assets | script
    this.hasUnsavedChanges = false;
    this.lastSavedMtime = null;
    this.undoStack = [];
    this.redoStack = [];

    // 交互拖拽状态
    this.isDragging = false;
    this.dragMode = 'move'; // move | resize | pan
    this.resizeHandle = null;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragStartElemX = 0;
    this.dragStartElemY = 0;
    this.dragStartElemW = 0;
    this.dragStartElemH = 0;
    this.hitBoxes = [];

    // 轮询检查 Agent 磁盘文件变更
    this.pollTimer = null;
    this.agentUpdateNotice = null;
  }

  async load(projectId, blockId = null) {
    this.startPolling();
    this.project = await this.app.api.getProjectDetail(projectId);
    this.app.updateBreadcrumb(this.project.title || this.project.name);

    // 选中分块
    if (!blockId && this.project.blocks.length > 0) {
      this.currentBlockId = this.project.blocks[0].id;
    } else {
      this.currentBlockId = blockId || 'block1';
    }

    await this.loadBlockLayout(this.currentBlockId);
    this.render();
  }

  destroy() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(async () => {
      if (!this.project || !this.currentBlockId) return;
      try {
        const meta = await this.app.api.checkBlockMtime(this.project.id, this.currentBlockId);
        if (!meta) return;
        if (this.lastSavedMtime && meta.mtime > this.lastSavedMtime) {
          if (!this.hasUnsavedChanges) {
            // 用户没有未保存修改，直接无缝更新
            console.log('[sync] 检测到外部/Agent 更新，自动重载');
            this.lastSavedMtime = meta.mtime;
            await this.loadBlockLayout(this.currentBlockId, false);
            this.app.toast('⚡ 已自动载入 Agent 最新修改', 'success');
            this.redrawCanvas();
            this.renderSidebar();
            this.renderInspector();
          } else {
            // 用户正在本地编辑，给出提醒横幅
            this.showAgentUpdateBanner();
          }
        }
      } catch {}
    }, 2500);
  }

  showAgentUpdateBanner() {
    if (document.getElementById('agent-sync-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'agent-sync-banner';
    banner.style.cssText = `
      position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
      background: #1e3a8a; border: 1px solid #3b82f6; color: #fff;
      padding: 8px 16px; border-radius: 8px; font-size: 13px; z-index: 100;
      display: flex; align-items: center; gap: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    `;
    banner.innerHTML = `
      <span>⚡ 检测到 Agent 在外部修改了此文件</span>
      <button class="btn btn-primary btn-sm" id="btn-sync-reload">载入 Agent 最新修改</button>
      <button class="btn btn-ghost btn-sm" id="btn-sync-dismiss">忽略</button>
    `;
    this.container.appendChild(banner);

    banner.querySelector('#btn-sync-reload').onclick = async () => {
      banner.remove();
      this.hasUnsavedChanges = false;
      await this.loadBlockLayout(this.currentBlockId);
      this.app.toast('已重载 Agent 最新修改', 'success');
      this.render();
    };
    banner.querySelector('#btn-sync-dismiss').onclick = () => banner.remove();
  }

  async loadBlockLayout(blockId, pushHistory = true) {
    try {
      const res = await this.app.api.getBlockLayout(this.project.id, blockId);
      this.layout = res.layout;
      this.lastSavedMtime = res.updatedAt;
      this.hasUnsavedChanges = false;
      this.selectedIndex = -1;
      this.app.updateStatus(true);
      if (pushHistory) {
        this.undoStack = [];
        this.redoStack = [];
      }
    } catch (err) {
      this.app.toast(`加载分块失败: ${err.message}`, 'error');
    }
  }

  recordSnapshot() {
    this.undoStack.push(JSON.stringify(this.layout));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
    this.hasUnsavedChanges = true;
    this.app.updateStatus(false);
  }

  undo() {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(JSON.stringify(this.layout));
    const prev = this.undoStack.pop();
    this.layout = JSON.parse(prev);
    this.hasUnsavedChanges = true;
    this.app.updateStatus(false);
    this.redrawCanvas();
    this.renderSidebar();
    this.renderInspector();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(JSON.stringify(this.layout));
    const next = this.redoStack.pop();
    this.layout = JSON.parse(next);
    this.hasUnsavedChanges = true;
    this.app.updateStatus(false);
    this.redrawCanvas();
    this.renderSidebar();
    this.renderInspector();
  }

  async saveLayout(autoRender = true) {
    if (!this.layout) return;
    try {
      const res = await this.app.api.saveBlockLayout(this.project.id, this.currentBlockId, this.layout, autoRender);
      this.lastSavedMtime = res.updatedAt;
      this.hasUnsavedChanges = false;
      this.app.updateStatus(true);
      this.app.toast(`已保存至 layout/${this.currentBlockId}.json${autoRender ? ' (已完成 Canvas 渲染)' : ''}`, 'success');
      const b = this.container.querySelector('#agent-sync-banner');
      if (b) b.remove();
    } catch (err) {
      this.app.toast(`保存失败: ${err.message}`, 'error');
    }
  }

  render() {
    if (!this.project || !this.layout) return;

    this.container.innerHTML = `
      <div class="editor-view">
        <!-- 二级工具栏 -->
        <div class="editor-subbar">
          <div class="block-tabs">
            <button class="btn btn-ghost btn-sm" id="btn-back-to-list" style="margin-right: 6px;">
              ← 全部项目
            </button>
            ${this.project.blocks.map((b) => `
              <div class="block-tab ${b.id === this.currentBlockId ? 'active' : ''}" data-block="${b.id}">
                ${b.id}
              </div>
            `).join('')}
            <button class="btn btn-ghost btn-sm" id="btn-add-block" title="新建分块">+</button>
            <div class="block-tab block-tab-all" id="btn-view-stitched" title="长图预览与拼接">
              📜 长图总览
            </div>
          </div>

          <div class="editor-controls">
            <div class="zoom-controls">
              <button class="btn btn-ghost btn-sm" id="zoom-out">-</button>
              <span class="zoom-val" id="zoom-text">${Math.round(this.zoom * 100)}%</span>
              <button class="btn btn-ghost btn-sm" id="zoom-in">+</button>
              <button class="btn btn-ghost btn-sm" id="zoom-fit">自适应</button>
            </div>

            <button class="btn btn-secondary btn-sm" id="btn-toggle-grid" title="切换辅助线">
              ${this.showGrid ? '⊞ 网格: 开' : '⊞ 网格: 关'}
            </button>

            <button class="btn btn-secondary btn-sm" id="btn-reload-block" title="从磁盘重载 (Agent 同步)">
              🔄 重载
            </button>

            <button class="btn btn-secondary btn-sm" id="btn-lint-block" title="运行机检检查">
              ⚖ 机检
            </button>

            <button class="btn btn-secondary btn-sm" id="btn-render-block" title="重新执行 Node Canvas 渲染">
              🎨 渲染切片
            </button>

            <button class="btn btn-primary btn-sm" id="btn-save-layout" title="保存至 layout 文件 (Ctrl+S)">
              💾 保存到文件
            </button>
          </div>
        </div>

        <!-- 编辑器主体三栏 -->
        <div class="editor-main">
          <!-- 左侧栏：图层 / 素材库 / 剧本 -->
          <div class="editor-sidebar-left">
            <div class="sidebar-tabs">
              <div class="sidebar-tab ${this.activeSidebarTab === 'layers' ? 'active' : ''}" data-tab="layers">
                图层 (${(this.layout.elements || []).length})
              </div>
              <div class="sidebar-tab ${this.activeSidebarTab === 'assets' ? 'active' : ''}" data-tab="assets">
                素材库 (${(this.project.assets || []).length})
              </div>
              <div class="sidebar-tab ${this.activeSidebarTab === 'script' ? 'active' : ''}" data-tab="script">
                剧本分镜
              </div>
            </div>

            <div class="sidebar-panel" id="sidebar-panel-content">
              <!-- 动态内容 -->
            </div>
          </div>

          <!-- 中间画布视口 -->
          <div class="canvas-viewport" id="canvas-viewport">
            <canvas id="canvas-board" class="canvas-board"></canvas>
          </div>

          <!-- 右侧栏：属性检查器 -->
          <div class="editor-sidebar-right" id="inspector-panel">
            <!-- 动态属性编辑器 -->
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
    this.renderSidebar();
    this.renderInspector();
    this.redrawCanvas();
  }

  bindEvents() {
    // 返回项目列表
    this.container.querySelector('#btn-back-to-list').onclick = () => {
      if (this.hasUnsavedChanges && !confirm('当前分块有未保存的修改，确定离开吗？')) return;
      this.destroy();
      this.app.loadProjects();
    };

    // 分块切换
    this.container.querySelectorAll('.block-tab[data-block]').forEach((tab) => {
      tab.onclick = async () => {
        const bid = tab.dataset.block;
        if (bid === this.currentBlockId) return;
        if (this.hasUnsavedChanges && !confirm('当前分块有未保存的修改，切换将丢失，确定继续吗？')) return;
        this.currentBlockId = bid;
        await this.loadBlockLayout(bid);
        this.render();
      };
    });

    // 新增分块
    this.container.querySelector('#btn-add-block').onclick = async () => {
      const num = this.project.blocks.length + 1;
      const blockId = `block${num}`;
      if (confirm(`是否在工程中创建新分块 ${blockId}？`)) {
        await this.app.api.createBlock(this.project.id, blockId);
        this.app.toast(`分块 ${blockId} 创建成功！`, 'success');
        this.load(this.project.id, blockId);
      }
    };

    // 长图总览与拼接
    this.container.querySelector('#btn-view-stitched').onclick = () => {
      this.showStitchModal();
    };

    // 缩放控制
    this.container.querySelector('#zoom-out').onclick = () => {
      this.setZoom(Math.max(0.15, this.zoom - 0.1));
    };
    this.container.querySelector('#zoom-in').onclick = () => {
      this.setZoom(Math.min(2.0, this.zoom + 0.1));
    };
    this.container.querySelector('#zoom-fit').onclick = () => {
      this.autoFitZoom();
    };

    // 辅助网格切换
    this.container.querySelector('#btn-toggle-grid').onclick = () => {
      this.showGrid = !this.showGrid;
      this.container.querySelector('#btn-toggle-grid').textContent = this.showGrid ? '⊞ 网格: 开' : '⊞ 网格: 关';
      this.redrawCanvas();
    };

    // 重载
    this.container.querySelector('#btn-reload-block').onclick = async () => {
      if (confirm('确定从磁盘重新载入？将拉取 Agent/外部写入的最新 layout/blockN.json。')) {
        await this.loadBlockLayout(this.currentBlockId);
        this.app.toast('已重载最新磁盘文件', 'success');
        this.render();
      }
    };

    // 机检
    this.container.querySelector('#btn-lint-block').onclick = async () => {
      this.showLintModal();
    };

    // 重新渲染
    this.container.querySelector('#btn-render-block').onclick = async () => {
      this.app.toast('正在通过 Canvas 渲染切片...', 'info');
      try {
        await this.app.api.renderBlock(this.project.id, this.currentBlockId);
        this.app.toast('切片渲染完成！', 'success');
      } catch (err) {
        this.app.toast(`渲染失败: ${err.message}`, 'error');
      }
    };

    // 保存
    this.container.querySelector('#btn-save-layout').onclick = () => {
      this.saveLayout(true);
    };

    // 侧边栏 tab 切换
    this.container.querySelectorAll('.sidebar-tab').forEach((tab) => {
      tab.onclick = () => {
        this.activeSidebarTab = tab.dataset.tab;
        this.container.querySelectorAll('.sidebar-tab').forEach((t) => t.classList.toggle('active', t === tab));
        this.renderSidebar();
      };
    });

    // 绑定画布交互
    this.bindCanvasInteraction();

    // 绑定全局快捷键
    this.bindKeyboardShortcuts();
  }

  setZoom(val) {
    this.zoom = Math.round(val * 100) / 100;
    const txt = this.container.querySelector('#zoom-text');
    if (txt) txt.textContent = `${Math.round(this.zoom * 100)}%`;
    this.redrawCanvas();
  }

  autoFitZoom() {
    const vp = this.container.querySelector('#canvas-viewport');
    if (!vp || !this.layout) return;
    const availH = vp.clientHeight - 80;
    const targetH = this.layout.height || 2500;
    const fitZoom = Math.max(0.15, Math.min(1.0, availH / targetH));
    this.setZoom(fitZoom);
  }

  bindKeyboardShortcuts() {
    window.onkeydown = (e) => {
      // 避免输入框内部触发
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.saveLayout(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selectedIndex >= 0) {
          e.preventDefault();
          this.deleteElement(this.selectedIndex);
        }
      } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        if (this.selectedIndex >= 0) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const el = this.layout.elements[this.selectedIndex];
          this.recordSnapshot();
          if (e.key === 'ArrowLeft') el.x = (el.x || 0) - step;
          if (e.key === 'ArrowRight') el.x = (el.x || 0) + step;
          if (e.key === 'ArrowUp') el.y = (el.y || 0) - step;
          if (e.key === 'ArrowDown') el.y = (el.y || 0) + step;
          this.redrawCanvas();
          this.renderInspector();
        }
      }
    };
  }

  bindCanvasInteraction() {
    const canvas = this.container.querySelector('#canvas-board');
    if (!canvas) return;

    canvas.onmousedown = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scale = this.zoom;
      const canvasX = (e.clientX - rect.left) / scale;
      const canvasY = (e.clientY - rect.top) / scale;

      // 检查是否点在已选中的变换手柄上
      if (this.selectedIndex >= 0 && this.hitBoxes[this.selectedIndex]) {
        const target = this.hitBoxes[this.selectedIndex];
        const [x0, y0, x1, y1] = target.box;
        const w = x1 - x0;
        const h = y1 - y0;
        const handleHitRadius = 14;

        // 检查右边缘调节 max_width / width
        if (Math.abs(canvasX - x1) < handleHitRadius && Math.abs(canvasY - (y0 + h / 2)) < handleHitRadius) {
          this.isDragging = true;
          this.dragMode = 'resize';
          this.resizeHandle = 'e';
          this.dragStartX = canvasX;
          this.dragStartY = canvasY;
          this.dragStartElemW = target.element.max_width || target.element.width || w;
          return;
        }

        // 检查右下角调节宽高
        if (Math.abs(canvasX - x1) < handleHitRadius && Math.abs(canvasY - y1) < handleHitRadius) {
          this.isDragging = true;
          this.dragMode = 'resize';
          this.resizeHandle = 'se';
          this.dragStartX = canvasX;
          this.dragStartY = canvasY;
          this.dragStartElemW = target.element.width || w;
          this.dragStartElemH = target.element.height || h;
          return;
        }
      }

      // 命中检测
      const hit = this.app.renderer.hitTest(this.hitBoxes, canvasX, canvasY);
      if (hit >= 0) {
        this.selectElement(hit);
        this.isDragging = true;
        this.dragMode = 'move';
        this.dragStartX = canvasX;
        this.dragStartY = canvasY;
        const el = this.layout.elements[hit];
        this.dragStartElemX = el.x || 0;
        this.dragStartElemY = el.y || 0;
      } else {
        this.selectElement(-1);
      }
    };

    window.onmousemove = (e) => {
      if (!this.isDragging || this.selectedIndex < 0) return;
      const canvasRect = canvas.getBoundingClientRect();
      const scale = this.zoom;
      const canvasX = (e.clientX - canvasRect.left) / scale;
      const canvasY = (e.clientY - canvasRect.top) / scale;
      const dx = Math.round(canvasX - this.dragStartX);
      const dy = Math.round(canvasY - this.dragStartY);

      const el = this.layout.elements[this.selectedIndex];
      if (this.dragMode === 'move') {
        let newX = this.dragStartElemX + dx;
        let newY = this.dragStartElemY + dy;

        // 磁吸对齐：中轴吸附 (x = 540)
        if (Math.abs(newX - 540) < 10) newX = 540;

        el.x = newX;
        el.y = newY;
        this.redrawCanvas();
        this.renderInspector();
      } else if (this.dragMode === 'resize') {
        if (this.resizeHandle === 'e') {
          if (el.type === 'text') {
            el.max_width = Math.max(100, Math.round(this.dragStartElemW + dx));
          } else {
            el.width = Math.max(20, Math.round(this.dragStartElemW + dx));
          }
        } else if (this.resizeHandle === 'se') {
          el.width = Math.max(20, Math.round(this.dragStartElemW + dx));
          el.height = Math.max(20, Math.round(this.dragStartElemH + dy));
        }
        this.redrawCanvas();
        this.renderInspector();
      }
    };

    window.onmouseup = () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.recordSnapshot();
      }
    };
  }

  async redrawCanvas() {
    const canvas = this.container.querySelector('#canvas-board');
    if (!canvas || !this.layout) return;
    const projectUrlBase = `/api/projects/${this.project.id}`;
    this.hitBoxes = await this.app.renderer.renderBlock(
      canvas,
      this.layout,
      projectUrlBase,
      this.selectedIndex,
      {
        zoom: this.zoom,
        showGrid: this.showGrid,
      }
    );
  }

  selectElement(index) {
    this.selectedIndex = index;
    this.redrawCanvas();
    this.renderSidebar();
    this.renderInspector();
  }

  renderSidebar() {
    const panel = this.container.querySelector('#sidebar-panel-content');
    if (!panel) return;

    if (this.activeSidebarTab === 'layers') {
      this.renderLayersTab(panel);
    } else if (this.activeSidebarTab === 'assets') {
      this.renderAssetsTab(panel);
    } else if (this.activeSidebarTab === 'script') {
      this.renderScriptTab(panel);
    }
  }

  renderLayersTab(panel) {
    const elements = this.layout.elements || [];
    panel.innerHTML = `
      <div class="layers-header">
        <div class="layers-title">图层顺序 (顶层在下)</div>
        <div style="display: flex; gap: 4px;">
          <button class="btn btn-secondary btn-sm" id="btn-add-element-menu">+ 添加元素</button>
        </div>
      </div>

      <div class="layer-list">
        ${elements.length === 0 ? `
          <div style="text-align: center; color: var(--text-muted); padding: 40px 0;">
            暂无元素
          </div>
        ` : elements.map((el, i) => {
          const isActive = i === this.selectedIndex;
          let icon = 'T';
          let label = el.content || '文本';
          if (el.type === 'asset') {
            icon = '🖼';
            label = el.file || '插画素材';
          } else if (el.type === 'rule') {
            icon = '━';
            label = el.vertical ? '垂直分割线' : '水平分割线';
          } else if (el.type === 'card') {
            icon = '▭';
            label = el.label || '信息卡片';
          }

          if (el.box) icon = '💬';

          return `
            <div class="layer-item ${isActive ? 'active' : ''}" data-index="${i}">
              <div class="layer-icon">${icon}</div>
              <div class="layer-name" title="${label}">${label}</div>
              <div class="layer-actions">
                <button class="btn btn-ghost btn-icon btn-sm action-up" title="上移一层">▲</button>
                <button class="btn btn-ghost btn-icon btn-sm action-down" title="下移一层">▼</button>
                <button class="btn btn-ghost btn-icon btn-sm action-del" title="删除">✕</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    panel.querySelectorAll('.layer-item').forEach((item) => {
      item.onclick = (e) => {
        if (e.target.closest('.layer-actions')) return;
        const idx = Number(item.dataset.index);
        this.selectElement(idx);
      };
      item.querySelector('.action-up').onclick = (e) => {
        e.stopPropagation();
        const idx = Number(item.dataset.index);
        this.moveElement(idx, idx - 1);
      };
      item.querySelector('.action-down').onclick = (e) => {
        e.stopPropagation();
        const idx = Number(item.dataset.index);
        this.moveElement(idx, idx + 1);
      };
      item.querySelector('.action-del').onclick = (e) => {
        e.stopPropagation();
        const idx = Number(item.dataset.index);
        this.deleteElement(idx);
      };
    });

    panel.querySelector('#btn-add-element-menu').onclick = () => {
      this.showAddElementModal();
    };
  }

  renderAssetsTab(panel) {
    const assets = this.project.assets || [];
    panel.innerHTML = `
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 10px;">
        点击素材直接插入当前分块画布中心：
      </div>
      <div class="asset-grid">
        ${assets.length === 0 ? `
          <div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 40px 0;">
            assets/ 目录暂无素材图片
          </div>
        ` : assets.map((a) => `
          <div class="asset-thumb" data-file="${a.name}">
            <img src="${a.url}" alt="${a.name}" loading="lazy" />
            <div class="asset-thumb-name">${a.name}</div>
          </div>
        `).join('')}
      </div>
    `;

    panel.querySelectorAll('.asset-thumb').forEach((item) => {
      item.onclick = () => {
        const file = item.dataset.file;
        this.addAssetElement(file);
      };
    });
  }

  renderScriptTab(panel) {
    panel.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 12px; font-size: 12px; line-height: 1.6;">
        <div style="font-weight: 600; color: #fff;">分镜任务与对齐</div>
        <div style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 6px; color: var(--text-secondary);">
          <pre style="white-space: pre-wrap; font-family: inherit;">${this.project.contentMd || '暂无 CONTENT.md 剧本'}</pre>
        </div>
      </div>
    `;
  }

  renderInspector() {
    const panel = this.container.querySelector('#inspector-panel');
    if (!panel) return;

    if (this.selectedIndex < 0 || !this.layout.elements[this.selectedIndex]) {
      this.renderBlockSettings(panel);
      return;
    }

    const el = this.layout.elements[this.selectedIndex];
    const isText = el.type === 'text';
    const isAsset = el.type === 'asset';
    const isRule = el.type === 'rule';
    const isCard = el.type === 'card';

    panel.innerHTML = `
      <div class="prop-section">
        <div class="prop-title">
          <span>${el.type.toUpperCase()} 元素属性</span>
          <button class="btn btn-ghost btn-sm" id="prop-duplicate">复制</button>
        </div>

        <div class="prop-row">
          <div class="prop-col">
            <label class="prop-label">X 坐标</label>
            <input type="number" class="prop-input" id="prop-x" value="${el.x ?? 0}" step="10" />
          </div>
          <div class="prop-col">
            <label class="prop-label">Y 坐标</label>
            <input type="number" class="prop-input" id="prop-y" value="${el.y ?? 0}" step="10" />
          </div>
          <div class="prop-col">
            <label class="prop-label">旋转角度 (°)</label>
            <input type="number" class="prop-input" id="prop-rotate" value="${el.rotate ?? 0}" step="1" />
          </div>
        </div>
      </div>

      ${isText ? this.renderTextInspector(el) : ''}
      ${isAsset ? this.renderAssetInspector(el) : ''}
      ${isRule ? this.renderRuleInspector(el) : ''}
      ${isCard ? this.renderCardInspector(el) : ''}

      <div class="prop-section" style="margin-top: auto;">
        <button class="btn btn-secondary" id="prop-delete" style="color: var(--accent-red); width: 100%;">
          🗑 删除此元素
        </button>
      </div>
    `;

    this.bindInspectorEvents(el);
  }

  renderTextInspector(el) {
    const hasBox = Boolean(el.box);
    return `
      <div class="prop-section">
        <div class="prop-title">文本内容 (支持语义标记)</div>
        <textarea class="prop-textarea" id="prop-content">${el.content || ''}</textarea>
        <div class="tag-buttons">
          <button class="btn-tag btn-tag-orange" id="tag-orange">+【关键词】橙</button>
          <button class="btn-tag btn-tag-blue" id="tag-blue">+『引语』蓝</button>
          <button class="btn-tag btn-tag-red" id="tag-red">+〖强信息〗毛笔</button>
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-title">排版与字阶</div>
        <div class="prop-row">
          <div class="prop-col">
            <label class="prop-label">字体</label>
            <select class="prop-select" id="prop-font">
              <option value="body" ${el.font === 'body' || !el.font ? 'selected' : ''}>文楷 (正文叙事推荐)</option>
              <option value="title" ${el.font === 'title' ? 'selected' : ''}>站酷快乐体 (活泼主标题)</option>
              <option value="butter" ${el.font === 'butter' ? 'selected' : ''}>站酷黄油体 (厚重高视觉冲击)</option>
              <option value="xiaowei" ${el.font === 'xiaowei' ? 'selected' : ''}>站酷小薇体 (文艺纤细标语)</option>
              <option value="handwriting" ${el.font === 'handwriting' ? 'selected' : ''}>小徕手写体 (生动对话气泡)</option>
              <option value="brush" ${el.font === 'brush' ? 'selected' : ''}>马善政毛笔 (苍劲雄浑重点)</option>
              <option value="running" ${el.font === 'running' ? 'selected' : ''}>志莽行书 (洒脱行书高光)</option>
              <option value="cursive" ${el.font === 'cursive' ? 'selected' : ''}>龙藏体 (写意草书飞白)</option>
              <option value="sans" ${el.font === 'sans' ? 'selected' : ''}>思源黑体 (现代干练科普)</option>
              <option value="serif" ${el.font === 'serif' ? 'selected' : ''}>思源宋体 (典雅古朴古籍)</option>
            </select>
          </div>
          <div class="prop-col">
            <label class="prop-label">字号 (px)</label>
            <input type="number" class="prop-input" id="prop-size" value="${el.size || 32}" step="2" />
          </div>
        </div>

        <div class="prop-row">
          <div class="prop-col">
            <label class="prop-label">对齐方式</label>
            <select class="prop-select" id="prop-align">
              <option value="left" ${el.align === 'left' ? 'selected' : ''}>左对齐</option>
              <option value="center" ${el.align === 'center' || !el.align ? 'selected' : ''}>居中对齐</option>
              <option value="right" ${el.align === 'right' ? 'selected' : ''}>右对齐</option>
            </select>
          </div>
          <div class="prop-col">
            <label class="prop-label">最大行宽 (max_width)</label>
            <input type="number" class="prop-input" id="prop-max-width" value="${el.max_width || 980}" step="20" />
          </div>
        </div>

        <div class="prop-row">
          <div class="prop-col">
            <label class="prop-label">行高倍率</label>
            <input type="number" class="prop-input" id="prop-line-height" value="${el.line_height || 1.45}" step="0.05" />
          </div>
          <div class="prop-col">
            <label class="prop-label">粗体</label>
            <select class="prop-select" id="prop-bold">
              <option value="true" ${el.bold ? 'selected' : ''}>是</option>
              <option value="false" ${!el.bold ? 'selected' : ''}>否</option>
            </select>
          </div>
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-title">
          <span>气泡边框 (box)</span>
          <input type="checkbox" id="prop-box-enable" ${hasBox ? 'checked' : ''} />
        </div>
        ${hasBox ? `
          <div class="prop-row">
            <div class="prop-col">
              <label class="prop-label">形制风格</label>
              <select class="prop-select" id="prop-box-style">
                <option value="fill" ${el.box.style === 'fill' ? 'selected' : ''}>fill (实底暖橙)</option>
                <option value="pill" ${el.box.style === 'pill' ? 'selected' : ''}>pill (胶囊底)</option>
                <option value="outline" ${el.box.style === 'outline' ? 'selected' : ''}>outline (白底黑边)</option>
                <option value="sketch" ${el.box.style === 'sketch' ? 'selected' : ''}>sketch (双线手绘)</option>
                <option value="ink" ${el.box.style === 'ink' ? 'selected' : ''}>ink (深墨底)</option>
                <option value="stamp" ${el.box.style === 'stamp' ? 'selected' : ''}>stamp (印章空心)</option>
                <option value="burst" ${el.box.style === 'burst' ? 'selected' : ''}>burst (爆炸齿)</option>
                <option value="marker" ${el.box.style === 'marker' ? 'selected' : ''}>marker (荧光横幅)</option>
              </select>
            </div>
            <div class="prop-col">
              <label class="prop-label">Tail 声源三角</label>
              <select class="prop-select" id="prop-box-tail">
                <option value="none" ${!el.box.tail || el.box.tail === 'none' ? 'selected' : ''}>无</option>
                <option value="bl" ${el.box.tail === 'bl' ? 'selected' : ''}>下左 (bl)</option>
                <option value="bc" ${el.box.tail === 'bc' ? 'selected' : ''}>下中 (bc)</option>
                <option value="br" ${el.box.tail === 'br' ? 'selected' : ''}>下右 (br)</option>
                <option value="tl" ${el.box.tail === 'tl' ? 'selected' : ''}>上左 (tl)</option>
                <option value="tc" ${el.box.tail === 'tc' ? 'selected' : ''}>上中 (tc)</option>
                <option value="tr" ${el.box.tail === 'tr' ? 'selected' : ''}>上右 (tr)</option>
                <option value="lc" ${el.box.tail === 'lc' ? 'selected' : ''}>左腰 (lc)</option>
                <option value="rc" ${el.box.tail === 'rc' ? 'selected' : ''}>右腰 (rc)</option>
              </select>
            </div>
          </div>
          <div class="prop-row">
            <div class="prop-col">
              <label class="prop-label">底色</label>
              <input type="color" class="prop-input" id="prop-box-bg" value="${el.box.bg || '#F6A83C'}" />
            </div>
            <div class="prop-col">
              <label class="prop-label">文字色</label>
              <input type="color" class="prop-input" id="prop-box-color" value="${el.box.color || '#4A2800'}" />
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  renderAssetInspector(el) {
    const assets = this.project.assets || [];
    return `
      <div class="prop-section">
        <div class="prop-title">插画素材属性</div>
        <div class="prop-col">
          <label class="prop-label">素材文件 (assets/)</label>
          <select class="prop-select" id="prop-asset-file">
            ${assets.map((a) => `
              <option value="${a.name}" ${el.file === a.name ? 'selected' : ''}>${a.name}</option>
            `).join('')}
          </select>
        </div>

        <div class="prop-row" style="margin-top: 8px;">
          <div class="prop-col">
            <label class="prop-label">宽 (px)</label>
            <input type="number" class="prop-input" id="prop-width" value="${el.width || ''}" placeholder="自动等比" />
          </div>
          <div class="prop-col">
            <label class="prop-label">高 (px)</label>
            <input type="number" class="prop-input" id="prop-height" value="${el.height || ''}" placeholder="自动等比" />
          </div>
        </div>

        <div class="prop-row" style="margin-top: 8px;">
          <div class="prop-col">
            <label class="prop-label">锚点 (Anchor)</label>
            <select class="prop-select" id="prop-anchor">
              <option value="cc" ${el.anchor === 'cc' ? 'selected' : ''}>中心 (cc)</option>
              <option value="ct" ${el.anchor === 'ct' ? 'selected' : ''}>顶中 (ct)</option>
              <option value="cb" ${el.anchor === 'cb' ? 'selected' : ''}>底中 (cb)</option>
              <option value="lc" ${el.anchor === 'lc' ? 'selected' : ''}>左中 (lc)</option>
              <option value="rc" ${el.anchor === 'rc' ? 'selected' : ''}>右中 (rc)</option>
              <option value="lt" ${el.anchor === 'lt' ? 'selected' : ''}>左上 (lt)</option>
              <option value="rt" ${el.anchor === 'rt' ? 'selected' : ''}>右上 (rt)</option>
            </select>
          </div>
          <div class="prop-col">
            <label class="prop-label">水平翻转 (flip)</label>
            <select class="prop-select" id="prop-flip">
              <option value="false" ${!el.flip ? 'selected' : ''}>正常</option>
              <option value="true" ${el.flip ? 'selected' : ''}>水平镜像</option>
            </select>
          </div>
        </div>
      </div>
    `;
  }

  renderRuleInspector(el) {
    return `
      <div class="prop-section">
        <div class="prop-title">分割线属性</div>
        <div class="prop-row">
          <div class="prop-col">
            <label class="prop-label">方向</label>
            <select class="prop-select" id="prop-rule-vert">
              <option value="false" ${!el.vertical ? 'selected' : ''}>水平横线</option>
              <option value="true" ${el.vertical ? 'selected' : ''}>垂直中轴线</option>
            </select>
          </div>
          <div class="prop-col">
            <label class="prop-label">粗细 (px)</label>
            <input type="number" class="prop-input" id="prop-thickness" value="${el.thickness || 2}" />
          </div>
        </div>
      </div>
    `;
  }

  renderCardInspector(el) {
    return `
      <div class="prop-section">
        <div class="prop-title">卡片属性</div>
        <div class="prop-row">
          <div class="prop-col">
            <label class="prop-label">宽</label>
            <input type="number" class="prop-input" id="prop-width" value="${el.width || 400}" />
          </div>
          <div class="prop-col">
            <label class="prop-label">高</label>
            <input type="number" class="prop-input" id="prop-height" value="${el.height || 200}" />
          </div>
        </div>
        <div class="prop-col" style="margin-top: 8px;">
          <label class="prop-label">卡片标题标签</label>
          <input type="text" class="prop-input" id="prop-card-label" value="${el.label || ''}" />
        </div>
      </div>
    `;
  }

  renderBlockSettings(panel) {
    const elCount = (this.layout.elements || []).length;
    panel.innerHTML = `
      <div class="prop-section">
        <div class="prop-title">画布分块设定</div>
        <div class="prop-row">
          <div class="prop-col">
            <label class="prop-label">画布宽度 (标准 1080)</label>
            <input type="number" class="prop-input" id="block-w" value="${this.layout.width || 1080}" />
          </div>
          <div class="prop-col">
            <label class="prop-label">画布高度</label>
            <input type="number" class="prop-input" id="block-h" value="${this.layout.height || 2500}" step="100" />
          </div>
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-title">分块指标概览</div>
        <div style="display: flex; flex-direction: column; gap: 8px; font-size: 12px; color: var(--text-secondary);">
          <div>元素总数: <span style="color: #fff; font-weight: 600;">${elCount}</span> 个</div>
          <div>插画素材: <span style="color: #fff; font-weight: 600;">${(this.layout.elements || []).filter((e) => e.type === 'asset').length}</span> 张</div>
          <div>文字图层: <span style="color: #fff; font-weight: 600;">${(this.layout.elements || []).filter((e) => e.type === 'text').length}</span> 组</div>
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-title">提示</div>
        <div style="font-size: 12px; color: var(--text-muted); line-height: 1.5;">
          • 点击画布上的任意文字或图片进行选中与拖拽位置<br/>
          • 按住 Shift + 方向键可做 10px 精准平移<br/>
          • 按 Ctrl+S 立即将所有改动保存至磁盘并渲染
        </div>
      </div>
    `;

    const bw = panel.querySelector('#block-w');
    const bh = panel.querySelector('#block-h');
    const updateSize = () => {
      this.recordSnapshot();
      this.layout.width = Number(bw.value) || 1080;
      this.layout.height = Number(bh.value) || 2500;
      this.redrawCanvas();
    };
    bw.onchange = updateSize;
    bh.onchange = updateSize;
  }

  bindInspectorEvents(el) {
    const panel = this.container.querySelector('#inspector-panel');
    if (!panel) return;

    const bindNum = (id, prop) => {
      const input = panel.querySelector(id);
      if (input) {
        input.oninput = () => {
          el[prop] = Number(input.value);
          this.redrawCanvas();
        };
        input.onchange = () => this.recordSnapshot();
      }
    };

    bindNum('#prop-x', 'x');
    bindNum('#prop-y', 'y');
    bindNum('#prop-rotate', 'rotate');
    bindNum('#prop-size', 'size');
    bindNum('#prop-max-width', 'max_width');
    bindNum('#prop-line-height', 'line_height');
    bindNum('#prop-width', 'width');
    bindNum('#prop-height', 'height');

    // 文本内容
    const content = panel.querySelector('#prop-content');
    if (content) {
      content.oninput = () => {
        el.content = content.value;
        this.redrawCanvas();
      };
      content.onchange = () => this.recordSnapshot();
    }

    // 语义标签快捷按钮
    const insertTag = (prefix, suffix) => {
      if (!content) return;
      const start = content.selectionStart;
      const end = content.selectionEnd;
      const sel = content.value.substring(start, end);
      const rep = `${prefix}${sel || '高亮内容'}${suffix}`;
      content.value = content.value.substring(0, start) + rep + content.value.substring(end);
      el.content = content.value;
      this.recordSnapshot();
      this.redrawCanvas();
    };

    const tagOrange = panel.querySelector('#tag-orange');
    if (tagOrange) tagOrange.onclick = () => insertTag('【', '】');
    const tagBlue = panel.querySelector('#tag-blue');
    if (tagBlue) tagBlue.onclick = () => insertTag('『', '』');
    const tagRed = panel.querySelector('#tag-red');
    if (tagRed) tagRed.onclick = () => insertTag('〖', '〗');

    // 字体、对齐、粗体
    const font = panel.querySelector('#prop-font');
    if (font) font.onchange = () => { el.font = font.value; this.recordSnapshot(); this.redrawCanvas(); };
    const align = panel.querySelector('#prop-align');
    if (align) align.onchange = () => { el.align = align.value; this.recordSnapshot(); this.redrawCanvas(); };
    const bold = panel.querySelector('#prop-bold');
    if (bold) bold.onchange = () => { el.bold = bold.value === 'true'; this.recordSnapshot(); this.redrawCanvas(); };

    // 气泡开关与属性
    const boxEnable = panel.querySelector('#prop-box-enable');
    if (boxEnable) {
      boxEnable.onchange = () => {
        if (boxEnable.checked) {
          el.box = el.box || { style: 'fill', bg: '#F6A83C', color: '#4A2800', pad: [12, 18], tail: 'none' };
        } else {
          delete el.box;
        }
        this.recordSnapshot();
        this.renderInspector();
        this.redrawCanvas();
      };
    }

    const boxStyle = panel.querySelector('#prop-box-style');
    if (boxStyle) boxStyle.onchange = () => { el.box.style = boxStyle.value; this.recordSnapshot(); this.redrawCanvas(); };
    const boxTail = panel.querySelector('#prop-box-tail');
    if (boxTail) boxTail.onchange = () => { el.box.tail = boxTail.value; this.recordSnapshot(); this.redrawCanvas(); };
    const boxBg = panel.querySelector('#prop-box-bg');
    if (boxBg) boxBg.oninput = () => { el.box.bg = boxBg.value; this.recordSnapshot(); this.redrawCanvas(); };
    const boxColor = panel.querySelector('#prop-box-color');
    if (boxColor) boxColor.oninput = () => { el.box.color = boxColor.value; this.recordSnapshot(); this.redrawCanvas(); };

    // 素材属性
    const assetFile = panel.querySelector('#prop-asset-file');
    if (assetFile) assetFile.onchange = () => { el.file = assetFile.value; this.recordSnapshot(); this.redrawCanvas(); };
    const anchor = panel.querySelector('#prop-anchor');
    if (anchor) anchor.onchange = () => { el.anchor = anchor.value; this.recordSnapshot(); this.redrawCanvas(); };
    const flip = panel.querySelector('#prop-flip');
    if (flip) flip.onchange = () => { el.flip = flip.value === 'true'; this.recordSnapshot(); this.redrawCanvas(); };

    // 复制元素
    const dup = panel.querySelector('#prop-duplicate');
    if (dup) {
      dup.onclick = () => {
        const copy = JSON.parse(JSON.stringify(el));
        copy.x = (copy.x || 0) + 30;
        copy.y = (copy.y || 0) + 30;
        this.layout.elements.push(copy);
        this.recordSnapshot();
        this.selectElement(this.layout.elements.length - 1);
      };
    }

    // 删除元素
    const del = panel.querySelector('#prop-delete');
    if (del) del.onclick = () => this.deleteElement(this.selectedIndex);
  }

  moveElement(from, to) {
    const list = this.layout.elements;
    if (to < 0 || to >= list.length) return;
    this.recordSnapshot();
    const item = list.splice(from, 1)[0];
    list.splice(to, 0, item);
    this.selectElement(to);
  }

  deleteElement(index) {
    if (index < 0 || index >= this.layout.elements.length) return;
    this.recordSnapshot();
    this.layout.elements.splice(index, 1);
    this.selectElement(-1);
  }

  addAssetElement(fileName) {
    this.recordSnapshot();
    const el = {
      type: 'asset',
      file: fileName,
      x: 540,
      y: 600,
      height: 400,
      anchor: 'cc',
    };
    this.layout.elements.push(el);
    this.selectElement(this.layout.elements.length - 1);
  }

  showAddElementModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-card" style="max-width: 440px;">
        <div class="modal-header">
          <div class="modal-title">添加新元素</div>
          <button class="btn btn-ghost btn-icon" id="add-modal-close">✕</button>
        </div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
          <button class="btn btn-secondary" style="padding: 16px; flex-direction: column;" id="add-btn-text">
            <span style="font-size: 20px;">T</span>
            <span>添加普通文本</span>
          </button>
          <button class="btn btn-secondary" style="padding: 16px; flex-direction: column;" id="add-btn-bubble">
            <span style="font-size: 20px;">💬</span>
            <span>添加手绘气泡</span>
          </button>
          <button class="btn btn-secondary" style="padding: 16px; flex-direction: column;" id="add-btn-rule">
            <span style="font-size: 20px;">━</span>
            <span>添加水平分割线</span>
          </button>
          <button class="btn btn-secondary" style="padding: 16px; flex-direction: column;" id="add-btn-card">
            <span style="font-size: 20px;">▭</span>
            <span>添加信息卡片</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('#add-modal-close').onclick = close;

    const addAndClose = (el) => {
      this.recordSnapshot();
      this.layout.elements.push(el);
      close();
      this.selectElement(this.layout.elements.length - 1);
    };

    modal.querySelector('#add-btn-text').onclick = () => {
      addAndClose({
        type: 'text',
        content: '新文本内容',
        x: 540,
        y: 400,
        size: 32,
        align: 'center',
        font: 'body',
      });
    };

    modal.querySelector('#add-btn-bubble').onclick = () => {
      addAndClose({
        type: 'text',
        content: '『发话内容或金句』',
        x: 540,
        y: 450,
        size: 28,
        bold: true,
        align: 'center',
        box: {
          style: 'fill',
          bg: '#F6A83C',
          color: '#4A2800',
          pad: [12, 18],
          tail: 'bc',
        },
      });
    };

    modal.querySelector('#add-btn-rule').onclick = () => {
      addAndClose({
        type: 'rule',
        x1: 140,
        x2: 940,
        y: 500,
        color: '#EFECE6',
        thickness: 2,
      });
    };

    modal.querySelector('#add-btn-card').onclick = () => {
      addAndClose({
        type: 'card',
        x: 80,
        y: 400,
        width: 920,
        height: 300,
        label: '核心观点',
      });
    };
  }

  async showLintModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-card" style="max-width: 640px;">
        <div class="modal-header">
          <div class="modal-title">机检质量判定报告 (${this.currentBlockId})</div>
          <button class="btn btn-ghost btn-icon" id="lint-modal-close">✕</button>
        </div>
        <div id="lint-modal-body" style="font-size: 13px; line-height: 1.6; color: var(--text-secondary);">
          正在运行 Node/Skia 静态排版与几何检查...
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('#lint-modal-close').onclick = () => modal.remove();

    try {
      const res = await this.app.api.lintBlock(this.project.id, this.currentBlockId);
      const body = modal.querySelector('#lint-modal-body');
      const isClean = res.lint?.hard === 0;

      body.innerHTML = `
        <div style="display: flex; gap: 10px; margin-bottom: 16px;">
          <div style="flex: 1; background: ${isClean ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'}; border: 1px solid ${isClean ? '#10b981' : '#ef4444'}; padding: 12px; border-radius: 8px;">
            <div style="font-weight: 700; color: ${isClean ? '#34d399' : '#f87171'}; font-size: 16px;">
              ${isClean ? '✔ 机检通过 (Hard = 0)' : '✕ 存在硬性违规 (Hard > 0)'}
            </div>
            <div style="font-size: 12px; margin-top: 4px;">
              硬伤 (Hard): ${res.lint?.hard ?? 0} · 提示 (Warn): ${res.lint?.warn ?? 0}
            </div>
          </div>
        </div>

        <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; max-height: 280px; overflow-y: auto;">
          <pre style="white-space: pre-wrap; font-family: monospace; font-size: 12px; color: #d4d4d8;">${JSON.stringify(res, null, 2)}</pre>
        </div>
      `;
    } catch (err) {
      modal.querySelector('#lint-modal-body').textContent = `机检失败: ${err.message}`;
    }
  }

  async showStitchModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-card" style="max-width: 800px; max-height: 90vh;">
        <div class="modal-header">
          <div class="modal-title">长图总览与拼接</div>
          <button class="btn btn-ghost btn-icon" id="stitch-modal-close">✕</button>
        </div>
        <div id="stitch-modal-body" style="display: flex; flex-direction: column; align-items: center; gap: 16px; overflow-y: auto;">
          <div style="display: flex; gap: 10px; width: 100%;">
            <button class="btn btn-primary" id="btn-trigger-stitch" style="flex: 1;">
              ⚡ 立即执行所有分块拼接
            </button>
          </div>
          <div id="stitch-img-wrap" style="width: 100%; text-align: center;">
            ${this.project.previewUrl ? `
              <img src="${this.project.previewUrl}?t=${Date.now()}" style="max-width: 100%; border: 1px solid #333; border-radius: 6px;" />
            ` : '<div style="padding: 40px; color: var(--text-muted);">暂无长图产物，点击上方按钮开始拼接</div>'}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    modal.querySelector('#stitch-modal-close').onclick = () => modal.remove();

    const triggerBtn = modal.querySelector('#btn-trigger-stitch');
    triggerBtn.onclick = async () => {
      triggerBtn.textContent = '正在通过 Canvas 拼接长图...';
      triggerBtn.disabled = true;
      try {
        const res = await this.app.api.stitchProject(this.project.id);
        triggerBtn.textContent = '拼接完成！再次拼接';
        triggerBtn.disabled = false;
        modal.querySelector('#stitch-img-wrap').innerHTML = `
          <div style="font-size: 13px; color: #34d399; margin-bottom: 8px;">
            ✔ 拼接成功！尺寸: ${res.width} × ${res.height} px
          </div>
          <img src="${res.prevUrl}" style="max-width: 100%; border: 1px solid #333; border-radius: 6px;" />
        `;
        this.app.toast('长图拼接完成！', 'success');
      } catch (err) {
        alert(`拼接失败: ${err.message}`);
        triggerBtn.textContent = '立即执行所有分块拼接';
        triggerBtn.disabled = false;
      }
    };
  }
}
