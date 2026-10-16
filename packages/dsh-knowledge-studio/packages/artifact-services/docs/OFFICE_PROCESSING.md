# 官方 Office 工作流

[English](OFFICE_PROCESSING_EN.md)

Word、Excel 和 PowerPoint 技能保留 `artifact-documents`、`artifact-spreadsheets`、`artifact-presentations` 标识及用户开关。宿主提供官方 Office 包时，加载的是该安装版本的原始技能正文和资源目录，附加 EduWork 的工作区、旧格式和 Studio 接入说明；不会维护一份复制的官方技能。项目或用户自行覆盖的技能不被改写。

## 读取与修改旧文件

| 文件 | 读取 | 编辑前转换 | 可交付转换 |
| --- | --- | --- | --- |
| DOC / DOCX | `office_document` 的 `inspect` | DOC → 新 DOCX | DOCX、PDF |
| XLS / XLSX | `office_spreadsheet` 的 `inspect` | XLS → 新 XLSX | XLSX、PDF |
| PPT / PPTX | `office_presentation` 的 `inspect` | PPT → 新 PPTX | PPTX、PDF |

读取旧格式时，官方 LibreOffice Kit 生成临时副本，内容读取完成后清理副本；不会修改原文件或在工作区留下转换文件。需要编辑时先使用 `convert` 输出新的现代 Office 文件，再按官方技能检查和编辑。输出不覆盖原文件；Kit 不提供回存 DOC/XLS/PPT 的功能。只有真正的 OLE 旧格式受支持，HTML/RTF 改名为 DOC、加密文件及损坏文件会报告实际错误。

例如，在当前工作区内调用 `office_document`：

```json
{"action":"convert","input_path":"材料.doc","output_path":"材料-可编辑.docx"}
```

Excel 的 `recalculate` 使用官方 Kit，输入和输出均为不同的 XLSX 文件。完成后仍须检查公式及缓存值，不能把重算成功当作业务逻辑正确。

## 对话与 Studio

对话自由创建或编辑文件时，按官方技能使用已配置的 Python 库和校验脚本。原有 `office_*` 工具保留为确定性适配接口，支持已有的结构化请求和 Studio 的内容规格。它们没有变成新的 Office 引擎：现代格式的普通结构检查调用官方 `check_office.py`；旧格式转换、公式重算和 Office 转 PDF 使用官方 Kit。

Studio 的报告、表格和幻灯片仍由同一适配层生成可编辑文件、保留引用与讲者备注。PDF 从实际保存的 DOCX/XLSX/PPTX 转换，保留文件的后续编辑；转换失败直接报告，不换成 HTML 重绘。每次 PDF 导出创建独立结果，重复下载不会覆盖已有文件或复用过期结果。非 Office 成果的网页/PDF 导出不属于这一迁移。

这些接入不改变工作区权限：已有写入权限可复用，只读模式下转换输出仍需宿主批准；拒绝后不改用脚本绕过。项目相对路径及实际路径都必须留在授权工作区内，外部符号链接/目录联接被拒绝。

## 宿主接入

在宿主的同一已锁定运行时中提供 `@deepseek-ai/dsh-skill-office` 与 `@deepseek-ai/libreoffice-kit`。EduWork 使用随固定 DSH Runtime 提供的包；当前组合为 DSH `0.2.0-rc.2` 和 Kit `0.1.2`。这些是宿主可选能力，不在本包里再打包一份引擎。

`DSH_MEDIA_NODE_ENV` 可指定宿主 Node 项目目录；未指定时按本包的正常模块解析规则查找。`DSH_OFFICE_PYTHON` 指向包含所需 Office 库的 Python。Host 作为 Node 进程运行时使用自身 Node；直接嵌入 Electron/SEA 的应用须通过 `DSH_OFFICE_NODE` 指定独立 Node 可执行文件。不会搜索 PATH、下载或调用系统 LibreOffice。

没有官方包的旧宿主仍可使用原有结构化创建、编辑、检查及浏览器 PDF 导出接口，但不提供新增的旧格式读取/转换和重算。EduWork 当前 Runtime 使用官方流程；已安装的官方资源损坏或执行失败时不会静默降级。模板专用 `strict` 检查仍由产品模板验证器处理，普通外部文稿不要求品牌模板标记。

结构检查不等于版式保真验收；不承诺复杂修订、宏、动画或所有 Excel 特性的无损转换。
