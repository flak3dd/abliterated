import { execSync } from 'node:child_process';

const pyCode = `
import json
with open('/models/current/generation_config.json') as f:
    print("generation_config.json:\\n", f.read())
`;

try {
  const res = execSync("ssh flak3dd 'docker run -i --rm -v /home/flak3dd/spark/models/Huihui-gpt-oss-120b-mxfp4-abliterated:/models/current:ro --entrypoint python3 vllm/vllm-openai:cu130-nightly'", {
    input: pyCode,
    encoding: 'utf8'
  });
  console.log('Tokenizer test:\n' + res);
} catch (e) {
  console.log('Error:', e.message);
  if (e.stdout) console.log('stdout:', e.stdout);
  if (e.stderr) console.log('stderr:', e.stderr);
}
