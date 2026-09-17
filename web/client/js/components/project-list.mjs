/**
 * 项目管理列表组件 (Canva 工作台风格)
 */
import { ICONS } from '../icons.mjs';

export class ProjectListComponent {
  constructor(app, container) {
    this.app = app;
    this.container = container;
    this.projects = [];
    this.filterText = '';
  }

  setProjects(projects) {
    this.projects = projects || [];
    this.render();
  }

  render() {
    const filtered = this.projects.filter((p) => {
      if (!this.filterText) return true;
      const q = this.filterText.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        (p.title && p.title.toLowerCase().includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q))
      );
    });

    this.container.innerHTML = `
      <div class="project-management-view">
        <!-- 一体化页面大标题区 (与页面自然融合，非卡片形制) -->
        <div class="pm-page-header">
          <div class="pm-header-intro">
            <span class="eyebrow">人机共创长图工作台</span>
            <h1 class="pm-page-title">pic-flow 项目空间</h1>
            <p class="pm-page-subtitle">
              基于 Canvas 渲染引擎的黑白手绘长图流水线，支持流式叙事排版、四图切片生图与高精度几何拼缝机检。
            </p>
          </div>
          <div class="pm-header-actions">
            <button class="btn btn-primary" id="btn-new-project">
              ${ICONS.plus(16)} <span>新建长图项目</span>
            </button>
            <button class="btn btn-secondary" id="btn-refresh-projects">
              ${ICONS.refresh(15)} <span>刷新</span>
            </button>
          </div>
        </div>

        <!-- 搜索与统计栏 -->
        <div class="pm-search-bar">
          <div class="search-input-wrap">
            <span class="search-icon">${ICONS.search(16)}</span>
            <input
              type="text"
              class="search-input"
              id="project-search"
              placeholder="搜索长图项目名称、标题或剧本核心..."
              value="${this.filterText}"
            />
            ${this.filterText ? `<button class="search-clear-btn" id="search-clear">${ICONS.close(14)}</button>` : ''}
          </div>
          <div class="projects-count-indicator">
            共 <strong>${filtered.length}</strong> 个长图工程
          </div>
        </div>

        <!-- 项目卡片网格 -->
        <div class="projects-grid">
          <!-- 快速新建卡片 -->
          <div class="project-card new-project-card" id="card-create-new">
            <div class="new-card-body">
              <div class="new-card-icon-circle">
                ${ICONS.plus(24)}
              </div>
              <div class="new-card-title">新建长图工程</div>
              <p class="new-card-hint">选用预设模板骨架与黑白手绘风格，快速启动新长图</p>
            </div>
          </div>

          ${filtered.length === 0 ? `
            <div class="empty-projects-placeholder">
              <div class="empty-icon">${ICONS.search(36)}</div>
              <h3>未找到匹配的长图工程</h3>
              <p>请尝试搜索其他关键字，或新建一个项目</p>
            </div>
          ` : filtered.map((p) => this.renderProjectCard(p)).join('')}
        </div>
      </div>
    `;

    // 绑定事件
    const searchInput = this.container.querySelector('#project-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.filterText = e.target.value;
        this.render();
      });
    }

    const clearBtn = this.container.querySelector('#search-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.filterText = '';
        this.render();
      });
    }

    const refreshBtn = this.container.querySelector('#btn-refresh-projects');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.app.loadProjects());
    }

    const newBtn = this.container.querySelector('#btn-new-project');
    if (newBtn) {
      newBtn.addEventListener('click', () => this.showNewProjectModal());
    }

    const newCard = this.container.querySelector('#card-create-new');
    if (newCard) {
      newCard.addEventListener('click', () => this.showNewProjectModal());
    }

    // 删除项目按钮事件绑定（阻止向上冒泡进入详情）
    this.container.querySelectorAll('.card-delete-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.deleteId;
        const project = this.projects.find((p) => p.id === id);
        if (project) {
          this.showDeleteConfirmModal(project);
        }
      });
    });

    // 点击项目卡片打开项目
    this.container.querySelectorAll('.project-card:not(.new-project-card)').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        this.app.openProject(id);
      });
    });
  }

  renderProjectCard(p) {
    const previewHtml = p.previewUrl
      ? `<img src="${p.previewUrl}" alt="${p.title}" loading="lazy" />`
      : `<div class="card-cover-empty"><span class="empty-cover-icon">🎨</span><span>暂无长图渲染</span></div>`;

    const updatedDate = new Date(p.updatedAt).toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    return `
      <div class="project-card" data-id="${p.id}">
        <div class="card-cover">
          ${previewHtml}
          <!-- 悬浮快捷删除按钮 -->
          <button class="card-delete-btn" data-delete-id="${p.id}" title="删除此项目">
            ${ICONS.trash(15)}
          </button>
          <div class="card-hover-overlay">
            <button class="btn btn-primary btn-sm btn-open-project">
              进入工作台 ${ICONS.chevronRight(14)}
            </button>
          </div>
        </div>
        <div class="card-body">
          <div class="card-title" title="${p.title || p.name}">${p.title || p.name}</div>
          <div class="card-desc">${p.description || p.name}</div>
          <div class="card-meta">
            <span class="chip chip-lavender">${p.blockCount || 0} 个分块</span>
            <span class="card-update-time">更新于 ${updatedDate}</span>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 自定义二次确认删除弹窗 (拒绝系统自带 confirm，完全符合 Canva 设计系统)
   */
  showDeleteConfirmModal(project) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-card delete-confirm-card">
        <div class="modal-header">
          <div class="modal-title" style="display: flex; align-items: center; gap: 8px; color: var(--danger);">
            ${ICONS.trash(18)}
            确认删除长图项目？
          </div>
          <button class="btn btn-ghost btn-icon" id="delete-modal-close">${ICONS.close(16)}</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 14px;">
          <div class="delete-target-preview">
            <div class="delete-target-title">${project.title || project.name}</div>
            <div class="delete-path-code">${project.path}</div>
          </div>

          <div class="delete-warning-banner">
            ⚠️ 警告：此操作将彻底删除该项目所在的整个本地目录（含所有分块 JSON、插画切片素材与剧本），无法撤销与恢复！
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px;">
          <button class="btn btn-secondary" id="delete-modal-cancel">取消</button>
          <button class="btn" id="delete-modal-confirm" style="background: var(--danger); color: #ffffff; font-weight: 700;">
            ${ICONS.trash(15)} 彻底删除
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) close(); };
    modal.querySelector('#delete-modal-close').onclick = close;
    modal.querySelector('#delete-modal-cancel').onclick = close;

    const confirmBtn = modal.querySelector('#delete-modal-confirm');
    confirmBtn.onclick = async () => {
      confirmBtn.innerHTML = `<span>正在删除项目目录...</span>`;
      confirmBtn.disabled = true;

      try {
        await this.app.api.deleteProject(project.id);
        close();
        this.app.toast(`已彻底删除项目: ${project.title || project.name}`, 'success');
        await this.app.loadProjects();
      } catch (err) {
        alert(`删除失败: ${err.message}`);
        confirmBtn.innerHTML = `${ICONS.trash(15)} 彻底删除`;
        confirmBtn.disabled = false;
      }
    };
  }

  showNewProjectModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
            <span style="color: var(--accent);">${ICONS.sparkles(18)}</span>
            新建 pic-flow 长图工程
          </div>
          <button class="btn btn-ghost btn-icon" id="modal-close">${ICONS.close(16)}</button>
        </div>
        <div style="display: flex; flex-direction: column; gap: 14px;">
          <div class="prop-col">
            <label class="prop-label">项目目录名 (英文字母 / 连字符)</label>
            <input type="text" class="prop-input" id="new-dir" placeholder="e.g. quantum-computing-story" autofocus />
          </div>
          <div class="prop-col">
            <label class="prop-label">长图主标题</label>
            <input type="text" class="prop-input" id="new-title" placeholder="e.g. 深入浅出：量子计算机如何工作" />
          </div>
          <div class="prop-row">
            <div class="prop-col">
              <label class="prop-label">模板骨架</label>
              <select class="prop-select" id="new-template">
                <option value="story" selected>story (流式叙事故事)</option>
              </select>
            </div>
            <div class="prop-col">
              <label class="prop-label">视觉风格包</label>
              <select class="prop-select" id="new-style">
                <option value="bw-sketch" selected>bw-sketch (黑白手绘风格)</option>
              </select>
            </div>
            <div class="prop-col">
              <label class="prop-label">布局骨架</label>
              <select class="prop-select" id="new-layout">
                <option value="story-flow" selected>story-flow (流式连续长图)</option>
              </select>
            </div>
          </div>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px;">
          <button class="btn btn-secondary" id="modal-cancel">取消</button>
          <button class="btn btn-primary" id="modal-confirm">创建工程</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('#modal-close').onclick = close;
    modal.querySelector('#modal-cancel').onclick = close;
    modal.querySelector('#modal-confirm').onclick = async () => {
      const dirName = modal.querySelector('#new-dir').value.trim();
      const title = modal.querySelector('#new-title').value.trim();
      const template = modal.querySelector('#new-template').value;
      const style = modal.querySelector('#new-style').value;
      const layout = modal.querySelector('#new-layout').value;

      if (!dirName) {
        alert('请输入项目目录名');
        return;
      }

      modal.querySelector('#modal-confirm').textContent = '正在初始化...';
      modal.querySelector('#modal-confirm').disabled = true;

      try {
        const res = await this.app.api.createProject({ dirName, title, template, style, layout });
        close();
        this.app.toast('项目创建成功！', 'success');
        await this.app.loadProjects();
        this.app.openProject(res.id);
      } catch (err) {
        alert(`创建失败: ${err.message}`);
        modal.querySelector('#modal-confirm').textContent = '创建工程';
        modal.querySelector('#modal-confirm').disabled = false;
      }
    };
  }
}
