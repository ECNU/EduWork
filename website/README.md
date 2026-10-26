# EduWork 项目官网

[English](README_EN.md)

[访问官网](https://ecnu.github.io/EduWork/)

面向开发者、教育工作者和机构介绍 EduWork 的项目定位、插件生态、开放接入与社区协作。提供中／英文切换、红／蓝配色、产品截图、Star 趋势，以及 Windows 安装包和 macOS DMG 的稳定版下载入口。

## 语言切换

顶部 EN／中文按钮切换整页文案，并记住浏览器中的选择。默认中文，也可用 `?lang=en` 或 `?lang=zh` 分享指定语言；URL 优先于已保存的偏好。语言与配色独立，禁用本地存储时仍可切换。

页面英文文案在 `language.js`，动态提示通过同一字典渲染；插件介绍来自下述共享目录。修改中文源文案时同步英文。已有英文版本的文档入口随语言切换；其余文档及真实产品截图保留原样。

## README 与官网共用的插件介绍

[`docs/plugin-catalog.json`](../docs/plugin-catalog.json) 维护中英文名称、简介、分类与 GitHub 文档入口。它是展示目录，预装范围由公版实际 npm 装配输入校验，不按仓库里存在的插件源码判断。Studio 与配套成果服务合并介绍；`companions` 记录这种配套关系。

修改目录后运行 `node scripts/sync-project-docs.mjs`，更新两份根 README 和 `index.html` 的标记区块。不要直接编辑生成区；区块之外的安装说明、官网布局各自维护。插件详情仍链接已有 GitHub 文档，Roadmap 只保留讨论入口。

CI 与官网构建会检查目录是否覆盖当前装配包、是否误列未预装包、中英文文档是否存在、生成内容是否同步。变更装配范围时须同步目录；新功能须按正式发行范围决定何时对外介绍。

## 修改与预览

页面使用原生 HTML、CSS 和 JavaScript，无构建依赖。使用 Node.js 24：

```sh
node --test website/community-data.test.mjs
node --test scripts/project-plugin-catalog.test.mjs
node scripts/sync-project-docs.mjs --check
node website/build.mjs --offline
python -m http.server 4176 --directory dist/website --bind 127.0.0.1
```

访问 `http://127.0.0.1:4176/`。移除 `--offline` 会在构建时从 GitHub 读取最新稳定版和 Star 数据；可通过 `GITHUB_TOKEN` 环境变量提供只读凭证。凭证不会写入页面。

## 发布与数据

GitHub Pages 使用 Actions 发布。主分支的官网变更、桌面发布完成、每六小时的定时任务或手动运行会重新构建；PR 只校验，不部署。部署目录只包含页面必需文件，不包含源码工具、草稿或工作记录。

下载仅选择最新稳定版中已经上传完成的 Windows `setup.zip` 和 macOS `electron.dmg`。缺少其中任一附件或数据读取失败时，本次部署失败，线上保留此前版本。Star 曲线使用 GitHub 的公开每日历史汇总，不读取用户名单；历史累计可能与当前 Star 总数存在差异，页面展示数据日期。

官网不展示使用机构名单或标识。机构接入部分介绍能力和配置方式。品牌图标来自仓库 `assets/eduwork/`，产品截图来自 `docs/images/`；全部图片随页面本地发布。
