# 产品组件清单服务

[English](README_EN.md)

只读读取 `assembly.json` 和 `desktop-resources.json`，探测关键组件的版本和就绪状态；兼容旧发行的 `release.json`。产品身份按当前发行读取，Electron 版本由正在运行的桌面进程传给 Node Host，不使用产品版本代替框架版本。打开「关于」页不会下载、安装或初始化任何环境。

DSH Loader 插件清单、启用状态和 Fiber 生命周期统一由官方 `host-plugin-inventory` 与 `ui-settings-plugin-inventory` 提供，本插件不再重复投影。
