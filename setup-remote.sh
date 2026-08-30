#!/bin/bash
set -e
# Usage: ./setup-remote.sh git@github.com:USERNAME/job-hunter.git
# or: ./setup-remote.sh https://github.com/USERNAME/job-hunter.git

REMOTE_URL=${1:-""}
if [ -z "$REMOTE_URL" ]; then
  echo "Usage: ./setup-remote.sh <remote-url>"
  echo "Example SSH: git@github.com:yourname/job-hunter.git"
  echo "Example HTTPS: https://github.com/yourname/job-hunter.git"
  exit 1
fi

if ! command -v git &> /dev/null; then echo "Install git first"; exit 1; fi

if [ ! -d .git ]; then
  git init
  git branch -M main
fi

git add .
git commit -m "feat: initial job-hunter radar MVP" || echo "nothing to commit or already committed"

git remote remove origin 2>/dev/null || true
git remote add origin "$REMOTE_URL"
echo "Remote set to $REMOTE_URL"
echo "Push with: git push -u origin main"
