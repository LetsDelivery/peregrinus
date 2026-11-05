# Skills

Skills committed here are part of the repository: clone it and they are available, with no
installation and no per-machine setup. `.claude/skills` is a symlink to this directory (on Windows it
needs `core.symlinks`). Two rules decide what belongs, the same ones the company's other repositories use.

## Every name starts with `postmano-`

A skill is resolved by name, and a name is global: a project skill, a personal one in
`~/.agents/skills/` and one from any installed plugin all land in the same list. Each repository prefixes
its skills with its own name, so none collides with another repository's or with a personal one.

The directory name and the `name:` in the frontmatter have to match.

The description matters as much as the name, because that is what a model reads to choose between
two skills. Say which repository the skill is about.

## A skill here knows something only this repository knows

The test is whether the skill would still make sense pasted into an unrelated project. If it would,
it is somebody's personal preference and belongs in `~/.agents/skills/`. What earns a place here is
the knowledge that is otherwise spread across `AGENTS.md`, `CONTEXT.md` and `docs/adr/`.

## The skills

| Skill | What it carries |
|---|---|
| [postmano-grill](postmano-grill/SKILL.md) | Grills a plan in rounds over a design tree, against this repository's own domain language, and writes `CONTEXT.md` entries and `docs/adr/` ADRs in the format the existing ones use. Use it as `/postmano-grill <what you want to grill>`. |
| [postmano-aws-skills](postmano-aws-skills/SKILL.md) | The entry point for any change to an AWS resource: `template.yml`, IAM, Cognito, Secrets Manager, DynamoDB, CloudFront. |

**`postmano-aws-skills` is the exception to the rule above, and says so.** Its generic part is only a pointer to a
public AWS skills collection, which would make sense in any project. It is here because every change in this
repository ends on AWS and the team should load the same entry point before touching it. What this repository
decided is the part that matters: it lives in `template.yml`, `docs/deploy.md` and `docs/adr/`, and wins where
general guidance disagrees.
