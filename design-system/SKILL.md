---
name: tournament-platform-design
description: Use this skill to generate well-branded interfaces and assets for منصّة البطولات (Arabic RTL football tournament platform for kids and teens), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

Key rules for this brand:
- Everything is Arabic, RTL (`<html lang="ar" dir="rtl">`), aimed at kids/teens: fun, energetic, but readable.
- Keep the exact fields and structures from the original code (match row, standings columns, statuses) — see README "الاتجاه".
- Use the CSS tokens in `tokens/` (link `styles.css`); component classes mirror the original repo's class names.
- Icons are emoji (🏆 ⚽ 🟨 🟥 🥇), never hand-drawn SVG. No official logo — use 🏆 in a gradient tile + wordmark.
- Original source: https://github.com/ahmad-sarsor/tournament (copy from it for screens not yet covered: admin panel, predictions, knockout bracket).

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.
