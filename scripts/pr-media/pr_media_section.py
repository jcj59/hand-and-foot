"""Append (or replace) a '## Screenshots' section in a PR body.
Usage: GH_TOKEN=... python3 pr_media_section.py <pr-number> <markdown-file>"""
import json, os, re, sys, urllib.request
REPO = "jcj59/hand-and-foot"; token = os.environ.get("GH_TOKEN", "")
def call(method, path, body=None):
    req = urllib.request.Request(f"https://api.github.com/repos/{REPO}/{path}", method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req) as r: return json.load(r)
def with_section(body, section):
    """The body with `section` in place of its own '## Screenshots' section, if any.
    Only a heading at the start of a line counts: the intent may mention one in prose."""
    old = re.search(r"^## Screenshots[ \t]*$", body, re.M)
    if old:
        end = re.compile(r"^## ", re.M).search(body, old.end())
        body = body[:old.start()] + (body[end.start():] if end else "")
    # Just after the intent, where a reviewer looks first.
    at = re.search(r"^## What Changed", body, re.M)
    if not at:
        return body.rstrip() + "\n\n" + section
    return body[:at.start()].rstrip() + "\n\n" + section + "\n\n" + body[at.start():]
if __name__ == "__main__":
    pr, section = sys.argv[1], open(sys.argv[2]).read().strip()
    body = call("GET", f"pulls/{pr}")["body"] or ""
    call("PATCH", f"pulls/{pr}", {"body": with_section(body, section)})
    print("updated PR", pr)
