// Chinese is the source language. Translate text nodes without replacing markup,
// so icons, links, focus and event handlers survive a language switch.
(() => {
  const english = {
    'EduWork · 面向教育场景的开源 Agent 工作台': 'EduWork · An open-source agent workspace for education',
    'EduWork，基于 DeepSeek Harness 的教育发行版。共建面向教学、科研与办公的插件、技能和机构接入能力。': 'EduWork is an education-focused distribution of DeepSeek Harness. Build reusable plugins, skills and institutional integrations for teaching, research and everyday work.',
    '基于 DeepSeek Harness，共建面向教学、科研与办公的插件、技能和机构接入能力。': 'Built on DeepSeek Harness. Shared plugins, skills and institutional integrations for teaching, research and everyday work.',
    '跳到主要内容': 'Skip to main content',
    '主导航': 'Main navigation',
    '项目': 'Project',
    '插件生态': 'Plugins',
    '机构接入': 'Integration',
    '社区共建': 'Community',
    '网站配色': 'Site theme',
    '使用红色配色': 'Use red theme',
    '红色配色': 'Red theme',
    '红': 'Red',
    '使用蓝色配色': 'Use blue theme',
    '蓝色配色': 'Blue theme',
    '蓝': 'Blue',
    '下载': 'Download',
    '展开导航': 'Open navigation',
    '收起导航': 'Close navigation',
    '面向教育场景的': 'Built for education.',
    '开源 Agent 工作台': 'An open agent workspace.',
    '基于 DeepSeek Harness，为教学、科研与办公组织可复用的插件、技能和桌面环境。让个人能用，也让学校与机构容易接入、共同改进。': 'Reusable plugins, skills and a desktop environment for teaching, research and everyday work. Built on DeepSeek Harness, ready for individuals and open for institutions to connect and contribute.',
    '在 GitHub 参与项目': 'Join us on GitHub',
    '阅读文档': 'Read the docs',
    '复制 Git 克隆命令': 'Copy Git clone command',
    '通用能力共享，机构服务按需扩展': 'Shared capabilities. Your own integrations.',
    'DSH、EduWork 与机构发行版的关系': 'How DSH, EduWork and institutional editions fit together',
    'Agent 运行时与插件体系': 'Agent runtime and plugin system',
    '复用运行能力': 'Shared runtime',
    '公共插件 · 场景技能 · 桌面环境': 'Plugins · Skills · Desktop',
    '配置与插件扩展': 'Configuration and extensions',
    '学校与机构发行版': 'Institutional editions',
    '机构账号、模型与专属业务服务': 'Institution accounts, models and services',
    '在同一运行基础上，维护教育场景的公共组合。通用改进回到公版，机构通过配置与插件接入。': 'A shared foundation for education. Common improvements flow back to EduWork; institutions connect through configuration and plugins.',
    'DSH 提供 Agent 运行时与插件体系。EduWork 持续复用上游的会话、工具、浏览器与文件能力。': 'DSH provides the agent runtime and plugin system. EduWork builds on its conversations, tools, browser and file capabilities.',
    '通过机构配置、业务插件和场景技能形成自己的发行组合。EduWork@ECNU 是其中一个实践。': 'Combine institution settings, service plugins and skills into your own edition. EduWork@ECNU is one example.',
    'GitHub 项目概况': 'Project at a glance',
    '每一份关注，都让项目走得更远': 'Every star helps the project reach more people',
    '查看稳定版与更新记录': 'Stable releases and changelog',
    '基于 DSH，共建教育场景': 'Built on DSH, together for education',
    '在同一基础上，': 'A shared foundation.',
    '建设可复用的教育能力。': 'Built to be reused.',
    'DSH 提供 Agent 运行时与插件基础。': 'DSH provides the agent runtime and plugin foundation.',
    'EduWork 把机构接入、资料创作与教育技能组合起来，': 'EduWork brings integrations, content creation and skills together',
    '形成可直接使用、也可继续扩展的桌面发行版。': 'in a desktop distribution you can use and extend.',
    '持续复用上游': 'Build on upstream',
    '会话、工具、浏览器与文件能力优先跟随 DSH，把精力放在教育工作需要的扩展。': 'Follow DSH for conversations, tools, browsing and files, and focus our effort on extensions for education.',
    '公共能力独立维护': 'Reusable plugins',
    '机构登录、Studio、记忆等以插件组织，按兼容范围供其他 DSH 应用复用。': 'Institution login, Studio and memory are maintained as plugins, reusable by compatible DSH applications.',
    '机构服务按需接入': 'Connect your services',
    '用配置连接模型，用插件接入业务。共享通用改进，保留各自的服务与品牌。': 'Configure model access and add services through plugins. Share improvements while keeping your own services and identity.',
    '产品界面': 'Product screenshots',
    '对话工作区': 'Workspace',
    '机构模型接入': 'Institution models',
    '放大当前产品截图': 'Enlarge the current screenshot',
    'EduWork 公版对话工作区与网页成果预览': 'EduWork conversation workspace and web artifact preview',
    '查看大图': 'Enlarge image',
    '对话、工具与成果，在同一个工作区。': 'Conversations, tools and results in one workspace.',
    '复用 DSH 的 Agent 能力，围绕本机资料开展任务，预览结果并继续完善。': 'Use DSH agents to work with local materials, preview results and keep refining them.',
    '查看文档': 'Documentation',
    '资料驱动的成果创作，通过插件扩展。': 'Create from your materials. Extend through plugins.',
    'Knowledge Studio 共用对话中的创作服务，以插槽接入成果类型、预览与后续操作。': 'Knowledge Studio shares creation services with conversations and offers extension slots for artifact types, previews and follow-up actions.',
    'Knowledge Studio 成果管理与创作面板': 'Knowledge Studio artifact management and creation panel',
    '使用组织账号，发现已获授权的模型。': 'Sign in with your organization to discover available models.',
    '连接兼容的机构网关；学校模型与个人 API Key 可以同时使用，权限与配额由服务端管理。': 'Connect a compatible institutional gateway. Institution models and personal API keys can coexist, with access and quotas managed by the server.',
    'EduWork 中连接 LiteLLM 后显示获授权的模型': 'Authorized LiteLLM models shown in EduWork',
    '插件包维护文档': 'Plugin documentation',
    '随发行版提供，': 'Included with EduWork.',
    '也为独立复用而构建。': 'Built to work beyond it.',
    '插件提供能力，技能组织方法。': 'Plugins add capabilities. Skills guide the work.',
    '按自己的工作需求组合，也欢迎把新的能力贡献回来。': 'Combine what you need, and contribute what you build.',
    '筛选插件': 'Filter plugins',
    '全部插件': 'All plugins',
    '知识与内容': 'Knowledge & content',
    '桌面扩展': 'Desktop',
    '机构登录与模型接入': 'Identity & model access',
    '浏览器单点登录、模型发现与 Token 管理。支持 LiteLLM 原生 OAuth 与实验性 oidc-llm 草案。': 'Browser-based SSO, model discovery and token management. Supports native LiteLLM OAuth and the experimental oidc-llm draft.',
    '文档与源码': 'Docs & source',
    '在 npm 查看机构登录插件': 'View the identity plugin on npm',
    '围绕工作区资料创建报告、演示、测验与闪卡；通过共享成果服务与界面插槽扩展创作能力。': 'Create reports, presentations, quizzes and flashcards from workspace materials. Extend creation with shared artifact services and UI slots.',
    '在 npm 查看 Knowledge Studio': 'View Knowledge Studio on npm',
    '文献检索': 'Literature search',
    '检索 DBLP、arXiv 文献，获取 BibTeX 与可用全文。接续社区实现，逐步拓展研究资料来源。': 'Search DBLP and arXiv, retrieve BibTeX and available full text. Builds on community work to expand research sources.',
    '在 npm 查看文献检索插件': 'View the literature plugin on npm',
    '本地记忆': 'Local memory',
    '管理本地记忆、检索历史对话，让后续任务接得上已有背景。数据与记忆在本机管理。': 'Manage local memory and search past conversations so new tasks can pick up the context. Data and memories stay on your machine.',
    '在 npm 查看本地记忆插件': 'View the memory plugin on npm',
    '邮件助手': 'Mail assistant',
    '通过 IMAP 读取邮件，经授权通过 SMTP 发送，让日常沟通接入同一套工作流程。': 'Read mail over IMAP and send through SMTP with authorization, bringing everyday communication into the same workflow.',
    '在 npm 查看邮件助手插件': 'View the mail plugin on npm',
    '桌面宠物': 'Desktop pet',
    '共用 Agent 任务与通知状态，提供多形象桌面展示。独立 npm 插件，需要 EduWork 桌面桥接。': 'An on-screen companion with multiple characters, sharing agent task and notification state. A standalone npm plugin that requires the EduWork desktop bridge.',
    '在 npm 查看桌面宠物插件': 'View the desktop pet plugin on npm',
    '展示 {count} 个插件 · 具体运行条件与兼容范围见各插件文档': 'Showing {count} plugins · See each plugin’s documentation for requirements and compatibility',
    '发现了好用的技能或 DSH 插件？': 'Found a useful skill or DSH plugin?',
    '推荐 Skills': 'Suggest a skill',
    '推荐 DSH 插件': 'Suggest a plugin',
    '发行版与扩展边界': 'Editions & extensions',
    '连接你们的服务，': 'Your services.',
    '共享我们的积累。': 'Our shared foundation.',
    '机构可以从公共发行版出发，连接已有模型平台，追加校内服务插件与专用技能，保留自己的品牌和更新渠道。': 'Start from the public edition, connect your model platform and add institution-specific plugins and skills, with your own branding and update channels.',
    '只需模型接入时，通过配置即可开始；需要专属业务能力时，再增加对应插件。': 'Configuration is enough for model access. Add plugins when you need services specific to your institution.',
    '从配置示例开始': 'Explore configuration examples',
    '已有 LiteLLM': 'Already using LiteLLM?',
    '复用原生 OAuth、组织授权与模型目录。': 'Use native OAuth, organization access and model discovery.',
    '自建模型平台': 'Running your own gateway?',
    '参与 oidc-llm 草案讨论，推进多客户端互通。': 'Join the oidc-llm draft discussion on client interoperability.',
    '需要机构发行版': 'Building an institutional edition?',
    '参考 EduWork@ECNU 的配置、插件与服务组合。': 'Explore the configuration, plugins and services in EduWork@ECNU.',
    '下一步，一起决定。': 'Shape what comes next.',
    '具体需求在 Issue 中展开，方案通过讨论和原型逐步完善。': 'Explore needs in issues and refine ideas through discussion and prototypes.',
    '日历与多来源数据': 'Calendar & data sources',
    '统一事件模型，允许插件填充数据，并保留个人备注。': 'A shared event model for plugin-supplied data and personal notes.',
    '方案评审': 'Design review',
    '开放远程接入': 'Open remote access',
    '独立插件、Web 客户端与可自托管中继，延续本机会话。': 'Continue local sessions through a plugin, web client and self-hosted relay.',
    '原型推进': 'Prototyping',
    '备份恢复与迁移': 'Backup, restore & migration',
    '梳理个人数据范围，评估 EduWork 与 DSH 双向迁移。': 'Define the scope of personal data and explore migration between EduWork and DSH.',
    '原型准备': 'Planning a prototype',
    'VeryMath 插件接入': 'VeryMath integration',
    '探索数学论文阅读、工具调用与研究工作流。': 'Explore mathematics papers, tool use and research workflows.',
    '欢迎认领': 'Help wanted',
    'GitHub 公开数据': 'Public GitHub data',
    '项目的成长，': 'Built by a community.',
    '来自每一位参与者。': 'Better with you.',
    '一份关注、一次讨论、一项改进。': 'A star, a discussion, a contribution.',
    '让教育场景里的共同需求，成为可以共享的成果。': 'Turn shared needs in education into work everyone can build on.',
    'Star 趋势': 'Star history',
    'Star 图表时间范围': 'Star chart time range',
    '全部': 'All time',
    '近 14 天': '14 days',
    '查看 Star 用户': 'View stargazers',
    '正在读取项目数据…': 'Loading project data…',
    '按 GitHub 每日 Star 历史汇总': 'Based on GitHub daily Star history',
    '一起建设 EduWork': 'Build EduWork together',
    '从一个实际需求开始，也可以贡献代码、文档与使用经验。': 'Start with a real need, or contribute code, documentation and practical experience.',
    '提出需求与建议': 'Share a need or idea',
    '分享你的场景，让改进有真实的起点。': 'Ground the next improvement in your experience.',
    '参与代码与文档': 'Contribute code & docs',
    '了解贡献方式，认领适合自己的任务。': 'Find out how to contribute and pick a task.',
    '共建 Roadmap': 'Shape the roadmap',
    '一起讨论下一步的功能与架构方向。': 'Discuss future features and architecture together.',
    '数据来源与统计口径': 'Data sources and methodology',
    'Star 与版本来自 GitHub 公开接口，页面显示本次更新的数据快照。Star 曲线按 GitHub 提供的每日统计累计，可能与当前 Star 总数存在差异。Roadmap 摘要来自项目 Issue，最新讨论请查看原帖。': 'Stars and releases come from the public GitHub API. This page shows a snapshot from the latest update. The chart accumulates GitHub’s daily Star counts, which may differ from the current total. Roadmap summaries come from project issues; follow the links for the latest discussion.',
    '把你的使用场景，带进下一次改进。': 'Bring your needs to the next improvement.',
    '欢迎分享需求、推荐技能与插件，或直接参与代码和文档贡献。': 'Share ideas, recommend skills and plugins, or contribute code and documentation.',
    '发起讨论': 'Start a discussion',
    '开放的教育 Agent 工作台。': 'An open agent workspace for education.',
    '基于': 'Built on',
    '构建 · MIT License': '· MIT License',
    '版本记录': 'Releases',
    '开始使用': 'Get started',
    '使用指南': 'User guide',
    '源码构建': 'Build from source',
    '配置与接入': 'Configuration',
    '社区与实践': 'Community',
    '贡献指南': 'Contributing',
    '讨论与反馈': 'Issues & feedback',
    '开放源码 · 共同建设': 'Open source · Built together',
    '产品截图大图': 'Product screenshot viewer',
    '关闭大图': 'Close image viewer',
    '关闭下载窗口': 'Close downloads',
    '下载 EduWork': 'Download EduWork',
    '稳定版': 'Stable release',
    '开源桌面客户端，连接你选择的模型服务。': 'An open-source desktop client for the model services you choose.',
    'setup.zip 安装包': 'setup.zip installer',
    '查看最新 Release': 'View latest release',
    '公版不附带模型额度。首次使用请配置个人模型服务，或连接兼容的机构账号。': 'The public edition does not include model credits. Configure your own model service or connect a compatible institution account to get started.',
    '发布说明 ↗': 'Release notes ↗',
    '使用指南 ↗': 'User guide ↗',
    '已复制克隆命令': 'Clone command copied',
    '请选中上方命令复制': 'Select and copy the command above',
    '暂无历史数据': 'No history available',
    'Star 累计趋势：{start} 至 {end}，当前 {count} 个 Star。': 'Cumulative Star history: {start} to {end}. Currently {count} Stars.',
    'GitHub 数据 · {date}': 'GitHub data · {date}',
    '数据暂不可用，请查看 GitHub': 'Data unavailable. Please check GitHub.',
    '暂时无法读取趋势数据。': 'Star history is temporarily unavailable.'
  };
  const root = document.documentElement;
  const valid = value => value === 'en' || value === 'zh';
  let language = 'zh';
  try { const saved = localStorage.getItem('eduwork-site-language'); if (valid(saved)) language = saved; } catch {}
  const requested = new URLSearchParams(location.search).get('lang');
  if (valid(requested)) language = requested;

  function text(source, values = {}) {
    const translated = language === 'en' ? (english[source] ?? source) : source;
    return translated.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
  }
  const repo = 'https://github.com/ECNU/EduWork';
  const docs = {
    [`${repo}#详细文档`]: `${repo}/blob/main/README_EN.md`,
    [`${repo}/blob/main/docs/PACKAGES.md`]: `${repo}/blob/main/docs/PACKAGES_EN.md`,
    [`${repo}/blob/main/docs/CONFIGURATION.md`]: `${repo}/blob/main/docs/CONFIGURATION_EN.md`,
    [`${repo}/tree/main/config/desktop/examples`]: `${repo}/blob/main/config/desktop/examples/README_EN.md`
  };
  for (const plugin of ['dsh-oidc', 'dsh-knowledge-studio', 'dsh-literature', 'dsh-memory', 'dsh-mail', 'dsh-desktop-pet']) {
    docs[`${repo}/tree/main/packages/${plugin}`] = `${repo}/blob/main/packages/${plugin}/README_EN.md`;
  }
  for (const guide of ['litellm-setup', 'oidc-llm-draft']) {
    docs[`${repo}/blob/main/packages/dsh-oidc/docs/gateway-auth/${guide}.md`] = `${repo}/blob/main/packages/dsh-oidc/docs/gateway-auth/${guide}.en.md`;
  }
  const link = source => language === 'en' ? (docs[source] ?? source) : source;
  // Dynamic regions are rendered by project.js, using the current application state.
  const dynamic = '[data-stat],#layer-description,#showcase-image,#showcase-title,#showcase-description,#plugin-count,#copy-status,#data-date,#star-chart,#windows-size,#mac-size,#lightbox-image,#lightbox-caption,#language-toggle,.menu-toggle';
  const bindings = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement.closest(`script,style,code,${dynamic}`)) continue;
    const source = node.nodeValue;
    if (english[source.trim()]) bindings.push(() => { node.nodeValue = source.replace(source.trim(), text(source.trim())); });
  }
  document.querySelectorAll('[aria-label],[title],[alt]').forEach(element => {
    if (element.matches(dynamic)) return;
    for (const attribute of ['aria-label', 'title', 'alt']) {
      const source = element.getAttribute(attribute);
      if (source && english[source]) bindings.push(() => element.setAttribute(attribute, text(source)));
    }
  });
  document.querySelectorAll('a[href]').forEach(element => {
    if (element.matches(dynamic) || element.id === 'showcase-doc') return;
    const source = element.getAttribute('href');
    if (docs[source]) bindings.push(() => { element.href = link(source); });
  });
  const title = document.title;
  document.querySelectorAll('meta[name="description"],meta[property="og:title"],meta[property="og:description"]').forEach(element => {
    const source = element.content;
    bindings.push(() => { element.content = text(source); });
  });
  function apply(value, persist = false) {
    language = valid(value) ? value : 'zh';
    root.lang = language === 'en' ? 'en' : 'zh-CN';
    document.title = text(title);
    bindings.forEach(update => update());
    const button = document.querySelector('#language-toggle');
    button.textContent = language === 'en' ? '中文' : 'EN';
    button.lang = language === 'en' ? 'zh-CN' : 'en';
    button.setAttribute('aria-label', language === 'en' ? '切换到中文' : 'Switch to English');
    if (persist) {
      try { localStorage.setItem('eduwork-site-language', language); } catch {}
      const url = new URL(location.href);
      url.searchParams.set('lang', language);
      history.replaceState(null, '', url);
    }
    window.dispatchEvent(new Event('eduwork-language-change'));
  }
  window.EduWorkLocale = { text, link, get language() { return language; } };
  document.querySelector('#language-toggle').addEventListener('click', () => apply(language === 'en' ? 'zh' : 'en', true));
  // A language-specific shared URL wins over preferences from other tabs.
  window.addEventListener('storage', event => {
    if (event.key === 'eduwork-site-language' && !valid(new URLSearchParams(location.search).get('lang'))) apply(event.newValue);
  });
  apply(language);
})();
