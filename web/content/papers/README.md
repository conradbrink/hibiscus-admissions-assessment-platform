# Paper assessments: content format

One JSON file per paper, `<stage>-<subject>.json` (for example `s4-mathematics.json`),
digitised from the Cambridge Primary Progression Tests 2025 the school holds a
licence for. `node web/scripts/paper-seed.mjs` turns them into banks, passages,
questions, keys, a rubric and one template per entry stage. Images live in
`media/` beside the JSON and are served to a sitting by `/api/sit/media/<file>`.

```jsonc
{
  "code": "s4-mathematics",            // stable; ids derive from it
  "name": "Cambridge Progression · Stage 4 · Mathematics",
  "subject": "mathematics",            // subjects.code: english | mathematics | science
  "stage": 4,                          // the paper's stage
  "time_limit_minutes": 40,
  "source": "0096 Mathematics 2025 Stage 4 Paper 1",
  "passages": [                        // English only: the insert text
    { "key": "insert", "title": "What do fairy tales teach us?", "body": "…full text with line numbers kept as [5], [10]…" }
  ],
  "sections": [
    {
      "title": "Section A: Reading",
      "instructions": "Read the text, then answer the questions.",
      "items": [
        {
          "code": "S4-MA-Q1",           // paper-unique; use Q1a, Q1b for parts
          "competency": "number_sense", // competencies.code (see list below)
          "type": "short_text",         // single_choice | multi_select | numeric | short_text | matching | ordering | extended_text
          "stem": "Write the 4-digit number that is equivalent to 5000 + 300 + 20 + 8",
          "media": "s4-mathematics-q3.png",   // optional; file in media/
          "passage": "insert",          // optional; passages[].key
          "marks": 1,
          "difficulty": 2,              // 1–5: early questions 1–2, mid 3, last third 4–5
          "options": ["cuboid", "cube", "cone"],            // choice/ordering: labels in authored order
          "pairs": [["flower", "reproduction"], ["stem", "transports water"]], // matching: [left, right]
          "key": { ... },               // see per type
          "partial_credit": true,       // multi_select / matching / ordering only
          "note": "Mark scheme: 5328"   // for the marker, free text
        }
      ]
    }
  ]
}
```

Keys per type (from the mark scheme):

| type | key | notes |
|---|---|---|
| `short_text` | `{ "accepted": ["5328", "5 328"] }` | every wording the mark scheme accepts; case and punctuation are ignored by the marker |
| `numeric` | `{ "value": 300, "tolerance": 0 }` | plain numbers only; units are in the stem |
| `single_choice` | `{ "correct": "deciphered" }` | one of `options` |
| `multi_select` | `{ "correct": ["Both were written on clay", "Both needed specially trained writers"] }` | subset of `options` |
| `matching` | none: `pairs` is the key | `options` unused |
| `ordering` | none: `options` order is the key | |
| `extended_text` | none | uses the paper's writing rubric; `marks` = rubric total (25) |

A question that needs a drawing on paper (draw a shape, draw a line on a
diagram, shade squares) cannot be answered on screen: rewrite it as a
`single_choice` with plausible options **only when** the mark scheme's answer
is a single identifiable thing; otherwise leave it out and say so in the
file's `omitted` list: `"omitted": [{ "q": "10", "why": "draw four triangles" }]`.
Keep the marks of the remaining questions as printed.

Competency codes: english → `reading`, `comprehension`, `vocabulary`,
`grammar`, `written_language`; mathematics → `number_sense`, `arithmetic`,
`geometry`, `measures_data`, `patterns`, `problem_solving`; science →
`science_biology`, `science_chemistry`, `science_physics`, `science_enquiry`.
