import { execSync } from 'node:child_process';

const pyCode = `
import urllib.request, hashlib, os

cache_dir = os.path.expanduser("~/spark/tiktoken_cache")
os.makedirs(cache_dir, exist_ok=True)

urls = [
    "https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken",
    "https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken"
]

for url in urls:
    fname = url.split("/")[-1]
    url_hash = hashlib.sha256(url.encode()).hexdigest()
    print("Downloading", fname, "hash:", url_hash)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as resp:
        content = resp.read()
    with open(os.path.join(cache_dir, fname), "wb") as f:
        f.write(content)
    with open(os.path.join(cache_dir, url_hash), "wb") as f:
        f.write(content)
    print("Saved", fname, "size:", len(content))

print("Tiktoken cache populated successfully at", cache_dir)
`;

console.log('Populating tiktoken cache on Spark host via stdin...');
const res = execSync("ssh flak3dd 'python3'", { input: pyCode, encoding: 'utf8' });
console.log(res);
