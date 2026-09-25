# Fonts served from the repository

`next/font/google` downloads from Google **at build time**. On 25 September a
CI build failed with `next/font/google queries have exactly one entry` because
that fetch did not come back, and a font nobody had touched stopped the deploy.
Anything in here cannot fail to download.

## fredoka-latin-variable.woff2

The kiosk's rounded face, used through `app/(kiosk)/layout.tsx`.

- **What**: Fredoka, variable across the 300–700 weight axis, latin subset only
  — the same bytes `next/font/google` was fetching for `subsets: ["latin"]`.
- **Where from**: the `latin` `@font-face` of
  `https://fonts.googleapis.com/css2?family=Fredoka:wght@300..700&display=swap`,
  which at v17 resolves to
  `https://fonts.gstatic.com/s/fredoka/v17/X7n64b87HvSqjb_WIi2yDCRwoQ_k7367_DWu89U.woff2`.
- **Licence**: SIL Open Font License 1.1, `OFL.txt` beside it. It stays with
  the file.

To update it, fetch that CSS again with a browser user agent (Google serves
older formats to anything it does not recognise), take the URL under the
`/* latin */` comment, and replace the file. Nothing else changes: the weight
range and the `--font-story` variable are declared in the layout.

The other faces — Geist and Geist Mono in `app/layout.tsx` — are still fetched
from Google and carry the same risk.
