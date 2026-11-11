# Kyungchan Cho's personal website

A Jekyll / GitHub Pages website focused on quantum error correction and quantum information, using the Academic Pages theme.

## Edit the site

- `_pages/about.md`: homepage and research interests.
- `_config.yml`: public profile, site metadata, and build settings.
- `_publications/`: published paper records and short summaries.
- `_data/writing.yml`: links to existing public articles.
- `_pages/writing.html`: writing index; also lists local posts when added.
- `_pages/cv.md`: education, research background, and teaching.
- `_data/navigation.yml`: main menu.
- `_sass/_personal.scss`: visual refinements.

Keep the web CV concise. Education lists degree programs at Purdue and GIST; GPAs and short-term exchange programs belong in the separate full CV PDF. Study-abroad scholarships may appear in the website's scholarship section.

The previous template's sample papers, blog posts, teaching entries, portfolio, map, and guide pages have been removed. The remaining theme files support the current site and future writing.

## Local preview

With Ruby and Bundler installed:

```sh
bundle install
bundle exec jekyll serve --config _config.yml,_config.dev.yml --host 127.0.0.1
```

For a production build and output checks:

```sh
bundle exec jekyll build --strict_front_matter
node scripts/check-site.mjs
```

The homepage lattice runs as an illustration generated in the browser. The local preview can use a separate decoder service on loopback.

## Add a blog post

Create `_posts/YYYY-MM-DD-short-title.md` with front matter:

```yaml
---
title: "A descriptive title"
date: YYYY-MM-DD
excerpt: "A short public summary."
---
```

Write the post below the front matter. Use `math: true` only for posts that need MathJax. Only already public material belongs in a post. The writing index and RSS feed update automatically.

## Publication and confidentiality

This is a public-source website. **Do not put confidential work anywhere in this repository**, including `_drafts`, front matter, HTML comments, attachments, or Git history. Keep research drafts in a separate private location. Ignoring or excluding a file from Jekyll does not make a committed file private.

`private/`, `_private/`, environment files, and local tooling are ignored as a precaution. Production settings disable drafts, future posts, and `published: false` content. These settings control output, not access to the source repository.

Use only published papers, existing public writing, verified biographical information, and explicitly approved descriptions. Never copy unpublished project names, results, figures, benchmarks, manuscripts, or local project paths into the website. See [public sources](docs/public-sources.md) for the evidence used in the initial refresh.

Building locally does not publish changes. Review the diff and generated site before pushing to the branch configured for GitHub Pages.

## Credits

Based on [Academic Pages](https://github.com/academicpages/academicpages.github.io), originally forked from [Minimal Mistakes](https://github.com/mmistakes/minimal-mistakes). The upstream MIT license is retained in `LICENSE`.
