$ErrorActionPreference = "Stop"
& git add -A
& git "commit" "-F" ".git/COMMIT_EDITMSG_TMP"
& git push origin main
& git log --oneline -3
