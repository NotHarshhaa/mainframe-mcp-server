# GitHub Pages site

Static documentation site for **mainframe-mcp-server**, deployed to GitHub Pages.

## Live site

After enabling Pages (see below):

**https://notharshhaa.github.io/mainframe-mcp-server/**

## Contents

| File | Purpose |
|------|---------|
| `index.html` | Landing page — features, tools, setup, enterprise |
| `assets/styles.css` | Site styles (light + dark themes) |
| `assets/theme.js` | Light / dark theme toggle (persists in localStorage) |
| `assets/banner.png` | Hero banner |
| `.nojekyll` | Disable Jekyll processing |

Markdown references (`configuration.md`, `deployment.md`, `tools-reference.md`) remain in this folder for the GitHub repo; the website links to them on GitHub.

## Enable GitHub Pages (one-time)

1. Open **Settings → Pages** on the repository.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `master` (or run the **Deploy GitHub Pages** workflow manually).

The workflow [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) uploads this `docs/` folder on each push.

## Local preview

Open `index.html` in a browser, or serve the folder:

```bash
npx --yes serve docs
# visit http://localhost:3000
```

Use relative paths — do not open from `file://` if testing asset links across browsers.
