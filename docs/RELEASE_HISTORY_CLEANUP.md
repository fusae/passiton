# Release History Cleanup Plan

This repository has historical commits that may contain personal local paths. Do not rewrite history in a working public repository without an explicit release decision.

## Option A: Rewrite Existing Repository History

Use this only before public release, after every maintainer has backed up local work and agreed to re-clone.

```bash
git clone --mirror <repo-url> turing-cleanup.git
cd turing-cleanup.git

git filter-repo \
  --replace-text <(cat <<'EOF'
/Users/jamesyu/.local/bin/dreamina==>dreamina
/Users/jamesyu/.agents/skills/baoyu-danger-gemini-web/scripts/main.ts==><path-to-gemini-web-script>
EOF
)

git grep -n '/Users/jamesyu' $(git rev-list --all) -- . || true
git remote set-url origin <final-repo-url>
git push --force --all origin
git push --force --tags origin
```

After force-push, all contributors must re-clone or hard-reset their local copies.

## Option B: New Public Repository With Squashed Baseline

Use this when preserving private development history is not required for the public release.

```bash
git clone <current-private-repo-url> turing-public
cd turing-public
rm -rf .git
git init
git add .
git commit -m "Initial public release"
git branch -M main
git remote add origin <final-repo-url>
git push -u origin main
```

Before publishing, run:

```bash
git grep -n 'MIT\\|/Users/jamesyu\\|github.com/jamesyu/turing\\|github.com/fusae/turing' -- . || true
git grep -n 'Access-Control-Allow-Origin.*\\*' -- src Dockerfile README.md CHANGELOG.md docs || true
npm run typecheck
npm test
npm run build
```
