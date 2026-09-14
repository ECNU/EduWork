# DSH 原生凭据服务

[English](README_EN.md)

DSH `CredentialProvider` 的桌面原生实现。`set/resolve/describe/unset` 通过只在进程内可见的、逐次启动认证的 Native Bridge 调用 Windows Credential Manager；不创建 `.credentials.yaml`。
