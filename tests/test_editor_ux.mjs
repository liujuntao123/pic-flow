/**
 * 编辑器交互回归（需要 Web 服务在线）：
 *
 *  1. HiDPI 热区 —— dpr=2 下点击画布元素必须能选中。曾经 canvas 只设置
 *     width/height 属性而没锁 CSS 尺寸，HiDPI 屏上整个画布被放大 dpr 倍显示，
 *     鼠标坐标换算全偏，表现为「很多元素点击了但是选不到」。
 *  2. 逐行热区 —— 无气泡文本按实际行框命中：宽段落包围盒右侧的空白
 *     不再拦截下方元素（hitTestAll 逐行口径）。
 *  3. 快捷键 —— 方向键微调/平移视口、撤销/重做、Ctrl+D 复制、Esc 取消、
 *     空格拖拽平移、Ctrl+滚轮缩放、? 帮助弹窗。
 *  4. 剧本分镜 markdown 渲染 + Block 标题点击跳转。
 *
 * 用法：npm run web & 然后 node tests/test_editor_ux.mjs
 * 环境变量：BASE_URL（默认 127.0.0.1:3100）、CHROME_PATH
 */
import { chromium } from 'playwright-core';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3100';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function openEditor(page) {
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.project-card');
  await page.click('.project-card:has-text("黄巢")');
  await page.waitForSelector('#canvas-board');
  // 等首轮 Canvas 渲染完成（命中数据就位），图片加载慢的旧渲染不会覆盖新数据
  await page.waitForFunction(() => (window.app?.projectDetailComp?.hitBoxes?.length || 0) > 0);
  await page.waitForTimeout(300);
}

/** 用真实鼠标拖拽元素 i 的指定手柄（屏幕位移 dx/dy），返回拖拽前的基础数据 */
async function dragHandle(page, index, handle, dx, dy, zoom) {
  const info = await page.evaluate(([i, h, z]) => {
    const comp = window.app.projectDetailComp;
    const target = comp.hitBoxes[i];
    const pos = window.app.renderer.handlePositions(target)[h];
    const rect = document.querySelector('#canvas-board').getBoundingClientRect();
    return {
      sx: rect.left + pos[0] * z,
      sy: rect.top + pos[1] * z,
      w0: target.width,
      h0: target.height,
      x0: target.element.x || 0,
    };
  }, [index, handle, zoom]);
  await page.mouse.move(info.sx, info.sy);
  await page.mouse.down();
  await page.mouse.move(info.sx + dx, info.sy + dy, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250); // 等重绘与命中数据刷新
  return info;
}

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    // ---- 1. HiDPI (dpr=2) 热区端到端 ----
    const hidpiCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page2x = await hidpiCtx.newPage();
    await openEditor(page2x);

    // 找一个「在其包围盒中心点命中就是它自己」的元素，拿真实鼠标去点屏幕上的对应位置
    const target = await page2x.evaluate(() => {
      const comp = window.app.projectDetailComp;
      const canvas = document.querySelector('#canvas-board');
      const rect = canvas.getBoundingClientRect();
      for (let i = 0; i < comp.hitBoxes.length; i += 1) {
        const [x0, y0, x1, y1] = comp.hitBoxes[i].box;
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        const hits = comp.app.renderer.hitTestAll(comp.hitBoxes, cx, cy, comp.zoom);
        if (hits.length > 0 && hits[0] === i) {
          return {
            index: i,
            screenX: rect.left + cx * comp.zoom,
            screenY: rect.top + cy * comp.zoom,
          };
        }
      }
      return null;
    });
    check('找到可唯一点选的元素', Boolean(target));

    if (target) {
      await page2x.mouse.click(target.screenX, target.screenY);
      const selected = await page2x.evaluate(() => window.app.projectDetailComp.selectedIndex);
      check('HiDPI (dpr=2) 点击画布元素能选中', selected === target.index,
        `期望 #${target.index}，实际 #${selected}`);
    }
    await hidpiCtx.close();

    // ---- 2~4. 常规 dpr=1 上下文 ----
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await openEditor(page);
    page.on('dialog', (d) => d.accept());

    // ---- 2. 剧本分镜 markdown 渲染（趁还没有未保存修改，先做无弹窗的部分） ----
    await page.click('.sidebar-tab[data-tab="script"]');
    await page.waitForSelector('.md-body');
    const mdInfo = await page.evaluate(() => ({
      h2: document.querySelectorAll('.md-body h2').length,
      links: document.querySelectorAll('.md-body .md-block-link').length,
    }));
    check('剧本分镜渲染为 markdown（含标题）', mdInfo.h2 > 0, `h2=${mdInfo.h2}`);
    check('剧本中的 Block 标题可跳转', mdInfo.links > 0, `links=${mdInfo.links}`);

    if (mdInfo.links > 0) {
      const expectBlock = await page.evaluate(() => {
        const h = document.querySelector('.md-body .md-block-link');
        return h.textContent.match(/Block\s*(\d+)/i)[1];
      });
      await page.click('.md-body .md-block-link');
      await page.waitForFunction(() => true, undefined);
      await page.waitForTimeout(600);
      const current = await page.evaluate(() => window.app.projectDetailComp.currentBlockId);
      check('点击剧本 Block 标题切换分块', current === `block${expectBlock}`,
        `期望 block${expectBlock}，实际 ${current}`);
      // 切回 block1 继续后续测试
      await page.click('.block-tab[data-block="block1"]');
      await page.waitForTimeout(600);
      await page.click('.sidebar-tab[data-tab="layers"]');
    }

    // ---- 3. 逐行热区（hitTestAll 单元口径，直接在页面里跑渲染器） ----
    const lineHit = await page.evaluate(async () => {
      const { CanvasRenderer } = await import('/js/canvas-renderer.mjs');
      const renderer = new CanvasRenderer();
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1200;
      const layout = {
        width: 1080,
        height: 1200,
        elements: [
          { type: 'text', content: '角落小字', x: 0, y: 0, size: 32, align: 'center' },
          {
            type: 'text',
            content: '这一段是很长的段落文本用来折出多行每一行都比上一行更接近画布边缘哦',
            x: 540, y: 100, size: 32, max_width: 400, align: 'center',
          },
        ],
      };
      const hitBoxes = await renderer.renderBlock(canvas, layout, '', -1, { zoom: 1 });
      const para = hitBoxes[1];
      if (!para.hitLines || para.hitLines.length < 2) return { ok: false, why: '段落未折出多行' };
      const last = para.hitLines[para.hitLines.length - 1];
      // 末行右侧、段落包围盒之内的空白点
      const px = (last.x + last.w + para.box[2]) / 2;
      const py = last.y + last.h / 2;
      // 把角落元素挪到该点（位于段落之下层）
      layout.elements[0].x = px;
      layout.elements[0].y = py - 16;
      const hitBoxes2 = await renderer.renderBlock(canvas, layout, '', -1, { zoom: 1 });
      const hits = renderer.hitTestAll(hitBoxes2, px, py, 1);
      return { ok: hits.length > 0 && hits[0] === 0, hits, px, py };
    });
    check('段落空白区不再拦截下方元素（逐行命中）', lineHit.ok,
      `hits=${JSON.stringify(lineHit.hits)}`);

    // ---- 4. 快捷键 ----
    await openEditor(page);
    await page.click('.layer-item:nth-child(2)');
    const hasInspector = await page.$('#prop-content');
    check('图层点选打开检查器', Boolean(hasInspector));

    const x0 = await page.evaluate(() => window.app.projectDetailComp.layout.elements[1].x || 0);
    await page.keyboard.press('ArrowRight');
    const x1 = await page.evaluate(() => window.app.projectDetailComp.layout.elements[1].x || 0);
    check('方向键微调元素 (1px)', x1 === x0 + 1, `x: ${x0} → ${x1}`);

    await page.keyboard.press('Control+z');
    const x2 = await page.evaluate(() => window.app.projectDetailComp.layout.elements[1].x || 0);
    check('Ctrl+Z 撤销', x2 === x0, `x: ${x1} → ${x2}`);

    await page.keyboard.press('Control+Shift+z');
    const x3 = await page.evaluate(() => window.app.projectDetailComp.layout.elements[1].x || 0);
    check('Ctrl+Shift+Z 重做', x3 === x0 + 1, `x: ${x2} → ${x3}`);

    const count0 = await page.evaluate(() => window.app.projectDetailComp.layout.elements.length);
    await page.keyboard.press('Control+d');
    const count1 = await page.evaluate(() => window.app.projectDetailComp.layout.elements.length);
    const selectedAfterDup = await page.evaluate(() => window.app.projectDetailComp.selectedIndex);
    check('Ctrl+D 复制元素', count1 === count0 + 1 && selectedAfterDup === count1 - 1,
      `count: ${count0} → ${count1}`);

    await page.keyboard.press('Escape');
    const deselected = await page.evaluate(() => window.app.projectDetailComp.selectedIndex);
    check('Esc 取消选中', deselected === -1);

    // 无选中时方向键平移视口
    await page.evaluate(() => { document.querySelector('#canvas-viewport').scrollTop = 300; });
    await page.keyboard.press('ArrowUp');
    const st = await page.evaluate(() => document.querySelector('#canvas-viewport').scrollTop);
    check('无选中时方向键平移视口', st === 180, `scrollTop: 300 → ${st}`);

    // 空格 + 拖拽平移
    await page.evaluate(() => { document.querySelector('#canvas-viewport').scrollTop = 300; });
    const vpBox = await page.locator('#canvas-viewport').boundingBox();
    const cx = vpBox.x + vpBox.width / 2;
    const cy = vpBox.y + vpBox.height / 2;
    await page.keyboard.down('Space');
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 60, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    const pan = await page.evaluate(() => {
      const vp = document.querySelector('#canvas-viewport');
      return { left: vp.scrollLeft, top: vp.scrollTop, panning: vp.classList.contains('panning') };
    });
    // 纵向断言足够：块宽 1080×45% < 视口宽，横向本就无可滚动余量
    check('空格+拖拽平移画布', Math.abs(pan.top - 240) <= 6 && !pan.panning,
      `scroll=(${pan.left}, ${pan.top})`);

    // Ctrl + 滚轮缩放
    const zoom0 = await page.$eval('#zoom-text', (el) => el.textContent);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);
    const zoom1 = await page.$eval('#zoom-text', (el) => el.textContent);
    check('Ctrl+滚轮缩放画布', zoom0 !== zoom1, `${zoom0} → ${zoom1}`);

    // ---- 5. 拖拽手柄调整尺寸 ----
    // 复位视口滚动：手柄的屏幕坐标必须落在可见画布内，mousedown 才会命中
    await page.evaluate(() => {
      const vp = document.querySelector('#canvas-viewport');
      vp.scrollTop = 0;
      vp.scrollLeft = 0;
    });
    // 动态读当前缩放（上面的 Ctrl+滚轮已把视图缩放到 50%）
    const zoomNow = await page.evaluate(() => window.app.projectDetailComp.zoom);

    // 5a. card 右缘手柄：宽度增加、左缘（x）不动
    const cardIdx = await page.evaluate(() => {
      const comp = window.app.projectDetailComp;
      comp.layout.elements.push({ type: 'card', x: 100, y: 300, width: 400, height: 200, label: '测试卡片' });
      comp.selectElement(comp.layout.elements.length - 1);
      return comp.selectedIndex;
    });
    await page.waitForFunction((i) => window.app.projectDetailComp.hitBoxes.length > i, cardIdx);
    const cardDrag = await dragHandle(page, cardIdx, 'e', 80, 0, zoomNow);
    const cardEl = await page.evaluate((i) => window.app.projectDetailComp.layout.elements[i], cardIdx);
    check('card 右缘手柄调整宽度', Math.abs(cardEl.width - cardDrag.w0 - 80 / zoomNow) <= 2
      && Math.abs(cardEl.x - cardDrag.x0) <= 1,
      `width ${cardDrag.w0} → ${cardEl.width}, x ${cardDrag.x0} → ${cardEl.x}`);

    // 5b. asset 角手柄等比缩放（以位移较大的轴为准）+ 锚点回贴
    const assetIdx = await page.evaluate(() => {
      const comp = window.app.projectDetailComp;
      comp.layout.elements.push({
        type: 'asset', file: 'nonexistent-for-test.png',
        x: 540, y: 600, width: 300, height: 200, anchor: 'cc',
      });
      comp.selectElement(comp.layout.elements.length - 1);
      return comp.selectedIndex;
    });
    await page.waitForFunction((i) => window.app.projectDetailComp.hitBoxes.length > i, assetIdx);
    const assetDrag = await dragHandle(page, assetIdx, 'se', 60, 10, zoomNow);
    const assetEl = await page.evaluate((i) => window.app.projectDetailComp.layout.elements[i], assetIdx);
    // 与 applyResize 同一套公式算期望值
    const expW = Math.max(20, Math.round(assetDrag.w0 + 60 / zoomNow));
    const expH = Math.max(20, Math.round(expW * (assetDrag.h0 / assetDrag.w0)));
    const ratioOk = Math.abs(assetEl.width - expW) <= 2 && Math.abs(assetEl.height - expH) <= 2;
    const centerKept = Math.abs((assetEl.width - assetDrag.w0) / 2 - (assetEl.x - assetDrag.x0)) <= 1;
    check('asset 角手柄等比缩放并保持中心', ratioOk && centerKept,
      `${assetDrag.w0}×${assetDrag.h0} → ${assetEl.width}×${assetEl.height}`);

    // 5c. text 行宽框架：左右手柄调折行宽度（居中对齐两侧对称生长，2× 跟手），高度自适应
    const textIdx = await page.evaluate(() => {
      const comp = window.app.projectDetailComp;
      comp.layout.elements.push({
        type: 'text', content: '手柄测试文本', x: 540, y: 900,
        size: 40, align: 'center', max_width: 400,
      });
      comp.selectElement(comp.layout.elements.length - 1);
      return comp.selectedIndex;
    });
    await page.waitForFunction((i) => window.app.projectDetailComp.hitBoxes.length > i, textIdx);
    // 拖宽：左缘手柄向左 40 屏幕px → 行宽 +2×(40/zoom)
    await dragHandle(page, textIdx, 'w', -40, 0, zoomNow);
    const textEl = await page.evaluate((i) => window.app.projectDetailComp.layout.elements[i], textIdx);
    check('text 左缘手柄调行宽（居中 2× 跟手）',
      Math.abs(textEl.max_width - (400 + 2 * 40 / zoomNow)) <= 2,
      `max_width 400 → ${textEl.max_width}`);
    const frameW = await page.evaluate((i) => {
      const t = window.app.projectDetailComp.hitBoxes[i];
      return t.frame ? t.frame[2] - t.frame[0] : -1;
    }, textIdx);
    check('文本选中框=行宽框架（手柄跟手）', Math.abs(frameW - textEl.max_width) <= 1,
      `frame=${Math.round(frameW)} max_width=${textEl.max_width}`);
    // 拖窄：行宽 160 → 6 个字折成 2 行，框架高度自适应变大
    await dragHandle(page, textIdx, 'w', 100, 0, zoomNow);
    const shrunk = await page.evaluate((i) => {
      const comp = window.app.projectDetailComp;
      const t = comp.hitBoxes[i];
      return { mw: comp.layout.elements[i].max_width, fh: t.frame[3] - t.frame[1] };
    }, textIdx);
    check('拖窄行宽后高度自适应（折行变多）',
      Math.abs(shrunk.mw - (400 + 2 * 40 / zoomNow - 2 * 100 / zoomNow)) <= 2 && shrunk.fh > 90,
      `max_width=${shrunk.mw} frameH=${Math.round(shrunk.fh)}（单行高 60）`);

    // ---- 6. 画布底部测试场：注入互不重叠的元素，滚动到可见区域 ----
    await page.evaluate(() => { document.querySelector('#canvas-viewport').scrollTop = 0; });
    await page.keyboard.press('Escape'); // 清空选择
    const fix = await page.evaluate(() => {
      const comp = window.app.projectDetailComp;
      const mk = (x, content) => ({
        type: 'text', content, x, y: 2400, size: 24, align: 'center', max_width: 300,
      });
      comp.layout.elements.push(mk(150, '多选【甲】'), mk(400, '多选乙'), mk(500, '吸附丙'));
      const vp = document.querySelector('#canvas-viewport');
      vp.scrollTop = 800; // 让 y≈2400 的区域进入视口
      comp.redrawCanvas(); // 直接改了 layout，必须手动触发重绘刷新命中数据
      return {
        idx: [comp.layout.elements.length - 3, comp.layout.elements.length - 2, comp.layout.elements.length - 1],
      };
    });
    await page.waitForFunction(
      (n) => window.app.projectDetailComp.hitBoxes.length >= n,
      fix.idx[2] + 1,
    );
    await page.waitForTimeout(300);

    // ---- 7. Shift+点击多选 + 批量移动 + 撤销 ----
    await page.keyboard.press('Escape');
    await page.evaluate(() => { document.querySelector('#canvas-viewport').scrollTop = 0; });
    await page.click('.layer-item:nth-child(1)');
    await page.click('.layer-item:nth-child(3)', { modifiers: ['Shift'] });
    const selCount = await page.evaluate(() => window.app.projectDetailComp.selectedIndices.length);
    check('Shift+点击多选图层', selCount === 2, `selected=${selCount}`);

    const beforeNudge = await page.evaluate(() => {
      const c = window.app.projectDetailComp;
      return c.selectedIndices.map((i) => c.layout.elements[i].x || 0);
    });
    await page.keyboard.press('ArrowRight');
    const afterNudge = await page.evaluate(() => {
      const c = window.app.projectDetailComp;
      return c.selectedIndices.map((i) => c.layout.elements[i].x || 0);
    });
    check('方向键批量微调多选', afterNudge.length === 2
      && afterNudge.every((x, k) => x === beforeNudge[k] + 1),
      `${JSON.stringify(beforeNudge)} → ${JSON.stringify(afterNudge)}`);

    // 拖拽组：在画布上直接点「多选甲」+ Shift+点「多选乙」组成多选（底部区域无层叠干扰），
    // 拖 30/20 屏幕px，两元素位移一致（吸附可能整体偏移，放宽 ±20）
    // 底部测试场要先滚入视口，否则鼠标事件坐标会漂移
    await page.evaluate(() => { document.querySelector('#canvas-viewport').scrollTop = 800; });
    await page.waitForTimeout(150);
    const pair = await page.evaluate((idx) => {
      const c = window.app.projectDetailComp;
      const rect = document.querySelector('#canvas-board').getBoundingClientRect();
      return idx.map((i) => {
        const b = c.hitBoxes[i].box;
        return {
          sx: rect.left + (b[0] + b[2]) / 2 * c.zoom,
          sy: rect.top + (b[1] + b[3]) / 2 * c.zoom,
        };
      });
    }, fix.idx.slice(0, 2));
    await page.mouse.click(pair[0].sx, pair[0].sy); // 选中「多选甲」
    await page.keyboard.down('Shift');
    await page.mouse.click(pair[1].sx, pair[1].sy); // Shift+点击加入「多选乙」
    await page.keyboard.up('Shift');
    const selCount2 = await page.evaluate(() => window.app.projectDetailComp.selectedIndices.length);
    check('Shift+点击画布元素多选', selCount2 === 2, `selected=${selCount2}`);

    const grp = await page.evaluate(() => {
      const c = window.app.projectDetailComp;
      const rect = document.querySelector('#canvas-board').getBoundingClientRect();
      const b = c.hitBoxes[c.selectedIndex].box;
      return {
        sx: rect.left + (b[0] + b[2]) / 2 * c.zoom,
        sy: rect.top + (b[1] + b[3]) / 2 * c.zoom,
        before: c.selectedIndices.map((i) => ({
          x: c.layout.elements[i].x || 0, y: c.layout.elements[i].y || 0,
        })),
      };
    });
    await page.mouse.move(grp.sx, grp.sy);
    await page.mouse.down();
    await page.mouse.move(grp.sx + 30, grp.sy + 20, { steps: 6 });
    await page.mouse.up();
    const moved = await page.evaluate(() => {
      const c = window.app.projectDetailComp;
      return c.selectedIndices.map((i) => ({
        x: c.layout.elements[i].x || 0, y: c.layout.elements[i].y || 0,
      }));
    });
    const dxs = moved.map((p, k) => p.x - grp.before[k].x);
    const dys = moved.map((p, k) => p.y - grp.before[k].y);
    check('批量拖拽移动保持相对位置',
      new Set(dxs).size === 1 && new Set(dys).size === 1
      && Math.abs(dxs[0] - 60) <= 20 && Math.abs(dys[0] - 40) <= 20,
      `dx=${dxs[0]} dy=${dys[0]}（期望≈60/40，容许吸附偏移）`);
    await page.keyboard.press('Control+z');
    const restored = await page.evaluate(() => {
      const c = window.app.projectDetailComp;
      return c.selectedIndices.map((i) => c.layout.elements[i].x || 0);
    });
    const undoDeltas = restored.map((x, k) => x - grp.before[k].x);
    check('批量移动可撤销', new Set(undoDeltas).size === 1 && Math.abs(undoDeltas[0]) <= 20,
      `x 回到 ${JSON.stringify(restored)}（原 ${JSON.stringify(grp.before.map((p) => p.x))}）`);

    // ---- 8. 框选 ----
    await page.keyboard.press('Escape');
    await page.evaluate(() => { document.querySelector('#canvas-viewport').scrollTop = 800; });
    await page.waitForTimeout(200);
    const m = await page.evaluate(() => {
      const rect = document.querySelector('#canvas-board').getBoundingClientRect();
      return {
        x0: rect.left + 60 * window.app.projectDetailComp.zoom,
        y0: rect.top + 2320 * window.app.projectDetailComp.zoom,
        x1: rect.left + 560 * window.app.projectDetailComp.zoom,
        y1: rect.top + 2460 * window.app.projectDetailComp.zoom,
      };
    });
    await page.mouse.move(m.x0, m.y0);
    await page.mouse.down();
    await page.mouse.move(m.x1, m.y1, { steps: 6 });
    await page.mouse.up();
    const marqSel = await page.evaluate((idx) => {
      const sel = window.app.projectDetailComp.selectedIndices;
      return idx.every((i) => sel.includes(i));
    }, fix.idx.slice(0, 2));
    const marqSelList = await page.evaluate(() => window.app.projectDetailComp.selectedIndices);
    check('框选选中区域内元素', marqSel, `selected=${JSON.stringify(marqSelList)}`);

    // ---- 9. 拖拽对齐吸附（干净画布：单元素，唯一竞争目标就是画布居中线 x=540）----
    const page3 = await ctx.newPage();
    await openEditor(page3);
    await page3.evaluate(() => {
      const c = window.app.projectDetailComp;
      c.layout.elements = [{
        type: 'text', content: '吸附测试', x: 500, y: 800, size: 24, align: 'center', max_width: 300,
      }];
      c._sel = [];
      c.redrawCanvas();
    });
    await page3.waitForFunction(() => window.app.projectDetailComp.hitBoxes.length === 1);
    const snapDrag = await page3.evaluate(() => {
      const c = window.app.projectDetailComp;
      const rect = document.querySelector('#canvas-board').getBoundingClientRect();
      const b = c.hitBoxes[0].box;
      return {
        sx: rect.left + (b[0] + b[2]) / 2 * c.zoom,
        sy: rect.top + (b[1] + b[3]) / 2 * c.zoom,
      };
    });
    // 向右拖 24 屏幕px：中心落进画布中线的吸附阈值（8/0.45≈17.8 画布px），应被精确吸到 540
    await page3.mouse.move(snapDrag.sx, snapDrag.sy);
    await page3.mouse.down();
    await page3.mouse.move(snapDrag.sx + 24, snapDrag.sy, { steps: 4 });
    await page3.mouse.up();
    const snappedX = await page3.evaluate(() => window.app.projectDetailComp.layout.elements[0].x);
    check('拖拽吸附到画布居中线 (x=540)', snappedX === 540, `x=${snappedX}`);
    const guidesCleared = await page3.evaluate(() => window.app.projectDetailComp.activeGuides);
    check('松开后对齐参考线收起', guidesCleared === null);
    await page3.close();

    // ---- 10. 双击画布直接编辑文本 ----
    await page.keyboard.press('Escape');
    const dbl = await page.evaluate((idx) => {
      const c = window.app.projectDetailComp;
      const rect = document.querySelector('#canvas-board').getBoundingClientRect();
      const b = c.hitBoxes[idx].box;
      return {
        sx: rect.left + (b[0] + b[2]) / 2 * c.zoom,
        sy: rect.top + (b[1] + b[3]) / 2 * c.zoom,
      };
    }, fix.idx[0]);
    await page.mouse.dblclick(dbl.sx, dbl.sy);
    const taShown = await page.$('#inline-text-editor');
    check('双击文本出现画布内编辑器', Boolean(taShown));
    const hiddenWhileEditing = await page.evaluate(
      (idx) => window.app.projectDetailComp.hiddenElementIndex === idx,
      fix.idx[0],
    );
    check('编辑中画布本体隐藏（防重影）', hiddenWhileEditing);
    if (taShown) {
      const taValue = await page.$eval('#inline-text-editor', (el) => el.value);
      check('编辑框显示带语义标记的原文', taValue === '多选【甲】', `value="${taValue}"`);
      const selLen = await page.$eval(
        '#inline-text-editor',
        (el) => el.selectionEnd - el.selectionStart,
      );
      check('进入编辑不整段全选（无凭空高亮块）', selLen === 0, `selLen=${selLen}`);
      await page.evaluate(() => {
        const ta = document.querySelector('#inline-text-editor');
        ta.value = '画布内改好的文字';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.keyboard.press('Escape');
    }
    const inlineResult = await page.evaluate((idx) => ({
      content: window.app.projectDetailComp.layout.elements[idx].content,
      hidden: window.app.projectDetailComp.hiddenElementIndex,
    }), fix.idx[0]);
    check('画布内编辑写回内容并恢复正常渲染',
      inlineResult.content === '画布内改好的文字' && inlineResult.hidden === -1,
      `content="${inlineResult.content}" hidden=${inlineResult.hidden}`);

    // ---- 6. 粗体口径：无真粗体字面的字体族不再触发合成粗体 ----
    const boldCheck = await page.evaluate(async () => {
      const { CanvasRenderer } = await import('/js/canvas-renderer.mjs');
      const r = new CanvasRenderer();
      return {
        title: r.getFontString(40, true, 'title'),
        brush: r.getFontString(32, true, 'brush'),
        body: r.getFontString(40, true, 'body'),
        bodyNormal: r.getFontString(40, false, 'body'),
      };
    });
    check('展示字体 bold 回退常规体（与引擎同口径，不发糊）',
      !boldCheck.title.startsWith('bold') && !boldCheck.brush.startsWith('bold'),
      `title="${boldCheck.title}"`);
    check('文楷/思源 bold 仍走真粗体字面',
      boldCheck.body.startsWith('bold') && !boldCheck.bodyNormal.startsWith('bold'),
      `body="${boldCheck.body}"`);

    // ? 帮助弹窗 + Esc 关闭
    await page.keyboard.press('Shift+Slash');
    const helpShown = await page.$('#shortcut-help-modal');
    check('? 呼出快捷键速查', Boolean(helpShown));
    await page.keyboard.press('Escape');
    const helpClosed = await page.evaluate(() => !document.getElementById('shortcut-help-modal'));
    check('Esc 关闭帮助弹窗', helpClosed);
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n[editor-ux] ${results.length - failed}/${results.length} 通过`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[editor-ux] 运行失败:', err);
  process.exit(1);
});
