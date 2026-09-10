#!/usr/bin/env node
import { execSync } from 'node:child_process';

const code = `
import vllm
print("vLLM version:", vllm.__version__)

from vllm.entrypoints.openai.parser.harmony_utils import render_for_completion, parse_chat_input_to_harmony_message, get_encoding
enc = get_encoding()
msgs = parse_chat_input_to_harmony_message({"role": "user", "content": "Hello"})
tokens = render_for_completion(msgs)
# Let's test StreamableParser on sample harmony tokens
from vllm.entrypoints.openai.parser.harmony_utils import get_streamable_parser_for_assistant
p = get_streamable_parser_for_assistant()
print("Initial parser state:")
print("current_channel:", p.current_channel)
print("current_recipient:", p.current_recipient)

# What tokens does the parser expect first?
# A message header starts with <|channel|>channel_name<|message|>
from vllm.entrypoints.openai.parser.harmony_utils import get_system_message
import inspect
print("get_system_message source:")
print(inspect.getsource(get_system_message))
# Let's inspect the raw generated tokens from a prompt
from vllm.entrypoints.openai.parser.harmony_utils import render_for_completion, parse_chat_input_to_harmony_message, get_encoding
enc = get_encoding()
msgs = parse_chat_input_to_harmony_message({"role": "user", "content": "Explain what 2+2 is in one word."})
prompt_tokens = render_for_completion(msgs)
print("Prompt tokens count:", len(prompt_tokens))
print("Prompt decoded:\\n", enc.decode(prompt_tokens))
`;

try {
  const res = execSync("ssh flak3dd 'docker exec -i gpt-oss-120b-abliterated python3'", {
    input: code,
    encoding: 'utf8'
  });
  console.log('Result:\n', res);
} catch (e) {
  console.error(e);
}
