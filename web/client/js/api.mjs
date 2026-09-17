/**
 * pic-flow Web API 客户端封装
 */

/** 服务端的 HttpError：带上 status，调用方据此区分 409（版本冲突）等情况。 */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function readJson(res, fallback) {
  let json = null;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(`${fallback}（HTTP ${res.status}）`, res.status);
  }
  if (!json.ok) throw new ApiError(json.error || fallback, res.status);
  return json.data;
}

export const api = {
  async getProjects() {
    return readJson(await fetch('/api/projects'), '获取项目列表失败');
  },

  async createProject(data) {
    return readJson(await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }), '创建项目失败');
  },

  async getProjectDetail(projectId) {
    return readJson(await fetch(`/api/projects/${projectId}`), '获取项目详情失败');
  },

  async deleteProject(projectId) {
    return readJson(await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
    }), '删除项目失败');
  },

  async getBlockLayout(projectId, blockId) {
    return readJson(await fetch(`/api/projects/${projectId}/layout/${blockId}?t=${Date.now()}`), '获取分块布局失败');
  },

  /**
   * @param {string} [expectedUpdatedAt] 上次读到的文件版本；与磁盘不一致时服务端回 409，
   *   避免把 Agent / 另一个窗口刚写的内容覆盖掉（远端可能已改）。
   */
  async saveBlockLayout(projectId, blockId, layout, autoRender = true, expectedUpdatedAt = null) {
    return readJson(await fetch(`/api/projects/${projectId}/layout/${blockId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout, autoRender, expectedUpdatedAt }),
    }), '保存分块失败');
  },

  async checkBlockMtime(projectId, blockId) {
    const res = await fetch(`/api/projects/${projectId}/mtime/${blockId}?t=${Date.now()}`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.ok ? json.data : null;
  },

  async renderBlock(projectId, blockId, debug = false, scale = 1) {
    return readJson(await fetch(`/api/projects/${projectId}/render/${blockId}?debug=${debug}&scale=${scale}`, {
      method: 'POST',
    }), '渲染分块失败');
  },

  async stitchProject(projectId) {
    return readJson(await fetch(`/api/projects/${projectId}/stitch`, { method: 'POST' }), '拼接长图失败');
  },

  async lintBlock(projectId, blockId) {
    return readJson(await fetch(`/api/projects/${projectId}/lint/${blockId}`), '运行机检失败');
  },

  async createBlock(projectId, blockId) {
    return readJson(await fetch(`/api/projects/${projectId}/blocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blockId }),
    }), '创建分块失败');
  },
};

