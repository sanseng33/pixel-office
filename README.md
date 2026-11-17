# 像素公司 / Pixel Office

智慧芽（PatSnap）苏州新办公室大堂用的 1:1 正方形屏幕原型。全屏显示一栋 7 层等距剖面办公楼：每层室内可见，有工位和会动的像素小人，屋顶有发光的 **PatSnap** 字牌。

画面是全息蓝图风格：近黑底、淡网格、少量漂浮像素。主线是浅冰蓝（`#7FDBFF`），电流在建筑主结构上循环流动（`#BFF4FF` ↔ `#2E9BFF`）。强调色只有白色（字牌、屏幕、状态灯）。

![大厅画面](docs/screenshot.png)

## 本地运行

需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

浏览器打开 [http://localhost:5173](http://localhost:5173)。开发服务监听 `0.0.0.0:5173`，同一局域网里的大屏电脑也可以访问。

## 构建与预览

```bash
npm run build
npm run preview
```

`preview` 默认端口 `4173`。产物在 `dist/`，可以放到任意静态文件服务器上。

## 改楼层

所有楼层都在 [`src/config/floors.ts`](src/config/floors.ts)。改完保存，开发服务器会自动刷新。

| 字段 | 作用 |
| --- | --- |
| `level` | 楼层号。`1` 在最底下，数字越大越靠上。请保持 1–7 且不要重复。 |
| `kind` | 室内模板：`lobby` 门厅展厅、`lounge` 休息区、`sales` 销售、`it` 机房、`rnd` 研发、`vacant` 空置施工。 |
| `label` | 侧面大字，例如 `3F`。只用 A–Z、0–9 和 `& - ! +` 空格。 |
| `name` | 侧面小字，例如 `SALES`。字符限制同上。 |
| `title` | 给人看的中文说明，不会画到屏幕上。 |
| `people` | 这一层的人数。空置层会忽略。人少、工位多，画面才不会挤。 |
| `stations` | 销售 / 研发 / IT 的工位数量，很多人会空着。 |
| `racks` | IT 层机柜数量。 |

事件会跟着 `kind` 走：成交在销售层，部署成功在研发层，访客到达在门厅层。

## 事件

现在用的是假轮询：大约每 10–30 秒随机抛出一条事件，几秒后回到平时状态。

接口在 [`src/events/source.ts`](src/events/source.ts)：

- `dealClosed` — 销售层有人庆祝，弹出 `DEAL`
- `deploySuccess` — 研发层屏幕闪白，弹出 `DEPLOY`
- `visitorArrived` — 门厅有人从门口走进来

换成真实数据时，实现同一个 `EventSource`（`start` / `stop`），然后在 [`src/main.ts`](src/main.ts) 里把 `createMockEventSource(...)` 换成你的实现即可。例如以后接 WebSocket：

```ts
export function createSocketSource(url: string): EventSource {
  let socket: WebSocket | null = null;
  return {
    start(onEvent) {
      socket = new WebSocket(url);
      socket.onmessage = (message) => {
        const data = JSON.parse(String(message.data)) as {
          type: 'dealClosed' | 'deploySuccess' | 'visitorArrived';
          level: number;
          ttlMs?: number;
        };
        onEvent({
          type: data.type,
          level: data.level,
          ttlMs: data.ttlMs ?? 5500,
          at: performance.now(),
        });
      };
    },
    stop() {
      socket?.close();
      socket = null;
    },
  };
}
```

## 显示

逻辑分辨率是 480×480。页面按整数倍放大到窗口里能放下的最大正方形，多出来的地方用同一近黑色留边。缩放使用 `image-rendering: pixelated`，像素保持清晰。

动画走固定对象池（小人、电流、粒子、庆祝碎片都是启动时分配好的），帧循环里不创建新对象，适合 7×24 小时挂着。

## 防烧屏与昼夜

大约每 15 分钟，整幅画面在 ±2 像素内挪一格，避免静态线条长期烧在同一批面板像素上。

色调按苏州时间（东八区，无夏令时）轻微变化：傍晚稍深，夜里再压一点。字牌仍然保持白色。

## Chrome 展厅模式

先构建再预览（或由系统服务托管 `dist/`）：

```bash
npm run build
npm run preview -- --host 0.0.0.0 --port 4173
```

在大屏那台电脑上：

```bash
google-chrome \
  --kiosk \
  --no-first-run \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --autoplay-policy=no-user-gesture-required \
  "http://127.0.0.1:4173/?kiosk=1"
```

`?kiosk=1` 会隐藏鼠标并禁用右键菜单。建议在操作系统里关掉屏保和自动休眠。WebGL 上下文如果丢失，页面会自动刷新。

## 调试参数

| 参数 | 作用 |
| --- | --- |
| `?demo=1` | 很快依次播放访客、成交、部署，方便看庆祝动画 |
| `?hour=22` | 强制按这个小时上色（0–23），不跟真实时间走 |
| `?kiosk=1` | 展厅模式：无鼠标 |
| `?burn=fast` | 防烧屏每 3 秒挪一次，用来确认位移 |

## 技术说明

Vite + TypeScript + PixiJS 8。建筑、家具和角色都是代码里画的原创像素，先烘到 480×480 的画布上，再由 Pixi 以最近邻贴上去。角色比例和走路节奏参考了 FC 时代横版的大头小身，没有使用任何现成的版权精灵。
