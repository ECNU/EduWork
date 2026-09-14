# 技能可用性控制

[English](README_EN.md)

在官方 `FileSystemSkillProvider` 外包装可用性策略，持久设置由同级 Host 服务管理。保留官方解析器、目录优先级、文件监听与作用域；在工作区策略之前应用 DSH 设置中的禁用技能名称。

## 能力与凭据

- 技能可声明 `metadata.eduwork.credentialRef`；兼容旧 `metadata.chatecnu` 字段。
- 机构技能还需匹配 `oidcProfileId` 与运行时 Base URL，仅存在共享 Key 不足以启用。
- `metadata.artifact.capability: image-generation` 按图像 Provider 可用性判断，与机构身份无关。
- 旧产品设置中的成果技能名称，通过共享纯函数策略映射到当前能力。

状态变化只使缓存失效，不移动技能目录。可选 Artifact Services 的 Cordis 事件、凭据 `credentials/reference-updated`（兼容 `credentials/updated`）驱动刷新；作用域销毁后忽略迟到响应。

## 装配与验证

产品集中复制技能时，Studio 应设置 `skills: false`。不支持此选项的旧 Studio 继续负责自身注册，装配器不重复复制同一套技能。

Host 测试使用真实 Cordis、DSH 0.1.5 与合成数据；可用 `CHATECNU_TEST_RUNTIME` 指定准备好的 rc.1 Runtime。技能 Provider 保持各 Agent 预设的独立作用域。
