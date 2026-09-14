# Component inventory native

[English](README_EN.md)

只读读取绿色发行包的 `release.json`，并按“产品与平台、代码运行时、能力环境”探测关键组件的锁定版本和当前就绪状态。打开设置页不会下载、安装或初始化任何环境。

DSH Loader 插件清单、启用状态和 Fiber 生命周期统一由官方 `host-plugin-inventory` 与 `ui-settings-plugin-inventory` 提供，本插件不再重复投影。
