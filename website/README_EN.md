# EduWork project website

[简体中文](README.md)

[Visit the website](https://ecnu.github.io/EduWork/)

The site introduces EduWork, its plugins, open integration and community to developers, educators and institutions. It includes Chinese/English switching, red/blue themes, product screenshots, Star history and stable Windows setup / macOS DMG downloads.

## Language selection

Use EN / 中文 in the header to switch the whole page and remember the choice in your browser. Chinese is the default. Share `?lang=en` or `?lang=zh` to open a specific language; the URL takes precedence over saved preferences. Language and theme are independent, and switching still works when local storage is blocked.

English copy lives in `language.js`; dynamic messages use the same dictionary. Keep English entries in sync when changing Chinese source copy. Documentation links follow the selected language where an English version exists. Other documents and real product screenshots remain in their original language.

## Editing and previewing

The site uses HTML, CSS and JavaScript with no build dependencies. With Node.js 24:

```sh
node --test website/community-data.test.mjs
node website/build.mjs --offline
python -m http.server 4176 --directory dist/website --bind 127.0.0.1
```

Open `http://127.0.0.1:4176/`. Without `--offline`, the build refreshes the latest stable release and Star data from GitHub. An optional read-only `GITHUB_TOKEN` may be passed through the environment; it is never written to the site.

## Deployment and data

GitHub Pages is deployed through Actions after website changes on main, completed desktop publications, a six-hour schedule or manual dispatch. Pull requests validate without deploying. Only required public files enter the deployment, excluding tools, drafts and working records.

Downloads must be uploaded Windows `setup.zip` and macOS `electron.dmg` assets from the latest stable release. Missing assets or failed metadata requests fail the deployment and leave the previous site intact. Star history uses GitHub’s public daily aggregates without retrieving user lists. Historical totals may differ from the current Star count. The page shows the snapshot date.

No adopter list or institution logos are displayed. The integration section describes capabilities and configuration. Brand icons come from `assets/eduwork/` and product screenshots from `docs/images/`; all images are hosted with the site.
