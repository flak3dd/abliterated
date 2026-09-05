import assert from 'node:assert/strict';
import {
  clampCount,
  decodeEntities,
  isBlockedHost,
  parseBingHtml,
  parseBraveApi,
  parseBraveHtml,
  parseDdgHtml,
  parseSearxJson,
  parseWikiOpensearch,
  stripTags,
  unwrapBingUrl,
  unwrapDdgUrl,
  formatResults,
} from './webSearch.js';

assert.equal(clampCount(undefined), 8);
assert.equal(clampCount(0), 1);
assert.equal(clampCount(99), 12);
assert.equal(clampCount('5'), 5);

assert.equal(decodeEntities('Qwen &amp; Flux'), 'Qwen & Flux');
assert.equal(stripTags('<strong>Qwen</strong> Studio'), 'Qwen Studio');

assert.equal(isBlockedHost('https://example.com'), false);
assert.equal(isBlockedHost('http://127.0.0.1/x'), true);
assert.equal(isBlockedHost('http://localhost/x'), true);
assert.equal(isBlockedHost('http://192.168.1.1/x'), true);
assert.equal(isBlockedHost('http://10.0.0.5/x'), true);
assert.equal(isBlockedHost('not-a-url'), true);

const bingWrapped =
  'https://www.bing.com/ck/a?!&&p=abc&u=a1aHR0cHM6Ly9xd2VuLmFpL2hvbWU&ntb=1';
assert.equal(unwrapBingUrl(bingWrapped), 'https://qwen.ai/home');

assert.equal(
  unwrapDdgUrl('https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa'),
  'https://example.com/a',
);

const braveHtml = `
<div class="snippet" data-pos="0" data-type="web">
  <a href="https://ollama.com/huihui_ai/qwen3-abliterated">
    <div class="title search-snippet-title" title="huihui_ai/qwen3-abliterated">huihui_ai/qwen3-abliterated</div>
  </a>
  <div class="generic-snippet">
    <div class="content desktop-default-regular t-primary line-clamp-dynamic">Uncensored Qwen via abliteration.</div>
  </div>
</div>
<div class="snippet" data-pos="1" data-type="web">
  <a href="https://huggingface.co/collections/huihui-ai/qwen3-abliterated">
    <div class="title search-snippet-title" title="Qwen3 abliterated">Qwen3 abliterated</div>
  </a>
  <div class="generic-snippet">
    <div class="content line-clamp-dynamic">HF collection</div>
  </div>
</div>
<div class="snippet" data-type="web">
  <a href="https://search.brave.com/search?q=skip"><div class="title search-snippet-title" title="skip">skip</div></a>
</div>
`;
const brave = parseBraveHtml(braveHtml);
assert.equal(brave.length, 2);
assert.equal(brave[0].url, 'https://ollama.com/huihui_ai/qwen3-abliterated');
assert.equal(brave[0].title, 'huihui_ai/qwen3-abliterated');
assert.match(brave[0].snippet, /Uncensored Qwen/);
assert.equal(brave[1].url, 'https://huggingface.co/collections/huihui-ai/qwen3-abliterated');

const bingHtml = `
<ol id="b_results">
<li class="b_algo">
  <h2><a href="${bingWrapped}">Qwen</a></h2>
  <cite>https://qwen.ai</cite>
  <p class="b_lineclamp2">Qwen Studio is an AI assistant.</p>
</li>
<li class="b_algo">
  <h2><a href="https://en.wikipedia.org/wiki/Qwen">Qwen (wiki)</a></h2>
  <p class="b_lineclamp2">Wikipedia article.</p>
</li>
</ol>
`;
const bing = parseBingHtml(bingHtml);
assert.equal(bing.length, 2);
assert.equal(bing[0].url, 'https://qwen.ai/home');
assert.equal(bing[0].title, 'Qwen');
assert.match(bing[0].snippet, /Qwen Studio/);
assert.equal(bing[1].url, 'https://en.wikipedia.org/wiki/Qwen');

const ddgHtml = `
<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example docs</a>
<a class="result__snippet">Official documentation.</a>
`;
const ddg = parseDdgHtml(ddgHtml);
assert.equal(ddg.length, 1);
assert.equal(ddg[0].url, 'https://example.com/docs');
assert.equal(ddg[0].title, 'Example docs');

const api = parseBraveApi({
  web: { results: [{ url: 'https://example.com', title: 'Ex', description: 'Hello' }] },
});
assert.equal(api[0].url, 'https://example.com');

const searx = parseSearxJson({
  results: [{ url: 'https://example.org', title: 'Org', content: 'Body' }],
});
assert.equal(searx[0].title, 'Org');

const wiki = parseWikiOpensearch(['q', ['Qwen'], ['LLM family'], ['https://en.wikipedia.org/wiki/Qwen']]);
assert.equal(wiki[0].url, 'https://en.wikipedia.org/wiki/Qwen');
assert.equal(wiki[0].snippet, 'LLM family');

const blocked = parseBraveHtml(`
<div data-type="web"><a href="http://127.0.0.1/secret"><div class="title search-snippet-title" title="x">x</div></a></div>
`);
assert.equal(blocked.length, 0);

const formatted = formatResults('qwen', brave, 'brave');
assert.match(formatted, /web_search "qwen" via brave \(2 results\)/);
assert.match(formatted, /web_fetch/);

console.log('webSearch.test.js ok');
