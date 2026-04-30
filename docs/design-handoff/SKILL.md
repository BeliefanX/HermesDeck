---
name: hermesdeck-design
description: Use this skill to generate well-branded interfaces and assets for HermesDeck (Hermes-native WebUI for power users), either for production or throwaway prototypes/mocks. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

Quick reference:
- Tokens live in `colors_and_type.css` (dark + light, semantic).
- Brand mark: `assets/brand/hermesdeck-mark.svg`.
- Iconography: lucide-react / lucide CDN. Never emoji, never unicode-as-icon.
- Surfaces are layered solids; shadows are reserved for popovers; borders are 1px hairlines.
- Voice is bilingual zh-CN + English (kickers, code), engineer-honest, no marketing tone.
- Reference UIs: `ui_kits/webui/index.html` (HermesDeck WebUI, the product itself).
