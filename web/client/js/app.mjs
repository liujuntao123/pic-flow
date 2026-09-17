import { api } from './api.mjs';
import { CanvasRenderer } from './canvas-renderer.mjs';
import { ProjectListComponent } from './components/project-list.mjs';
import { ProjectDetailComponent } from './components/project-detail.mjs';

class App {
  constructor() {
    this.api = api;
    this.renderer = new CanvasRenderer();
    this.container = document.getElementById('app-main');
    this.projectListComp = new ProjectListComponent(this, this.container);
    this.projectDetailComp = new ProjectDetailComponent(this, this.container);
    this.currentView = 'list'; // list | detail
    this.activeProjectId = null;
    this._isRouting = false;
  }

  async init() {
    console.log('[App] 初始化 pic-flow Canvas Studio...');
    this.bindHeaderEvents();
    this.bindRoutingEvents();

    // canvas 不触发 @font-face 下载，必须显式加载完再首渲染，
    // 否则首屏会用回退字体度量排版（字体到位后也不重绘）
    try {
      await this.renderer.ensureFontsLoaded();
    } catch {}

    await this.routeFromUrlOrStorage();
  }

  bindHeaderEvents() {
    document.getElementById('brand-home').onclick = () => {
      this.showProjectList();
    };
  }

  bindRoutingEvents() {
    window.addEventListener('hashchange', () => {
      if (!this._isRouting) {
        this.routeFromUrlOrStorage();
      }
    });
    window.addEventListener('popstate', () => {
      if (!this._isRouting) {
        this.routeFromUrlOrStorage();
      }
    });
  }

  parseHashRoute() {
    const hash = window.location.hash || '';
    // 支持 #/project/:projectId 或 #/project/:projectId/:blockId
    const m = hash.match(/^#\/project\/([^/?#]+)(?:\/([^/?#]+))?/);
    if (m) {
      return {
        projectId: decodeURIComponent(m[1]),
        blockId: m[2] ? decodeURIComponent(m[2]) : null,
      };
    }
    return null;
  }

  syncRoute(projectId, blockId = null, pushState = false) {
    try {
      if (projectId) {
        localStorage.setItem('picflow_active_project', projectId);
        if (blockId) localStorage.setItem('picflow_active_block', blockId);
        else localStorage.removeItem('picflow_active_block');

        const hash = blockId
          ? `#/project/${encodeURIComponent(projectId)}/${encodeURIComponent(blockId)}`
          : `#/project/${encodeURIComponent(projectId)}`;

        if (window.location.hash !== hash) {
          this._isRouting = true;
          if (pushState) history.pushState(null, '', hash);
          else history.replaceState(null, '', hash);
          setTimeout(() => {
            this._isRouting = false;
          }, 50);
        }
      } else {
        localStorage.removeItem('picflow_active_project');
        localStorage.removeItem('picflow_active_block');
        if (window.location.hash && window.location.hash !== '#/' && window.location.hash !== '#') {
          this._isRouting = true;
          if (pushState) history.pushState(null, '', '#/');
          else history.replaceState(null, '', '#/');
          setTimeout(() => {
            this._isRouting = false;
          }, 50);
        }
      }
    } catch {}
  }

  async routeFromUrlOrStorage() {
    const hashRoute = this.parseHashRoute();
    let projectId = hashRoute ? hashRoute.projectId : null;
    let blockId = hashRoute ? hashRoute.blockId : null;

    if (!projectId) {
      try {
        projectId = localStorage.getItem('picflow_active_project');
        blockId = localStorage.getItem('picflow_active_block');
      } catch {}
    }

    if (projectId) {
      try {
        await this.openProject(projectId, blockId, false);
        return;
      } catch (err) {
        console.warn('[App] 恢复项目状态失败，降级到项目列表:', err);
      }
    }

    await this.loadProjects();
  }

  updateBreadcrumb(subTitle = null) {
    const el = document.getElementById('breadcrumb-sub');
    if (subTitle) {
      el.textContent = subTitle;
      el.style.display = 'inline-block';
      document.getElementById('breadcrumb-sep').style.display = 'inline-block';
    } else {
      el.style.display = 'none';
      document.getElementById('breadcrumb-sep').style.display = 'none';
    }
  }

  updateStatus(synced) {
    const badge = document.getElementById('status-badge');
    const text = document.getElementById('status-text');
    if (synced) {
      badge.className = 'status-badge synced';
      text.textContent = '已同步磁盘';
    } else {
      badge.className = 'status-badge unsaved';
      text.textContent = '有未保存修改';
    }
  }

  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✔' : type === 'error' ? '✕' : 'ℹ';
    toast.innerHTML = `<span class="toast-icon">${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  async loadProjects() {
    this.currentView = 'list';
    this.activeProjectId = null;
    document.body.classList.remove('editor-mode');
    this.syncRoute(null, null, false);
    this.updateBreadcrumb(null);
    this.updateStatus(true);
    if (this.projectDetailComp) this.projectDetailComp.destroy();

    try {
      const projects = await this.api.getProjects();
      this.projectListComp.setProjects(projects);
    } catch (err) {
      this.toast(`获取项目列表失败: ${err.message}`, 'error');
    }
  }

  async openProject(projectId, blockId = null, pushState = true) {
    this.currentView = 'detail';
    this.activeProjectId = projectId;
    document.body.classList.add('editor-mode');
    try {
      await this.projectDetailComp.load(projectId, blockId);
      this.syncRoute(projectId, this.projectDetailComp.currentBlockId, pushState);
    } catch (err) {
      this.toast(`打开工程失败: ${err.message}`, 'error');
      this.showProjectList();
    }
  }

  showProjectList() {
    this.loadProjects();
  }
}

// 启动
window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
  window.app.init();
});
