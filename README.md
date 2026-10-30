# ACA-utils

A single-source WebExtension with two independent in-page dashboards:

- IT Compliance Scorecard supported-application compliance analytics.
- ESATS supported-MO application, retirement, deletion, and lifecycle analytics with daily IndexedDB synchronization.

The build emits Chromium/Edge and Firefox variants under `dist/`.

## Build and verify

```powershell
npm run check
```

Load `dist/chromium` as an unpacked extension in Chrome or Edge. Load `dist/firefox` temporarily in Firefox, or use the packaged `.xpi` for signing/distribution workflows.

Research inputs are used during development only and are never copied into `dist/`.
