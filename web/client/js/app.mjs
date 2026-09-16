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
  }

  async init() {
    console.log('[App] 初始化 pic-flow Canvas Studio...');
    this.bindHeaderEvents();
    // canvas 不触发 @font-face 下载，必须显式加载完再首渲染，
    // 否则首屏会用回退字体度量排版（字体到位后也不重绘）
    try {
      await this.renderer.ensureFontsLoaded();
    } catch {}
    await this.loadProjects();
  }

  bindHeaderEvents() {
    document.getElementById('brand-home').onclick = () => {
      this.showProjectList();
    };
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
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
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

  async openProject(projectId, blockId = null) {
    this.currentView = 'detail';
    this.activeProjectId = projectId;
    try {
      await this.projectDetailComp.load(projectId, blockId);
    } catch (err) {
      this.toast(`打开工程失败: ${err.message}`, 'error');
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
