---
name: documents/technical-documentation
title: Technical documentation
when: printable technical documentation: specification, API reference, architecture note, installation guide for engineers
keywords: technical documentation, documentation technique, doc technique, specification, cahier des charges, spec, api, api reference, architecture, readme, installation guide, guide d installation, developer, developpeur, configuration, technical spec, notice technique
---
# Technical documentation

Engineers read documentation to answer a precise question fast. Make the structure predictable and the details exact.

## Decide first
- Document type: **reference** (look things up), **guide** (do a task), **explanation** (understand why). Do not mix them in one section.
- Audience level and prerequisites; state them at the top.
- Versioning: product version, document version, date.

## Build it
1. **Title block**: name, version, date, status (draft, approved), authors.
2. **Overview**: what it is, what it is not, in five lines; a diagram if the system has parts (svg/diagram).
3. **Contents** with numbered sections.
4. **Sections** with consistent shapes: for each API endpoint or component — purpose, parameters table, example, errors.
5. **Code blocks** with language labels and realistic examples.
6. **Glossary** and **change log**.

## Techniques
```css
pre, code { font-family: var(--mono); font-size: 8.8pt; }
pre { background: #f5f5f2; border: .5pt solid var(--line); padding: 3mm 4mm; border-radius: 1.5mm; white-space: pre-wrap; break-inside: avoid; }
.param td:first-child { font-family: var(--mono); white-space: nowrap; }
.note { border-left: 2.5pt solid var(--accent); padding: 1.5mm 4mm; }
.warning { border-left: 2.5pt solid #c0392b; padding: 1.5mm 4mm; }
h2 { counter-increment: h2; } h2::before { content: counter(h2) ". "; }
```
- **Parameter tables**: name (mono), type, required, default, description.
- **Admonitions**: Note / Warning / Tip, each with a word label, not only a colour.
- **Section numbers** let people refer to "§4.2".
- Keep line length short in code blocks; wrap long lines.

## Make it fit
Technical does not mean ugly: one accent for section numbers and links, a calm sans for text, mono for anything the user types. A tinted cover band in the product's colour gives identity.

## Avoid
- Code examples that do not run, placeholders like `foo`.
- Screenshots of text instead of text.
- Mixing tutorial chatter into reference tables.

## Self-check
1. Version and date on the first page?
2. Can a reader find any endpoint/component from the contents?
3. Every parameter typed and described?
4. Do examples match the parameters?
5. Warnings visually distinct and labelled?
