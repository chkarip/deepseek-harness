---
name: git-commit-helper
description: Generate conventional commits with semantic type, scope, subject, and breaking change notifications. Use when composing git commit messages, writing pull request titles, or formatting changelogs.
---

# Conventional Commit Guidelines

Follow the Conventional Commits 1.0.0 specification for all commit messages.

## Format
```
<type>(<scope>): <short summary>

[optional body explaining WHY the change was made]

[optional footer(s) for BREAKING CHANGE or issue references]
```

## Permitted Types
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools
