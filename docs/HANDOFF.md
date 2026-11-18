# 像素公司交接

本文以分支 `cursor/pixel-office-prototype-78b1` 的当前代码为准，写这份文档时的分支头是 `93edd1a`（完整 SHA `93edd1ada90062626f50a7bfc80353691f75d2b7`）。默认画面以 `src/render/tile/engine.ts` 为准。`README.md` 仍在描述更早的底图叠层，和入口不一致的地方在下面单独标出。

`docs/wip/` 里的补丁、压缩包和截图都没有应用到源代码。不要把它们当成已经合入的功能。

## 项目目标

智慧芽（PatSnap）苏州新楼 1F 展厅，一块 1:1 的正方形屏幕，上面跑实时动画网页「像素公司 / 像素工位」。

画面是一栋等距剖面塔楼，七层叠在同一张格子上：每层有工位和像素小人，小人会走、会坐、偶尔聊天。适合 7×24 小时挂在展厅。窗口不是正方形时，四周用近黑留边，画面本身保持正方形。

## 已确定的视觉要求

这些是已经定下来的画面标准。当前塔楼视图（不带 `renderer`、不带 `floor`）大体按这个标准在画：

- 垂直直筒。每一层同一个脚印，只有竖向层距，没有退台。
- 楼板近正方形，各层同尺寸。
- L 形缺角从 1F 贯穿到屋顶，缺角朝向观众，上层楼板挡住下层后部。
- 楼层标签在左侧立面，格式是 `1F LOBBY` 这种「层号 + 英文名」。
- 楼顶有 PatSnap 字牌，还有两台空调外机。
- 仅藏青、冰蓝、白三色，极简全息像素风（类 FC《热血高校》）。主线条是浅蓝。代码里的三个主色是藏青 `0x071422`、冰蓝 `0x9ad7ff`、白 `0xf4fbff`。楼板还用了更深的藏青填充（例如 `0x0c1828`、`0x071018`），亮着的屏幕有一笔 `0x6eb6dc`。夜景（苏州时间 20 点到次日 6 点）在整幅上盖一层 `0x02060c`、透明度 0.28。
- 电流脉冲沿建筑自身边线走。塔楼每层沿楼板外轮廓（`towerSolid` 的外环）走脉冲；屋顶另有两条从底层角点拉到屋顶的竖线。
- 各层最外沿不要玻璃围栏。塔楼模式的楼板侧面是实心色块，外沿只有一圈冰蓝轮廓线，没有栏杆。这一步是 `11b1303`。
- 内部要密，不要稀疏。塔楼家具由 `stackAccents` 按楼层类型铺满可见的 L 形区域，连 3×3 的空块也会被填上。
- 工位多，在岗人数少。塔楼里的人数写在 `stackFolk`，每层大约 4 到 6 人，6F 空置层是 0 人。多数工位空着。
- 行走是四帧剪刀步：接触、交错、反接触、交错，对侧手臂摆动，头和躯干高度不变。

楼层含义（1F 在最底）：

| 层 | `type` | 标签 | 中文（`title`，不上屏） |
| --- | --- | --- | --- |
| 1F | `lobby` | LOBBY | 入口与公共展厅 |
| 2F | `lounge` | LOUNGE | 员工休息区 |
| 3F | `sales` | SALES | 销售 |
| 4F | `it` | IT | IT 机房 |
| 5F | `rnd` | R&D | 研发 |
| 6F | `vacant` | VACANT | 空置 |
| 7F | `rnd` | R&D | 研发（实验台） |

楼层号、类型、侧标由 `src/config/floors.ts` 的 `floors` 驱动。改 `type` 会换塔楼里那一套家具分支（`stackAccents` / `stackFolk`）。

塔楼视图不读 `stations`、`occupancy`、`people`。`makePeople` 在塔楼模式下把入座人数和配置里的额外人数都当成 0，只生成 `stackFolk` 里的人。这三个字段只影响 `?floor=N` 的单层，以及 `?renderer=plate` 的旧叠层。

5F 和 7F 都是 `rnd`，塔楼里用 `level` 分开：5F（`level <= 5`）左翼工位行的朝向和 7F 不同，在岗小人的落点也略有差别。单层布局里，`layout.ts` 的 `rndSmall()` 只给 5F，带一块白板；7F 用更长的工位行。README 里「较高的那层 rnd 多一块白板 / 实验台」描述的是旧底图叠层（`plate.ts` 在 7F 放 `lab`），不是现在的默认塔楼。

## 技术栈与架构

- Vite 6、TypeScript 5、PixiJS 8。`package.json` 里 pixi 是 `^8.6.6`，锁文件解析到 `8.23.0`。`three`（`^0.170.0`）只给遗留的 `?renderer=3d`。
- 需要 Node.js 20 或更高。本机核对构建时用的是 Node 22。
- 入口：`index.html` → `src/main.ts`。
- 逻辑分辨率 `VIEW = 540`（`src/config/display.ts`）。画布缓冲就是 540×540，再用 CSS 按整数放大。边长至少 1080 的正方形窗口上，显示尺寸是 1080（×2），像素缓冲仍是 540。这是放大，不是按 1080 重画。
- 默认渲染器是 `src/render/tile/engine.ts` 的 `createTileFloor`。Pixi `Application` 关闭抗锯齿、`roundPixels`、`resolution: 1`，精灵用 `Graphics` 的矩形和多边形当场画，不用图片图集。主循环在 `main.ts`，掉帧上限 50ms，刷新压在 30 帧。
- 网格是等距菱形：屏幕坐标 `(x - y) * tileW`、`(x + y) * tileH`，再减 `z * zH`。塔楼瓦片是 **12×5**（偏扁，好让七层塞进正方形），单层是 **16×11**。
- 仓库里另有一份严格 2:1 的投影：`src/render/iso.ts`（半宽 16、半高 8，10×10 平面），只被 `src/render/scene.ts` 引用。`main.ts` 没有引用 `scene.ts`。当前塔楼不是这份 2:1。交接说明里的「2:1 等距」对得上的是这份未接线的旧模块，对不上正在跑的 `engine.ts`。
- 塔楼脚印在 `towerSolid`：`TOWER_N = 17`，`TOWER_CUT = 9`。`x >= 9 && y >= 9` 的 8×8 被切掉。实心格数 `17² − 8² = 225`。每一层同一函数，所以缺角贯穿。文件头注释写「比 15 格单层每边长约 13%、面积大约 +28%」，13% 是 `17/15`，+28% 是外接正方形 `17²/15²`，不是 225 这个实心格数。
- 单层脚印在 `src/render/tile/layout.ts` 的 `PLAN = 15`，另外还削了近角，和塔楼的 17 格 L 形不是同一张图。塔楼摆家具时 `notchLayout` 丢掉 `layout.ts` 的家具，改用 `engine.ts` 里的 `stackAccents`。
- `floors.ts` 里的 `polygon`、`edges`、`mask`、`LIPS` 是按 `public/assets/bg-shell.jpg`（1024×1024）量的，只给 `?renderer=plate`。改这些数不会改变默认塔楼。
- 小人在可走格上四方向寻路（A*）。坐着的人隔一会儿站起来走，漫游的人会在聊天点停下。事件来自 `src/events/source.ts` 的假轮询，大约每 10–30 秒一条，持续约 5.5 秒。塔楼里 `deploySuccess` 会让该层一个坐着的人站起来，并让该层轮廓脉冲变亮。成交、部署的文字弹出在旧的 `plate.ts` 里，默认塔楼不画 `DEAL` / `DEPLOY`。
- 防烧屏：大约每 15 分钟，整幅在 ±2 CSS 像素里挪一格（`?burn=fast` 改成每 3 秒）。时钟按苏州时间（东八区，无夏令时），可用 `?hour=0`–`23` 固定。`?kiosk=1` 藏鼠标并禁右键。WebGL 上下文丢失会整页刷新。

### 安装、运行、构建

```bash
npm install
npm run dev
```

开发服务监听 `0.0.0.0:5173`。浏览器打开 [http://localhost:5173](http://localhost:5173)。

```bash
npm run build
npm run preview
```

`build` 是 `tsc --noEmit && vite build`，目标 `es2022`，产物在 `dist/`。`preview` 监听 `0.0.0.0:4173`。展厅 Chrome 的 kiosk 启动参数见 README「Chrome 展厅模式」。

### URL 参数（对照当前代码）

当前 `main.ts` / `engine.ts` 实际认的参数：

| 参数 | 当前代码里的行为 |
| --- | --- |
| （无） | 七层塔楼，17×17 减 8×8，225 格，540 缓冲再整数放大 |
| `?floor=N` | `N` 为 1–7 时只画那一层，网格是 `PLAN = 15` 的旧单房间（`layout.ts`），家具和人数走配置里的 `occupancy` / `people`。这不是塔楼的一层放大，不能用来验收塔楼 |
| `?renderer=plate` | 旧底图叠层，背景 `public/assets/bg-shell.jpg`，道具和小人叠在上面。显示尺寸跟窗口走，不锁 540 |
| `?renderer=3d` | `src/render/office3d.ts` 的 three.js。上层楼板有退台（`addLSlab` 里按层内缩）。和已经定下的直筒不一致，只是遗留入口 |
| `?demo=1` | 很快依次播访客、成交、部署 |
| `?hour=H` | 强制按这个小时上色，0–23 |
| `?kiosk=1` | 展厅：无鼠标、无右键菜单 |
| `?burn=fast` | 防烧屏每 3 秒挪一次 |
| `?debug=1` | 只在 `?floor=N` 单层上画可走格。塔楼全景不画这层调试点 |
| `?poses=1` | 塔楼引擎改画一张小人姿势表（四个方向、四帧走、坐、聊天，四种发型） |

下面两个参数**不在当前代码里**，只出现在未验收补丁 `docs/wip/5f-detail-wip.patch` 中。不打补丁时写上它们没有任何效果：

| 参数 | 补丁里的行为（未合入） |
| --- | --- |
| `?plate=b` | 楼板改成 19×19，缺角从 `x >= 10 && y >= 10` 起，也就是 9×9。实心格 `19² − 9² = 280`，比现在的 225 格多 55 格，约 **24.4%**（`280/225 − 1`）。补丁注释写成「+24%」。默认仍是上面的 17×17 减 8×8。内容用 `SHIFT = 1` 平移，使旧布局相对缺角的位置保持不变 |
| `?hd=2` | 画布缓冲改成 `540 × hd`。`hd` 只允许 1 或 2，所以 `2` 是 1080×1080 的真实缓冲，舞台 `scale` 设为 2。精细精灵只在 **5F** 且 `hd > 1` 时走半像素路径，其它层仍按 540 网格画，再被放大。`main.ts` 的 CSS 尺寸计算没有跟着改，仍按 `VIEW = 540` 取整放大 |

`?floor=N` 在补丁里同样没有改。打上补丁之后它仍是 15 格单房间，不能当塔楼或 plate B 的验收画面。验收塔楼看不带 `floor` 的全景；验收未合入的放大楼板看 `?plate=b`（精细 5F 再加 `?hd=2`）。

## 提交历史

这些提交都在当前分支上，从旧到新。消息是提交说明的原文：

| 短 SHA | 完整 SHA | 日期 | 说明 |
| --- | --- | --- | --- |
| `11b1303` | `11b1303143e00a5a116a6caf210f48dc354fa5be` | 2026-11-17 | Pack the notch and drop the glass rails. 去掉玻璃围栏，楼板外沿改成实心侧面，家具格挡住行人 |
| `b7a447a` | `b7a447ab6b0eeca46a2c0016135fc287c2733a11` | 2026-11-17 | Grow the floor plate and furnish the front of the notch. 塔楼脚印改成 17 格正方形，家具铺到缺角朝向观众的一侧 |
| `cf5f966` | `cf5f966d96af9f4e287ddc18e0648213c7aa59dc` | 2026-11-17 | Pack desk rows and rack rows into the visible notch. 5F/7F 两翼多行工位，4F 整排机柜 |
| `c743709` | `c743709ddb9119d1e7d6638356755c097e80d957` | 2026-11-18 | Give the upper floors a real aisle and fill the right edge. 3F–7F 一条连通走道穿过缺角，右翼前排补家具 |
| `93edd1a` | `93edd1ada90062626f50a7bfc80353691f75d2b7` | 2026-11-18 | Redraw people as outlined pixel characters and restore desk rows. 描边小人（头、头发、手臂、脚分开），并加回 3F/5F/7F 的一排工位。这是写本文时的分支头 |

更早的提交把画面从单层研发间收成七层剖面，再收成不透明的直筒剖切。那些不在上表里。

## 当前进展与未验收工作

已合入的默认画面是：直筒七层、17×17 减 8×8（225 格）、无玻璃围栏、描边剪刀步小人、工位密、在岗人少、屋顶 PatSnap 和空调外机、脉冲沿楼板轮廓走。PR #1 开着，还没合并。

未验收的下一步在 `docs/wip/`，基于 `93edd1a`，**不要应用进默认分支当完成品**。方向是用户已经确认的两件事一起做：放大楼板（plate B），以及更精细的精灵。先做 5F 这一层当样板。

`git apply --check` 已对 `93edd1a` 跑过，补丁可以干净地打上。它只改 `src/render/tile/engine.ts`。

![plate B 未通过验收的塔楼截图](wip/wip-tower-plateB-FAILING.png)

### 目录里有什么

| 文件 | 来源 | 作用 |
| --- | --- | --- |
| `docs/wip/5f-detail-wip.patch` | 原样拷贝，未应用 | plate B、`?hd=2`、5F 精细精灵，以及下面的 SHIFT 修复 |
| `docs/wip/5f-wip-untracked.tar.gz` | 原样拷贝 | 解压后得到仓库根上的 `scripts/bands.py`、`scripts/capture.mjs`、`sheet.html` |
| `docs/wip/wip-tower-plateB-FAILING.png` | 原样拷贝 | 这版样板未通过验收的截图 |

### 补丁实际做了什么

- `?plate=b`：`TOWER_N = 19`，`TOWER_CUT = 10`，280 格。屋顶间隙从 40 收到 30，避免七层加高后顶出画面。
- `SHIFT = 1`：`put()` 把基准坐标加上 SHIFT。已经用绝对格坐标扫描的循环改走 `putAt()`，先减 SHIFT 再交给 `put()`，避免加两次。`isAisle`、`stackFolk` 的落点、聊天点同样只平移一次。这就是 plate B 下「重复 SHIFT」布局 bug 的修复。
- `?hd=2`：缓冲 1080。`fine` 只在 5F 打开，走 `drawGuyFine`、`drawHandsFine`、`drawMonitorFine`、`drawDeskFine`、`drawChairFine`。注释写调色仍限制在藏青 / 冰蓝 / 白；实现里又加了衬衫蓝、裤子色、皮肤色 `0x9fc9e6`、代码行 `0x4a8db3` 等阶调。
- 暴露 `window.__tower`（格数、每层家具种类计数、人数、屏幕包围盒），给捕获脚本读。
- plate B 多出来的、旧 17 格布局没摆过的一条可见边（`SHIFT > 0` 时的 `x = 1` 列，以及两条 `edge` 边）用循环补家具。研发和销售在这条边上优先放 `file`（文件柜，画成方块体），少数放绿植，靠边的偶数位尝试再塞一张工位。空洞填充（`holeAt`）会一直往 3×3 空区丢道具，直到塞满。

### 为什么没过验收

SHIFT 重复叠加的问题在这版补丁里已经按上面的方式修了。没过的是新增面积的摆法：多出来的朝向观众的条带和空洞被成堆的方块体（`file`，空置层则是 `box`）填满，挡住后面的工位行。截图就是这件事。前排应该是工位、会议、绿植这类真实办公设施，留出走道，而不是纸箱。

### 怎样自己打上这版样板（仅本地查看，不要当最终提交）

在干净的 `93edd1a` 上：

```bash
git apply docs/wip/5f-detail-wip.patch
tar -xzf docs/wip/5f-wip-untracked.tar.gz
```

解压得到：

- `scripts/capture.mjs`：用无头 Chrome（DevTools 协议，端口 9333）截 1080×1080。用法 `node scripts/capture.mjs <输出目录> <名字>=<query>[@帧数]`。默认页面是 `http://127.0.0.1:4173/`，可用环境变量 `BASE` 改。会顺便把 `window.__tower` 写成同名 JSON。
- `scripts/bands.py`：按捕获的 JSON 裁每一层，统计偏亮像素占比。依赖 Pillow。用法 `python scripts/bands.py <捕获目录> <名字> ...`。
- `sheet.html`：脱离引擎的半像素精灵草图（工位、椅子、小人），在浏览器里直接打开，用来对 5F 精细绘制，不参与 Vite 构建。

看塔楼样板：

```bash
npm run dev
```

打开 `http://localhost:5173/?plate=b&hd=2`。不要用 `?floor=5` 验收这张图。

截图（需先有预览服务，并且机器上有 `/usr/bin/google-chrome`）：

```bash
npm run build
npm run preview
node scripts/capture.mjs /tmp/wip-capture tower='plate=b&hd=2'
```

## 已知问题

- 小人仍显得机械，像机器人。剪刀步和描边已经有了，头身、手臂和坐姿还不够像人。
- plate B 的前排新面积需要用工位、会议、绿植等真实办公设施填充。现在的样板用成堆纸箱（文件柜 / `box`）挡住了工位行，未通过验收。
- `?floor=N` 是过时的 15 格单房间，不能代表塔楼。
- 5F 高细节样板还没做完。精细路径只在补丁里，而且只覆盖 5F。
- `README.md` 的「技术说明」仍写默认画面是 `bg-shell.jpg` 加少量道具。默认已经是程序绘制的塔楼。README 也没写 `?poses=1`，并且把 `?debug=1` 说成塔楼也会画可走区域。
- 塔楼的 `?debug=1` 不画网格。调试单层走道要用 `?floor=N&debug=1`，那张图和塔楼脚印不同。
- `?renderer=3d` 仍带退台，和直筒要求相反。

## 用户已确认的决策

- 扩大楼板面积可以，不会因此把细节做差。继续打磨细节。
- 细节取决于精灵和绘制精度，不取决于格子数。plate B 的 280 格是为了多出可摆的办公面积；5F 的精细度来自 `?hd=2` 的半像素绘制，不是来自多出来的那 55 格。

## 建议的下一步

按这个顺序做。每一步都用塔楼全景验收，plate B 用 `?plate=b`，5F 精细绘制加上 `?hd=2`。

1. **先改 5F 样板的前排，不要直接合入现在这份补丁。** 保留 plate B 和「SHIFT 只加一次」。把新增的朝向观众的条带从 `file` / `box` 换成工位、会议室、绿植，过道保持连通，纸箱不能挡在工位行前面。对照 `docs/wip/wip-tower-plateB-FAILING.png`，确认那一片方块堆消失。
2. **把 5F 精细小人画到能看成人。** 继续 `drawGuyFine` 这条半像素路径（头、头发、躯干、手臂、剪刀步的腿分开，坐着时手在键盘上）。验收标准是不再像机器人。绘制精度用 `hd=2` 的 1080 缓冲，不要靠再加格子。
3. **5F 样板通过之后，再把同一套家具密度和精细精灵铺到其它层。** 然后决定 plate B 是否成为默认脚印。在那之前，不带参数的页面必须仍是现在的 225 格塔楼。
4. **处理 `?floor=N` 和 README。** 要么把单层改成塔楼对应层的放大，要么在 README 写明它是旧的 15 格房间，不能当塔楼验收。README 的默认画面描述改成 `engine.ts` 的塔楼，避免后来的人按底图叠层验收。
5. **人数和走道维持现状。** 工位多、在岗少，人数改 `stackFolk`，楼层类型改 `floors.ts`。不要为了填满新格子加纸箱，也不要加回玻璃围栏。
