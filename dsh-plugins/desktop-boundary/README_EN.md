# Desktop trust boundary

[简体中文](README.md)

Receives a one-time bootstrap from the Go parent through stdin and exposes a Node Cordis service only to trusted Host plugins.

Bootstrap secrets must not enter command-line arguments, environment variables, disk files, logs or WebView state.
