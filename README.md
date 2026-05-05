# Properties Filename

Obsidian plugin that automatically renames notes based on frontmatter properties.

When a note's properties change (e.g. `nom` and `prenom`), the file is renamed to match a configurable template (e.g. `{{nom}} {{prenom}}`). Wikilinks pointing to the file are updated automatically by Obsidian's rename API.

## Use case

You maintain a folder of contact/patient/client notes where the canonical identifier is built from properties — first name + last name, project code + title, etc. Editing the property updates the filename without manual renames.

## Configuration

Each rule has:

- **Folder** — folder path the rule applies to (e.g. `Patients`). Subfolders included.
- **Template** — filename template using `{{property}}` placeholders. Example: `{{nom}} {{prenom}}`
- **Require type** *(optional)* — only rename if frontmatter `type` matches this value (e.g. `patient`).

A rename only fires when:

- All referenced properties are present and non-empty
- The new name differs from the current filename
- No other file already exists at the target path

## Commands

- **Properties Filename: Rename current file from properties** — manual trigger for the active note.
- **Properties Filename: Rename all matching files in vault** — bulk pass over every file matching a rule.

## Auto-rename

Auto-rename on property change is **off by default**. Enable it in settings if you want files to rename live as you type (debounced 800ms).

## Install (manual)

1. Download `main.js`, `manifest.json`, `styles.css` from the latest release
2. Drop into `<vault>/.obsidian/plugins/properties-filename/`
3. Enable in Settings → Community plugins

## Install via BRAT (beta)

Add `gilles6/properties-filename` in the BRAT plugin.

## Development

```sh
npm install
npm run dev      # esbuild watch mode
npm run build    # production build
npm run lint     # check Obsidian plugin guidelines (eslint-plugin-obsidianmd)
npm run deploy   # build + copy artifacts into the local test vault
```

`npm run lint` runs the same checks that the ObsidianReviewBot performs on submission — handy to catch issues (sentence-case UI text, inline styles, unsafe API usage, etc.) before pushing a release.

## License

MIT
