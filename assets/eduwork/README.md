# EduWork Logo

[English](README_EN.md)

`mark.svg` 是矢量母版，以折页形 E 表达资料转化为工作成果。图标使用同一轮廓的白色剪影，蓝色为默认品牌色；界面红色风格只改变底色。机构 Logo 由 `config/eduwork.jsonc` 的 `product.logoFile` 覆盖，不改变发行版应用标识。

修改母版后运行 `node scripts/build-eduwork-icons.mjs --sharp <sharp 模块入口>`，生成 PNG、Windows 多尺寸 ICO、macOS ICNS、单色托盘资源和客户端路径常量。ICNS 是图标资源，尚不表示已经支持 macOS 打包。资源随本项目 MIT 许可提供。
