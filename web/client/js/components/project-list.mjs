/**
 * 项目管理列表组件
 */

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
        <div class="pm-header">
          <div class="pm-title-group">
            <h1>pic-flow 项目空间</h1>
            <p>基于 Canvas 渲染引擎的黑白手绘长图流水线 · 人机共创控制台</p>
          </div>
          <button class="btn btn-primary" id="btn-new-project">
            <span>+</span> 新建长图项目
          </button>
        </div>

        <div class="pm-toolbar">
          <input
            type="text"
            class="search-input"
            id="project-search"
            placeholder="搜索项目名称、标题或故事核心..."
            value="${this.filterText}"
          />
          <button class="btn btn-secondary btn-sm" id="btn-refresh-projects">
            🔄 刷新
          </button>
          <div style="margin-left: auto; font-size: 13px; color: var(--text-muted);">
            共找到 ${filtered.length} 个项目
          </div>
        </div>

        <div class="projects-grid">
          ${filtered.length === 0 ? `
            <div style="grid-column: 1 / -1; text-align: center; padding: 60px 0; color: var(--text-muted);">
              未找到匹配的项目
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

    const refreshBtn = this.container.querySelector('#btn-refresh-projects');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.app.loadProjects());
    }

    const newBtn = this.container.querySelector('#btn-new-project');
    if (newBtn) {
      newBtn.addEventListener('click', () => this.showNewProjectModal());
    }

    this.container.querySelectorAll('.project-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        this.app.openProject(id);
      });
    });
  }

  renderProjectCard(p) {
    const previewHtml = p.previewUrl
      ? `<img src="${p.previewUrl}" alt="${p.title}" loading="lazy" />`
      : `<div class="card-cover-empty"><span>🎨 暂无渲染图</span></div>`;

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
        </div>
        <div class="card-body">
          <div class="card-title" title="${p.title}">${p.title || p.name}</div>
          <div class="card-desc">${p.description || p.name}</div>
          <div class="card-meta">
            <span class="card-badge">${p.blockCount || 0} 个分块</span>
            <span>更新于 ${updatedDate}</span>
          </div>
        </div>
      </div>
    `;
  }

  showNewProjectModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <div class="modal-title">新建 pic-flow 长图工程</div>
          <button class="btn btn-ghost btn-icon" id="modal-close">✕</button>
        </div>
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div class="prop-col">
            <label class="prop-label">项目目录名 (英文/拼音字母)</label>
            <input type="text" class="prop-input" id="new-dir" placeholder="e.g. tang-collapse-case" />
          </div>
          <div class="prop-col">
            <label class="prop-label">长图主标题</label>
            <input type="text" class="prop-input" id="new-title" placeholder="e.g. 乱局余音：大唐终章" />
          </div>
          <div class="prop-row">
            <div class="prop-col">
              <label class="prop-label">模板骨架</label>
              <select class="prop-select" id="new-template">
                <option value="story" selected>story (叙事故事)</option>
              </select>
            </div>
            <div class="prop-col">
              <label class="prop-label">视觉风格包</label>
              <select class="prop-select" id="new-style">
                <option value="bw-sketch" selected>bw-sketch (黑白手绘)</option>
              </select>
            </div>
            <div class="prop-col">
              <label class="prop-label">布局骨架</label>
              <select class="prop-select" id="new-layout">
                <option value="story-flow" selected>story-flow (流式叙事)</option>
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
