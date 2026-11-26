# Template Policy

## Built-In Templates

Built-in templates must be:

- source-neutral and free of private names, local paths, and unpublished data;
- compilable with the engine listed in `template.yaml`;
- small enough to understand and modify;
- explicit about package dependencies;
- suitable for source-grounded mathematical content.

## Using A Selected Template

Follow `SKILL.md` under **Preserve The Selected Template** when adapting a
template. The editable starter source is the basis for the deck. Preserve its
visual framework while replacing example content; changing the framework
requires a specific user request or an explicitly chosen redesign.

For example, `seminar-minimal-zh` uses `Boadilla`, `seahorse`, and `\titlepage`.
Fill in its title, author, institute, and date through the existing commands.
Keep its centered cover, title treatment, navigation, and divided footline.
A left-aligned title card with a new footer is a redesign, even when it uses
the same lavender color. Put extra introductory content on a content frame
when it does not fit the existing cover structure.

## Downloaded Templates

Downloaded templates stay in the source index until review confirms:

- redistribution license;
- institutional logo and color policy;
- no personal names, student IDs, phone numbers, or private metadata;
- no local absolute paths;
- successful smoke build;
- no hidden external downloads or shell-escape requirements.

## Institutional Templates

Institutional templates such as ECNU-themed decks may be indexed and used
locally. Do not publish them as generic built-in templates unless branding
rights are clear. Prefer a clean generic version plus a documented note that
users may add their own authorized logo.
