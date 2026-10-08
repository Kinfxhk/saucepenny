# Releasing Saucepenny

1. Update `CHANGELOG.md` and the version in every `package.json` and
   `packages/core/src/version.ts`.
2. Run the full checks locally and push to `main`:

```sh
npm ci
npm run check
npm run test:e2e
```

3. **Wait until CI is green on the release commit** (Linux and Windows, all jobs:
   check, e2e, docker). Do not tag before that.
4. Build the static site zip and checksum, and preview the notes:

```sh
npm run build
npm run package:site
npm run release:notes
```

5. One-time set-up before the first release: Settings → Pages → Source "GitHub
   Actions", and allow tags matching `v*` on the `github-pages` environment (release
   runs deploy from the tag).
6. Tag the commit (`git tag -a v<version> -m "Saucepenny v<version>"`), push the tag,
   and publish a GitHub release with the notes and both files from `release/`.
   Publishing the release runs the **Pages** workflow.
7. Open the live site in a fresh browser, cost a recipe with a sub-recipe, check a menu
   item's food cost % and that the footer source link points at the new tag.
8. Optional: regenerate the screenshot with a server running (`npm start`):

```sh
npm run screenshot
```
