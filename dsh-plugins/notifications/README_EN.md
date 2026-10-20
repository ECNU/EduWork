# Plugin notifications

[中文](README.md)

Registers business sources and handles deduplication, updates, withdrawal and click routing. It shares the tray, OS notification and desktop pet presentation with Agent notifications, without requiring the pet.

EduWork loads this plugin during assembly. Business plugins optionally inject the Host `notifications` service and the client `notificationActions` service through Cordis. Without a presentation adapter, acceptance is not reported as desktop delivery.

See the [protocol and integration examples](../../docs/PLUGIN_NOTIFICATIONS.md) for fields, lifecycle, account isolation and compatibility. This service does not replace Agent approval or business storage.
