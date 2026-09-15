/**
 * pic-flow Web API 客户端封装
 */

export const api = {
  async getProjects() {
    const res = await fetch('/api/projects');
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '获取项目列表失败');
    return json.data;
  },

  async createProject(data) {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '创建项目失败');
    return json.data;
  },

  async getProjectDetail(projectId) {
    const res = await fetch(`/api/projects/${projectId}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '获取项目详情失败');
    return json.data;
  },

  async getBlockLayout(projectId, blockId) {
    const res = await fetch(`/api/projects/${projectId}/layout/${blockId}?t=${Date.now()}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '获取分块布局失败');
    return json.data;
  },

  async saveBlockLayout(projectId, blockId, layout, autoRender = true) {
    const res = await fetch(`/api/projects/${projectId}/layout/${blockId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout, autoRender }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '保存分块失败');
    return json.data;
  },

  async checkBlockMtime(projectId, blockId) {
    const res = await fetch(`/api/projects/${projectId}/mtime/${blockId}?t=${Date.now()}`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.ok ? json.data : null;
  },

  async renderBlock(projectId, blockId, debug = false, scale = 1) {
    const res = await fetch(`/api/projects/${projectId}/render/${blockId}?debug=${debug}&scale=${scale}`, {
      method: 'POST',
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '渲染分块失败');
    return json.data;
  },

  async stitchProject(projectId) {
    const res = await fetch(`/api/projects/${projectId}/stitch`, {
      method: 'POST',
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '拼接长图失败');
    return json.data;
  },

  async lintBlock(projectId, blockId) {
    const res = await fetch(`/api/projects/${projectId}/lint/${blockId}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '运行机检失败');
    return json.data;
  },

  async createBlock(projectId, blockId) {
    const res = await fetch(`/api/projects/${projectId}/blocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blockId }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '创建分块失败');
    return json.data;
  },
};
