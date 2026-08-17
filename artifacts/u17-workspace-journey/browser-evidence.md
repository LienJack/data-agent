# U17 Browser Evidence

- Workspace: `9e0ed5ae-7ab6-4896-b7eb-868e202f3725`
- Browser: Chromium through `agent-browser`
- Desktop: 1440 x 1000, no document horizontal overflow
- Mobile: 390 x 844, no document horizontal overflow
- Locale: Chinese to English and English to Chinese changed display state without changing the full URL
- Keyboard: native Context Preview `summary` toggled closed/open with Enter; locale segmented button changed locale with Enter
- Context Preview: governed POST reached the Workspace route and rendered the stable `RESOLVED_CONTEXT_DEFAULTS_INCOMPLETE` error instead of a false empty/success state
- Agent process: reasoning and `text2sql.execute` were visible, both started collapsed, hidden detail payload was absent from document text, and keyboard expansion revealed only the public projection
- Console: no application runtime error; development-only React/Next notices only

## Screenshots

- `desktop-home-zh.png`: `sha256:be042e6cd590dc1411f1328068b34a6cd787f7d4db6f0b741b009d57b4e1f87d`
- `desktop-home-en.png`: `sha256:d4191be21771989e14f2c95e59861f9de36cba52f78e4b05b98ad6c3b5a9600b`
- `desktop-agent-sse-disclosure.png`: `sha256:5125f1fdcd960e2e97b27442bdd0aafc41927386920fc7c8df22f3a604a04beb`
- `mobile-semantic-en.png`: `sha256:aa8f70063c09b0b024e63fdc839e878c0938601932263bee03c2254f3ac0ee9d`
- `mobile-context-preview-en.png`: `sha256:1102868a064405a684b22c8acc1ac8c2357c810cd2d57310f5cef9b92ae4e7cd`

This evidence is a Goal/CI artifact, not a product Authority Receipt. Falcon was not imported or executed.

Verified artifact hash: `sha256:8bcd99d1bf6f244b5f945901942d21f78ad4c372e3df4eae9e64b01185cb162f`.
