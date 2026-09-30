"""Upload PR screenshots to the repo's pr-media branch via the GitHub contents API.
Usage: GH_TOKEN=... python3 upload_media.py <dir> <folder-in-branch>"""
import base64, json, os, sys, urllib.request, urllib.error
REPO = "jcj59/hand-and-foot"; BRANCH = "pr-media"
token = os.environ["GH_TOKEN"]
def call(method, path, body=None):
    req = urllib.request.Request(f"https://api.github.com/repos/{REPO}/{path}", method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(req) as r: return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code in (404, 422): return {"_status": e.code, **json.load(e)}
        raise
if call("GET", f"git/ref/heads/{BRANCH}").get("_status") == 404:
    main = call("GET", "git/ref/heads/main")["object"]["sha"]
    call("POST", "git/refs", {"ref": f"refs/heads/{BRANCH}", "sha": main})
    print("created branch", BRANCH)
src, folder = sys.argv[1], sys.argv[2]
for name in sorted(os.listdir(src)):
    path = f"{folder}/{name}"
    existing = call("GET", f"contents/{path}?ref={BRANCH}")
    body = {"message": f"media: {path}", "branch": BRANCH,
            "content": base64.b64encode(open(os.path.join(src, name), "rb").read()).decode()}
    if "sha" in existing: body["sha"] = existing["sha"]
    r = call("PUT", f"contents/{path}", body)
    print(path, "ok" if "content" in r else r)
    print(f"  https://raw.githubusercontent.com/{REPO}/{BRANCH}/{path}")
