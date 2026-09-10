import { execSync } from 'node:child_process';

const pyCode = `
from transformers import AutoTokenizer

tok = AutoTokenizer.from_pretrained('/models/current')
messages = [
    {"role": "user", "content": "Hello! What is 2+2?"}
]

prompt_default = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
prompt_none = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, reasoning_effort="none")
prompt_low = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, reasoning_effort="low")

print("--- APPLY CHAT TEMPLATE TEST ---")
messages = [
    {"role": "system", "content": "You are an expert software engineer and systems architect."},
    {"role": "user", "content": "Write a Python script that watches a folder."}
]
rendered = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
print(rendered)
`;

try {
  const res = execSync("ssh flak3dd 'docker run -i --rm -v /home/flak3dd/spark/models/Huihui-gpt-oss-120b-mxfp4-abliterated:/models/current:ro --entrypoint python3 vllm/vllm-openai:cu130-nightly'", {
    input: pyCode,
    encoding: 'utf8'
  });
  console.log(res);
} catch (e) {
  console.log('Error:', e.message);
}



