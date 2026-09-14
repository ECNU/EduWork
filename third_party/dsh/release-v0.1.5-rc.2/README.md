# DSH 0.1.5-rc.2 依赖锁

[English](README_EN.md)

`LOCK.json` 记录选定上游源码、Node/npm 版本与校验哈希。官方 npm 组件的依赖树固定在 `npm-runtime/package-lock.json`。

`DSH-CONTRACT-SNAPSHOT.json` 记录接口导出、文件和类型哈希，用于检查依赖契约。必要的编译兼容补丁只应用于临时构建目录，不修改官方源文件。保留的 rc.1 来源记录用于追溯依赖来源，不表示当前默认仍为 rc.1。

产品默认基底为 rc.2，DSH 版本与 EduWork 产品版本分别管理。Electron 为常规桌面发行，Go 为升级过渡；两壳共用产品运行时。见 [Electron 集成](../../../dsh-electron/README.md)。
