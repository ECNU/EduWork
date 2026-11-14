# 术语库 Web 管理界面说明

实现文件：`scripts/glossary_web.py`。它是单文件 Flask 应用，内嵌完整
HTML/CSS/JavaScript 前端。

## 启动

从 `math-glossary` package 根目录运行：

```bash
python3 scripts/glossary_web.py \
  --glossary "/absolute/path/to/glossary.json"
```

可选参数：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--host` | `127.0.0.1` | 监听地址 |
| `--port` | `7788` | 监听端口 |
| `--no-browser` | false | 不自动打开系统浏览器 |
| `--allow-remote` | false | 显式允许非 loopback 地址 |

界面没有用户认证。默认只在本机使用；不要为了方便直接绑定
`0.0.0.0`。如果确需远程访问，调用者必须理解网络暴露风险并显式添加
`--allow-remote`。

## 整体架构

```text
glossary_web.py
├── configure()                 路径解析与启动前验证
├── _load_terms/_save_terms()  JSON 读取、原子写入与 Excel 刷新
├── REST API
│   ├── GET    /api/terms
│   ├── GET    /api/terms/<id>
│   ├── POST   /api/terms
│   ├── PUT    /api/terms/<id>
│   ├── DELETE /api/terms/<id>
│   ├── GET    /api/stats
│   ├── GET    /api/recent-changes
│   └── POST   /api/shutdown
├── serve_frontend()           内嵌浏览器界面
└── main()                     CLI 与本地服务器入口
```

`configure()` 从显式 `--glossary` 参数确定数据目录；`SKILL_BASE` 从脚本
安装位置推导。因此不需要复制脚本、修改源码或依赖某个客户端的安装目录。

## 数据一致性

每次写操作统一经过 `_save_terms()`：

1. 验证顶层为对象数组，且每条包含非空 `term_id`、`en`、`cn`；
2. 按 `en`、`cn` 排序；
3. 重新连续分配 `idx`；
4. 将 JSON 写入同目录临时文件并原子替换；
5. 原子生成当天的 Excel；
6. 新 Excel 成功后再删除其他日期的旧 Excel。

JSON 是唯一事实源，不要直接修改 Excel。

如果第 5 步因依赖或导出错误失败，API 仍返回成功的 JSON 写入结果，并附带
`warning: JSON 已完成，Excel 待完成`；旧 Excel 不会被删除。前端必须显示该
warning，不能把部分完成误报为三者已同步。

## 字段定制

如果将来更改 schema，需要同步审阅：

| 位置 | 责任 |
| --- | --- |
| `create_term()` | 新增记录默认字段 |
| `update_term()` | 可修改字段白名单 |
| `list_terms()` | 搜索结果字段 |
| `showDetailView()` | 详情展示字段 |
| `enterEditMode()` | 编辑字段 |
| `submitEdit()` | 前端提交字段 |
| 新增弹窗 | 新增表单字段 |

字段变化属于 schema migration，不是简单换主题。更新前应先备份用户数据并补迁移
测试。

## 搜索与界面定制

当前搜索对 `en` 和 `cn` 做前缀匹配，`#` 返回非字母开头术语。修改搜索逻辑时，
更新 `list_terms()` 和相应测试。

标题、文案、颜色和字体都位于 `serve_frontend()` 的内嵌模板中。CSS 变量包括：

```css
--accent: #b91c1c;
--accent-light: #fef2f2;
--bg: #fcfcf9;
--text: #1c1c1c;
--border: #e8e5e0;
```

暗色模式、移动端布局和减少动画分别由对应的 CSS media query 控制。

## 关闭服务

优先在启动终端按 `Ctrl+C`。页面的关闭按钮只做 Werkzeug 开发服务器的
best-effort 请求；当前运行环境不提供关闭 hook 时，界面会提示回到终端停止，不会
调用立即终止进程的底层 API。

## 依赖与验证

先只读检查：

```bash
python3 -c "import flask, openpyxl"
```

缺失时，向用户说明用途并在获得确认后安装：

```bash
python3 -m pip install -r requirements.txt
```

运行 package 测试：

```bash
python3 -m unittest discover -s tests -v
```

测试必须在临时目录中配置独立 `glossary.json`，不得指向用户正在使用的术语库。
