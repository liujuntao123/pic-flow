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
    this._sel = []; // 选中栈：支持多选，末位为主选中（selectedIndex 存取器映射到它）
    this.selectedIndex = -1;
    this.zoom = 0.45; // 默认缩放比例以适配屏幕
    this.showGrid = true;
    this.activeSidebarTab = 'layers'; // layers | assets | script
    this.hasUnsavedChanges = false;
    this.lastSavedMtime = null;
    this.undoStack = [];
    this.redoStack = [];
    this._staged = null; // 拖拽/输入进行中的暂存快照（改动前记、确认后提交）

    // 交互拖拽状态
    this.isDragging = false;
    this.dragMode = 'move'; // move | resize | pan | marquee
    this.dragMoved = false; // 本次按下后是否真的移动过：纯点击不进撤销栈
    this.spacePan = false;  // 空格按住 = 平移模式
    this.resizeHandle = null;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragStartElemW = 0;
    this.dragStartElemH = 0;
    this.dragStartBox = null;  // 按下时的包围盒快照（缩放期间的稳定基准）
    this.dragStartRot = null;  // 按下时的旋转信息快照
    this.hitBoxes = [];

    // 多选批量移动
    this.dragStartPositions = []; // 拖拽前所有选中元素的 {index, x, y}
    this.dragStartGroupBox = null; // 拖拽前选中组的联合包围盒（对齐吸附基准）

    // 对齐参考线（拖拽时实时计算，{v:[x...], h:[y...]}，画布坐标）
    this.activeGuides = null;

    // 框选
    this.marqueeStart = null;
    this.marqueeEl = null;

    // 画布内文本编辑（覆盖层 textarea）
    this.inlineEditing = null;      // { ta, index }
    this.hiddenElementIndex = -1;

    // 轮询检查 Agent 磁盘文件变更
    this.pollTimer = null;
    this.agentUpdateNotice = null;
  }

  /** 主选中元素：多选时为最后点入的那个（唯一显示变换手柄），无选中为 -1 */
  get selectedIndex() {
    return this._sel.length > 0 ? this._sel[this._sel.length - 1] : -1;
  }

  set selectedIndex(index) {
    this._sel = Number.isInteger(index) && index >= 0 ? [index] : [];
  }

  get selectedIndices() {
    return this._sel;
  }

  isSelected(index) {
    return this._sel.includes(index);
  }

  /** 选中变化后统一的界面刷新 */
  refreshSelectionUI() {
    this.redrawCanvas();
    this.renderSidebar();
    this.renderInspector();
  }

  /** Shift+点击切换多选 */
  toggleSelect(index) {
    const pos = this._sel.indexOf(index);
    if (pos >= 0) this._sel.splice(pos, 1);
    else this._sel.push(index);
    this.refreshSelectionUI();
  }

  setSelection(indices) {
    const total = this.layout?.elements?.length || 0;
    this._sel = indices.filter((i) => Number.isInteger(i) && i >= 0 && i < total);
    this.refreshSelectionUI();
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
    // 全局监听必须在离开编辑器时摘掉：否则在项目列表页按 Ctrl+S
    // 仍会用已经过期的编辑器 buffer 覆盖磁盘（实测踩过）。
    if (this.keydownHandler && window.onkeydown === this.keydownHandler) window.onkeydown = null;
    if (this.keyupHandler && window.onkeyup === this.keyupHandler) window.onkeyup = null;
    if (this.blurHandler && window.onblur === this.blurHandler) window.onblur = null;
    if (this.mousemoveHandler && window.onmousemove === this.mousemoveHandler) window.onmousemove = null;
    if (this.mouseupHandler && window.onmouseup === this.mouseupHandler) window.onmouseup = null;
    this.spacePan = false;
    // 画布内编辑器与框选框是挂到视口 DOM 上的，离开时一并清理
    if (this.inlineEditing) {
      this.inlineEditing.ta.remove();
      this.inlineEditing = null;
    }
    this.hiddenElementIndex = -1;
    if (this.marqueeEl) {
      this.marqueeEl.remove();
      this.marqueeEl = null;
    }
    const banner = this.container && this.container.querySelector('#agent-sync-banner');
    if (banner) banner.remove();
  }

  /** 任何一次真实修改都要立刻置脏：否则 2.5s 轮询会把正在输入的草稿当成"无改动"覆盖掉。 */
  markDirty() {
    if (this.hasUnsavedChanges) return;
    this.hasUnsavedChanges = true;
    this.app.updateStatus(false);
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

  /**
   * 暂存/提交式快照：拖拽、输入框这类「按下时还不知道会不会真改」的场景，
   * 必须在**改动发生前**暂存、确认改动后提交。若在改动后 recordSnapshot，
   * 撤销栈顶存的就是改完的状态，Ctrl+Z 第一下会原地踏步。
   */
  stageSnapshot() {
    this._staged = JSON.stringify(this.layout);
  }

  commitStaged() {
    if (this._staged === null || this._staged === undefined) return;
    this.undoStack.push(this._staged);
    this._staged = null;
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
    this.hasUnsavedChanges = true;
    this.app.updateStatus(false);
  }

  discardStaged() {
    this._staged = null;
  }

  /** 先暂存再执行改动（select/color 等一步到位的控件用） */
  editWithSnapshot(fn) {
    this.stageSnapshot();
    fn();
    this.commitStaged();
  }

  undo() {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(JSON.stringify(this.layout));
    const prev = this.undoStack.pop();
    this.layout = JSON.parse(prev);
    // 撤销后元素数量可能变化，钳掉越界的选中索引
    this._sel = this._sel.filter((i) => i < (this.layout.elements || []).length);
    this.hasUnsavedChanges = true;
    this.app.updateStatus(false);
    this.refreshSelectionUI();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(JSON.stringify(this.layout));
    const next = this.redoStack.pop();
    this.layout = JSON.parse(next);
    this._sel = this._sel.filter((i) => i < (this.layout.elements || []).length);
    this.hasUnsavedChanges = true;
    this.app.updateStatus(false);
    this.refreshSelectionUI();
  }

  async saveLayout(autoRender = true) {
    if (!this.layout) return;
    try {
      const res = await this.app.api.saveBlockLayout(
        this.project.id, this.currentBlockId, this.layout, autoRender, this.lastSavedMtime,
      );
      this.lastSavedMtime = res.updatedAt;
      this.hasUnsavedChanges = false;
      this.app.updateStatus(true);
      if (res.renderError) {
        // 保存成功但渲染失败：不能报"已完成渲染"，否则用户会拿着上一版的切片去拼接
        this.app.toast(`已保存，但 Canvas 渲染失败：${res.renderError}`, 'error');
      } else {
        this.app.toast(`已保存至 layout/${this.currentBlockId}.json${autoRender ? ' (已完成 Canvas 渲染)' : ''}`, 'success');
      }
      const b = this.container.querySelector('#agent-sync-banner');
      if (b) b.remove();
    } catch (err) {
      if (err.status === 409) {
        const reload = confirm(`${err.message}\n\n是否立即载入磁盘上的最新版本？（当前编辑内容将丢失）`);
        if (reload) {
          await this.loadBlockLayout(this.currentBlockId);
          this.render();
        }
        return;
      }
      this.app.toast(`保存失败: ${err.message}`, 'error');
    }
  }

  render() {
    if (!this.project || !this.layout) return;
    // 整个编辑器 DOM 重建：画布内编辑器与框选层必须一并失效
    this.inlineEditing = null;
    this.hiddenElementIndex = -1;
    this.marqueeEl = null;
    this.activeGuides = null;

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

    // 新增分块：用「已有最大编号 + 1」，数量法在 block1+block3 这种缺号工程里会撞车
    this.container.querySelector('#btn-add-block').onclick = async () => {
      const maxNum = this.project.blocks.reduce((m, b) => {
        const n = Number(String(b.id).replace(/[^0-9]/g, ''));
        return Number.isFinite(n) ? Math.max(m, n) : m;
      }, 0);
      const blockId = `block${maxNum + 1}`;
      if (!confirm(`是否在工程中创建新分块 ${blockId}？`)) return;
      try {
        await this.app.api.createBlock(this.project.id, blockId);
        this.app.toast(`分块 ${blockId} 创建成功！`, 'success');
        this.load(this.project.id, blockId);
      } catch (err) {
        this.app.toast(`创建分块失败: ${err.message}`, 'error');
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
    if (this.inlineEditing) this.commitInlineEdit();
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
    const inEditable = (target) => !target
      || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      || target.isContentEditable;

    this.keydownHandler = (e) => {
      // 空格按住 = 平移模式（光标变抓手）。输入法/输入框内不接管。
      if (e.code === 'Space' && !inEditable(e.target)) {
        if (!this.spacePan) {
          this.spacePan = true;
          const vp = this.container.querySelector('#canvas-viewport');
          if (vp) vp.classList.add('panning');
        }
        if (!this.isDragging) e.preventDefault();
        return;
      }

      // 输入框里只接管 Ctrl+S（保存），Ctrl+Z 等留给输入框原生撤销
      if (inEditable(e.target)) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          this.saveLayout(true);
        }
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === 's') {
        e.preventDefault();
        this.saveLayout(true);
      } else if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        this.redo();
      } else if (mod && key === 'd') {
        e.preventDefault();
        this.duplicateSelected();
      } else if (mod && (key === '=' || key === '+')) {
        e.preventDefault();
        this.zoomBy(0.1);
      } else if (mod && key === '-') {
        e.preventDefault();
        this.zoomBy(-0.1);
      } else if (mod && key === '0') {
        e.preventDefault();
        this.autoFitZoom();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this._sel.length > 0) {
          e.preventDefault();
          this.deleteSelection();
        }
      } else if (e.key === 'Escape') {
        // 先关弹窗，再取消选中
        const modal = this.container.querySelector('.modal-overlay')
          || document.querySelector('body > .modal-overlay');
        if (modal) {
          modal.remove();
        } else if (this._sel.length > 0) {
          this._sel = [];
          this.refreshSelectionUI();
        }
      } else if (e.key === '?') {
        e.preventDefault();
        this.showHelpModal();
      } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        if (this._sel.length > 0) {
          // 有选中元素：方向键批量微调（Shift = 10px 步进）
          const step = e.shiftKey ? 10 : 1;
          this.recordSnapshot();
          for (const i of this._sel) {
            const el = this.layout.elements[i];
            if (!el) continue;
            if (e.key === 'ArrowLeft') el.x = (el.x || 0) - step;
            if (e.key === 'ArrowRight') el.x = (el.x || 0) + step;
            if (e.key === 'ArrowUp') el.y = (el.y || 0) - step;
            if (e.key === 'ArrowDown') el.y = (el.y || 0) + step;
          }
          this.redrawCanvas();
          this.renderInspector();
        } else {
          // 无选中元素：方向键平移画布视口（Shift = 快速滚动）
          this.panViewport(e.key, e.shiftKey ? 480 : 120);
        }
      } else if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        this.panViewport(e.key, Math.round(this.container.clientHeight * 0.8));
      }
    };

    this.keyupHandler = (e) => {
      if (e.code === 'Space') {
        this.spacePan = false;
        const vp = this.container.querySelector('#canvas-viewport');
        if (vp) vp.classList.remove('panning');
      }
    };

    // 窗口失焦时松开空格锁存，否则切窗口回来后拖拽会一直处于平移模式
    this.blurHandler = () => {
      this.spacePan = false;
      const vp = this.container.querySelector('#canvas-viewport');
      if (vp) vp.classList.remove('panning');
    };

    window.onkeydown = this.keydownHandler;
    window.onkeyup = this.keyupHandler;
    window.onblur = this.blurHandler;
  }

  /** 平移画布视口（方向键 / PageUp / PageDown） */
  panViewport(direction, step = 120) {
    const vp = this.container.querySelector('#canvas-viewport');
    if (!vp) return;
    if (direction === 'ArrowLeft' || direction === 'PageUp') vp.scrollLeft -= step;
    if (direction === 'ArrowRight' || direction === 'PageDown') vp.scrollLeft += step;
    if (direction === 'ArrowUp') vp.scrollTop -= step;
    if (direction === 'ArrowDown') vp.scrollTop += step;
  }

  /** 以视口中心为锚点缩放（快捷键 Ctrl + / Ctrl -） */
  zoomBy(delta) {
    const vp = this.container.querySelector('#canvas-viewport');
    const old = this.zoom;
    const next = Math.max(0.15, Math.min(2.0, old + delta));
    if (next === old) return;
    this.setZoom(next);
    if (!vp) return;
    // 保持视口中心的内容不跳：内容尺寸随 zoom 线性变化，按比例修正滚动量
    const cx = vp.scrollLeft + vp.clientWidth / 2;
    const cy = vp.scrollTop + vp.clientHeight / 2;
    const ratio = next / old;
    vp.scrollLeft = cx * ratio - vp.clientWidth / 2;
    vp.scrollTop = cy * ratio - vp.clientHeight / 2;
  }

  bindCanvasInteraction() {
    const canvas = this.container.querySelector('#canvas-board');
    if (!canvas) return;
    const vp = this.container.querySelector('#canvas-viewport');

    // 视口级平移：按住空格拖拽，或中键拖拽（不依赖画布内命中，背景空白也能拖）
    if (vp) {
      vp.onmousedown = (e) => {
        if (e.button !== 1 && !this.spacePan) return;
        e.preventDefault();
        this.isDragging = true;
        this.dragMode = 'pan';
        this.dragMoved = false;
        this.panStartClientX = e.clientX;
        this.panStartClientY = e.clientY;
        this.panStartScrollLeft = vp.scrollLeft;
        this.panStartScrollTop = vp.scrollTop;
      };

      // Ctrl/⌘ + 滚轮：以光标为锚点缩放（普通滚轮仍走原生滚动）
      this.wheelHandler = (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const old = this.zoom;
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const next = Math.max(0.15, Math.min(2.0, Math.round(old * factor * 100) / 100));
        if (next === old) return;
        const rect = vp.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        this.setZoom(next);
        const ratio = next / old;
        vp.scrollLeft = vp.scrollLeft * ratio + mx * (ratio - 1);
        vp.scrollTop = vp.scrollTop * ratio + my * (ratio - 1);
      };
      vp.addEventListener('wheel', this.wheelHandler, { passive: false });
    }

    canvas.onmousedown = (e) => {
      // 平移模式下画布点击不参与选择
      if (this.spacePan || e.button === 1) return;
      // 正在画布内编辑文本时，点画布即提交（textarea blur 也会触发，此处兜底）
      if (this.inlineEditing) this.commitInlineEdit();

      const rect = canvas.getBoundingClientRect();
      const scale = this.zoom;
      const canvasX = (e.clientX - rect.left) / scale;
      const canvasY = (e.clientY - rect.top) / scale;

      // 检查是否点在主选中元素的变换手柄上（按元素类型给出手柄，旋转元素已逆旋转比对）
      if (this.selectedIndex >= 0 && this.hitBoxes[this.selectedIndex]) {
        const target = this.hitBoxes[this.selectedIndex];
        const handle = this.app.renderer.findHandle(target, canvasX, canvasY, this.zoom);
        if (handle) {
          this.isDragging = true;
          this.dragMode = 'resize';
          this.dragMoved = false;
          this.resizeHandle = handle;
          this.dragStartX = canvasX;
          this.dragStartY = canvasY;
          this.stageSnapshot(); // 改动前暂存，真拖动了才在 mouseup 提交
          const el = target.element;
          if (el.type === 'text') {
            this.dragStartElemW = el.max_width ?? 940;
          } else if (el.type !== 'rule') {
            // asset 宽高可能未显式声明（按图片比例推导），这里以实际渲染框为准
            this.dragStartElemW = target.width;
            this.dragStartElemH = target.height;
          }
          // 起点快照：拖拽期间 redrawCanvas 会刷新 hitBoxes，
          // 缩放计算必须全部基于按下时的几何，否则增量会被重复累加
          this.dragStartBox = [...target.box];
          this.dragStartRot = target.rot || null;
          return;
        }
      }

      // 命中检测（全量版：同一位置的层叠元素从顶到底都拿到）
      const hits = this.app.renderer.hitTestAll(this.hitBoxes, canvasX, canvasY, this.zoom);
      if (hits.length > 0) {
        const topHit = hits[0];
        if (e.shiftKey) {
          // Shift+点击：切换多选，随后可直接拖动整组
          if (!this.isSelected(topHit)) this._sel.push(topHit);
          else this.toggleSelectOff(topHit);
        } else if (e.altKey && hits.length > 1 && hits.includes(this.selectedIndex)) {
          // Alt+点击：在命中堆叠里向下轮换（穿透选择），再点一轮回到顶层
          const pos = hits.indexOf(this.selectedIndex);
          const idx = hits[(pos + 1) % hits.length];
          this._sel = [idx];
          this.refreshSelectionUI();
        } else if (!this.isSelected(topHit)) {
          this._sel = [topHit];
          this.refreshSelectionUI();
        }
        this.beginDragMove(canvasX, canvasY);
      } else if (!e.shiftKey) {
        // 空白处按下：框选（松开时几乎无位移则视为取消全选）
        this.isDragging = true;
        this.dragMode = 'marquee';
        this.dragMoved = false;
        this.marqueeStart = [canvasX, canvasY];
        this.showMarquee(canvasX, canvasY, canvasX, canvasY);
      }
    };

    // 悬停光标反馈：手柄 → 方向缩放光标，元素 → 移动，空白 → 十字
    canvas.onmousemove = (e) => {
      if (this.isDragging) return;
      const rect = canvas.getBoundingClientRect();
      const cx = (e.clientX - rect.left) / this.zoom;
      const cy = (e.clientY - rect.top) / this.zoom;
      let cursor = 'crosshair';
      if (this.selectedIndex >= 0 && this.hitBoxes[this.selectedIndex]) {
        const handle = this.app.renderer.findHandle(this.hitBoxes[this.selectedIndex], cx, cy, this.zoom);
        if (handle) cursor = this.cursorForHandle(handle);
      }
      if (cursor === 'crosshair') {
        const hit = this.app.renderer.hitTest(this.hitBoxes, cx, cy, this.zoom);
        if (hit >= 0) cursor = 'move';
      }
      canvas.style.cursor = cursor;
    };

    // 双击文本元素：直接在画布上编辑（覆盖层 textarea，画布本体临时隐藏）。
    // 注意不要触发 refreshSelectionUI 的重绘：它会与 startInlineEdit 的隐藏渲染
    // 竞速（渲染令牌只保护命中数据，不保护画布像素），后画完的那个会把
    // 元素本体画回来，和编辑框叠成两份内容。
    canvas.ondblclick = (e) => {
      const rect = canvas.getBoundingClientRect();
      const canvasX = (e.clientX - rect.left) / this.zoom;
      const canvasY = (e.clientY - rect.top) / this.zoom;
      const hits = this.app.renderer.hitTestAll(this.hitBoxes, canvasX, canvasY, this.zoom);
      const idx = hits.find((i) => this.layout.elements[i]?.type === 'text');
      if (idx === undefined) return;
      if (this.inlineEditing) this.commitInlineEdit();
      this._sel = [idx];
      this.renderSidebar();
      this.renderInspector();
      this.startInlineEdit(idx);
    };

    this.mousemoveHandler = (e) => {
      if (!this.isDragging) return;

      // 视口平移：不依赖选中元素
      if (this.dragMode === 'pan') {
        const viewport = this.container.querySelector('#canvas-viewport');
        if (!viewport) return;
        const dx = e.clientX - this.panStartClientX;
        const dy = e.clientY - this.panStartClientY;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.dragMoved = true;
        viewport.scrollLeft = this.panStartScrollLeft - dx;
        viewport.scrollTop = this.panStartScrollTop - dy;
        return;
      }

      // 框选：更新选框，松开时统一结算
      if (this.dragMode === 'marquee') {
        const rect = canvas.getBoundingClientRect();
        const cx = (e.clientX - rect.left) / this.zoom;
        const cy = (e.clientY - rect.top) / this.zoom;
        if (Math.abs(cx - this.marqueeStart[0]) + Math.abs(cy - this.marqueeStart[1]) > 3 / this.zoom) {
          this.dragMoved = true;
        }
        this.showMarquee(this.marqueeStart[0], this.marqueeStart[1], cx, cy);
        return;
      }

      if (this.selectedIndex < 0) return;
      const canvasRect = canvas.getBoundingClientRect();
      const scale = this.zoom;
      const canvasX = (e.clientX - canvasRect.left) / scale;
      const canvasY = (e.clientY - canvasRect.top) / scale;
      const dx = Math.round(canvasX - this.dragStartX);
      const dy = Math.round(canvasY - this.dragStartY);
      if (dx === 0 && dy === 0) return;
      this.dragMoved = true;

      const el = this.layout.elements[this.selectedIndex];
      if (this.dragMode === 'move') {
        // 批量移动：所有选中元素保持相对位置一起走
        const snap = this.computeSnap(dx, dy);
        this.activeGuides = snap.guides;
        for (const p of this.dragStartPositions) {
          const target = this.layout.elements[p.index];
          if (!target) continue;
          target.x = Math.round(p.x + dx + snap.dx);
          target.y = Math.round(p.y + dy + snap.dy);
        }
        this.markDirty();
        this.redrawCanvas();
        if (this._sel.length === 1) this.renderInspector();
      } else if (this.dragMode === 'resize') {
        // 旋转元素的拖拽位移要转回元素局部坐标系，手柄才跟着元素方向走
        let ldx = dx;
        let ldy = dy;
        if (this.dragStartRot && this.dragStartRot.deg) {
          const rad = (-this.dragStartRot.deg * Math.PI) / 180;
          ldx = dx * Math.cos(rad) - dy * Math.sin(rad);
          ldy = dx * Math.sin(rad) + dy * Math.cos(rad);
        }
        this.applyResize(el, { box: this.dragStartBox }, this.resizeHandle, ldx, ldy);
        this.markDirty();
        this.redrawCanvas();
        this.renderInspector();
      }
    };

    this.mouseupHandler = () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      if (this.dragMode === 'marquee') {
        this.finishMarquee();
        this.discardStaged();
      } else if (this.dragMode !== 'pan') {
        // 拖拽/缩放：真拖动了才提交改动前暂存的快照，纯点击丢弃
        if (this.dragMoved) this.commitStaged();
        else this.discardStaged();
      }
      // 收掉对齐参考线
      if (this.activeGuides) {
        this.activeGuides = null;
        this.redrawCanvas();
      }
    };
    window.onmousemove = this.mousemoveHandler;
    window.onmouseup = this.mouseupHandler;
  }

  /** Shift+点击移除：清空时允许减到 0 个 */
  toggleSelectOff(index) {
    const pos = this._sel.indexOf(index);
    if (pos >= 0) this._sel.splice(pos, 1);
    this.refreshSelectionUI();
  }

  /** 记录拖拽起点：所有选中元素的位置 + 组联合包围盒（吸附基准） */
  beginDragMove(canvasX, canvasY) {
    this.isDragging = true;
    this.dragMode = 'move';
    this.dragMoved = false;
    this.stageSnapshot(); // 改动前暂存，真拖动了才在 mouseup 提交
    this.dragStartX = canvasX;
    this.dragStartY = canvasY;
    this.dragStartPositions = this._sel.map((i) => {
      const el = this.layout.elements[i] || {};
      return { index: i, x: el.x || 0, y: el.y || 0 };
    });
    this.dragStartGroupBox = this.unionBox(this._sel);
  }

  /** 一组 hitBox 索引的联合包围盒 [x0, y0, x1, y1] */
  unionBox(indices) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const i of indices) {
      const b = this.hitBoxes[i]?.box;
      if (!b) continue;
      x0 = Math.min(x0, b[0]);
      y0 = Math.min(y0, b[1]);
      x1 = Math.max(x1, b[2]);
      y1 = Math.max(y1, b[3]);
    }
    return [x0, y0, x1, y1];
  }

  /**
   * 拖拽对齐吸附：把移动组的左/中/右、上/中/下与画布边/居中线、
   * 其他元素的边缘/中线比对，阈值内吸附到最近的并返回参考线。
   */
  computeSnap(dx, dy) {
    const th = 8 / this.zoom;
    const mb = this.dragStartGroupBox || [0, 0, 0, 0];
    const W = this.layout.width || 1080;
    const H = this.layout.height || 2500;

    const movingV = [mb[0] + dx, (mb[0] + mb[2]) / 2 + dx, mb[2] + dx];
    const movingH = [mb[1] + dy, (mb[1] + mb[3]) / 2 + dy, mb[3] + dy];

    const targetsV = [0, W / 2, W];
    const targetsH = [0, H / 2, H];
    const selSet = new Set(this._sel);
    this.hitBoxes.forEach((it, i) => {
      if (!it || selSet.has(i)) return;
      const [a, b, c, d] = it.box;
      targetsV.push(a, (a + c) / 2, c);
      targetsH.push(b, (b + d) / 2, d);
    });

    const nearest = (values, targets) => {
      let best = null;
      for (const m of values) {
        for (const t of targets) {
          const d = t - m;
          if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t };
        }
      }
      return best;
    };

    const bv = nearest(movingV, targetsV);
    const bh = nearest(movingH, targetsH);
    return {
      dx: bv ? bv.d : 0,
      dy: bh ? bh.d : 0,
      guides: { v: bv ? [bv.t] : [], h: bh ? [bh.t] : [] },
    };
  }

  /** 框选框显示（挂在视口上，画布内容坐标换算成 CSS 像素） */
  showMarquee(x0, y0, x1, y1) {
    const vp = this.container.querySelector('#canvas-viewport');
    const canvas = this.container.querySelector('#canvas-board');
    if (!vp || !canvas) return;
    if (!this.marqueeEl) {
      this.marqueeEl = document.createElement('div');
      this.marqueeEl.className = 'marquee-box';
      vp.appendChild(this.marqueeEl);
    }
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    this.marqueeEl.style.left = `${canvas.offsetLeft + left * this.zoom}px`;
    this.marqueeEl.style.top = `${canvas.offsetTop + top * this.zoom}px`;
    this.marqueeEl.style.width = `${Math.abs(x1 - x0) * this.zoom}px`;
    this.marqueeEl.style.height = `${Math.abs(y1 - y0) * this.zoom}px`;
  }

  /** 框选结算：与选框相交的元素全部选中；无位移视为取消全选 */
  finishMarquee() {
    const rect = this.marqueeEl ? [
      parseFloat(this.marqueeEl.style.left),
      parseFloat(this.marqueeEl.style.top),
      parseFloat(this.marqueeEl.style.left) + parseFloat(this.marqueeEl.style.width),
      parseFloat(this.marqueeEl.style.top) + parseFloat(this.marqueeEl.style.height),
    ] : null;
    if (this.marqueeEl) {
      this.marqueeEl.remove();
      this.marqueeEl = null;
    }
    if (!this.dragMoved || !rect) {
      this._sel = [];
      this.refreshSelectionUI();
      return;
    }
    const vp = this.container.querySelector('#canvas-viewport');
    const canvas = this.container.querySelector('#canvas-board');
    const ox = canvas ? canvas.offsetLeft : 0;
    const oy = canvas ? canvas.offsetTop : 0;
    const zoom = this.zoom;
    const box = [
      (rect[0] - ox) / zoom, (rect[1] - oy) / zoom,
      (rect[2] - ox) / zoom, (rect[3] - oy) / zoom,
    ];
    const picked = [];
    this.hitBoxes.forEach((it, i) => {
      if (!it) return;
      const [a, b, c, d] = it.box;
      const intersects = a <= box[2] && c >= box[0] && b <= box[3] && d >= box[1];
      if (intersects) picked.push(i);
    });
    this.setSelection(picked);
  }

  async redrawCanvas() {
    const canvas = this.container.querySelector('#canvas-board');
    if (!canvas || !this.layout) return;
    const projectUrlBase = `/api/projects/${this.project.id}`;
    // 渲染是异步的（等图片加载）：期间可能又触发了新一次渲染。
    // 过期渲染返回的命中数据不能覆盖最新的，否则热区会与画面错位。
    const token = (this._renderToken = (this._renderToken || 0) + 1);
    const hitBoxes = await this.app.renderer.renderBlock(
      canvas,
      this.layout,
      projectUrlBase,
      this._sel,
      {
        zoom: this.zoom,
        showGrid: this.showGrid,
        guides: this.activeGuides || null,
        hiddenIndex: this.hiddenElementIndex,
      }
    );
    if (token !== this._renderToken) return;
    this.hitBoxes = hitBoxes;
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
          const isActive = this.isSelected(i);
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
        if (e.shiftKey) {
          // Shift+点击：切换多选
          this.toggleSelect(idx);
        } else if (!this.isSelected(idx) || this._sel.length > 1) {
          this._sel = [idx];
          this.refreshSelectionUI();
        }
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
    const md = this.project.contentMd || '';
    if (!md.trim()) {
      panel.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 40px 0;">
          工程根目录暂无 CONTENT.md 剧本
        </div>
      `;
      return;
    }

    if (!window.marked || typeof window.marked.parse !== 'function') {
      // vendor/marked.min.js 加载失败时回退纯文本，保证剧本仍可读
      panel.innerHTML = `
        <div style="background: rgba(255,255,255,0.03); padding: 10px; border-radius: 6px; color: var(--text-secondary);">
          <pre style="white-space: pre-wrap; font-family: inherit;">${md}</pre>
        </div>
      `;
      return;
    }

    panel.innerHTML = `<div class="md-body" id="script-md-body">${window.marked.parse(md)}</div>`;

    // 剧本里的「Block N」标题可点击：直接切到对应分块编辑（人机共创的主工作流）
    panel.querySelectorAll('.md-body h1, .md-body h2, .md-body h3, .md-body h4').forEach((h) => {
      const match = h.textContent.match(/Block\s*(\d+)/i);
      if (!match) return;
      const blockId = `block${match[1]}`;
      if (!this.project.blocks.some((b) => b.id === blockId)) return;
      h.classList.add('md-block-link');
      h.title = `点击切换到 ${blockId} 编辑`;
      h.onclick = async () => {
        if (blockId === this.currentBlockId) return;
        if (this.hasUnsavedChanges && !confirm('当前分块有未保存的修改，切换将丢失，确定继续吗？')) return;
        this.currentBlockId = blockId;
        await this.loadBlockLayout(blockId);
        this.render();
      };
    });
  }

  renderInspector() {
    const panel = this.container.querySelector('#inspector-panel');
    if (!panel) return;

    if (this._sel.length > 1) {
      this.renderMultiInspector(panel);
      return;
    }

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

  /** 多选批量面板：对齐到画布 + 批量复制/删除 */
  renderMultiInspector(panel) {
    const n = this._sel.length;
    panel.innerHTML = `
      <div class="prop-section">
        <div class="prop-title"><span>批量操作</span><span>${n} 个元素</span></div>
        <div style="font-size: 12px; color: var(--text-muted); line-height: 1.6;">
          拖拽任意选中元素可批量移动（带对齐线吸附）；方向键批量微调。
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-title">对齐到画布</div>
        <div class="prop-row">
          <button class="btn btn-secondary btn-sm" id="align-left" style="flex:1;">⭰ 左对齐</button>
          <button class="btn btn-secondary btn-sm" id="align-centerH" style="flex:1;">水平居中</button>
          <button class="btn btn-secondary btn-sm" id="align-right" style="flex:1;">⭲ 右对齐</button>
        </div>
        <div class="prop-row">
          <button class="btn btn-secondary btn-sm" id="align-top" style="flex:1;">⭱ 顶对齐</button>
          <button class="btn btn-secondary btn-sm" id="align-centerV" style="flex:1;">垂直居中</button>
          <button class="btn btn-secondary btn-sm" id="align-bottom" style="flex:1;">⭳ 底对齐</button>
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-row">
          <button class="btn btn-secondary btn-sm" id="multi-duplicate" style="flex:1;">⧉ 复制所选</button>
          <button class="btn btn-secondary btn-sm" id="multi-delete" style="flex:1; color: var(--accent-red);">🗑 删除所选</button>
        </div>
      </div>
    `;

    const bindAlign = (id, mode) => {
      const btn = panel.querySelector(id);
      if (btn) btn.onclick = () => this.alignSelection(mode);
    };
    bindAlign('#align-left', 'left');
    bindAlign('#align-centerH', 'centerH');
    bindAlign('#align-right', 'right');
    bindAlign('#align-top', 'top');
    bindAlign('#align-centerV', 'centerV');
    bindAlign('#align-bottom', 'bottom');
    panel.querySelector('#multi-duplicate').onclick = () => this.duplicateSelected();
    panel.querySelector('#multi-delete').onclick = () => this.deleteSelection();
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
          • 点击选中，Shift+点击多选，空白处拖拽框选；拖拽任意选中元素批量移动<br/>
          • 移动时自动显示对齐线（画布边/居中线 + 其他元素边缘/中线）并吸附<br/>
          • 双击文本直接在画布上编辑；拖手柄调尺寸（素材等比，文本调行宽）<br/>
          • Ctrl+S 保存渲染，Ctrl+Z/Shift+Z 撤销重做，Ctrl+D 复制，? 全部快捷键
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

    // 数字/文本输入：focus 时暂存（改动前），change 确认后提交撤销快照
    const bindNum = (id, prop) => {
      const input = panel.querySelector(id);
      if (input) {
        input.onfocus = () => this.stageSnapshot();
        input.oninput = () => {
          el[prop] = Number(input.value);
          this.markDirty();          // 边打边改也要立刻置脏，否则 2.5s 轮询会覆盖草稿
          this.redrawCanvas();
        };
        input.onchange = () => this.commitStaged();
        input.onblur = () => this.discardStaged();
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
      content.onfocus = () => this.stageSnapshot();
      content.oninput = () => {
        el.content = content.value;
        this.markDirty();
        this.redrawCanvas();
      };
      content.onchange = () => this.commitStaged();
      content.onblur = () => this.discardStaged();
    }

    // 语义标签快捷按钮
    const insertTag = (prefix, suffix) => {
      if (!content) return;
      const start = content.selectionStart;
      const end = content.selectionEnd;
      const sel = content.value.substring(start, end);
      const rep = `${prefix}${sel || '高亮内容'}${suffix}`;
      this.editWithSnapshot(() => {
        content.value = content.value.substring(0, start) + rep + content.value.substring(end);
        el.content = content.value;
      });
      this.redrawCanvas();
    };

    const tagOrange = panel.querySelector('#tag-orange');
    if (tagOrange) tagOrange.onclick = () => insertTag('【', '】');
    const tagBlue = panel.querySelector('#tag-blue');
    if (tagBlue) tagBlue.onclick = () => insertTag('『', '』');
    const tagRed = panel.querySelector('#tag-red');
    if (tagRed) tagRed.onclick = () => insertTag('〖', '〗');

    // 字体、对齐、粗体（一步到位的控件：先暂存再改动再提交）
    const font = panel.querySelector('#prop-font');
    if (font) font.onchange = () => this.editWithSnapshot(() => { el.font = font.value; this.redrawCanvas(); });
    const align = panel.querySelector('#prop-align');
    if (align) align.onchange = () => this.editWithSnapshot(() => { el.align = align.value; this.redrawCanvas(); });
    const bold = panel.querySelector('#prop-bold');
    if (bold) bold.onchange = () => this.editWithSnapshot(() => { el.bold = bold.value === 'true'; this.redrawCanvas(); });

    // 气泡开关与属性
    const boxEnable = panel.querySelector('#prop-box-enable');
    if (boxEnable) {
      boxEnable.onchange = () => {
        this.editWithSnapshot(() => {
          if (boxEnable.checked) {
            el.box = el.box || { style: 'fill', bg: '#F6A83C', color: '#4A2800', pad: [12, 18], tail: 'none' };
          } else {
            delete el.box;
          }
        });
        this.renderInspector();
        this.redrawCanvas();
      };
    }

    const boxStyle = panel.querySelector('#prop-box-style');
    if (boxStyle) boxStyle.onchange = () => this.editWithSnapshot(() => { el.box.style = boxStyle.value; this.redrawCanvas(); });
    const boxTail = panel.querySelector('#prop-box-tail');
    if (boxTail) boxTail.onchange = () => this.editWithSnapshot(() => { el.box.tail = boxTail.value; this.redrawCanvas(); });
    const boxBg = panel.querySelector('#prop-box-bg');
    if (boxBg) {
      boxBg.onfocus = () => this.stageSnapshot();
      boxBg.oninput = () => { el.box.bg = boxBg.value; this.markDirty(); this.redrawCanvas(); };
      boxBg.onchange = () => this.commitStaged();
      boxBg.onblur = () => this.discardStaged();
    }
    const boxColor = panel.querySelector('#prop-box-color');
    if (boxColor) {
      boxColor.onfocus = () => this.stageSnapshot();
      boxColor.oninput = () => { el.box.color = boxColor.value; this.markDirty(); this.redrawCanvas(); };
      boxColor.onchange = () => this.commitStaged();
      boxColor.onblur = () => this.discardStaged();
    }

    // 素材属性
    const assetFile = panel.querySelector('#prop-asset-file');
    if (assetFile) assetFile.onchange = () => this.editWithSnapshot(() => { el.file = assetFile.value; this.redrawCanvas(); });
    const anchor = panel.querySelector('#prop-anchor');
    if (anchor) anchor.onchange = () => this.editWithSnapshot(() => { el.anchor = anchor.value; this.redrawCanvas(); });
    const flip = panel.querySelector('#prop-flip');
    if (flip) flip.onchange = () => this.editWithSnapshot(() => { el.flip = flip.value === 'true'; this.redrawCanvas(); });

    // rule（横线/竖线）属性：曾经只渲染控件不绑事件，改了没反应
    const ruleVert = panel.querySelector('#prop-rule-vert');
    if (ruleVert) {
      ruleVert.onchange = () => {
        this.editWithSnapshot(() => {
          // 注意必须显式比较字符串：el.vertical = "false" 在 JS 里是真值，
          // 会让横线被渲染成竖线（且 x1/x2 不存在 → 画出看不见的线）
          el.vertical = ruleVert.value === 'true';
        });
        this.redrawCanvas();
      };
    }
    const thickness = panel.querySelector('#prop-thickness');
    if (thickness) {
      thickness.onfocus = () => this.stageSnapshot();
      thickness.oninput = () => { el.thickness = Number(thickness.value); this.markDirty(); this.redrawCanvas(); };
      thickness.onchange = () => this.commitStaged();
      thickness.onblur = () => this.discardStaged();
    }

    // card 标签
    const cardLabel = panel.querySelector('#prop-card-label');
    if (cardLabel) {
      cardLabel.onfocus = () => this.stageSnapshot();
      cardLabel.oninput = () => { el.label = cardLabel.value; this.markDirty(); this.redrawCanvas(); };
      cardLabel.onchange = () => this.commitStaged();
      cardLabel.onblur = () => this.discardStaged();
    }

    // 复制元素
    const dup = panel.querySelector('#prop-duplicate');
    if (dup) dup.onclick = () => this.duplicateSelected();

    // 删除元素
    const del = panel.querySelector('#prop-delete');
    if (del) del.onclick = () => this.deleteSelection();
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

  /** 复制所有选中元素并选中副本（Ctrl+D / 检查器「复制」按钮共用） */
  duplicateSelected() {
    if (this._sel.length === 0) return;
    this.recordSnapshot();
    const copies = [];
    for (const i of this._sel) {
      const src = this.layout.elements[i];
      if (!src) continue;
      const copy = JSON.parse(JSON.stringify(src));
      copy.x = (copy.x || 0) + 30;
      copy.y = (copy.y || 0) + 30;
      this.layout.elements.push(copy);
      copies.push(this.layout.elements.length - 1);
    }
    this.setSelection(copies);
  }

  /** 删除所有选中元素（Delete / 多选面板共用） */
  deleteSelection() {
    if (this._sel.length === 0) return;
    this.recordSnapshot();
    // 从大到小删，避免索引位移
    const indices = [...this._sel].sort((a, b) => b - a);
    for (const i of indices) {
      if (i >= 0 && i < this.layout.elements.length) this.layout.elements.splice(i, 1);
    }
    this._sel = [];
    this.refreshSelectionUI();
  }

  /** 选中组对齐到画布（left/centerH/right/top/centerV/bottom），基于各元素包围盒整体平移 */
  alignSelection(mode) {
    if (this._sel.length === 0) return;
    const W = this.layout.width || 1080;
    const H = this.layout.height || 2500;
    this.recordSnapshot();
    for (const i of this._sel) {
      const item = this.hitBoxes[i];
      const el = this.layout.elements[i];
      if (!item || !el) continue;
      const [x0, y0, x1, y1] = item.box;
      let dx = 0;
      let dy = 0;
      if (mode === 'left') dx = -x0;
      if (mode === 'centerH') dx = W / 2 - (x0 + x1) / 2;
      if (mode === 'right') dx = W - x1;
      if (mode === 'top') dy = -y0;
      if (mode === 'centerV') dy = H / 2 - (y0 + y1) / 2;
      if (mode === 'bottom') dy = H - y1;
      el.x = Math.round((el.x || 0) + dx);
      el.y = Math.round((el.y || 0) + dy);
    }
    this.redrawCanvas();
    this.renderInspector();
  }

  /**
   * 按手柄方向应用缩放（位移已换算到元素局部坐标系）。
   *  · text：左右手柄对称调整折行宽度 max_width
   *  · rule：沿线方向拖动端点
   *  · asset / card：8 向缩放；角手柄等比，asset 还要按 anchor 把锚点贴回新框
   */
  applyResize(el, item, handle, ldx, ldy) {
    if (!handle) return;

    if (el.type === 'text') {
      // 手柄吸鼠标：居中对齐时框架两侧对称生长（改 1 侧行宽 = 全宽 2 倍位移），
      // 左/右对齐时手柄侧就是行宽边界，1:1 跟手。高度由重排后的行数自适应。
      const align = el.align || 'center';
      const factor = align === 'center' ? 2 : 1;
      const delta = handle === 'w' ? -ldx : ldx;
      el.max_width = Math.max(100, Math.round(this.dragStartElemW + delta * factor));
      return;
    }

    if (el.type === 'rule') {
      if (el.vertical) {
        const top = Math.min(el.y1 ?? 0, el.y2 ?? 0);
        const bottom = Math.max(el.y1 ?? 0, el.y2 ?? 0);
        if (handle === 'n') {
          const t = Math.max(bottom - 20, Math.round(top + ldy));
          if (el.y1 <= el.y2) el.y1 = t; else el.y2 = t;
        } else {
          const b = Math.max(top + 20, Math.round(bottom + ldy));
          if (el.y1 >= el.y2) el.y1 = b; else el.y2 = b;
        }
      } else {
        const left = Math.min(el.x1 ?? 0, el.x2 ?? 0);
        const right = Math.max(el.x1 ?? 0, el.x2 ?? 0);
        if (handle === 'w') {
          const l = Math.min(right - 20, Math.round(left + ldx));
          if (el.x1 <= el.x2) el.x1 = l; else el.x2 = l;
        } else {
          const r = Math.max(left + 20, Math.round(right + ldx));
          if (el.x1 >= el.x2) el.x1 = r; else el.x2 = r;
        }
      }
      return;
    }

    // asset / card：基于按下时的包围盒做 8 向缩放（纯起点计算，与重绘时机无关）
    const [bx0, by0, bx1, by1] = item.box;
    const oldW = Math.max(20, this.dragStartElemW);
    const oldH = Math.max(20, this.dragStartElemH);
    let w = oldW;
    let h = oldH;
    if (handle.includes('e')) w = oldW + ldx;
    if (handle.includes('w')) w = oldW - ldx;
    if (handle.includes('s')) h = oldH + ldy;
    if (handle.includes('n')) h = oldH - ldy;
    if (handle.length === 2) {
      // 角手柄等比缩放（与主流设计工具一致），以位移较大的轴为准
      if (Math.abs(ldx) >= Math.abs(ldy)) h = w * (oldH / oldW);
      else w = h * (oldW / oldH);
    }
    w = Math.max(20, Math.round(w));
    h = Math.max(20, Math.round(h));

    // 固定对边，得到新框的左上角
    let nx0 = bx0;
    let ny0 = by0;
    if (handle.includes('w')) nx0 = bx1 - w;
    if (handle.includes('n')) ny0 = by1 - h;

    if (el.type === 'card') {
      el.width = w;
      el.height = h;
      el.x = Math.round(nx0);
      el.y = Math.round(ny0);
      return;
    }

    // asset：宽高显式化（原先可能靠图片比例推导），锚点在新框中的对应位置回贴到 x/y
    el.width = w;
    el.height = h;
    const [ax, ay] = this.anchorInBox(el.anchor || 'cc', nx0, ny0, w, h);
    el.x = Math.round(ax);
    el.y = Math.round(ay);
  }

  /** anchor 名 → 该锚点在 [x, y, w, h] 框内的坐标 */
  anchorInBox(anchor, x, y, w, h) {
    switch (anchor) {
      case 'lt': return [x, y];
      case 'ct': return [x + w / 2, y];
      case 'rt': return [x + w, y];
      case 'lc': return [x, y + h / 2];
      case 'rc': return [x + w, y + h / 2];
      case 'lb': return [x, y + h];
      case 'cb': return [x + w / 2, y + h];
      case 'rb': return [x + w, y + h];
      default: return [x + w / 2, y + h / 2]; // cc
    }
  }

  cursorForHandle(handle) {
    const map = {
      n: 'ns-resize', s: 'ns-resize',
      e: 'ew-resize', w: 'ew-resize',
      ne: 'nesw-resize', sw: 'nesw-resize',
      nw: 'nwse-resize', se: 'nwse-resize',
    };
    return map[handle] || 'crosshair';
  }

  /**
   * 画布内直接编辑文本：双击文本元素后，在画布上叠一个同字体/字号/行高/
   * 对齐/颜色的 textarea，画布本体临时隐藏（透明绘制），编辑完提交。
   */
  async startInlineEdit(index) {
    const el = this.layout.elements[index];
    if (!el || el.type !== 'text') return;
    const vp = this.container.querySelector('#canvas-viewport');
    const canvas = this.container.querySelector('#canvas-board');
    const item = this.hitBoxes[index];
    if (!vp || !canvas || !item) return;
    const frame = item.frame || item.box;
    const zoom = this.zoom;
    const size = el.size ?? 40;
    const lineHeight = size * (el.line_height ?? 1.5) * zoom;
    const theme = this.layout.theme || {};

    // 先隐藏本体并等重绘落地，再显示编辑框（避免两份内容叠加）
    this.hiddenElementIndex = index;
    await this.redrawCanvas();
    // 等待期间被取消（切分块/关闭编辑器）就不再弹出
    if (this.hiddenElementIndex !== index || !this.container.contains(canvas)) return;

    const ta = document.createElement('textarea');
    ta.id = 'inline-text-editor';
    ta.value = el.content || '';
    ta.spellcheck = false;
    const weight = el.bold && this.app.renderer.isRealBoldFont(el.font || 'body') ? 'bold ' : '';
    // 不透明底色（与画布同色）兜底：即便渲染竞速让本体晚了一拍消失，也会被盖住
    const canvasBg = this.layout.bg || theme.bg || '#FFFFFF';
    ta.style.cssText = `
      position: absolute;
      left: ${canvas.offsetLeft + frame[0] * zoom}px;
      top: ${canvas.offsetTop + frame[1] * zoom}px;
      width: ${(frame[2] - frame[0]) * zoom}px;
      height: ${Math.max((frame[3] - frame[1]) * zoom, lineHeight)}px;
      font: ${weight}${Math.max(8, Math.round(size * zoom * 100) / 100)}px ${this.app.renderer.getFontFamily(el.font || 'body')};
      line-height: ${lineHeight}px;
      text-align: ${el.align || 'center'};
      color: ${el.color || el.box?.color || theme.text || '#333333'};
      background: ${canvasBg};
    `;
    vp.appendChild(ta);

    this.inlineEditing = { ta, index };
    this.renderSidebar();
    ta.focus();
    // 光标落在末尾即可，不要整段全选（蓝色选区会像凭空多出来的高亮块）
    const end = ta.value.length;
    ta.setSelectionRange(end, end);

    ta.oninput = () => {
      el.content = ta.value;
      this.markDirty();
      // 边打边重排：画布本体虽隐藏，但选中框架/命中数据要跟着内容长
      this.redrawCanvas();
    };
    ta.onblur = () => this.commitInlineEdit();
    ta.onkeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.commitInlineEdit();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.commitInlineEdit();
      }
    };
  }

  /** 提交画布内编辑：写回内容、恢复画布本体显示 */
  commitInlineEdit() {
    if (!this.inlineEditing) return;
    const { ta, index } = this.inlineEditing;
    this.inlineEditing = null;
    const el = this.layout.elements[index];
    if (el) el.content = ta.value;
    ta.remove();
    this.hiddenElementIndex = -1;
    this.redrawCanvas();
    this.renderSidebar();
    this.renderInspector();
  }

  /** 快捷键速查弹窗（? 呼出） */
  showHelpModal() {
    if (document.getElementById('shortcut-help-modal')) return;
    const rows = [
      ['Ctrl/⌘ + S', '保存到文件并渲染'],
      ['Ctrl/⌘ + Z', '撤销'],
      ['Ctrl/⌘ + Shift + Z / Ctrl/⌘ + Y', '重做'],
      ['Ctrl/⌘ + D', '复制选中元素'],
      ['Delete / Backspace', '删除选中元素'],
      ['方向键', '微调选中元素 (1px) / 无选中时平移画布'],
      ['Shift + 方向键', '微调 10px / 快速平移画布'],
      ['空格 + 拖拽 / 中键拖拽', '平移画布视口'],
      ['Ctrl/⌘ + 滚轮', '以光标为锚点缩放'],
      ['Ctrl/⌘ + +/-', '以视口为中心缩放'],
      ['Ctrl/⌘ + 0', '自适应画布'],
      ['Alt + 点击', '在层叠元素间向下轮换选中'],
      ['Shift + 点击', '加入/移出多选'],
      ['空白处拖拽', '框选元素，批量移动/微调/对齐'],
      ['双击文本', '在画布上直接编辑文字'],
      ['拖拽控制手柄', '调整尺寸（素材角手柄等比；文本手柄调行宽，高度自适应）'],
      ['拖拽移动', '自动显示对齐线：画布边/居中线 + 其他元素边缘/中线'],
      ['Esc', '关闭弹窗 / 取消选中'],
      ['?', '打开本速查表'],
    ];
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'shortcut-help-modal';
    modal.innerHTML = `
      <div class="modal-card" style="max-width: 480px;">
        <div class="modal-header">
          <div class="modal-title">键盘快捷键</div>
          <button class="btn btn-ghost btn-icon" id="help-modal-close">✕</button>
        </div>
        <div class="shortcut-table">
          ${rows.map(([k, d]) => `<div class="shortcut-row"><kbd>${k}</kbd><span>${d}</span></div>`).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    modal.querySelector('#help-modal-close').onclick = () => modal.remove();
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
      const body = modal.querySelector('#modal-body') || modal.querySelector('#lint-modal-body');
      // 四条机检都要算数：只看 lint 的 hard，会在 clearance 报压盖时照样弹「机检通过」
      const hard = res.lint?.hard ?? 0;
      const geom = typeof res.geom === 'number' ? res.geom : (res.geom?.error ? 1 : 0);
      const occl = typeof res.occlusion === 'number' ? res.occlusion : (res.occlusion?.error ? 1 : 0);
      const clear = typeof res.clearance === 'number' ? res.clearance : (res.clearance?.error ? 1 : 0);
      const isClean = hard === 0 && geom === 0 && occl === 0 && clear === 0;
      const summary = `硬伤 Hard ${hard} · 几何 ${geom} · 遮挡 ${occl} · 净空 ${clear}`;

      body.innerHTML = `
        <div style="display: flex; gap: 10px; margin-bottom: 16px;">
          <div style="flex: 1; background: ${isClean ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'}; border: 1px solid ${isClean ? '#10b981' : '#ef4444'}; padding: 12px; border-radius: 8px;">
            <div style="font-weight: 700; color: ${isClean ? '#34d399' : '#f87171'}; font-size: 16px;">
              ${isClean ? '✔ 机检通过（四项全绿）' : '✕ 存在未通过项'}
            </div>
            <div style="font-size: 12px; margin-top: 4px;">
              ${summary} · 提示 Warn ${res.lint?.warn ?? 0}
            </div>
          </div>
        </div>

        <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; max-height: 280px; overflow-y: auto;">
          <pre style="white-space: pre-wrap; font-family: monospace; font-size: 12px; color: #d4d4d8;">${JSON.stringify(res, null, 2)}</pre>
        </div>
      `;
    } catch (err) {
      const body = modal.querySelector('#lint-modal-body');
      if (body) body.textContent = `机检失败: ${err.message}`;
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
