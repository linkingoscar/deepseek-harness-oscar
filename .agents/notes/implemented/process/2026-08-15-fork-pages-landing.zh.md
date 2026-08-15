# Agent Note: Fork project landing page on GitHub Pages

Status: implemented

[English](2026-08-15-fork-pages-landing.md) | 中文

## Problem

仓库现有 GitHub Pages workflow 会把投影生成的 VitePress 文档直接发布到站点根路径。随着这个 fork 已经形成独立于 upstream 的工程方向、路线图和开发状态，Pages 根路径继续只表现为文档入口，已经不能准确表达仓库定位。若另起一套站点并替换现有投影文档，又会复制文档内容并削弱已有的 `doc-sync` 发布路径。

## Decision

GitHub Pages 继续使用现有 VitePress build 作为文档发布路径，同时由 `website/fork-landing.html` 提供 fork 专属项目主页。`.github/workflows/docs-pages.yml` 在 `pnpm run doc-sync` 生成 `website/.dist` 后、上传 Pages artifact 前，将该独立主页复制为 `website/.dist/index.html`。现有 `/guide/`、`/develop/`、`/reference/` 以及英文文档路由继续由 VitePress 输出。

这个 landing page 是 presentation asset，不是第二份文档源。它只总结 fork 当前的工程原则、已落地工作、活跃 workstream、roadmap、evidence model，并链接到仓库中的 canonical documentation。页面不发布 benchmark 分数，也不暗示 benchmark 基础设施本身可以证明某种 execution mode 更优。

## Alternatives considered

**用独立静态站完全替换 VitePress。** 项目主页会更直接，但会丢掉现有双语投影文档，并重复建设发布基础设施。

**把主页做成 VitePress custom theme。** 可以保持单一 renderer，但会把高度定制的项目展示页与生成式文档 source tree 绑定，并为了纯展示需求引入更多 theme machinery。

**通过独立 Pages branch 或第二个 workflow 发布主页。** 这会形成两个竞争同一 GitHub Pages environment 的部署路径，使发布所有权更不清晰。

## Consequences

Pages 根路径可以展示 fork 自己的定位，同时无需把 canonical docs 复制进 `website/`。文档生成、dead-link checks 与原有路由仍然由 `doc-sync` 负责。workflow 中新增一个明确的 post-build root overlay step，因此未来修改 Pages 根页时必须保持这个执行顺序。

独立 landing page 不经过 VitePress renderer，因此不受 VitePress dead-link validation 覆盖。页面内部文档链接使用 `./guide/` 这类相对站点根路径的写法，以兼容 GitHub Pages 的 repository base path。此变更只影响发布与展示，不改变 agent runtime 行为。
