# ACA-utils

A single-source WebExtension that embeds a supported-application compliance dashboard in the IT Compliance Scorecard. The build emits Chromium/Edge and Firefox variants under `dist/`.

## Build and verify

```powershell
npm run check
```

Load `dist/chromium` as an unpacked extension in Chrome or Edge. Load `dist/firefox` temporarily in Firefox, or use the packaged `.xpi` for signing/distribution workflows.

The research HAR and workbook remain development inputs only and are never copied into `dist/`.
