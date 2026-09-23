import type { ExampleContent } from '../index';

export const zhCNExamples: Record<string, ExampleContent> = {
  daymark: {
    title: 'Daymark：从需求到待办应用',
    description:
      '五份可编辑输入：产品简报、任务、项目、原创标志与设计规范。连接今日任务、项目详情与任务编辑。',
    prompt:
      '根据工作区的 product-brief.md、tasks.json、projects.json、logo.svg 和 DESIGN.md，制作 Daymark 移动优先待办原型。先阅读全部文件，保留原始输入并使用真实本地标志与设计规范。实现今日、项目列表、项目详情和任务编辑完整流程，共享任务状态，新增、编辑、完成任务后所有列表与计数同步；处理空状态、校验和返回导航。仅用模拟数据，无后端、登录、支付、网络请求或安装。用 App.jsx 实现响应式可访问界面，更新 DESIGN.md，预览并操作主流程后完成；不要声称未测试的功能已验证。',
  },
  'common-ground': {
    title: 'Common Ground：工作坊预约',
    description:
      '从简报、排期 CSV 与原创海报构建发现、详情、预约和确认流程；所有预约均为本地模拟。',
    prompt:
      '先阅读工作区 product-brief.md、schedule.csv、poster.svg、logo.svg 和 DESIGN.md，为虚构品牌 Common Ground 制作完整工作坊预约原型。使用本地原创海报、标志与规范，以 CSV 为场次、价格和容量依据。连接发现、详情、预约表单和确认页，共享已选场次与访客信息，校验人数和联系方式，防止重复扣减容量，取消后恢复名额；支持返回和无结果状态。明确标注模拟预约、无实际付款。保留输入文件，用 App.jsx 实现移动和桌面响应式界面，更新 DESIGN.md；不添加后端、登录、支付、网络调用或依赖安装。预览并操作主流程再完成，不把未测试行为标为已验证。',
  },
  trailhead: {
    title: 'Trailhead：从草图到行程规划',
    description:
      '原创 SVG 低保真草图、注释简报和示例行程，生成互联的行程编辑器；无需视觉模型也可读取注释。',
    prompt:
      '先阅读工作区 sketch-reference.svg、product-brief.md 和 trips.json，将 Trailhead 草稿转成完整互联的行程规划原型。SVG 是原创手绘风格低保真参考，不是手绘照片或最终成品；即使无法查看图像也要读取 SVG 文本和简报注释，仅在支持时查看图像。把三组线框转为行程列表、行程详情和停留点编辑页，不要把草图直接当最终界面。新增、删除、排序和编辑使用单一共享状态，所有页面的时长总计一致，支持校验、空状态和返回。仅用本地模拟数据，不使用真实地图、导航、预订、认证、网络或安装。保留输入，用 App.jsx 实现响应式可访问界面并创建 DESIGN.md；预览并操作主流程再完成，不声称未测试结果已验证。',
  },
  'cosmic-animation': {
    title: '宇宙尺度动画',
    description: '面向航天科技公司的动画 Hero，含轨道、星场和任务控制细节。',
    prompt:
      '为一家名叫 Outer Frame 的航天科技公司做一个单页 Hero，面向航天采购方和技术创始人。中心是一组动画宇宙场景：发光恒星、三层带视差的轨道环、稀疏星场和任务控制风格的说明栏。上方放一句短 tagline，下方放可信度信息和 ghost CTA。移动端到桌面端都要稳定，动画用 CSS/SVG 保持 60fps，不使用外部图库或占位图。',
  },
  'organic-loaders': {
    title: '有机风格加载动画',
    description: '六个手绘感加载状态，带标签、说明和可访问状态文本。',
    prompt:
      '设计一个 wellness 产品 UI kit 的加载动画展示页。包含六个有机风格 loader，每个放在独立卡片里，带名称、一句使用场景说明、active/paused 状态和可访问 loading 文案。动画包括 blob 变形、叶片摇摆、墨滴扩散、呼吸圆环、柔和脉冲、丝带编织。使用暖奶油背景和柔和粉彩，纯 CSS/SVG 动画，响应式换行，不使用外部图片资产。',
  },
  'landing-page': {
    title: '营销落地页',
    description: '效率工具的编辑风落地页，结构完整、内容更具体。',
    prompt:
      '为一款名叫 Field Notes、面向小型产品团队的效率工具设计营销落地页。首屏要包含 headline、subhead、产品 UI 暗示、主 CTA 和次链接；下面依次放三个核心收益区、简洁 testimonial、价格预告和页脚。使用编辑风排版、大留白、米白背景、炭黑文字和深赭色强调色。所有文案要贴合产品场景，移动端自适应，不使用热链图库或占位图片。',
  },
  'case-study': {
    title: '客户案例单页',
    description: '可打印金融科技案例，含指标、引言和流程图。',
    prompt:
      '为一家 B2B 金融科技公司创建一页可打印客户案例，比例适合 8.5x11，同时在网页预览中可读。布局包含：带客户名和业务背景的高 Hero、三组 before/after 指标和变化值、CFO 引言、三步 How we did it 区块、紧凑的流程或架构图、合作 logo 条。使用深色主题、衬线标题、等宽数字、真实感模拟数据，不要 lorem ipsum 或外部图片。',
  },
  dashboard: {
    title: '收入分析看板',
    description: '高密度 SaaS 收入看板，含图表、筛选、表格和状态。',
    prompt:
      '设计一个面向 SaaS 收入团队的分析看板。左侧栏放 5 个导航项，顶部有日期范围和 segment 筛选；主体 2x2 网格包含 MRR 趋势折线图、pipeline 阶段堆叠条形图、Top accounts 表格、forecast attainment 仪表图。至少给一个卡片加入空状态或筛选状态，使用真实感 mock 数据和标签。整体是高密度深色专业 UI，teal 和 amber 作强调，控件有键盘焦点样式，窄屏可响应式重排。',
  },
  'pitch-slide': {
    title: '路演单页 — Why now',
    description: '16:9 市场时机页，含论点、要点、图表和页脚。',
    prompt:
      '为一家基础设施创业公司设计一页 16:9 路演稿，标题是 Why now。页面包含小 eyebrow：Market timing，一句强有力的核心论断，左侧三条简短支撑要点，右侧两条线的趋势图，底部放公司标识、source note 和页码。使用米白背景、海军蓝文字、一个橙色强调色，排版克制自信，数字真实可信，所有元素保持导出安全的固定间距。',
  },
  email: {
    title: '欢迎邮件',
    description: '邮件安全的 600px 欢迎邮件，含引导步骤和 CTA。',
    prompt:
      '为名叫 Studio Loop 的设计工具设计一封事务性欢迎邮件。采用 600px 单列 table-based 布局，兼容邮件客户端：深靛蓝 header 带 wordmark，友好问候语，三步上手引导，每步带小型 inline SVG 图形和一句说明，主 CTA、备用文字链接、最小化合规页脚。使用浅色表面和靛蓝强调，系统字体栈，移动端紧凑适配，不使用外部图片或不兼容脚本。',
  },
  'mobile-app': {
    title: '习惯追踪移动端首屏',
    description: '手机外框内的习惯首页，含 streak、进度环和底部栏。',
    prompt:
      '在手机外框里设计一个名叫 Streak 的习惯追踪 App 首页。顶部显示今天日期，中间是当前连续天数 Hero 卡片，下面列出四个习惯，每项有圆形进度环和勾选按钮，再加一条本周完成度迷你图表和五个图标的底部 Tab 栏。要展示已完成和未完成状态，触控区域足够大，使用柔和薄荷背景、白色卡片和炭黑文字，预览框架自适应，不使用外部资源。',
  },
  'pricing-page': {
    title: 'SaaS 定价页',
    description: '三档价格、年付切换、功能对比表和 FAQ。',
    prompt:
      '为名叫 Arcjet 的开发者平台设计定价页。展示三档：Hobby 免费、Pro 每月 29 美元、Enterprise 定制；Pro 卡片要突出并带 Most popular 徽章。包含月付/年付 segmented toggle、10 行以上功能对比表、FAQ accordion 和低调的安全说明。使用深色模式、细腻层次、等宽数字、大垂直间距，文案贴合开发者平台，移动端卡片堆叠，不使用假链接或外部图库。',
  },
  'blog-article': {
    title: '编辑风格博客文章',
    description: '长文页面，含 Hero、目录、拉引、代码和相关文章。',
    prompt:
      '为名叫 Pixel & Prose 的设计工程 publication 设计长文文章页。包含用 CSS/inline SVG 构成的首屏 hero 图像区、大号衬线标题、作者 byline 和头像 initials、发布日期、粘性目录侧栏、正文段落、拉引 quote、inline code blocks、脚注和底部相关文章网格。使用经典编辑风浅色主题，阅读宽度约 680px，移动端目录要合理折叠，不要 lorem ipsum。',
  },
  'event-calendar': {
    title: '团队日历视图',
    description: '互动月历，含事件条、筛选、侧栏和 popover。',
    prompt:
      '为团队排期应用设计一个月视图日历组件。展示完整月份网格，突出今天，多日事件用彩色 pill 横跨日期；旁边有 upcoming events 小侧栏，顶部有月份左右切换、Today 按钮和团队筛选。点击事件要显示详情 tooltip 或 popover，并处理同一天事件过多的情况。使用干净白色表面、细网格线、四类事件颜色、可访问焦点状态，窄屏要压缩或堆叠。',
  },
  'chat-interface': {
    title: '聊天消息界面',
    description: '移动端聊天 UI，含气泡、输入状态、图片消息和输入栏。',
    prompt:
      '在手机外框中设计一个消息 App 对话页。展示发送方和接收方气泡、消息组之间的时间戳、用本地 CSS/SVG 占位构成的图片消息、三个点的 typing indicator、带头像和在线状态的联系人头部、iOS 风格状态栏，以及底部输入栏：附件按钮、文本框、发送按钮。包含空输入和正在输入状态，触控区域精致，不使用外部头像服务。',
  },
  'portfolio-gallery': {
    title: '摄影作品集画廊',
    description: '深色瀑布流作品集，含筛选、悬浮遮罩和灯箱状态。',
    prompt:
      '设计一个摄影师作品集页面，使用 masonry 图片网格。图片用不同宽高比例的 CSS gradient 或形状占位，不使用外部图片。包含极简顶部导航和摄影师 wordmark，分类筛选 pills，图片 hover 时出现标题和相机参数，选中时有 lightbox 风格状态，底部有简短档期说明。使用近黑背景、细白边框、克制排版、顺滑 hover 过渡，响应式支持两列、三列、四列。',
  },
  'receipt-invoice': {
    title: '可打印发票',
    description: '设计机构发票，含地址、明细、总额和付款条款。',
    prompt:
      '为名叫 Studio Neon 的设计机构设计一张可打印 invoice/receipt。包含 logo 或 wordmark 区、invoice 编号和日期、billing 和 shipping 地址并排、5 行真实感项目明细表、subtotal/tax/total 汇总、付款条款、备注和 Thank you 页脚。使用干净奶油纸张背景、炭黑文字、一个强调色突出总额，适配 A4/Letter 打印比例，网页预览可缩放，不使用外部资产。',
  },
  'settings-panel': {
    title: '应用设置页面',
    description: 'SaaS 设置页，含表单、开关、连接账户和危险区。',
    prompt:
      '设计一个 SaaS 应用设置页。左侧栏包含 Profile、Notifications、Security、Billing、Team、Integrations；主区域显示 Profile：文本输入、头像上传占位、toggle 开关、dropdown select、connected account 行、红色 danger zone、breadcrumbs 和 Save changes 按钮。展示 disabled 和 dirty 状态，焦点环可访问，移动端表单堆叠，整体表单间距干净，不使用假导航链接。',
  },
  'auth-signin': {
    title: '登录页',
    description: '精致登录卡片，含邮箱密码、第三方按钮和校验状态。',
    prompt:
      '为名叫 Lumen 的 SaaS 产品设计登录页。深色星空 CSS 背景上放置居中卡片，包含产品 wordmark、Welcome back 标题、邮箱和密码输入框、主登录按钮、Forgot password 链接、OR 分隔线、Google/GitHub/Apple 第三方按钮（可用文字或 inline glyph），以及注册入口。加入校验或错误状态样式、清晰焦点环、响应式居中，不使用外部 icon 或头像 host。',
  },
  'kanban-board': {
    title: '看板项目面板',
    description: '三列项目看板，含任务卡、头像、优先级和拖拽暗示。',
    prompt:
      '为产品团队设计一个 kanban board。顶部栏包含项目名、board/list 切换、筛选 chips 和 Add task 按钮；下方三列：Backlog、In progress、Done，每列有彩色 header、数量 pill 和 3 到 5 张任务卡。卡片展示标题、短描述、负责人 initials 堆叠、due date 和 priority tag。包含 hover/drag affordance 和空列状态，使用柔和灰色画布、白色卡片，窄屏允许横向滚动。',
  },
  'ai-product-hero': {
    title: 'AI 产品主视觉',
    description: '编辑风 AI Hero，含抽象视觉、闪烁光标、CTA 和信任行。',
    prompt:
      '为名叫 Inkwell 的 AI 写作助手设计 Hero 区。背景为深海军蓝到紫色，右侧用 CSS/SVG 构成抽象的生成写作视觉，大号编辑风 headline 后有闪烁 caret，两行 subhead，主/次 CTA，一小条 trust row。响应式处理好，不要泛泛的 feature-card filler；排版要自信有编辑感，不使用外部图库或占位图。',
  },
  'weather-card': {
    title: '移动端天气卡片',
    description: '手机天气首页，含预报条、单位和定位控件。',
    prompt:
      '在手机外框里设计一个天气 App 首页。背景是柔和天蓝到靛蓝渐变，中间玻璃质感天气卡展示城市、当前温度、天气图形、高低温和 6 小时预报条；下面第二张卡展示 7 日 summary bars。加入 loading/error 微文案区域、定位和单位切换控件，触控友好、半透明但对比度可读，不使用外部图标字体或天气 API。',
  },
  'timeline-changelog': {
    title: '版本更新时间线',
    description: '版本时间线，含筛选、RSS CTA、标签和 breaking callout。',
    prompt:
      '设计一个产品 changelog 页面，形式是竖向时间线。顶部有筛选行：All、Features、Fixes、Breaking，以及 RSS subscribe pill；下面四条 release，每条包含日期、版本标签、标题、2 到 3 行描述、mini-tags，并加入一个 breaking-change 高亮提示。使用暖米白背景、衬线标题、克制排版，移动端时间线要堆叠，release 文案要真实，不要 lorem ipsum。',
  },
  'stats-counter': {
    title: '动态数据统计条',
    description: '滚动触发计数卡片，含霓虹强调和 reduced-motion fallback。',
    prompt:
      '设计一个落地页 stats strip，包含三个滚动进入视口后从 0 开始递增的数字：2.4M users、99.8% uptime、180 countries。每个数据位于深海军蓝背景上的半透明卡片里，背后有不同霓虹强调色光晕，下面是小号全大写 label。用 IntersectionObserver 和 requestAnimationFrame，不用 JS 库，提供 reduced-motion fallback，移动端文字保持可读。',
  },
  'kinetic-poster': {
    title: '动态活动海报',
    description: '设计会议动态海报，含大字、几何、信息和 CTA。',
    prompt:
      '为名叫 Motion Matters 的设计会议做一个 kinetic web poster。它要像一张现场活动海报：超大动态 typography、旋转几何标记、日期地点、speaker chips 和 Register CTA。包含 paused 或 reduced-motion 状态，构图要能从竖版移动端转换到横向桌面端。使用高对比编辑风配色，只用 CSS/SVG 动画，不调用外部图片或字体服务。',
  },
  'particle-field': {
    title: '粒子场 Hero',
    description: '基础设施产品互动粒子 Hero，含技术指标和连接线。',
    prompt:
      '为一家名叫 Vector Loom 的数据基础设施公司创建互动 particle-field landing section。深色 canvas 风 Hero 中有 80 到 120 个小粒子和细连接线，鼠标 hover 或键盘安全交互时有轻微吸引效果。放 headline、短技术 subhead、metric chips 和 CTA 行。可用 CSS/Canvas/SVG，但不要外部库；提供 reduced-motion fallback，移动端和桌面端内容都要可读。',
  },
  'progress-microinteractions': {
    title: '进度微交互动效',
    description: '上传、清单、stepper、成功和重试状态的动效实验台。',
    prompt:
      '为一款效率应用设计 progress and completion 微交互实验台。展示五个组件：上传进度、清单完成、stepper 过渡、成功确认、retry/error 状态。每个组件要有标签、一句使用说明，并通过按钮触发状态变化。使用可访问 status text，平静的绿色和金色，纯 CSS 加少量 vanilla JS，响应式换行，不使用外部资源。',
  },
  'command-center': {
    title: 'AI 运维指挥中心',
    description: '高密度运维 UI，含事件、runbook、状态和 inspector。',
    prompt:
      '设计一个 AI operations 工具的 command-center 界面。包含顶部 search/command bar、左侧 environment rail、主 incident timeline、active runbook 面板、model/provider 状态 chips，以及右侧 selected event inspector。展示 empty、selected 和 warning 状态。使用高密度专业深色 UI、清晰层级、等宽 metadata、快捷键提示、响应式折叠行为，不使用假外链。',
  },
  'file-manager': {
    title: '研究文件管理器',
    description: '文件工作区，含文件夹树、网格/列表、选择和详情抽屉。',
    prompt:
      '为研究团队设计一个 cloud file manager。包含 toolbar：搜索、排序、上传、视图切换；左侧 folder tree；主区域文件 grid/list，展示类型图标、owner initials、modified dates 和 selection checkboxes；右侧 details drawer 显示选中文件。包含空文件夹和多选状态、可访问焦点样式、响应式布局、真实文件名，不使用外部 icon 库。',
  },
  'onboarding-wizard': {
    title: '团队引导向导',
    description: '四步 setup 流程，含表单、校验、帮助和成功总结。',
    prompt:
      '为团队分析产品设计四步 onboarding wizard。步骤是公司资料、连接数据源、邀请队友、review setup。左侧是 progress rail，主区域是表单和校验状态，含 inline help、Back/Next 控制，最后有 success summary。使用冷静企业风和一个鲜明强调色，表单标签真实，错误提示可访问，移动端堆叠。',
  },
  'checkout-flow': {
    title: '结账流程',
    description: '高端零售结账页，含表单、配送、付款、总额和状态。',
    prompt:
      '为一家高端文具店设计 checkout flow 页面。包含购物车 summary、shipping address 表单、delivery options、payment method、promo code、订单总额 breakdown 和 secure checkout CTA。展示校验错误和选中配送状态。使用精致零售排版、暖纸张表面，商品缩略图用 CSS 构成，桌面双列到移动单列响应式，不使用外部商品图片。',
  },
  'agenda-planner': {
    title: 'Workshop 日程规划器',
    description: '混合 workshop 时间线，含冲突、房间和详情面板。',
    prompt:
      '设计一个 hybrid workshop 的 day-agenda planner。包含从上午 9 点到下午 5 点的时间线，session blocks 带 type chips、speaker initials、room 或 Zoom 标签、冲突警告；侧边面板显示选中 session 详情和 Add to calendar 按钮。使用清晰排期 UI、按 session 类型配色、键盘可见控件、响应式堆叠和真实 session 标题。',
  },
  'design-token-inspector': {
    title: '设计 Token Inspector',
    description: 'Token 浏览器，含色板、字体预览、diff 和导出抽屉。',
    prompt:
      '为产品设计系统设计 design-token inspector。包含 token 分类侧栏、可搜索 token 表格、颜色 swatches、typography preview rows、spacing scale 可视化、changed token 的 diff badge，以及 code export drawer。展示选中 token 详情和空搜索状态。使用克制工具型 UI、清晰 metadata、可访问对比度、响应式表格，不使用外部资产。',
  },
  'product-launch-page': {
    title: '产品发布页',
    description: '发布 Campaign 页，含 Hero、Tour、Quote、价格、FAQ 和 CTA。',
    prompt:
      '为名叫 Northstar Canvas 的协作白板设计产品发布页。首屏要有明确产品信号、launch announcement banner、具体 offer 的 Hero、互动 feature tour、客户 quote、launch pricing block、FAQ 和 CTA footer。整体有 campaign 能量但不要泛泛渐变球，文案要围绕真实产品能力，sections 响应式，用 CSS/SVG 做视觉，不使用 stock 图片。',
  },
  'nonprofit-campaign-page': {
    title: '公益 Campaign 页面',
    description: '捐赠页，含目标进度、影响指标、故事和资金用途。',
    prompt:
      '为社区食物项目设计 nonprofit campaign page。包含 Hero 和 donation goal、进度条、impact stats、story section、volunteer signup、donation tiers、upcoming events，以及透明 fund-use breakdown。使用温暖、人本的 CSS/插画形状视觉，CTA 清楚，移动端优先，文案真实不 SEO 垃圾，不使用 stock photos 或占位人物。',
  },
  'agency-homepage': {
    title: 'Agency 首页',
    description: '精品工作室首页，含服务、案例、流程和联系 CTA。',
    prompt:
      '为名叫 Common Room Studio 的精品产品设计 agency 设计首页。包含 editorial hero、services index、selected work teasers、process section、team note、contact CTA 和 footer。使用成熟 typography、不对称布局、项目缩略图用 CSS 构成、微妙 hover 状态、响应式网格，文案具体像真实 agency，不要通用 portfolio filler。',
  },
  'webinar-registration': {
    title: 'Webinar 注册页',
    description: 'B2B 注册页，含讲者、议程、表单、信任标识和确认状态。',
    prompt:
      '为 B2B security workshop 设计 webinar registration page。包含 speaker panel、日期时间和 timezone、agenda bullets、注册表单、trust badges、who should attend 区块，以及提交后的 confirmation state preview。使用专业 SaaS 风格，表单校验清楚，响应式布局，文案真实，讲者头像用 inline SVG 占位，不使用热链头像或 logo。',
  },
  'open-source-project-page': {
    title: '开源项目主页',
    description: '开发者主页，含安装命令、架构、社区和路线图。',
    prompt:
      '为一个名叫 Pocketbase Studio 的 local-first 开发者工具设计开源项目主页。包含 Hero 和 GitHub CTA、install command block、feature matrix、architecture diagram、community stats、roadmap preview、contributor callout 和 license note。使用开发者友好的信息密度、等宽代码表面、响应式命令块、真实项目风文案，不使用外部脚本。',
  },
  'enterprise-security-page': {
    title: '企业安全页',
    description: 'Trust 页面，含合规、数据流、控制项、审计 mock 和 FAQ。',
    prompt:
      '为一个 SaaS 平台设计 enterprise security page。包含 compliance overview、data-flow diagram、security controls grid、audit-log screenshot mock、trust center links 以按钮形式呈现、customer assurance FAQ 和 contact-security CTA。使用安静专业的信息架构，内容密集但易扫读，合规标签真实，响应式布局，不使用假外部目的地。',
  },
  'waitlist-page': {
    title: 'Waitlist 页面',
    description: '编辑风注册页，含邮箱、用例、隐私说明和成功状态。',
    prompt:
      '为名叫 Margins 的 AI-native notebook app 设计 waitlist page。包含简洁产品承诺、email capture form、可选 invite-code 字段、三个具体使用场景、social proof count、privacy note 和提交成功状态。使用亲密的编辑风、CSS 纸张纹理、精致表单状态、移动端优先，不使用外部图片。',
  },
  'annual-report': {
    title: '年度报告',
    description: 'Web-first 影响力报告，含信件、指标、项目和财务图表。',
    prompt:
      '为 climate-tech nonprofit 设计 web-first annual report page。包含封面、director letter、impact metrics、program highlights、financial allocation chart、partner acknowledgements 和 download/report CTA。使用印刷感编辑布局，数据可视化用 SVG/CSS，数字真实并带 source notes，响应式阅读体验，不使用 stock photos。',
  },
  'product-brief': {
    title: '产品 Brief',
    description: '内部功能一页 brief，含范围、流程、风险和 rollout 清单。',
    prompt:
      '为名叫 Smart Routing 的内部功能设计一页 product brief。包含 problem statement、target users、success metrics、scope/non-scope、key flows、risks、rollout checklist、owner/date metadata。使用清晰产品管理层级，信息密集但可读，带 status chips 和紧凑图解，打印友好比例，不使用占位人名。',
  },
  'resume-cv': {
    title: '简历 / CV',
    description: '设计工程师 CV，含经历时间线、项目和技能矩阵。',
    prompt:
      '为一位 senior design engineer 设计精致 resume/CV 页面。包含姓名和联系方式 header、短 profile、experience timeline、selected projects、skills matrix、education，以及侧栏 tools/certs。结构要 ATS-friendly、阅读清晰，打印安全字号，使用低调强调线条，内容像真实岗位经历，网页预览响应式，不使用头像照片。',
  },
  'research-summary': {
    title: '研究摘要',
    description: '访谈研究摘要，含发现、引用、机会矩阵和行动建议。',
    prompt:
      '为用户访谈研究设计 research summary page。包含 study title、methodology snapshot、participant breakdown、top five findings、quote cards、opportunity matrix、recommendation checklist 和 appendix links 按按钮展示。使用冷静、证据优先的视觉风格，source label 清楚，图表可访问，sections 响应式，不要 lorem ipsum。',
  },
  'press-kit': {
    title: 'Startup Press Kit',
    description: '发布 press kit，含 boilerplate、quote、facts、资产和 FAQ。',
    prompt:
      '为一家 startup launch 设计 press kit page。包含 company boilerplate、founder quote、launch facts、用 CSS mock card 构成的产品截图、downloadable asset list、media contact、approved short descriptions 和 FAQ。使用适合媒体快速读取的信息组织、清晰 typography、紧凑卡片、响应式布局，公开文案真实，不使用外部 logo 或照片。',
  },
  'finance-ops-dashboard': {
    title: '财务运营看板',
    description: 'CFO 看板，含 runway、burn、账龄、预测偏差和审批。',
    prompt:
      '为 CFO 团队设计 finance operations dashboard。包含 KPI strip、cash runway trend、burn by department 堆叠条形图、invoice aging table、forecast variance card 和 approval queue。加入 quarter 和 entity 筛选，逾期 invoice warning 状态，真实感财务 mock 数据，高密度专业浅/深混合表面，以及响应式表格处理。',
  },
  'customer-support-dashboard': {
    title: '客服支持看板',
    description: 'CX 看板，含 SLA、情绪、渠道、排行榜和队列健康。',
    prompt:
      '为 CX lead 设计 customer support dashboard。包含 ticket volume trend、SLA breach alert、channel mix chart、sentiment cards、agent leaderboard table 和 queue health panel。展示选中筛选 chips 和 empty/no-data 文案。使用运营型 SaaS 信息密度、蓝色和珊瑚色强调、真实 ticket 指标、可访问表格和响应式卡片重排。',
  },
  'observability-dashboard': {
    title: '可观测性看板',
    description: '基础设施看板，含服务健康、延迟、错误、部署和日志。',
    prompt:
      '为基础设施团队设计 observability dashboard。包含 service health grid、latency percentile chart、error-rate sparkline cards、deploy timeline、incident banner 和带 severity chips 的 logs table。使用接近终端但更现代的深色风格、等宽 metadata、清楚的红黄绿状态语言、真实 service names、响应式 overflow 处理，图表用 inline SVG，不依赖外部图库。',
  },
  'ecommerce-inventory-dashboard': {
    title: '库存运营看板',
    description: '运营看板，含库存风险、仓库筛选、预测和采购队列。',
    prompt:
      '为电商运营经理设计 ecommerce inventory dashboard。包含 stock risk KPI strip、warehouse filter、low-stock table、demand forecast line chart、category distribution bars、purchase-order queue 和 product detail drawer。使用暖色实用型风格、真实 SKU、warning/healthy 状态、响应式表格，不使用占位商品照片。',
  },
  'healthcare-appointments-dashboard': {
    title: '诊所预约看板',
    description: '协调员看板，含日程、医生可用性、check-in、房间和提醒。',
    prompt:
      '为诊所 coordinator 设计 healthcare appointments dashboard。包含 day schedule timeline、provider availability、no-show risk cards、patient check-in queue、room status grid 和 follow-up reminders。使用冷静临床配色、隐私友好的 mock 数据、清晰 status chips、可访问对比度、响应式日程行为，不出现真实患者身份信息。',
  },
  'education-analytics-dashboard': {
    title: '教育分析看板',
    description: '课程分析，含报名、参与、热力图、学生和干预建议。',
    prompt:
      '为课程管理员设计 education analytics dashboard。包含 enrollment funnel、weekly engagement chart、assignment completion heatmap、at-risk learners table、cohort filters 和 intervention suggestions。使用清晰学术风格、真实 course labels、empty/filter 状态、响应式网格，不使用 100% 或 1,234 这类泛化 round-number filler。',
  },
  'creator-analytics-dashboard': {
    title: '创作者数据看板',
    description: '创作者指标，含受众、留存、内容、收入、赞助和日历。',
    prompt:
      '为视频 newsletter 平台设计 creator analytics dashboard。包含 audience growth、retention curve、top posts table、revenue split、sponsor pipeline 和 content calendar preview。使用有表达力但易扫读的风格，创作者指标真实可信，包含 hover/selected 状态、响应式卡片布局，不使用外部缩略图。',
  },
  'board-update-deck': {
    title: '董事会更新 Deck',
    description: '六页高管更新，含 scorecard、收入、产品、风险和 asks。',
    prompt:
      '为一家 Series A SaaS 公司设计 6 页 16:9 board update deck。页面包括 title、company scorecard、revenue and pipeline、product progress、key risks、next-quarter asks。使用高管级信息密度，统一页脚和页码，图表用 SVG/CSS 构建，数字真实但可虚构，海军蓝/米白克制配色，固定 slide 比例可安全导出。',
  },
  'product-roadmap-deck': {
    title: '产品路线图 Deck',
    description: '五页规划 deck，含策略、路线图、依赖、时间线和决策点。',
    prompt:
      '为内部规划会议设计 5 页 product roadmap deck。页面包括 strategy theme、now/next/later roadmap、dependency map、launch timeline、decision asks。使用清楚 swimlanes、priority badges、设计中带简短 speaker-note 风 caption、统一 typography、16:9 布局，不使用装饰性 filler 图形。',
  },
  'workshop-deck': {
    title: 'Workshop Deck',
    description: '90 分钟 discovery workshop 的主持人 deck。',
    prompt:
      '为 90 分钟 product discovery session 设计 facilitator workshop deck。包含 title slide、agenda、ground rules、两页 exercise、break slide、synthesis wall 和 closing actions。使用温暖协作感视觉、timer/activity blocks、用 CSS 绘制 sticky-note 元素、指令清晰、16:9 比例，缩略预览也要可读。',
  },
  'research-readout-deck': {
    title: '研究汇报 Deck',
    description: '七页客户研究汇报，含 insight、friction map 和建议。',
    prompt:
      '设计 7 页 research readout deck，总结客户访谈。页面包括 study overview、participant snapshot、key insight 1、key insight 2、journey friction map、opportunity matrix、recommendations。使用证据优先的编辑风、quote callouts、简单图表、统一 source notes、16:9 导出安全布局，不使用 stock portraits。',
  },
  'sales-proposal-deck': {
    title: '销售方案 Deck',
    description: '企业销售 proposal，含问题、方案、计划、价格和 next steps。',
    prompt:
      '为一家 cybersecurity platform 面向 mid-market 客户设计 6 页 sales proposal deck。包含 cover、customer problem、proposed solution、implementation plan、pricing/package summary、next steps。使用专业企业风、account-specific placeholder fields、简单架构图、清晰 CTA、固定 16:9 比例，不使用假 logo。',
  },
  'digest-newsletter': {
    title: 'Digest Newsletter',
    description: '邮件安全周报，含更新、截止日期、tip 和偏好页脚。',
    prompt:
      '为项目管理 App 设计 weekly digest newsletter email。使用 600px 邮件安全布局，包含 header、个性化 intro、三条项目更新、upcoming deadlines 表格、product tip 和 footer preferences。结构要 table-friendly，强调元素用 inline SVG 或 CSS-safe 方式，移动端可堆叠，文案真实，不使用外部图片或脚本。',
  },
  'payment-reminder-email': {
    title: '付款提醒邮件',
    description: '礼貌 invoice reminder，含摘要、due date、CTA、表格和支持文案。',
    prompt:
      '为 invoicing 产品设计一封礼貌 payment reminder email。包含 invoice summary card、due date、amount、payment CTA、secondary support link、itemized mini-table 和 reassurance copy。逾期强调要清楚但不要制造恐慌。使用 600px table-based 布局，按钮对比度可访问，移动端间距安全，账单文案真实，不使用外部资产。',
  },
  'product-update-email': {
    title: '产品更新邮件',
    description: '功能发布邮件，含三块特性、CSS mockup 和 changelog CTA。',
    prompt:
      '设计一封 product update email，宣布三个新的协作功能。使用 600px 单列布局，包含 hero headline、release summary、三个 feature blocks、用 CSS 构成的 screenshot mockups、changelog link button 和 footer。文案保持简洁，包含 alt text 或 fallback text，兼容移动邮件客户端，避免外部托管图片。',
  },
  'mobile-banking-app': {
    title: '移动银行界面',
    description: '银行首页，含余额、快捷操作、交易和安全状态。',
    prompt:
      '在手机外框中设计 mobile banking home screen。包含 account balance card、quick actions、recent transactions、spending insight card、security status 和 bottom tab bar。展示 masked account data、收入/支出 transaction 状态、biometric prompt affordance，高对比金融 UI，触控区域充足，不使用真实银行 logo 或外部 icons。',
  },
  'food-delivery-tracker': {
    title: '外卖配送追踪',
    description: '配送状态页，含时间线、CSS 地图、ETA、订单和支持。',
    prompt:
      '在手机外框中设计 food delivery tracking screen。包含 order status timeline、用 CSS/SVG 绘制的 courier location map、ETA card、restaurant/order summary、contact/support buttons，以及带 items 的 bottom sheet。展示 active/in-transit 状态，使用温暖食品 App 配色，大触控区域，手机预览响应式，不使用外部地图或食物照片。',
  },
  'fitness-workout-builder': {
    title: '健身训练构建器',
    description: '移动训练规划，含目标、搜索、训练块和计时器。',
    prompt:
      '在手机外框中设计 mobile workout builder screen。包含 weekly goal header、exercise search、可拖拽感 workout blocks、intensity selector、rest timer chip、progress summary 和 save CTA。展示 selected 和 empty 状态，风格有能量但文字清晰，控件可访问，exercise names 真实，不使用外部健身图片。',
  },
  'ipad-magazine-reader': {
    title: 'iPad 杂志阅读器',
    description: '平板编辑阅读器，含跨页感、排版控制和收藏状态。',
    prompt:
      '为一本长文文化 publication 设计 iPad magazine reader。布局要有 tablet 横向空间和双页 spread 的感觉：cover story rail、文章卡片、阅读进度、字体/字号控制、saved/bookmarked 状态和侧边目录。这个示例要专门测试 iPad/tablet 断点、编辑排版、横向空间利用和长文可读性，不依赖外部照片。',
  },
  'watch-run-coach': {
    title: '手表跑步教练',
    description: '小屏健身界面，含配速、距离、圆环、触觉提示和短文案。',
    prompt:
      '设计一个 Apple Watch 风格的 run coach screen。极小视口里要显示当前距离、pace ring、heart-rate zone、haptic cue 状态、pause/resume 控制和一句 glanceable coaching message。优先保证等效 44px 触控目标、超短文案、强对比、圆形进度几何，并提供 reduced-motion-friendly 的脉冲动画。',
  },
  'android-wallet-screen': {
    title: 'Android 钱包界面',
    description: '交通和支付钱包，含卡片、离线/安全状态和导航。',
    prompt:
      '设计一个 Android wallet home screen，用于交通卡和支付卡。包含 stacked cards、tap-to-pay ready 状态、最近 transit rides、add-card CTA、安全提示和底部导航。使用接近 Material 的间距但不复制 Google 品牌，展示 disabled/offline 状态，触控区域大，用 inline SVG/CSS 画卡片，不使用外部 logo。',
  },
  'foldable-travel-planner': {
    title: '折叠屏旅行规划器',
    description: '双栏 itinerary/map 规划器，用于测试折叠屏布局。',
    prompt:
      '设计一个 foldable-phone travel planner，闭合和展开状态要有不同信息重点。左侧 pane 显示 itinerary summary，右侧 pane 做 map/detail planning，包含拖拽改期暗示、天气 badge、酒店/航班卡片和冲突 warning。重点测试双栏布局、hinge-safe 间距、响应式折叠和真实旅行内容，不使用外部地图。',
  },
  'vision-pro-spatial-gallery': {
    title: '空间画廊界面',
    description: 'Vision Pro 风格浮层档案界面，含选中对象和策展抽屉。',
    prompt:
      '设计一个 Vision Pro 风格的 art archive spatial gallery。展示浮动 panels、艺术品 metadata、中心 selected object、深度层次、半透明表面、手势友好的 controls 和 curator notes drawer。它仍然是 web artifact，用 CSS transforms 和 layered cards 表达空间感，不做真实 3D；包含 focus/selected 状态，避免为了玻璃效果而玻璃效果。',
  },
  'safari-product-tour': {
    title: 'Safari 产品 Tour',
    description: '浏览器壳内产品导览，含 callout、步骤和 CTA。',
    prompt:
      '为一款隐私优先 notes app 设计放在 macOS Safari browser frame 里的 product tour。包含浏览器 chrome、URL/title 区、Hero tour step、三个标注式 UI callout、步骤 dots 和最终 Start trial CTA。这个任务要测试 browser scaffold、iframe-safe 响应式布局、标注定位和具体产品文案。',
  },
  'arc-research-browser': {
    title: 'Arc 研究浏览器',
    description: '研究工作区，含侧栏 tabs、source cards、quotes 和 citations。',
    prompt:
      '设计一个 Arc-style research browser workspace，用于 analyst 对比市场报告。包含左侧 spaces/tabs、command bar、split content pane、source cards、extracted quotes 和 citation queue。展示 selected 和 empty citation 状态、快捷键提示、高密度阅读 UI，不使用热链截图。',
  },
  'terminal-release-monitor': {
    title: '终端发布监控',
    description: 'CLI 风发布看板，含阶段、日志、进度和 retry 命令。',
    prompt:
      '为开发者工具设计 terminal-style release monitor。它应该像专注的 CLI dashboard，包含 build、test、package、notarize、deploy 阶段，streaming log rows、progress bars、retry command suggestions 和最终 release summary。使用等宽层级、真实命令文本、pass/fail/warn 状态和 keyboard-first 交互提示。',
  },
  'vscode-extension-marketplace': {
    title: 'VS Code 扩展页',
    description: '编辑器外框里的扩展详情，含 tabs 和权限信息。',
    prompt:
      '为一个 AI refactoring extension 设计 VS Code extension marketplace detail screen。包含 editor chrome、activity bar、extension icon、install button、version/changelog tabs、feature list、rating breakdown、permissions notice 和 code preview panel。这个示例要测试 dev-mockup scaffold、tab 行为、高密度 metadata 和深色编辑器质感。',
  },
  'drawer-inspector': {
    title: '底部抽屉 Inspector',
    description: '画布组件 Inspector，含选中元素、token 和校验信息。',
    prompt:
      '设计一个 bottom-drawer inspector，用于在画布上选择组件后编辑属性。页面上方是 muted design canvas 和 selected element，下方 bottom sheet 包含 handle、component name、editable properties、token chips、actions 和 validation messages。展示打开/关闭状态、scrim 行为、键盘焦点和移动端安全抽屉高度。',
  },
  'toast-notification-center': {
    title: 'Toast 通知中心',
    description: '多状态临时通知，含 undo、分组、timeout 和历史抽屉。',
    prompt:
      '为项目管理 App 设计 toast notification center。展示 success、warning、error、undo 等 toast stack，包含 dismiss buttons、progress timeout bars、grouped notifications 和 compact history drawer。这个 artifact 要测试 transient UI、z-index 层级、状态颜色语义、动效时间和 reduced-motion 行为。',
  },
  'skeleton-loading-dashboard': {
    title: '看板骨架加载',
    description: 'Dashboard loading study，含 skeleton、渐进显示和 timeout error。',
    prompt:
      '为 analytics 产品设计 dashboard loading-state study。展示真实 dashboard shell，并分三阶段：metrics 加载时的 skeleton cards、chart progressive reveal、10 到 30 秒后的 timeout error card 和 Retry CTA。Skeleton 几何必须匹配最终内容形状，包含 status text，不使用 full-screen spinner，并在底部给出 final loaded preview 作为对照。',
  },
  'empty-state-library': {
    title: '空状态组件库',
    description: 'First-use、no-results、error 三类空状态，文案和动作各不相同。',
    prompt:
      '为 SaaS App 设计一个小型 empty-state library。并排展示三种变体：first-use、no-results、error。每种都要有不同 illustration、headline、body copy、primary action、必要时 secondary action，以及 accessibility-friendly status text。避免通用 “No data” 文案，每个状态要对应具体功能，例如 invoices、search 或 sync。',
  },
  'file-tree-code-review': {
    title: '文件树 Code Review',
    description: 'Review UI，含折叠文件、变更 badge、评论和 diff metadata。',
    prompt:
      '为设计工程团队设计 code review file-tree interface。包含 collapsible folders、changed-file badges、diff status colors、selected file preview、comment count chips、filter/search 和 empty filter state。这个设计要测试 file-tree scaffold、高密度文本对齐、键盘导航和 code metadata 可读性。',
  },
  'cjk-editorial-longform': {
    title: '中文长文排版',
    description: '中文长文页面，用于测试中英混排和 CJK typography。',
    prompt:
      '设计一篇中文长文阅读页面，主题是「城市空间中的界面设计」。需要体现中文排版质量：标题、副标题、作者信息、目录、正文段落、脚注、拉引、图注和相关文章。正文行高、标点挤压、中文与英文产品名混排、移动端断行都要认真处理。视觉要像中文设计杂志，不要英文模板翻译腔。',
  },
  'bilingual-event-page': {
    title: '双语活动页',
    description: '中英双语活动页，含议程、讲者、表单和混排布局。',
    prompt:
      '为上海的 design systems meetup 设计 bilingual event page。页面需要自然混合中文和英文：Hero、日期地点、议程、speaker cards、sponsor strip、registration form 和 FAQ。重点测试 CJK typography、中英混排间距、form layout、移动端换行和真实双语文案，避免机器翻译腔。',
  },
  'stripe-brand-checkout': {
    title: 'Stripe 结账设置',
    description: '品牌驱动 checkout settings，含 payout、dispute、tax 和 fee chart。',
    prompt:
      '为 marketplace seller 设计 Stripe-branded checkout settings page，如果可用请使用内置 Stripe brand reference。包含 payout account status、payment method toggles、tax settings、dispute alert、fee breakdown chart 和 test-mode banner。这个结果要测试 brand reference loading、form layout、chart rendering 和企业级金融 UI 信息密度。',
  },
  'linear-roadmap': {
    title: 'Linear 路线图看板',
    description: '品牌驱动 roadmap，含 cycles、initiatives、health 和 issue states。',
    prompt:
      '为产品团队设计 Linear-branded roadmap dashboard，如果可用请使用内置 Linear brand reference。包含 cycles、initiatives、project health、issue counts、team filters、dependency warnings 和 selected initiative drawer。这个设计要测试 brand-system inheritance、高密度 workflow UI、empty/blocked states 和克制深色 surface system。',
  },
  'notion-knowledge-base': {
    title: 'Notion 知识库',
    description: '品牌驱动 wiki 首页，含 page tree、docs、search 和 templates。',
    prompt:
      '设计一个 Notion-branded team knowledge-base page，如果可用请使用内置 Notion brand reference。包含 wiki homepage layout、page tree、recently updated docs、owner badges、search empty state、onboarding checklist 和 template gallery。输出要测试 document hierarchy、file-tree navigation、empty states 和 subtle productivity-app styling。',
  },
  'spotify-campaign-page': {
    title: 'Spotify 创作者 Campaign',
    description: '品牌驱动 recap campaign，含动态数据、图表和分享预览。',
    prompt:
      '为 end-of-year creator recap 设计 Spotify-branded campaign page，如果可用请使用内置 Spotify brand reference。包含 Hero、animated listening-stat cards、genre breakdown chart、share-card preview、artist quote 和 CTA。任务要测试 brand color discipline、animated stats、social-share surfaces 和 media-product energy，不使用外部 album art。',
  },
  'shopify-merchant-dashboard': {
    title: 'Shopify 商家看板',
    description: '品牌驱动电商运营看板，含订单、库存和 payout。',
    prompt:
      '为商家运营设计 Shopify-branded merchant operations dashboard，如果可用请使用内置 Shopify brand reference。包含 order volume、fulfillment queue、inventory risk、conversion funnel、top products table、payout card 和 selected order detail drawer。这个示例要测试 ecommerce data、brand references、chart rendering、tables 和 operational empty/error states。',
  },
  'ibm-enterprise-report': {
    title: 'IBM 企业报告',
    description: '品牌驱动 AI 治理报告，含矩阵、inventory 和 audit timeline。',
    prompt:
      '设计一个 IBM-branded enterprise AI governance report page，如果可用请使用内置 IBM brand reference。包含 executive summary、risk matrix、model inventory table、audit timeline、policy controls 和 downloadable appendix CTA。这个设计要测试 brand reference use、高密度 report composition、tables、charts 和稳重企业 typography。',
  },
  'raycast-launcher': {
    title: 'Raycast 命令启动器',
    description: '品牌驱动 launcher，含 grouped commands、快捷键、toast 和 drawer。',
    prompt:
      '设计一个 Raycast-branded command launcher，用于在设计资源之间切换；如果可用请使用内置 Raycast brand reference。包含 search input、grouped commands、keyboard shortcuts、recent actions、empty search state、执行命令后的 toast feedback 和 compact preferences drawer。这个示例要测试 cmdk、keyboard UX、toast、drawer 和品牌风格。',
  },
  'calcom-booking-flow': {
    title: 'Cal.com 预约流程',
    description: '品牌驱动 scheduling flow，含日历、时区、表单和确认状态。',
    prompt:
      '为一位 design consultant 设计 Cal.com-branded booking flow，如果可用请使用内置 Cal.com brand reference。包含 profile header、service selection、calendar availability grid、timezone selector、attendee form、confirmation state 和 reschedule/cancel links。这个示例要测试 form-layout、calendar interaction、empty time slots、移动端响应式和品牌继承。',
  },
};
