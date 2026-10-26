#!/usr/bin/env bash
# push 전에 돌린다 — 회사 · 제품 흔적이 하나라도 나오면 실패
set -u
cd "$(dirname "$0")"
PAT='tinysolver|tiny-solver|tiny_solver|codepoet|k-codepoet|\.home\.|192\.168\.|100\.(71|123)\.|iam\.tinysolver|/Users/[a-z]+'
hit=0
# git 에 올라가는 파일만(.gitignore 된 .env 같은 개인 설정은 뺀다)
git ls-files -co --exclude-standard -z | grep -zv "^check-traces.sh$" | xargs -0 grep -InE -i "$PAT" && hit=1
git log --format='%an <%ae>%n%B' 2>/dev/null | grep -iE "$PAT" && hit=1
command -v exiftool >/dev/null && find . -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' \) -not -path './.git/*' -exec exiftool -q -if '$GPSLatitude or $Artist or $Make or $Software' -p '$FileName' {} \; | grep . && hit=1
[ $hit = 0 ] && echo "✓ 흔적 없음" || { echo "✗ 흔적 있음 — 위 줄을 지우고 다시"; exit 1; }
