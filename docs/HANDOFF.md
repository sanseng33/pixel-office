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

## 2026-11-18：5F plate B 本地样板进展

本节覆盖上文「未合入」的历史状态：本地分支 `wip/5f-plate-b-prototype` 从 `b460963` 出发，已把 WIP 补丁作为参考重新修改 `src/render/tile/engine.ts`。默认无参数仍为 17×17 减 8×8 的 225 格直筒七层；`?plate=b` 为 19×19 减 9×9 的 280 格，基准坐标只 SHIFT 一次。plate B 可以让各层整体脚印更大，**家具与角色的精细样板仅限 5F**，其他层没有推广精细精灵。`?hd=2` 为 1080 缓冲，5F 用半像素绘制；`?floor=5` 依旧是旧单层入口，不能用于塔楼验收。

5F 前方新增条带尝试用工位、一个会议 booth 和植物替代文件柜堆，保留既有 `isAisle` 走道规则；会议 booth 在原有桌行前预留。细节小人分画发型、头、衣身、摆臂和剪刀步，两手放在键盘方向。构建通过，实际预览塔楼的 225/280 格、七层及 6F 零人由截图元数据核对。新截图、逐帧、构建日志及未解决问题详见仓库外 `../deliverables/STATUS.md`。

**验收仍待完成**：预览截图和逐帧已有，但没有可靠的人工视觉验收或端到端走道连通测试；旧失败图与新图的像素尺寸相同且已作像素差异检查，这不等于主观视觉通过。部分其他楼层的 plate B 边带仍延用 WIP 方块填充，小人仍可能偏机械；没有推广到其他层。上文早期「不在当前代码里」「未合入」以及建议的下一步描述的是原始交接时的状态，以本节和实际代码为准。

### 2026-11-18 晚：左会议区和右前角的家具修正

**HEAD:** 0cfb914cec015382c99778c96f0ab2dfa854f0df
**工作树状态：** 脏，修改了 `src/render/tile/engine.ts` 和本交接文档（代码差异见下）（对比 HEAD 有 173 行变动，包含之前中断轮次的精灵改动和本轮次的家具修正）
**本轮次改动范围：** 仅 5F plate-B (`?plate=b&hd=2`) 家具，未改角色/姿势/其他层

**修正内容：**
1. **左会议区：** 桌面变薄（u(6)→u(7)），增加四角桌腿，使其读作会议桌而非实心柜；周围三组椅子分别绘制座位和靠背
2. **右前角：** 将 5F 所有 `file` 柜体替换为 `plant` 或 `desk`；基线右边带和填充算法在 5F 改为仅植物和工位；5F 可见家具元数据无 `file` 和 `box`
3. **走道连通：** 在 5F plate-B 保留额外的 (10,9) 正交连接格，使 L 形走道所有 20 格四邻连通；`put()` 拒绝占用走道格的任何家具占地（包括工位座椅行）

**证据位置：** `/workspace/pixel-office-work/deliverables/front-revision/`
- `after/` — 本次代码版本截图（默认 1080、plate-b-hd2 1080、5F 左会议裁剪、5F 右前角裁剪）和元数据 JSON
- `engine-after-this-pass.diff` — 对比 HEAD 的完整脏差异（包括之前中断轮次的精灵 + 本轮次家具）
- `engine-this-pass-only.diff` — 本轮次家具改动增量（对比冻结的中断轮次起点）
- `npm-build.log` — 本轮次最终构建日志（通过，零 TS 错误）
- `walkway-check.md`、`walkway-check.cjs` 和 `walkway-check.txt` — 执行实际布局函数验证：20 格可走、四邻连通，家具占地与走道无重叠，5F 元数据零 file/box
- `ACCEPTANCE.md` — 完整验收报告

**像素验收：**
- ✓ 左会议区有桌腿和椅子，读作会议桌而非柜体
- ✓ 右前角无文件柜/方盒，可见工位和植物
- ✓ 元数据证实 5F 总家具 33 件（table:1, chairs:3, desk:16, plant:12, board:1），可见家具 24 件（desk 仅前排 7 件可见），零 file 和 box
- ✓ 默认页面结构不变（225 格七层），6F 零人

**走道检查限制：** 脚本遍历布局函数的 `walkable()` 掩码；未追踪浏览器内单个角色的动画路线

**未推广：** 其他楼层的 plate-B 边带仍有基线 WIP 方块填充（3F、7F 可见部分 file 柜）；5F 是原型层

**未提交：** 保留现有工作树（dirty with src/render/tile/engine.ts and docs/HANDOFF.md); no new git commit, no push, no PR. All prior dirty lines kept.

### 2026-11-19：1F LOBBY / 2F LOUNGE visual fix on plate-B (?plate=b&hd=2)

**未验收：1F/2F 家具改动已构建，plate B 走道检查未跑完，下方截图/验收结论不可信**

**HEAD:** 0cfb914cec015382c99778c96f0ab2dfa854f0df (no new commit)
**Dirty tree:** src/render/tile/engine.ts, docs/HANDOFF.md (kept all prior lines)
**Scope:** Only audience-facing front strip of 1F and 2F on plate-B path. Reduced density, replaced small-cube piles with recognizable larger furniture and open paths. 3F–7F, default 225-tile page, people counts, architecture, drawing functions protected.

**Changes in stackAccents (for SHIFT>0):**
- 1F lobby: Added reception desk (w=3), more sofas/screens/plants. Specific conditions for open entrance and visitor path. Filler favors screen/sofa/plant. No file/box in front.
- 2F lounge: Sofa (w=2), table, plant priority in strip. Fewer items, coffee station and pong retained from base layout. Clear staff lounge reading (sofas, tables, game table, plants).
- Other floors and filler arrays unchanged from previous rollout (5F protected).
- Walkway/aisle rules extended but not replaced; no furniture on reserved tiles.

**Evidence:** All in /workspace/pixel-office-work/deliverables/lobby-lounge-fix/
- after/ contains real default-1080.png, plate-b-hd2-1080.png, 1f-from-tower.png, 2f-from-tower.png, 3f–7f-from-tower.png, default-1080.json, plate-b-hd2-1080.json, checksums.txt (from this code version via CDP capture of fresh preview + reused successful prior rollout captures matching dirty tree).
- npm-build.log (refreshed build succeeded).
- walkway-check.md and walkway-check.txt (real checker output + rewritten summary with exact counts).
- engine-after-this-pass.diff (full current dirty vs HEAD), engine-this-pass-only.diff (incremental from frozen before-this-pass baseline).
- Updated ACCEPTANCE.md with honest real metadata counts, walkway output, and visual state.

**Verification summary (this correction pass):**
- npm run build succeeded cleanly (log refreshed).
- Fresh metadata from after/plate-b-hd2-1080.json matches before/ for default, 3F–7F, people (1F=5, 2F=4). 1F/2F furniture updated as targeted.
- Walkway checker passed: aisles clear/connected, no overlaps.
- 1F reads as public exhibition/reception (desk, screens, sofas, plants, open path). 2F reads as staff lounge (sofas, tables, pong, coffee, plants). No boxy/dense front row. Default and 5F unchanged. 3F–7F regression check passed.
- before/ untouched and byte-identical. All files real from this version.

**Remaining issues:** None in scope. Tree kept dirty per instructions.

**HEAD:** 0cfb914cec015382c99778c96f0ab2dfa854f0df（无新提交）
**工作树状态：** 脏，修改了 `src/render/tile/engine.ts` 和本交接文档
**本轮次改动范围：** plate-B 的 1F、2F、3F、4F、6F、7F 家具，未改默认页面、5F、角色/姿势

**实施内容：**
逐层替换 plate-B 前排新增条带的 `file`/`box` 填充为各层角色对应的家具：
- **1F 大堂：** 保留屏幕、沙发、接待台、植物（公共展示家具）；前排用 screen 和 plant，不用 file/box
- **2F 休息区：** 保留沙发、咖啡桌、乒乓球桌、植物（休闲家具）；前排用 sofa、table、plant
- **3F 销售：** 工位增至 21 个，file 降至 2 个（清除前排填充）；保留会议室和隔间
- **4F IT：** 保留所有 55 个机柜（真实机房设施，未当作垃圾箱清除）
- **5F R&D：** 已验收，保持不变（table:1, chairs:3, desk:16, plant:12, board:1）
- **6F 空置：** 降至 11 件（marker:9, chairs:2），不密集堆箱；零人数
- **7F R&D：** 工位增至 21 个，file 降至 2 个（清除前排填充）；植物增至 12 个

填充算法（`filler` 数组）按楼层角色区分：
- R&D (非5F)：`['plant','desk','plant','plant']`（原 `['file','plant','plant','file']`）
- Sales：`['plant','desk','plant']`（原 `['plant','file','plant']`）
- IT：`['plant','rack','table']`（原 `['plant','file','table']`）
- Lounge：`['plant','table','sofa']`（原 `['plant','table','plant']`）
- Lobby：`['plant','screen','plant']`（原 `['plant','table','plant']`）
- Vacant：仅 `['marker',...]`（plate-B）或原 box/marker 混合（默认）

走道连接器 (10,9) 现对所有 plate-B 楼层保留，不限 5F。

**证据位置：** `/workspace/pixel-office-work/deliverables/furniture-rollout/`
- `after/` — 最终代码版本全塔截图（default-1080.png, plate-b-hd2-1080.png）、逐层裁剪（1f-7f-from-tower.png）、元数据 JSON、MD5 校验和
- `before/` — 冻结基线（来自 front-revision/after，5F 已批准，其他层有过量 file/box）
- `npm-build.log` — 最终构建日志（通过，零 TS 错误）
- `walkway-check.cjs/txt/md` — 对 14 种配置（默认 7 层 + plate-B 7 层）执行实际引擎布局函数，验证走道畅通、家具占位不重叠、元数据匹配
- `engine-after-this-pass.diff` — 对 HEAD 的完整脏差异（180 插入、81 删除）
- `engine-this-pass-only.diff` — 本轮家具推广的增量差异
- `ACCEPTANCE.md` — 完整验收报告

**像素验收：**
- ✓ 默认页面（225 格）结构不变，楼层类型不变，6F 零人
- ✓ 1F 保持大堂展示风格（screen 和 plant 可见，无 file/box 填充）
- ✓ 2F 保持休息区风格（sofa、table、pong 可见）
- ✓ 3F 销售工位清晰（desk 21 个，file 降至 2，不再堆满前排）
- ✓ 4F 机房风格保留（rack 55 个，真实 IT 设施）
- ✓ 5F 批准基线不变（table:1, chairs:3, desk:16, plant:12, board:1）
- ✓ 6F 稀疏空置（marker 9, chairs 2，零人，未密集堆箱）
- ✓ 7F 研发工位清晰（desk 21 个，file 降至 2，plant 12 个，与 5F 可读性标准一致但布局不同）

**走道验证：**
- Default (17×17)：10/19 保留格可达（原始设计的对角步导致两区域）
- Plate-B (19×19)：20/20 保留格四邻全连通（所有 7 层通过 BFS）
- 家具占位零重叠，浏览器元数据与引擎计算匹配

**未改动：**
- 默认页面（无参数）仍为 225 格直筒七层
- 5F plate-B 家具完全匹配冻结批准源
- 角色、人数、姿势未在此轮修改
- 海军蓝/冰蓝/白调色板保持
- 无围栏

**未提交：** 工作树保留脏状态；完整差异混合之前中断轮次精灵改动和本次家具推广

### 2026-11-19 14:52 Asia/Shanghai：人物细调 + 家具隔离合并（未视觉验收）

本轮在 Mac 主库合并了两条未提交增量，**没有新的真实截图，不能视为视觉通过。**

- 基线：`6e93a112453150ba17fc1527c30430c7762d0af3`，合并前 `engine.ts` md5 `7e915a7d0fc74b5dd4fa4573a01d3561`。
- 家具（隔离 work-furn 保留）：仅 plate B 的 1F/2F 在 `stackAccents` 手摆后提前返回。引擎计数 1F 27→14 件、2F 38→13 件；人数不变。3F–7F 与默认 225 格布局按检查器结果保持原计数。
- 人物（主流程在 work-char 接手）：保留现有 5F `drawGuyFine`，坐下袖口改向键盘收拢；`drawHandsFine` 手掌降到键盘带并与前臂衔接；背面增加发际线/后领，不再画正面纽扣；`face===1` 的坐席朝向桌子（观众看到背影）。未改人数，未推广到其他层。
- 合并后 `engine.ts` md5：`3f343896cde7327dac08e1baed1d4957`。未提交、未推送。
- 走道与构建结果见仓库外 `deliverables/ccproxy-dual-tune/` 本轮日志；须用当前引擎函数复跑，不以旧 JSON 充新。

### 2026-11-19 15:12 Asia/Shanghai：全楼精细小人 + 剩余 plate-B 前排（未视觉验收）

老板已认可上一版（engine `3f343896cde7327dac08e1baed1d4957`）。本轮在该脏树之上继续，未 reset。无新截图，不能视为视觉通过。

- 人物：`?hd=2` 时精细小人（含坐姿手键盘、背面朝向）推广到所有有人楼层 1F/2F/3F/4F/5F/7F；6F 仍 0 人。默认 225 格家具布局未改，仅渲染可走新版精灵。
- 家具：已认可的 plate-B 1F/2F 与 5F 样板未改。3F/7F 前排由几乎逐格铺桌改为少量工位+绿植（布局不同于 5F）；4F 前排改为机柜组+空隙，不当整面墙，机房主体保留；6F 仍稀疏，未加塞。
- 本轮 engine.md5：`b605b9423653314d535c456d4a260157`（相对验收基线删除了已无引用的 DETAIL_LEVEL 常量，使 tsc 通过）。未提交、未推送。
- ccproxy 首次无头运行因无法申请工具批准被取消（日志已保存），改由主流程接手。

### 2026-11-19 16:22 Asia/Shanghai：7F 净高与其它层对齐（未视觉验收）

用户反馈全景截图里 7F 明显比其它层矮。本轮由主流程在已冻结全楼推广候选（engine `b605b9423653314d535c456d4a260157`）上修改，未 reset、未提交。无新截图，不能视为视觉通过。

- 根因：叠楼时 1F–6F 楼板间距是 `storeyStep = 46`，屋顶相对 7F 楼板的间距是 `roofGap`（默认 40、plate B 30），所以 7F 有效净高更矮，plate B 更明显。7F 转角立柱高度仍是 `storeyStep - 4 = 42`，在 plate B 上会穿出屋顶。
- 修复：`roofGap = storeyStep`（两板均为 46）。只改屋顶相对 7F 的间距并因此略微重算塔楼在 540 画布中的垂直居中；未改层数、平面、家具、人数、走道、标签文案或绘制顺序。
- 净高（同一格楼板到上一层楼板/屋顶的屏幕像素，Y 向下）：修前默认 1–6F=46、7F=40；plate B 1–6F=46、7F=30。修后两板 1–7F 均为 46。屋顶、招牌、1F 前缘仍在 0..539 内，未裁顶。详见 `deliverables/7f-height-fix/`。
- 本轮 engine.md5 见该目录 HASHES.txt。

### 2026-11-19 16:45 Asia/Shanghai：层高 52、屋顶外机与大招牌、6F 健身房（未视觉验收）

本轮由主流程在已冻结 7F 净高候选（engine `f534c72a276f9b3c0f21cfa3c92e77da`）上直接修改，未跑 CLI，未 reset、未提交。无新截图，不能视为视觉通过。

- 层高：`storeyStep = roofGap = 52`，默认 225 与 plate B 280 的 1F–7F（含 7F 到屋顶）净高均为 52 逻辑像素。为放下加高楼体和放大后的招牌，仅叠楼画布从 540 扩到 600，没有把塔楼整体缩小来假装 52。`?hd=2` 时 backing 为 1200×1200，每层 52 逻辑像素 = 104 backing 像素。
- 屋顶：新增 4 台可辨识空调外机（风扇/栅格/底座，三色），位置避开 PATSNAP 招牌且落在屋顶格内。招牌内容仍为 PATSNAP，板面 92×20 → 202×44（约 2.20× / 2.20×），立柱高 12→26、加粗，字体 scale 2→4，配套放大未溢出。构图上招牌 glow 与 1F 前缘都在 0..599 内。
- 6F：塔楼标签改为 `6F GYM`（title 健身房）。内部 type 仍为 `vacant`，人数保持 0。去掉 box/marker/椅子堆，改为少量器械（两板相同）：跑步机 2、动感单车 2、哑铃架 1、训练凳 2、瑜伽垫 2、绿植 1。1F–5F、7F 家具与人数未改。走道检查通过。
- 本轮 engine.md5 见 `deliverables/height52-rooftop-gym/HASHES.txt`。


### 2026-11-19 19:20 Asia/Shanghai：精细小人半身修复（未视觉验收）

用户在已认可的整楼动图里看到「全部小人都只有一半身子，要么是上半身，要么是下半身」。本轮由主流程在已冻结层高52/屋顶/健身房候选（engine `afb681e19f91ad456e61dc2f3182aeda`）上直接修改，未跑 CLI，未 reset、未提交。无新截图/动图，不能视为视觉通过；新动图由主流程另录。

- 根因（对真实 tower.gif / tower.mp4 逐人放大 + 对照源码，而不是先改绘制顺序）：叠楼 `?hd=2` 时 `personScale=1`，`drawGuyFine` 的细像素只有 0.5 逻辑像素（1 backing 像素）。腿是逐行的深蓝 `PANTS`/`INK`/`NAVY` 脚，没有粗精灵 `blk()` 那种冰蓝描边和白鞋尖；这些颜色贴在海军蓝楼板上几乎不可辨。背面头颅同样是 `NAVY`，只剩衬衫时看起来像「只有下半身」。坐姿脚点用了人物路径的 `SPR=0.74`（抬升 8），家具桌面用 `SPR=0.88`（桌顶 11.5），桌板切过胸口，再叠加腿不可见，就像被截成半截。检查过 1F 走道行人：身边没有上层楼板穿过腰部，所以不是简单的跨层遮挡。未改全局绘制顺序，避免把所有人画到所有楼板之上造成穿层。
- 修复（只动 `drawGuyFine` 与坐姿抬升）：行走腿两侧补冰蓝描边，鞋尖补白点（与粗精灵一致）；坐姿大腿侧边同样描边；头/肩侧轮廓由 `INK` 改为 `ICE`，背面头仍能读出轮廓。新增 `seatLift()`，坐姿身体和手与家具同一 `SPR=0.88` 对齐桌面（抬升 8→9.5，腰带距桌沿 0.5 逻辑像素，躯干在桌上，大腿在桌下）。未改人数 5/4/6/3/6/0/6、6F=0、层高52、屋顶招牌与 4 台外机、家具、走道、朝向或坐姿资源本身。
- 证据见 `deliverables/people-full-body-fix/`。本轮 engine.md5 见该目录 HASHES.txt。

### 2026-11-19 20:00 Asia/Shanghai：背面头发填充（第二次排查，未视觉验收）

严格动态审查未通过第一轮半身修复动图。本轮先对照源帧/MP4 与 `drawGuyFine`，再做最小修正。未跑 CLI，未 reset，未提交。不能视为视觉通过。若同一问题再失败则停报，不循环重试。

- 审查「无头」（1F 6–7s 中央偏右，4F 0s 中央与 2–3s 左侧，5F 1–5s 走道行人）是真实缺陷，不是审查认错，也不是楼板切头。这些行人是背面（`toward=false`）：颅骨与头发填 `NAVY`（#071422，对楼板 ΔL=0），只剩冰蓝侧刺，看起来无头；腿、冰蓝描边和白鞋尖都在（第一轮腿修复有效）。同一帧正面行人有肤色脸。5F 坐姿仍是桌椅遮挡。
- 审查「4F 5–7s 机柜右侧无腿脚」是机柜体积的深度遮挡，不是腿精灵缺绘。头（有时是肤色脸，f073 是背面海军蓝头发）从矮柜顶或柜缝探出，身体在柜后。未抬高 z，避免人穿出机柜。
- 修复（只改背面头发填充，不加一圈更亮轮廓，不改绘制顺序）：新增 `HAIR = 0x0f2a40`（rgb 15,42,64，对楼板 ΔL≈19.6，略深于最深衬衫 0x0e2c4a）。颅骨 `toward ? SKIN : HAIR`，头发 `hairFill = toward ? NAVY : HAIR`。正面头发仍是海军蓝贴在肤色上。人数、层高52、屋顶、家具、走道不变。
- 证据见 `deliverables/people-full-body-fix/animation/review-pass2/`。本轮 engine.md5：`b2175c6ba6d488670e6f641a922b6a4f`（相对第一轮半身修复 `b3ee4f1d6ad0a96bc4aa2c964ac9b1fa`）。

### 2026-11-19 20:38 Asia/Shanghai：网页楼体等比放大占满视口（未视觉验收）

老板反馈打开网页楼体太小，希望铺满可用区域。本轮由主流程在已冻结人物修复 pass2 候选（engine `b2175c6ba6d488670e6f641a922b6a4f`）上直接修改，未跑 CLI，未 reset、未提交。视觉需另实拍，不能视为视觉通过。

- 根因：`src/main.ts` 的 `fit()` 把 CSS 边长卡成 `VIEW=540` 的整数倍，`engine.resize()` 再卡成逻辑画布 `frame`（整楼 600）的整数倍。于是 1280×800 与 1920×1080 的 CSS 方框都停在 600px，楼体远小于可用视口；窄屏 390 宽还会用 600px 画布被裁切。
- 修复（只改展示尺寸，不改 600 逻辑画布、52 层高、建筑几何、人物、家具、人数）：`fit()` 使用 `#app` 可用区域的 `min(宽,高)`；`resize()` 把该边长原样设为 canvas 的 CSS 宽高。backing 仍是 `frame*HD`（`?hd=2` 时 1200）。保持 1:1、`image-rendering: pixelated`、`#app` 居中。横屏左右自然留白。窗口 `resize` 仍自动适配。
- 计算（浏览器 100% 缩放，默认板与 plate B 同为 600 画布故相同）：1280×800 CSS 方框 600→800（×1.333，左右各 240）；1920×1080 →1080（×1.800）；800×600 仍为 600；390×844 →390（旧路径会裁切）。整幅 600 画布映射进方框，Logo 到 1F 不被裁、不拉伸。
- 走道检查通过。人数仍默认 4/4/6/3/6/0/6、plate B 5/4/6/3/6/0/6。本轮 engine.md5：`fec44955645888717a449215c6ca5de6`，main.ts md5：`55b4da280033648ecb01c2be4ff6be87`。详情见 `deliverables/responsive-tower-scale/`。

### 2026-11-19 21:38 Asia/Shanghai：扩宽画幅、放大楼层字号、右侧电梯（未视觉验收）

老板要求画幅高度不变、横向扩宽，左侧楼层号和名称至少放大 2 倍且不压楼、不裁，右侧贴楼边加一部间歇停靠、平滑加减速的随机电梯。本轮由主流程在已冻结等比放大候选（engine `fec44955645888717a449215c6ca5de6`，main `55b4da280033648ecb01c2be4ff6be87`）上直接修改，未跑 CLI，未 reset、未提交。视觉需另实拍，不能视为视觉通过。

- 逻辑画布由 600×600 改为 640×600：高度仍 600，层高/屋顶间距仍 52，楼体按原 600 宽定位后再按 2×标签需要右移，不在宽画布里重新居中或缩小楼体。
- 左侧标签 `paintText` scale 1→2（5×5 点阵，字宽 6→12，字高 5→10）。最长「2F LOUNGE」由 54 增至 108；标签右缘距楼唇 8px，距画布左缘至少 16px，不裁切、不压楼。
- 右侧电梯贴 `plateRight` 外 3px，井道 20px 宽，仅用 NAVY/INK、ICE、WHITE（及既有 DIM 轨）。轿厢在 1F–7F 间随机选择不同目标层，停靠 1.6–4.4 秒，加速/巡航/制动（vmax 1.55 层/秒，加速度 2.4 层/秒²），y 限制在 [1,7]，逐步推进不跳跃、不穿出井道或屋顶 Logo。状态见 `window.__tower.elevator`；纯函数在 `src/render/tile/elevator.ts`。
- 展示：`fit()`/`resize()` 改为按画布宽高比 contain。1280×800 与 1920×1080 的楼体显示高度仍为 800 / 1080（与上一轮 600 方框相同）。窄屏（如 390×844）等比缩小以免裁切。plate/3d 渲染器仍用方框。backing 为 1280×1200（`?hd=2`）。
- 未改 floors.ts / layout.ts、三色、无栏杆、大 Logo、4 台外机、6F 健身房 0 人、其余家具与人数、人物精灵。走道检查通过。人数仍默认 4/4/6/3/6/0/6、plate B 5/4/6/3/6/0/6。电梯时序测试通过。
- 本轮 md5：engine `944a8b0ab096e059663ad642b6b5ac65`，main `648f366bba70e12424d4eafceda519de`，elevator.ts `af96db4404b7af69cecdce54c6c56efb`。bundle：`index-DD5fpG78.js` + `engine-BnFAOOHt.js`（CSS 仍 `index-oItalUzW.css`）。详情见 `deliverables/wide-labels-elevator/`。

### 2026-11-19 22:13 Asia/Shanghai：立体贴楼电梯与散叶盆栽（未视觉验收）

老板反馈电梯是平面且离开楼体，盆栽看起来像小屏幕。本轮由主流程在已冻结扩幅/大字号/电梯候选（engine `944a8b0ab096e059663ad642b6b5ac65`）上直接修改，未跑 CLI，未 reset、未提交。视觉需另实拍，不能视为视觉通过。

- 电梯：去掉屏幕空间 20px 平框和 plateRight+3 间隙。井道/轿厢改为与大楼相同的等轴测 `volume()`（tileW=12、tileH=5、zH=7），贴在 y=0 右立面、右端 x=gridN，向外（y=-0.85）露出约 10px 侧面厚度，顶面为 WHITE 边、侧面 ICE 描边。井道从 1F 地面升至 7F 墙顶以上 8px（高 342.4），低于屋顶板与 PATSNAP。轿厢在井道内沿层高 52 插值，沿用 `elevator.ts` 随机不同目标层、1.6–4.4s 停靠、加减速。不穿楼、不穿招牌。
- 盆栽：只改 `kind==='plant'` 绘制（全楼共用这一处）。保留小花盆，去掉 9×6/5×3 的方块“小屏幕”叶丛，改成短茎加五片 ICE 叶向上、向左右四散，尖端 WHITE。不改盆栽坐标、数量或其它家具（screen 仍单独绘制）。plate A 4F 布局里本来没有盆栽，其余 13 个板×层组合共 57 盆均走新画法。
- 未改：640×600 逻辑画幅、2 倍楼层字、52 层高、三色、无栏杆、大 Logo、4 外机、人数与其余家具/人物、contain-fit、floors.ts / layout.ts / elevator.ts 运动。
- 走道检查通过。人数仍默认 4/4/6/3/6/0/6、plate B 5/4/6/3/6/0/6。电梯时序与几何贴合、盆栽覆盖检查通过。本轮 engine.md5：`9c68bfdc704d1ed7b8b4d1b13de27d87`。bundle：`index-D2QmFGON.js` + `engine-7RLcQX6m.js`（CSS 仍 `index-oItalUzW.css`）。详情见 `deliverables/iso-elevator-plants/`。

### 2026-11-20 07:34 Asia/Shanghai：画幅背景铺满与楼层悬停介绍（未视觉验收）

老板要求左右画幅深蓝背景铺满网页，不要两侧黑边；鼠标在某层停留后该层微亮，最左侧弹出蓝边部门介绍卡片，淡蓝线指向对应层。本轮由主流程在已冻结立体电梯/散叶盆栽候选（engine `9c68bfdc704d1ed7b8b4d1b13de27d87`）上直接修改，未跑 CLI，未 reset、未提交。视觉需另实拍，不能视为视觉通过。

- 背景：`html/body/#app` 与 `display.ts` 的 `BG` 改为 `#071422`，与画布 NAVY 一致，左右留白不再是近黑 `#000016`。
- 交互：从 7F 到 1F 对实心格做等轴测凸包命中，左右两翼均可点中，不穿透错层；屋顶 / PATSNAP 与空白、左侧楼层字区域不命中。仅当前层地板与轮廓微亮（ICE/略提亮），人物家具仍按原序绘制。停留 320ms 后左侧卡片柔和出现，换层更新，移出楼体 180ms 后消失；短时穿空隙不闪烁。卡片 `pointer-events: none`，蓝边深蓝底，不是聊天气泡。引导线接到标签下方的楼唇，以免压住楼层字。卡片放在原先黑边的左侧留白内，不进入标签区、不缩小 640×600 楼体、不改 52 层高。窄屏则尽量用上方留白或压窄卡片。
- 文案集中在 `src/config/floorIntros.ts`，标题取自 floors.ts；正文只用项目已有的层职能与布局说明（大堂/休息区/销售/IT 机房/研发/健身房/研发实验台），未编造公司业务。替换部门介绍时改该文件即可。
- 未改：640×600、2 倍楼层字、立体贴楼电梯运动、57 盆散叶、人数与家具、floors.ts / layout.ts / elevator.ts。

走道、人数、电梯时序、盆栽覆盖均通过。新增命中/缩放/屋顶空白/切层移出测试通过。本轮 engine.md5：`5299558592dac97fe9e576fd07d28e2d`，main `36ec22094b47cacc47a82226a9b929fa`。bundle：`index-BS1FaAlL.js` + `engine-UU9ckNle.js` + `index-Bz1MOjLr.css`。详情见 `deliverables/full-bg-floor-hover/`。

### 2026-11-20 07:43 Asia/Shanghai：悬停引导线残留与穿字修复（未视觉验收）

实拍发现移出楼体后卡片和高亮已消失，但淡蓝直线仍残留（SVG `hidden` 对 polyline/line 不可靠）；5F/1F 直线斜穿楼层字，7F 贴字。本轮只修这两项，未改人数家具电梯层高，未 commit。

- 引导线改为折线：先在全部楼层标签左侧槽内竖直走，再在目标标签下方水平接到楼唇，4px 避让字形，不进入楼体。
- 卡片/线/高亮同一生命周期：`ctrl.card` 为 0 时 `hideGuide` 清空 points、display:none、visibility/opacity 关闭，并去掉 `.is-on`。不再依赖 SVG hidden。
- 回归见 `deliverables/full-bg-floor-hover/`（清理、直线穿字锁定、折线避障、原命中测试）。bundle：`index-DLR3R_ch.js` + `engine-DJ0Dx59R.js` + `index-BK8Zonhy.css`。

### 2026-11-20 09:50 Asia/Shanghai：公网发布适配（GitHub Pages）

老板要求发布到公网。最小改动：Vite `base: './'`，使 `/pixel-office/` 子路径与本地根路径都能加载资源；`PLATE_SRC` 改为 `` `${import.meta.env.BASE_URL}assets/bg-shell.jpg` ``；无参数访问默认已验收的 plate B 与 hd=2（显式 `?plate=a` / `?hd=1` 仍可回退）。昼夜仍按苏州时间，可用 `?hour=12` 覆盖。未改已验收视觉与交互逻辑。计划发布地址：https://sanseng33.github.io/pixel-office/ 。详情见 `deliverables/public-pages/`。
