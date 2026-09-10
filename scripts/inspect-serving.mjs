import { execSync } from 'node:child_process';

const pyCode = `
import subprocess
out = subprocess.run(["grep", "-rn", "unexpected tokens remaining", "/usr/local/lib/python3.12/dist-packages/"], capture_output=True, text=True)
print("STDOUT:", out.stdout[:1000])
print("STDERR:", out.stderr[:1000])
if not out.stdout:
    out2 = subprocess.run(["grep", "-rn", "unexpected tokens", "/vllm-workspace/"], capture_output=True, text=True)
    print("STDOUT 2:", out2.stdout[:1000])
`;

try {
  const res = execSync("ssh flak3dd 'docker run -i --rm -v /home/flak3dd/spark/models/Huihui-gpt-oss-120b-mxfp4-abliterated:/models/current:ro --entrypoint python3 vllm/vllm-openai:cu130-nightly'", {
    input: pyCode,
    encoding: 'utf8'
  });
  console.log('--- Native vLLM Inspection ---\n' + res);
} catch (e) {
  console.error('Error:', e.message);
  if (e.stdout) console.log('stdout:', e.stdout);
  if (e.stderr) console.log('stderr:', e.stderr);
}

