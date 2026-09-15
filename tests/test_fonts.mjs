import { render } from '../pipeline/canvas/render.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

async function testAllFonts() {
  console.log('测试内置字体渲染...');
  const testLayout = {
    width: 1080,
    height: 1900,
    elements: [
      {
        type: 'text',
        content: 'pic-flow 内置精品字体全景预览',
        x: 540,
        y: 80,
        size: 46,
        font: 'butter',
        align: 'center',
        bold: true,
      },
      {
        type: 'text',
        content: '1. 站酷黄油体 (butter)：【厚重招贴感】大字号高张力标题首选！',
        x: 100,
        y: 200,
        size: 34,
        font: 'butter',
        align: 'left',
      },
      {
        type: 'text',
        content: '2. 站酷快乐体 (title)：『生动活泼』富有漫画节奏感与亲和力的叙事主标题',
        x: 100,
        y: 340,
        size: 34,
        font: 'title',
        align: 'left',
      },
      {
        type: 'text',
        content: '3. 霞鹜文楷 (body)：长文正文基石，笔触温润沉稳，人文气息浓郁，万字阅读毫无疲劳感。',
        x: 100,
        y: 480,
        size: 30,
        font: 'body',
        max_width: 880,
        align: 'left',
      },
      {
        type: 'text',
        content: '4. 站酷小薇体 (xiaowei)：纤细柔美、典雅文艺的副标题与意境诗意文字',
        x: 100,
        y: 620,
        size: 34,
        font: 'xiaowei',
        align: 'left',
      },
      {
        type: 'text',
        content: '『喂！我是小徕手写体 (handwriting)！放在气泡里对话太合适不过啦！』',
        x: 540,
        y: 770,
        size: 30,
        font: 'handwriting',
        align: 'center',
        box: {
          style: 'fill',
          bg: '#F6A83C',
          color: '#4A2800',
          pad: [16, 24],
          tail: 'bc',
        },
      },
      {
        type: 'text',
        content: '5. 马善政毛笔楷书 (brush)：〖苍劲雄浑〗力透纸背的高光金句与结论定型！',
        x: 100,
        y: 930,
        size: 36,
        font: 'brush',
        align: 'left',
      },
      {
        type: 'text',
        content: '6. 志莽行书 (running)：〖乱石穿空，惊涛拍岸，卷起千堆雪〗',
        x: 100,
        y: 1070,
        size: 38,
        font: 'running',
        align: 'left',
      },
      {
        type: 'text',
        content: '7. 龙藏体 (cursive)：〖仰天大笑出门去，我辈岂是蓬蒿人〗',
        x: 100,
        y: 1210,
        size: 38,
        font: 'cursive',
        align: 'left',
      },
      {
        type: 'text',
        content: '8. 思源黑体 (sans)：现代克制无衬线字体，商业模型与硬核科普图表说明必备。',
        x: 100,
        y: 1350,
        size: 30,
        font: 'sans',
        align: 'left',
      },
      {
        type: 'text',
        content: '9. 思源宋体 (serif)：古典正统衬线字体，典籍引用、史料摘抄与碑刻记录。',
        x: 100,
        y: 1480,
        size: 30,
        font: 'serif',
        align: 'left',
      },
    ],
  };

  const out = '/tmp/test_fonts_preview.png';
  await render(testLayout, out, false, REPO_ROOT);
  console.log(`[PASS] 全字体预览图已生成: ${out}`);
}

testAllFonts().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
