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

## Open Sans and Poppins

The school website's two faces (hibiscusschools.com), used by the parent
pages through `app/(parent)/layout.tsx`: Open Sans for reading, Poppins for
headings and buttons.

- **What**: static latin-subset WOFF2 files, one per weight:
  `open-sans-latin-{400,600,700}-normal.woff2` and
  `poppins-latin-{600,700,800}-normal.woff2`. The latin subset covers
  English, the punctuation in `U+2000-206F` and the euro sign; a letter
  outside it (ā, ł) falls back to the system face for that letter.
- **Where from**: the `@fontsource/open-sans` and `@fontsource/poppins`
  packages at 5.3.0 (Google Fonts' v24 builds), taken file for file from
  their `files/` folders. `npm pack @fontsource/open-sans@5.3.0
  @fontsource/poppins@5.3.0` fetches the same bytes.
- **Licence**: SIL Open Font License 1.1, `OFL-open-sans.txt` and
  `OFL-poppins.txt` beside them (each package's own `LICENSE`). `OFL.txt` is
  Fredoka's.

To add a weight, take that weight's latin file from the package and add it
to the `src` list in the layout. The `--font-open-sans` and `--font-poppins`
variables, and the `.theme-parent` rules in `app/globals.css` that use them,
stay as they are.

The other faces — Geist and Geist Mono in `app/layout.tsx`, the staff
console's — are still fetched from Google and carry the same risk.
