# Third-Party Notices

Reddix is distributed under the [MIT License](LICENSE). It bundles or depends on
the third-party packages listed below. Each remains under its own license; full
license texts ship inside each package's directory under `node_modules/`.

This file covers **runtime (production) dependencies**. Build- and test-time
`devDependencies` are not distributed with the application and are omitted.

| Package | Version | License | Project |
|---------|---------|---------|---------|
| cors | 2.8.x | MIT | https://github.com/expressjs/cors |
| express | 5.x | MIT | https://expressjs.com/ |
| lucide-react | 0.468.x | ISC | https://lucide.dev |
| nanoid | 5.x | MIT | https://github.com/ai/nanoid |
| react | 18.3.x | MIT | https://react.dev/ |
| react-dom | 18.3.x | MIT | https://react.dev/ |
| zod | 3.x | MIT | https://zod.dev |

To regenerate the underlying license inventory across the full dependency tree:

```bash
npx license-checker --production --summary
```

All listed licenses are permissive (MIT / ISC) and compatible with Reddix's MIT
license.
