# 《归迟录》Three.js 灰盒

技术栈：Vite + TypeScript + three.js。竖屏 9:16（1080×1920 比例）优先手机。

## 运行

在仓库根目录执行：

```bash
npm install
npm run dev
npm run build
npm run preview
```

- `npm install`：按 `package.json` / `package-lock.json` 安装依赖。
- `npm run dev`：启动 Vite 开发服务器，默认 http://localhost:5173（`vite.config.ts` 已设置 `host: true`、端口 `5173`）。
- `npm run build`：先 `tsc` 再 `vite build`，产物在 `dist/`（该目录不入库）。
- `npm run preview`：本地预览构建结果。

依赖（见 `package.json`）：

| 包 | 用途 |
|----|------|
| `three` | 运行时三维渲染 |
| `typescript`、`vite`、`@types/three` | 开发与构建 |

## 内容

- 见下方「灰盒串通」可玩路径（旧「遭遇妖物」按钮改为调试入口）
- 三位主角立绘广告牌：沈归迟 / 陆清歌 / 宁小满（`public/portraits/`）
- 旧 Unity 草稿目录 `_unity-archive/` 不纳入本仓库（见 `.gitignore`）

## 灰盒串通（v0.2，补丁 v0.1 已批执行）

- 模块：`src/data/`（types+loader）· `src/save/gameState.ts`（localStorage）· `src/flow/flowController.ts` · `src/scene/scenePresenter.ts` · `src/dialog/dialogRunner.ts`（DOM）· `src/battle/battleLogic.ts` · `src/map/chapterMap.ts`
- 配置：源 `Config/Samples/*.json` → 运行时拷贝 `public/config/*.json`，`fetch(BASE_URL+"config/<表>.json")`
- 底板：`bg_key` `W0/scenes/SC_xx` → `public/W0/scenes/SC_xx_v0.png`
- 可玩路径：标题 → SC_01_OPEN 对白 → SC_02_MEET_A → SC_03_TOWN「调查 search_01」触发 ENC_TUTORIAL_01 → 攻击胜/撤退回场景 → SC_04_CHOICE 抉择写 branch_save_life / branch_chase → SC_05_BOSS 对白
- 里程碑：灰盒周 2026-12-21～12-26；M3 待下周锁定；不上 Capacitor，PWA 后补

- 2026-10-31：开场短剧本（苏禾 v0.1：DLG_OPEN_01/02、DLG_MEET_A_01/02、DLG_TOWN_01→ENC_TUTORIAL_01，flags letter_peeked/qingge_joined_early）+ 雾纹山魈战斗贴图（`public/enemies/EN_MOB_MELEE.png`，Plane h=2.4）已挂。对白支持 `next_dialogue_id` / `choices[].followup_lines` / `start_encounter_id`。

## SC_03 可走桩（M1）

单屏 1080×1920，走 `SC_03_TOWN`。坐标与触发以 `public/config/walkmaps/SC_03_TOWN.json`（v0.3.x）为准；图层在 `public/assets/walkmaps/SC_03_TOWN/`（手绘 v0.3）。长卷不进本镜头。

```bash
npm run dev
```

- 标题点 **SC_03 可走桩** 直接进山门驿亭。或「开始游戏」走完开场、岔口后「前往下一场景」进入。
- **点地面**寻路（逻辑格 + A*，格间平滑）。左下 **摇杆** 也可走。右下按钮是调查 / 香案 / 进镇。
- 进场对白结束后，走到爪痕按「调查爪痕」，驿道才通；走上石坪进教学战。对白和战斗中不能移动，场景不卸成黑房。
- 底栏停在设计包安全区（约 y≤1600），不压摇杆。地图是暂停总览，不是主进度。

换碰撞只替换 `SC_03_TOWN_walkable.png`（白 ≥128 可走）或调用 `reloadWalkable`。`paths[].waypoints` 已留字段，本轮不读、不加岔路。说明见 `Docs/SC_03可走桩.md`。

## 文档

- 设计草稿：`Docs/模块与存档接口.md`、`Docs/美术替换接口.md`、`Docs/配置表通路.md`
- 协作流程：[`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md)（禁止直接推送 `main`）
