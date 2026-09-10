import { execSync } from 'node:child_process';

const pyCode = `
with open('/home/flak3dd/spark/serving_patch.py', 'r') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'use_harmony' in line or 'harmony' in line.lower():
        print(f"{i+1}: {line.rstrip()}")
        for j in range(max(0, i-5), min(len(lines), i+15)):
            print(f"  {j+1}: {lines[j].rstrip()}")
        print("="*60)
`;

try {
  const res = execSync("ssh flak3dd 'python3'", { input: pyCode, encoding: 'utf8' });
  console.log(res);
} catch (e) {
  console.error(e.message);
}
