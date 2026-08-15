# 采办岛 v1 设计系统

## 1. 设计方向

借鉴 Apple Live Activities / Dynamic Island 的信息层级与连续动效，而非复制 iPhone 外形。遵循：

1. **一眼可读**：L1 只表达入口，L2 只展示活跃任务状态，复杂编辑进入 L3。
2. **连续变化**：同一内容在 L1/L2/L3 之间保持空间关系，避免突然换页。
3. **材质克制**：仅外层使用系统 Acrylic 磨砂；内层卡片用半透明色块建立层级。
4. **不打断工作**：悬停不抢焦点，自动收起可预测，全屏场景主动退让。
5. **信息不依赖颜色**：图标、文字、形状与颜色共同表达状态。

参考：Apple Materials 与 Live Activities 设计指南；Windows 桌面 Acrylic（Win10 1803+/Win11 经 SetWindowCompositionAttribute 实现）。

## 2. 设计 Token

### 2.1 颜色（暗色默认值；高对比度模式改用系统颜色）

| Token | 值 | 用途 |
| --- | --- | --- |
| Color.Surface.IslandTint | #08090B（76% tint） | 外岛磨砂偏色 |
| Color.Surface.Fallback | #111216 | 透明关闭、节能或不支持磨砂时 |
| Color.Surface.Card | #FFFFFF 8% | 普通卡片 |
| Color.Surface.CardHover | #FFFFFF 12% | hover / 键盘焦点卡片 |
| Color.Surface.CardPressed | #FFFFFF 16% | pressed / 拖动中 |
| Color.Border.Subtle | #FFFFFF 12% | 卡片与分隔线 |
| Color.Text.Primary | #F5F7FA | 主标题、关键数值 |
| Color.Text.Secondary | #B8BDC7 | 描述、时间、辅助信息 |
| Color.Text.Tertiary | #858B96 | 弱提示；不得用于关键状态 |
| Color.Focus | #64D2FF | 2px 键盘焦点环 |
| Color.Node.Completed | #32D74B | 已完成（绿），配对 Check 图标 |
| Color.Node.InProgress | #0A84FF | 进行中（蓝），配对 Play/Progress 图标 |
| Color.Node.Pending | #FFD60A | 待完成（黄），配对 Clock 图标 |
| Color.Urgency.Critical | #FF453A | 紧急，配对双感叹号与"紧急" |
| Color.Urgency.High | #FF9F0A | 高，配对向上箭头与"高" |
| Color.Urgency.Normal | #BF5AF2 | 普通，配对圆点与"普通" |
| Color.Urgency.Low | #8E8E93 | 低，配对向下箭头与"低" |

状态色只用于 2–4px 色条、小图标、文字或描边，不用作整张卡片的高饱和背景。逾期使用 Critical 色并明确显示"已逾期"，不能只把 deadline 变红。

### 2.2 圆角与边框

| Token | 值 | 用途 |
| --- | --- | --- |
| Radius.Island | 40px | L2 / L3 外轮廓（柔化四角） |
| Radius.Collapsed | 999px | L1 提示条胶囊 |
| Radius.Card | 18px | 任务卡片、详情分区 |
| Radius.Control | 12px | 输入框、按钮、菜单 |
| Radius.Chip | 999px | 状态、紧急度、筛选标签 |
| Border.Subtle | 1px | 低对比分隔 |
| Border.Focus | 2px | 键盘焦点环，外偏移 2px |

所有可见矩形面必须使用以上圆角层级之一；嵌套圆角遵循外大内小，避免内层切到外轮廓。

### 2.3 间距

基础间距单位 4px：4 / 8 / 12 / 16 / 20 / 24 / 32。任务卡片内边距 16px，L3 内容分区 24px，岛外边缘安全内距 12px。

### 2.4 字体

- 字体：Segoe UI Variable，回退 Segoe UI。
- Display：28/34 Semibold（L3 标题、空状态）；Title：20/26 Semibold（速览标题）；Card Title：16/22 Semibold（最多两行省略）；Body：14/20 Regular；Caption：12/16 Regular（deadline、紧急度、元数据）。
- 重要倒计时使用 tabular numerals，避免数字变化引起宽度跳动。
- Windows 文本缩放开启后允许内容增高与滚动，禁止缩小字体维持固定高度。

## 3. 三级形态规格

### 3.1 L1 隐藏条

- 96×6 逻辑像素，窗口向上偏移约 2px，仅露出约 4px；
- 主显示器顶部中央；纯黑 Acrylic/回退色胶囊，无文字无计数；
- 触发热区约 120×10（顶部中央），用屏幕坐标轮询实现，禁止拦截式透明覆盖窗口。

### 3.2 L2 小面板

- 默认 760×280；宽 560–主屏工作区 80%，高 ≤工作区 45%；外距 12；
- 顶部工具行 44px；卡片区占剩余空间；
- 卡片 224×164、间距 12；宽度足够时露出下一张卡片边缘，提示可横向滑动；
- 速览态：面板加高，左侧卡片列表 + 右侧详情（或上下分区），保持形变连续。

### 3.3 L3 大面板

- 最大为主屏工作区 85%，外距 24；圆角 28px；
- 顶栏：标题 + 返回（Esc）+ 关闭；导航：任务编辑 / AI 草稿审核 / 归档 / 设置；
- 时间轴：横向时间线，节点胶囊（绿/蓝/黄），支持拖拽排序与点击改状态；
- 所有触控目标 ≥44×44，相邻目标间距 ≥8px。

### 3.4 形态过渡

- 同一窗口连续形变；尺寸动画用 spring（stiffness ≈ 300、damping ≈ 30），时长 250–400ms；
- 只动画 compositor 友好属性（transform、opacity、border-radius）；禁止用高频布局重排模拟过渡；
- L1→L2：内容淡入 + 形变；L2→L3：面板放大 + 分区淡入；反向同理；
- 高对比度或系统"减少动画"开启时直接切换，无过渡。

## 4. 任务卡片

从上到下：

1. 紧急度 chip 与 deadline / 逾期信息；
2. 任务标题（最多两行，超出省略号）；
3. 下一个未完成节点（一行省略）；
4. 已完成节点数 / 总数与细进度条；
5. 可访问名称汇总上述信息（读屏器友好）。

杂事卡片：显示"杂事"chip，无进度条与下一节点，其余一致。

## 5. 动效规范

- 展开/收起：spring 250–400ms；卡片进入/删除：位移+缩放+淡入淡出；
- 滑动：跟手位移、松手按速度惯性滚动并吸附最近卡片，阻尼平滑；
- 状态切换：颜色过渡 150ms；逾期呼吸动画透明度幅度 ≤0.02，避免干扰；
- 全部动效可被系统"减少动画"设置一键关闭（回退规则见 3.4）。

## 6. 触控与可访问性

- 触控目标 ≥44×44；支持触摸滑动；长按 450ms 拖拽重排为后续版本；
- 键盘：Tab 焦点顺序为 L2 工具行→卡片→详情；Enter/Space 激活；Esc 层层返回；
- 焦点环 2px #64D2FF；状态不只用颜色表达（图标+文字）；
- 高对比度模式：关闭磨砂、使用系统颜色；正文对比度满足 WCAG AA。
