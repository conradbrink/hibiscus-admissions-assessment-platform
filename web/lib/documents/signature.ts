/**
 * The signature that goes above the CEO's name on a letter.
 *
 * Embedded rather than served, and that is the whole point of this file.
 * `logoUrlFor` (`./letterhead.tsx`) builds a public URL — right for a logo,
 * wrong for a person's signature, because anyone who guesses
 * `/brand/signature-brink.png` would have a clean copy of it. A data URI
 * exists only inside a rendered PDF and has no address of its own.
 *
 * It still sits in the repository, which is private. That is the trade, and
 * it is written down here so the next person weighing it can see the choice
 * rather than inherit it.
 *
 * The supplied scan was an opaque white box with grey ink. The white is keyed
 * out by ink density rather than a threshold — alpha runs from the paper
 * (luminance 235) to the darkest stroke (60) — so the edges keep their
 * antialiasing instead of turning into stair-steps, and the stroke reaches
 * full black rather than the 83% a plain inversion would have left it.
 *
 * 202x156. At the ~110pt it is drawn, a little over its natural size; fine
 * for a signature, and worth replacing if a higher-resolution scan appears.
 */
export const SIGNATURE_BRINK =
  "data:image/png;base64," +
  "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" +
  "ya5gst9N8bnZ4oo3WzSmzLOta8QlA14Rl2bxj6dRLkvPpyWzpWzOnq8T1+atnv/3Fig3IVha+E7z89S0XSUPwtMjs3DWn0Yo" +
  "qS9pnXmb0fYTAlvnX9ptQotUSvquvlP5zG3pXhTPyqi2eDZ2q7iibX450Hok5+g8Pf8cQB63MeoPMOstfu7spfldIa64g187" +
  "Wf2iXM7Ma5h4PYLJT72x+sbrA2vnj0ag4gvRDpl2yiey6F3izsTXoFXOMqzEUZc8nI37j7iwa74ama7mmQpjaqqpaDcr3bMr" +
  "z37TcHGdxqy4QxPPqmZYtr1e1M/5EbO3QrpXvTGtrdr9sIRqj3kjzU2yDbhSSd/eQWkp0vC+55gX47t8hZS2o8S1KRbRThDW" +
  "S7y+5+loJgGI8xKvBM/zPMMNGPhQHrWcEK06I64Os50XWZlFoEA//wHm4X5xeWbWNtuf3y58oGPSu5ujQ4p+Q6qqZDoqPVdo" +
  "VH/lFwBgVdmvi+vC5NNrSLvLSOquJBPMmgVZ+2e9/muiO9nuq0zExNlFECFK1UP9rn1I+ybePx/pKCPQJCXiqsPbfsj0mPd6" +
  "grnZicN/RdyBOKv/XOMJpDZxHcpWSn77xwxZUuY6zkSfk9TFE8YQQTmGCdHkmV1N+DXJR3hfx2cwZ75VXFqILqa1du4ESNbV" +
  "qwRpuZ4IXDZmkO7rbIFRMx3dHQUDmt+wT/ITEp6HdrP6XXVEsl6NCRDNCNjG2tR7fuA15usAwmuNZxUc5zrVjI8HFs+P1FsH" +
  "85fDJG+lANIuPlMrrtKglQKyqM3iFIxyDgDWs4DWZ8U0yz3+bUd1rbpjA1KyGDNqOeZZVEk/HM2yVzI36xkGA7ejHdUMy7Xl" +
  "nRX8ts5hytgHY0blZrIexWh669TVhlDZhSDxtcWHzNcfeTYfhzx9hYquxAlOjnJNh3GqxfUgqQccbTBBEyDyWzTogaU94vK5" +
  "imHa3UjZLg8oXWgWq4Vr/7de5lYP7DzX615NlM20z9FOf0nm1gg7xPUE0WfNth/IfwHdZS+61Ygmfjmi4Pqc57nAfLeKK153" +
  "kTlIl83wFtrlewnNf/JCj4vrSX4phcTTAgwnYHYzjc6g1gtYNDMDKrG9ZwGSpeJSMgowDV5m4Q4ACANJI86t9aa/6jm+1sbB" +
  "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";

/** Who it belongs to, so a letter cannot sign the wrong name under it. */
export const SIGNATURE_BRINK_NAME = "Roelien Brink";
export const SIGNATURE_BRINK_TITLE = "C.E.O., Hibiscus Schools";
