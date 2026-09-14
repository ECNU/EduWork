# ADR 0001：企业集成闭环采用单插件组合边界

**简体中文** | [English](0001-one-plugin-composition-boundary.en.md)

- 状态：已接受
- 日期：2026-08-25

## 背景

原产品实现把 OIDC 账号行为、机构目录、私有 Provider 包、桌面桥接和产品功能耦合在一起。若只发布登录部分，用户无法真正调用模型；若发布所有桌面相关内容，又会把标准绑定到 Wails 和单一机构。

## 决策

发布一个名为 `dsh-oidc` 的项目和软件包，包含：

- 标准 OIDC Web 客户端和宿主中立的 native adapter 契约；
- 固定 Key Binding 客户端；
- 一个本地、经过审查的 OpenAI-compatible DSH Provider adapter；
- 声明式 Provider/模型配置和有边界的品牌配置；
- 标准账号 UI，以及 Web/native 宿主共用、可感知宿主能力的企业模型设置界面；
- `models-only` 和 external UI 组合模式；
- 稳定的本地模型转换服务。

桌面外壳、配额、机构业务 API、搜索、图像理解实现、Skill、打包和更新继续留在本仓库之外。

Enterprise Profile 只是数据，不能选择可执行 adapter，也不能自定义 Key Binding 网络字段。

## 影响

- 普通 Web DSH 只需一个插件和一个 Profile，就能完成从企业登录到模型调用的闭环。
- 桌面产品可在宿主服务后保留更丰富的 native 操作，同时继承相同的 Provider/模型 UI。
- 原私有 Provider 包被内化，消除了未公开依赖。
- 插件职责大于通用 OIDC 登录控件，因此安全和兼容审查必须覆盖凭据及模型传输集成。
- 新增其他 Provider 协议族需要经过审查的本地代码和架构决策，不能由远程 Profile 数据启用。
