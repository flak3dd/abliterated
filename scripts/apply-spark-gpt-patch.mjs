import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

console.log('================================================================');
console.log(' EXTRACTING AND PATCHING SERVING.PY ON SPARK HOST               ');
console.log('================================================================');

// 1. Extract pristine serving.py directly from base docker image
console.log('1. Extracting pristine serving.py from base image...');
execSync("ssh flak3dd 'docker run --rm --entrypoint cat vllm/vllm-openai:cu130-nightly /usr/local/lib/python3.12/dist-packages/vllm/entrypoints/openai/chat_completion/serving.py > ~/spark/serving_patch.py'", { stdio: 'inherit' });

// 2. Patch serving_patch.py using python on Spark host
console.log('2. Applying patch to ~/spark/serving_patch.py (use_harmony=True — Harmony prompt encode + channel parse)...');
const pythonScript = `
with open('/home/flak3dd/spark/serving_patch.py', 'r') as f:
    code = f.read()

# Patch 1: FORCE use_harmony = True and add Harmony stop tokens.
# gpt-oss is trained on the Harmony format: use_harmony gates BOTH prompt encoding
# and response parsing. The abliterated MXFP4 fork reports a non-"gpt_oss" model_type,
# so the stock check auto-disables Harmony and the model is fed a plain-chat prompt ->
# degenerate token-soup output. Forcing True restores correct encoding + channel parse
# (final channel -> content, analysis channel -> reasoning_content).
target1 = 'self.use_harmony = self.model_config.hf_config.model_type == "gpt_oss"'
replacement1 = '''self.use_harmony = True
        if "stop_token_ids" not in self.default_sampling_params:
            self.default_sampling_params["stop_token_ids"] = []
        self.default_sampling_params["stop_token_ids"].extend(
            get_stop_tokens_for_assistant_actions()
        )'''

if target1 not in code:
    print('ERROR: target1 not found in serving_patch.py')
    exit(1)

code = code.replace(target1, replacement1, 1)

# Patch 2: reasoning_parser_cls = None, tool_parser = None, parser_cls = None
target2 = '''        # set up reasoning parser
        self.reasoning_parser_cls = ParserManager.get_reasoning_parser(
            reasoning_parser_name=reasoning_parser
        )
        # set up tool use
        self.enable_auto_tools: bool = enable_auto_tools
        self.tool_parser = ParserManager.get_tool_parser(
            tool_parser_name=tool_parser,
            enable_auto_tools=enable_auto_tools,
            model_name=self.model_config.model,
        )
        self.parser_cls = ParserManager.get_parser(
            tool_parser_name=tool_parser,
            reasoning_parser_name=reasoning_parser,
            enable_auto_tools=enable_auto_tools,
            model_name=self.model_config.model,
        )'''
replacement2 = '''        # Harmony (use_harmony=True) parses the analysis/final channels natively into
        # reasoning_content/content; disable the OpenAI-style reasoning/tool parsers so
        # they do not double-parse the Harmony output.
        self.reasoning_parser_cls = None
        self.enable_auto_tools: bool = False
        self.tool_parser = None
        self.parser_cls = None'''

if target2 not in code:
    print('ERROR: target2 not found in serving_patch.py')
    exit(1)

code = code.replace(target2, replacement2, 1)

with open('/home/flak3dd/spark/serving_patch.py', 'w') as f:
    f.write(code)

print('SUCCESS: ~/spark/serving_patch.py patched with use_harmony=True (Harmony prompt encode + channel parse); OpenAI reasoning/tool parsers disabled')

`;

execSync("ssh flak3dd 'python3'", { input: pythonScript, stdio: ['pipe', 'inherit', 'inherit'] });

// 3. Sync updated compose file
console.log('3. Writing updated docker-compose.gpt-oss-120b-abliterated.yml...');
const localCompose = path.join(root, 'spark', 'docker-compose.gpt-oss-120b-abliterated.yml');
const composeContent = fs.readFileSync(localCompose, 'utf8');
execSync(`ssh flak3dd 'cat << "EOF" > ~/spark/docker-compose.gpt-oss-120b-abliterated.yml\n${composeContent}\nEOF'`, { stdio: 'inherit' });

// 4. Recreate container
console.log('4. Recreating gpt-oss-120b-abliterated container...');
execSync("ssh flak3dd 'cd ~/spark && docker compose -f docker-compose.gpt-oss-120b-abliterated.yml up -d --force-recreate'", { stdio: 'inherit' });

console.log('\nContainer recreated with patched serving.py!');

