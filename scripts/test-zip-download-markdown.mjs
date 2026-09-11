import assert from 'assert';
import { detectFilenameAndContent, extractFilesFromMarkdown } from '../src/lib/zipDownload.ts';

console.log('--- Testing Markdown File Extraction and ZIP Helpers ---');

// Test 1: First line comment // path/to/file
const code1 = `// ai-pentest/requirements.txt
nmap>=0.7.0
pyyaml>=6.0`;
const res1 = detectFilenameAndContent(code1, 'diff', 0);
assert.strictEqual(res1.filename, 'ai-pentest/requirements.txt');
assert.strictEqual(res1.cleanContent, 'nmap>=0.7.0\npyyaml>=6.0');
console.log('✔ Test 1 passed: // path/to/file comment detection');

// Test 2: Python shebang + comment
const code2 = `#!/usr/bin/env python3
# ai-pentest/core/engine.py
import subprocess
print("Running")`;
const res2 = detectFilenameAndContent(code2, 'python', 1);
assert.strictEqual(res2.filename, 'ai-pentest/core/engine.py');
assert.strictEqual(res2.cleanContent, '#!/usr/bin/env python3\nimport subprocess\nprint("Running")');
console.log('✔ Test 2 passed: Shebang + # path/to/file detection');

// Test 3: Markdown fence with file path in header
const markdown = `
Here are the configuration and code files:

\`\`\`yaml
# config/settings.yaml
pentest:
  name: "AI-Pentest"
\`\`\`

And the python script:

\`\`\`python:src/scanner.py
def scan():
    return True
\`\`\`

And a standalone bash script without explicit path:

\`\`\`bash
echo "Hello from shell"
\`\`\`
`;

const extracted = extractFilesFromMarkdown(markdown);
assert.strictEqual(extracted.length, 3);
assert.strictEqual(extracted[0].name, 'config/settings.yaml');
assert.strictEqual(extracted[1].name, 'src/scanner.py');
assert.strictEqual(extracted[2].name, 'file_3.sh');
console.log('✔ Test 3 passed: Multi-file markdown extraction with fallback');

console.log('All ZIP download and extraction tests PASSED!');
