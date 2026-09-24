# Workspace artifact publish tool

[简体中文](README.md)

The 0.1.7 candidate uses the separate `/native` entry: upstream `present` registers existing files, and an adapter validates successful product image, speech, video and Office outputs before appending native durable delivery events. It does not register a duplicate `artifact_publish` tool or product file cards. Failed, cancelled and out-of-workspace outputs are excluded; nested calls wait for their outer transport to succeed. The default entry remains available to the older Runtime.

`artifact_publish` validates an existing project-relative file and returns
DSH presentation metadata so generated artifacts produced outside a structured
creation tool can still be previewed and opened from the conversation.

The tool is read-only. It neither copies nor mutates the target file.
