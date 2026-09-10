import { execSync } from 'node:child_process';

const pyCode = `
from transformers import AutoTokenizer

tok = AutoTokenizer.from_pretrained('/models/current')
print("Vocab size:", len(tok))
for token in ['<|start|>', '<|end|>', '<|channel|>', '<|message|>', '<|call|>', '<|return|>', '<|endoftext|>']:
    print(f"{token} id:", tok.convert_tokens_to_ids(token))
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
