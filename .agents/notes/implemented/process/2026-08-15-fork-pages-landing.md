# Agent Note: Fork project landing page on GitHub Pages

Status: implemented

English | [中文](2026-08-15-fork-pages-landing.zh.md)

## Problem

The repository's GitHub Pages workflow publishes the projected VitePress documentation directly at the site root. That makes the Pages root behave like a documentation entry point even though the fork now has its own engineering direction, roadmap, and development status that differ from upstream. Replacing the projected documentation tree with a separate site would duplicate documentation and weaken the existing `doc-sync` publication path.

## Decision

GitHub Pages keeps the existing VitePress build as the documentation publication path, and `website/fork-landing.html` becomes the fork-specific project homepage. After `pnpm run doc-sync` builds `website/.dist`, `.github/workflows/docs-pages.yml` copies the standalone landing page to `website/.dist/index.html` before uploading the Pages artifact. Existing `/guide/`, `/develop/`, `/reference/`, and English documentation routes remain VitePress output.

The landing page is a presentation asset, not a second documentation source. It summarizes the fork's current engineering principles, landed work, active workstreams, roadmap, evidence model, and links into the canonical repository documentation. It does not publish benchmark scores or imply that benchmark infrastructure proves an execution-mode ranking.

## Alternatives considered

**Replace the VitePress site with a standalone static site.** This would make the project homepage simple, but it would discard the existing projected bilingual documentation and duplicate publication infrastructure.

**Build the homepage as a custom VitePress theme.** This would keep one renderer, but it would couple a highly bespoke project landing page to the generated documentation source tree and require substantially more theme machinery for a presentation-only concern.

**Publish the landing page from a separate Pages branch or workflow.** This would create competing Pages deployment paths and make ownership of the single GitHub Pages environment less clear.

## Consequences

The Pages root can present fork-specific identity without copying canonical docs into `website/`. Documentation generation, dead-link checks, and existing routes continue to run through `doc-sync`. The workflow has one explicit post-build overlay step for the root page, so future changes to the Pages root must preserve that ordering.

The standalone landing page is not rendered by VitePress and therefore is not covered by VitePress's dead-link validation. Its internal documentation links use root-relative-to-site paths such as `./guide/` so they continue to work under the GitHub Pages repository base path. The change affects publication and presentation only; it does not change agent runtime behavior.
