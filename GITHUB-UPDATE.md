# Updating github.com/ZakDarkWeb/ZHunter to v8

The repo currently holds v7.6.1 and includes `firebase-config.js` with an API key. Do this once:

## 1. Kill the key
Firebase console → project `zhunter-66d4d` → either delete the project, or Project settings → General → Web API key → restrict/regenerate. The key stays in old commits forever unless you rewrite history (step 4, optional).

## 2. Replace the code
```bash
git clone https://github.com/ZakDarkWeb/ZHunter.git
cd ZHunter
git rm -r --cached . -q            # forget everything tracked
rm -rf ./*                         # clear working tree (keeps .git)
# unzip ZHunter-v8.2.2.zip somewhere, then copy the CONTENTS of ZHunter-main/ into this folder
cp -r /path/to/ZHunter-main/. .
git add -A
git commit -m "v8.2.2: new side panel, bulk hunt rewrite, HLS→MP4, Amazon hi-res fix, dead code removed"
git tag v8.2.2
git push origin main --tags
```

## 3. Repo description
Settings → set description to: *Chrome side-panel product hunter: bulk-hunt open tabs from Amazon, Walmart, Sam's Club, Alibaba, AliExpress… → sheet + ZIP.*

## 4. (Optional) purge the key from history
```bash
pip install git-filter-repo
git filter-repo --path firebase-config.js --invert-paths
git push origin --force --all
```
Only do this if nobody else has cloned the repo; it rewrites every commit.

## 5. Releases
On GitHub → Releases → Draft new release → tag `v8.2.2` → attach `ZHunter-v8.2.2.zip` so people can download without cloning.
