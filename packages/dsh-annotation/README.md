# 选段引用与批注

[English](README_EN.md)

`@eduwork/dsh-annotation` 是一个可选的 DSH 插件：在对话中选中一段文字，点「批注」并写下批注（可选），这段原文就以引用块的形式插入输入框；发送时展开为引用原文和批注，再接上你的问题。

## 安装

在 EduWork 的「插件」页选择「添加插件」，填写 `@eduwork/dsh-annotation`，安装后启用。停用和卸载在同一页面完成。

需要兼容 DSH 0.2 API 系列（`>=0.2.0-rc.2 <0.3.0-0`）的客户端。

## 使用

1. 在对话中选中文字，点出现的「＋ 批注」按钮。
2. 写批注（可留空），点「加入输入框」或按 Enter；Shift+Enter 换行。拼音组词时，Enter 只确认候选词，结束组词后再按 Enter 加入输入框。
3. 输入框中出现引用块，点它可查看原文与批注，点击弹窗外或切换窗口自动关闭；继续输入问题后发送。

引用块随草稿保存，可与普通文字、文件引用混用。发送仍由客户端的原生流程完成，排队与插入运行中回合的行为遵循你的设置。修改批注时删除引用块后重新引用。

## 开发

```sh
node scripts/packages/manage.mjs install dsh-annotation
node scripts/packages/manage.mjs check dsh-annotation
```

许可证：MIT。
