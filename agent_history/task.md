# Android 14 Compatibility & Crash Fix Tasks

- [x] Add `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_DATA_SYNC` to `app.json`
- [x] Add `POST_NOTIFICATIONS` to `app.json`
- [x] Implement runtime `POST_NOTIFICATIONS` permission request in `App.js`
- [x] Add 2-second stability delay before starting background service
- [x] Restore valid `ic_launcher` icon in `SmsBackgroundService.js`
- [x] Verify app launch and service persistence on Android 14+
