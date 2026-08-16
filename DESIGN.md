---
name: "采办岛"
description: "以采购链路为界面的精密采购工作台"
colors:
  surface-tint-dark: "rgba(10, 12, 15, 0.78)"
  surface-fallback-dark: "#111318"
  surface-raised-dark: "rgba(255, 255, 255, 0.06)"
  surface-hover-dark: "rgba(255, 255, 255, 0.10)"
  surface-pressed-dark: "rgba(255, 255, 255, 0.14)"
  surface-overlay-dark: "rgba(8, 10, 13, 0.88)"
  border-subtle-dark: "rgba(255, 255, 255, 0.10)"
  border-strong-dark: "rgba(255, 255, 255, 0.18)"
  text-primary-dark: "#F5F7FA"
  text-secondary-dark: "#B8BDC7"
  text-tertiary-dark: "#858B96"
  accent-dark: "#64D2FF"
  accent-text-dark: "#061117"
  completed-dark: "#32D74B"
  pending-dark: "#FFD60A"
  cancelled-dark: "#858B96"
  critical-dark: "#FF453A"
  high-dark: "#FF9F0A"
  normal-dark: "#8E8E93"
  danger-dark: "#FF6961"
  surface-tint-light: "rgba(246, 247, 250, 0.84)"
  surface-fallback-light: "#F2F4F7"
  surface-raised-light: "rgba(255, 255, 255, 0.72)"
  surface-hover-light: "rgba(17, 19, 24, 0.05)"
  surface-pressed-light: "rgba(17, 19, 24, 0.08)"
  surface-overlay-light: "rgba(246, 247, 250, 0.92)"
  border-subtle-light: "rgba(17, 19, 24, 0.10)"
  border-strong-light: "rgba(17, 19, 24, 0.18)"
  text-primary-light: "#15171A"
  text-secondary-light: "#5B616B"
  text-tertiary-light: "#656C76"
  accent-light: "#0078D4"
  accent-text-light: "#F8FBFF"
  completed-light: "#16843A"
  pending-light: "#8A6500"
  cancelled-light: "#656C76"
  critical-light: "#C62828"
  high-light: "#A65300"
  normal-light: "#6D737C"
  danger-light: "#B42318"
typography:
  display:
    fontFamily: "'Segoe UI Variable', 'Microsoft YaHei UI', 'Segoe UI', system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 680
    lineHeight: "34px"
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "'Segoe UI Variable', 'Microsoft YaHei UI', 'Segoe UI', system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 680
    lineHeight: 1.45
    letterSpacing: "-0.025em"
  title:
    fontFamily: "'Segoe UI Variable', 'Microsoft YaHei UI', 'Segoe UI', system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 670
    lineHeight: 1.45
    letterSpacing: "-0.02em"
  body:
    fontFamily: "'Segoe UI Variable', 'Microsoft YaHei UI', 'Segoe UI', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "'Segoe UI Variable', 'Microsoft YaHei UI', 'Segoe UI', system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 650
    lineHeight: 1.45
    letterSpacing: "0.08em"
  utility:
    fontFamily: "'Cascadia Mono', 'Consolas', monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
rounded:
  collapsed: "999px"
  l2-shell: "32px"
  l3-shell: "24px"
  section: "16px"
  control: "12px"
  chip: "999px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "20px"
  space-6: "24px"
  space-8: "32px"
components:
  button-primary-dark:
    backgroundColor: "{colors.accent-dark}"
    textColor: "{colors.accent-text-dark}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  button-secondary-dark:
    backgroundColor: "{colors.surface-raised-dark}"
    textColor: "{colors.text-primary-dark}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  button-ghost-dark:
    backgroundColor: "transparent"
    textColor: "{colors.text-primary-dark}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  button-danger-dark:
    backgroundColor: "transparent"
    textColor: "{colors.danger-dark}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  field-dark:
    backgroundColor: "{colors.surface-raised-dark}"
    textColor: "{colors.text-primary-dark}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "44px"
  nav-item-active-dark:
    backgroundColor: "{colors.surface-pressed-dark}"
    textColor: "{colors.text-primary-dark}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "44px"
  segmented-active-dark:
    backgroundColor: "{colors.surface-pressed-dark}"
    textColor: "{colors.text-primary-dark}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "44px"
  switch-dark:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary-dark}"
    rounded: "{rounded.chip}"
    width: "56px"
    height: "44px"
  procurement-slip-dark:
    backgroundColor: "{colors.surface-raised-dark}"
    textColor: "{colors.text-primary-dark}"
    rounded: "{rounded.section}"
    padding: "16px"
    width: "248px"
  dialog-dark:
    backgroundColor: "{colors.surface-overlay-dark}"
    textColor: "{colors.text-primary-dark}"
    rounded: "{rounded.section}"
    padding: "0"
    width: "min(480px, calc(100vw - 32px))"
---

# Design System: 采办岛

## Overview

**Creative North Star: "精密采购工作台"**

“精密采购工作台”把采购链路本身作为界面：L1 是低打扰入口，L2 先建立任务身份、再给出下一采购动作，L3 只围绕当前任务展开。采购凭条与由节点、连接线、状态标记组成的采购链路是视觉签名；它们不是装饰，而是行动顺序和风险的共同载体。

系统借鉴 Apple 的信息层级、渐进披露与连续动效，但不模仿 macOS 外观。视觉世界由冷黑曜石外壳、自适应银内容面和单一冰蓝交互强调构成，强调精确、安静和可核对；深色是品牌主呈现，浅色、高对比度与减少动画模式跟随系统偏好。概念种子为 `6d4d8516`。

材质集中在外壳，内容靠留白、细分隔和稳定网格建立层级。AI 建议始终以草稿呈现，安全敏感操作显式确认，界面优先让用户看清下一步、当前状态和真实目标。

**Key Characteristics:**

- L1 低打扰、L2 任务名称优先且下一动作紧随、L3 当前任务单焦点。
- 冷黑曜石、自适应银与冰蓝构成品牌主世界，深色是主呈现。
- 采购凭条和采购链路是跨层级复用的视觉签名。
- 状态色保持微量，并始终与图标、文字、线型或描边共同出现。
- 安全边界可见：外链先核对完整目标，凭据默认遮罩，AI 输出只作为草稿。

## Colors

色彩按深浅主题成对维护：深色以 `surface-*-dark`、`text-*-dark` 为主，浅色使用对应的 `*-light` token；组件不得自行推导新色值。

### Primary

- **冰蓝操作光**（`accent-dark` / `accent-light`）：唯一主交互强调，用于主要动作、焦点环、当前标签和进行中节点；深浅主题分别使用各自配对值。

### Secondary

- **完成绿**（`completed-dark` / `completed-light`）：只标识已完成或成功。
- **待办黄**（`pending-dark` / `pending-light`）：只标识待完成、待审核或未配置提醒。
- **取消灰**（`cancelled-dark` / `cancelled-light`）：标识已取消节点；不进入进度分母，也不参与下一动作计算。
- **紧急红与高优先橙**（`critical-*` / `high-*`）：表达紧急程度和逾期风险；危险操作另用 `danger-*`，不与业务紧急度混用。

### Neutral

- **冷黑曜石**（`surface-tint-dark` / `surface-fallback-dark`）：深色外壳与无磨砂回退。
- **自适应银**（`surface-raised-*`、`surface-hover-*`、`surface-pressed-*`）：内容面及交互状态；透明度而非额外色相形成层级。
- **主文、辅文、弱提示**（`text-primary-*`、`text-secondary-*`、`text-tertiary-*`）：按重要性递减；关键状态不得只落在弱提示层。
- **细边与强边**（`border-subtle-*` / `border-strong-*`）：分区、控件和悬浮边界；不承担主要信息层级。

### Named Rules

**The 单一冰蓝 Rule.** 冰蓝是唯一主交互强调；同一视图不再引入第二个品牌强调色。

**The 微量状态 Rule.** 状态色只进入小图标、文字、2–4px 轨迹或描边，不铺满卡片或大面积容器。

## Typography

- **Display Font:** Segoe UI Variable（回退 Microsoft YaHei UI、Segoe UI、system-ui）
- **Body Font:** Segoe UI Variable（同一回退栈）
- **Label/Mono Font:** Cascadia Mono（回退 Consolas、monospace）

**Character:** 字体系统化、克制且高密度可读。粗细和字距负责建立采购动作、任务标题与辅助事实的优先级，不使用装饰性品牌字体。

### Hierarchy

- **Display**（680，28px/34px，-0.035em）：L3 独立视图标题和关键下一动作。
- **Headline**（680，24px，-0.025em）：当前任务标题；单行省略，避免挤压状态信息。
- **Title**（670，18px，-0.02em）：分区标题、凭条中的任务名称。
- **Body**（400，14px，1.45）：正文、说明与大多数表单内容；长说明控制在约 58–64ch。
- **Label**（650，11px，0.08em）：眉题、侧栏分组、来源和元数据标签；只对短标签使用大写感字距。
- **Utility**（400，11px）：时间、路径、URL 和凭据框；时间变化使用等宽数字，避免宽度跳动。

### Named Rules

**The 系统字形 Rule.** 后续界面继续使用系统 UI 字体和工具等宽字体，不用展示字体制造“高级感”。

## Layout

界面由同一窗口的三级形态构成。L1 是顶部中央的安静边缘（96×6px）；L2 默认是横向凭条轨道，窗口目标尺寸为 760×280px，凭条宽 248px、间距 12px；L3 使用 240px 任务侧栏与 `minmax(0, 1fr)` 工作区，主要阅读内容最大宽 880px。L3 的任务区一次只渲染概览、采购节点、资料、提醒或备注中的一个主分区；草稿、归档和设置是侧栏次级入口，设置固定分为常用、AI 与 Qoder、飞书同步、数据与高级四区。

空间节奏严格来自 4px 基线及前置 `spacing` token。常规控件最小命中为 44×44px，相邻目标至少留 8px；外壳安全内距使用 12px，任务内容常用 16–32px 递进。横向列表、侧栏和标题行必须给可变文本 `min-width: 0` 与明确省略策略，避免中文长标题破坏动作区。

紧凑断点为 760px：侧栏隐藏，顶部出现 56px 任务选择与次级入口；主内容改单列，概览双列、资料编辑器、草稿双栏、归档事实和设置表单均堆叠；标签行保持横向滚动而不压缩命中区域。Windows 文本缩放时允许内容增高和工作区滚动，不缩小字号维持固定高度。

**The 单焦点 Rule.** L2 只回答“下一步做什么”，L3 只展开一个当前任务和一个主分区；新增功能不得把工作区改回多卡片仪表盘。

## Elevation & Depth

深度是外壳 Acrylic、透明银内容面、细描边和少量阴影的混合。L2/L3 外壳可以使用系统 Acrylic；磨砂不可用、用户关闭、高对比度或减少动画时回退为确定性纯色。内部大多数区域保持平面，以分隔线、留白和选中态区分；只有真实浮层和可行动凭条使用边界与阴影。

### Shadow Vocabulary

- **岛体环境阴影**（`0 18px 58px`）：只用于 L2/L3 最外壳。
- **菜单悬浮阴影**（`0 16px 40px`）：用于“更多”菜单等小型悬浮层。
- **确认浮层阴影**（`0 24px 72px`）：用于对话框和模态操作。
- **反馈阴影**（`0 14px 38px`）：用于短时 Toast；不扩散到常驻内容。

**The 壳体先行 Rule.** 材质和大阴影属于外壳或真实浮层；内容区默认平面，禁止卡片套卡片制造虚假层级。

## Shapes

轮廓从外到内递减：L1 胶囊（999px）、L2 外壳（32px）、L3 外壳（24px）、内容分区和凭条（16px）、按钮与输入（12px）；状态轨迹和开关继续使用胶囊。品牌标记是带轻微旋转的非对称细描边几何，采购轨迹则用精确的圆点、细线和短段建立秩序。

边框默认 1px，键盘焦点环为 2px 并外偏移 2px。矩形面只使用既有圆角层级；嵌套时外大内小，内部控件不得切到外壳轮廓。

**The 外大内小 Rule.** 新组件先确定所在层级，再从既有圆角 token 选择；不得新增相邻但不一致的 10px、14px 或 20px 圆角。

## Components

组件整体感觉是“克制、可核对、命中明确”。默认态安静，hover 只抬高对比或轻微位移，focus 必须清晰可见，active 使用短促缩放或压下反馈。

### Buttons

- **Shape:** 控件圆角（12px），最小高度 44px；图标按钮固定 44×44px。
- **Primary:** 冰蓝背景与深色前景，左右内距 16px，只用于当前最主要动作。
- **Hover / Focus:** hover 切换到主题的银色 hover 面；focus 使用 2px 冰蓝外环；active 缩放至 0.97 并使用 pressed 面。
- **Secondary / Ghost / Danger:** 次按钮使用 raised 面与细边；Ghost 默认透明；危险按钮只以危险色文字或描边出现，不做大面积红底。

### Chips

- **Style:** 状态轨迹和开关采用胶囊；分段选择器外层为 12px 控件轮廓，内部项为减去 4px 的圆角。
- **State:** 未选以辅文和透明面为主，选中使用 pressed 面；紧急度可以改变文字色，但必须保留文字标签。

### Cards / Containers

- **Corner Style:** 采购凭条和真实内容分区使用 16px 圆角。
- **Background:** raised 面覆盖冷黑曜石外壳；hover 使用 hover 面，不新增白色实体卡。
- **Shadow Strategy:** 常驻凭条依赖细边与色调层级，不加独立大阴影。
- **Border / Padding:** 1px subtle 边，内距 16px；凭条左侧 2px 紧急度轨迹，底部 3px 采购链路。

### Inputs / Fields

- **Style:** raised 背景、strong 描边、12px 圆角、44px 最小高度，水平内距 12px。
- **Focus:** 边框切换为冰蓝，同时保留全局 `focus-visible` 外环。
- **Error / Disabled:** 错误用危险色文字与反馈轨迹；禁用态降至 48% 不透明度，但标签仍明确。

### Navigation

侧栏任务项和次级入口使用 44px 最小高度、12px 圆角与左侧细状态轨迹；活动项用 pressed 面、subtle 边和 `aria-current`。任务分区与设置分区使用底部 2px 冰蓝轨迹标记当前项。紧凑布局隐藏侧栏但保留任务选择、草稿、归档和设置入口。

### Procurement Slip & Trail

凭条以任务名为主标题、下一有效节点为副标题，随后呈现风险/截止和上一/当前/下一节点轴；不在每张凭条重复“下一采购动作”。主体、节点状态选择和右上角更多菜单是分离的真实控件：主体支持左右键、Home/End、触摸拖动和吸附，节点点击后显式选择四态，更多菜单处理任务完成、取消和删除。L3 中同一链路展开为节点标记、连接线、状态文字和可编辑选择器，维持从 L2 到 L3 的语义连续。

### Dialogs, Credentials & Settings

对话框使用 16px 圆角 overlay 面、标题/说明/动作区三段结构，锁定焦点并在关闭后恢复。外链和文件必须显示完整目标并要求确认；连接地址、访问密钥和个人令牌默认遮罩，只有明确“显示”后可见。设置始终保持四分区，不把安全敏感项混入常用设置。

**The 安全边界 Rule.** 任何离开应用、暴露凭据或把草稿写入正式任务的动作，都必须在界面中显示真实目标与明确确认状态。

## Do's and Don'ts

### Do:

- **Do** 让新增界面继续围绕采购动作、凭条或节点链路组织，而不是围绕功能模块堆卡片。
- **Do** 复用共享语义 token，并同时验证深色、浅色、高对比度和纯色回退。
- **Do** 保持所有交互目标至少 44×44px、键盘焦点可见，并让状态同时有图标、文字或线型。
- **Do** 在 760px 以下验证单列重排、横向标签滚动、长中文标题和 Windows 文本缩放。
- **Do** 把高级配置放进渐进披露，把下一步动作和安全后果放在第一层。

### Don't:

- **Don't** 模仿 macOS 窗口控件、菜单栏或桌面 chrome；借鉴的是信息层级和连续性，不是平台皮肤。
- **Don't** 用整张高饱和红、黄、绿卡片表达状态，或让颜色成为唯一状态线索。
- **Don't** 在内容区叠加无业务层级的卡片、渐变、玻璃层或装饰性阴影。
- **Don't** 在减少动画模式运行惯性、补间或呼吸动效；直接定位到最终状态。
- **Don't** 默认展示凭据、缩略外链目标，或让 AI 建议绕过草稿审核进入正式数据。
