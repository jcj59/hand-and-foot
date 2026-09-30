"""Append (or replace) a '## Screenshots' section in a PR body.
Usage: GH_TOKEN=... python3 pr_media_section.py <pr-number> <markdown-file>"""
import json, os, sys, urllib.request
REPO = "jcj59/hand-and-foot"; token = os.environ["GH_TOKEN"]
def call(method, path, body=None):
    req = urllib.request.Request(f"https://api.github.com/repos/{REPO}/{path}", method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req) as r: return json.load(r)
pr, section = sys.argv[1], open(sys.argv[2]).read().strip()
body = call("GET", f"pulls/{pr}")["body"] or ""
start = body.find("## Screenshots")
if start != -1:
    end = body.find("\n## ", start + 3)
    body = body[:start] + (body[end + 1:] if end != -1 else "")
# Just after the intent, where a reviewer looks first.
at = body.find("\n## What Changed")
body = (body[:at] + "\n\n" + section + "\n" + body[at:]) if at != -1 else (body + "\n\n" + section)
call("PATCH", f"pulls/{pr}", {"body": body})
print("updated PR", pr)
