---
name: skill-creator
description: Create or revise concise, reusable DeepSeek Harness Skills. Use when the user wants to turn repeated instructions into a SKILL.md bundle, add scripts/references/assets to a Skill, create a project-specific Skill, or prepare a personal Skill for GUI import. Do not use for Provider, MCP, model, or application settings.
---

# Create a DeepSeek Harness Skill

Create the smallest self-contained Skill that reliably handles the user's repeated workflow.

## Choose the scope

- For a project Skill, write `.dsh/skills/<skill-name>/SKILL.md` under the current project. DSH discovers it automatically.
- For a personal Skill, create a standalone draft folder such as `skill-drafts/<skill-name>/`, then tell the user to import that folder from **Settings → Plugins → Skills → Import**.
- Never write directly into the application's private `$DSH_HOME`, another agent's global directory, or the immutable bundled Skill directory.

## Build the Skill

1. Identify one or two concrete requests the Skill must handle. Ask only when a missing choice would materially change the workflow.
2. Name the Skill with lowercase letters, digits, and hyphens; keep it under 64 characters.
3. Create a folder with exactly one required `SKILL.md`. Add `scripts/`, `references/`, or `assets/` only when they provide reusable value.
4. Write YAML frontmatter containing only `name` and `description`. Put every trigger and “when to use” condition in `description`.
5. Write the body as concise imperative instructions. Assume the model already knows general facts; include only workflow, domain, tool, and quality constraints it would not know.
6. Keep references one level away from `SKILL.md`. Resolve every relative path from the Skill folder.
7. Inspect all files before reporting completion. Run representative scripts when the Skill includes deterministic code.

Use this minimal form:

```markdown
---
name: meeting-helper
description: Prepare agendas, summarize notes, and extract decisions and owners. Use for meeting preparation, minutes, follow-up lists, and action-item tracking.
---

# Handle Meeting Material

1. Read all supplied notes and attachments.
2. Separate decisions, unresolved questions, owners, and deadlines.
3. Preserve uncertain facts as explicit follow-ups.
4. Deliver a concise summary followed by an action table.
```

## Keep the package clean

- Do not add README, installation, changelog, or process-history files.
- Do not include API keys, tokens, cookies, personal paths, or private configuration.
- Do not copy dependency caches, virtual environments, `node_modules`, Git metadata, or build output.
- Do not overwrite a personal Skill with the same name. Choose a new name or let the user resolve the conflict in the GUI.
- Do not claim a Skill is active merely because files exist. Confirm it appears in the Skill center or DSH `/` menu.

## Report

State the Skill name, scope, files created, validation performed, and current status: project-active, draft-awaiting-import, or imported-and-visible.
