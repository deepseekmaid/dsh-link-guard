// 单测：@local/dsh-link-guard 的纯函数与宿主钩子（用假 ctx，不依赖 DSH 运行时）
//
// 说明：源码里刻意不写反斜杠字面量——用 B = String.fromCharCode(92) 拼出来，
// 这样测试照样覆盖「链接里出现反斜杠」，仓库里也不会出现 Windows 绝对路径。
import { apply, assistantTextOf, MAX_CORRECTIONS_PER_TURN } from '../lib/index.js';
import { buildCorrection, findBadLinks, lastAssistantText, normalizeLinks } from '../lib/scan.js';

const B = String.fromCharCode(92); // 反斜杠
const badTarget = 'docs' + B + '_verify' + B + 'report.md';
const goodTarget = 'docs/_verify/report.md';

let pass = 0;
const fails = [];
function ok(name, cond) {
  if (cond) pass++;
  else fails.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
}

// ---------- scan ----------
const badText = `看这个 [报告](${badTarget}) 和 [ok](${goodTarget})`;
const bad = findBadLinks(badText);
ok('检出反斜杠链接', bad.length === 1 && bad[0].fixed === goodTarget);
ok('跳过代码围栏', findBadLinks('```\n[x](' + badTarget + ')\n```').length === 0);
ok('正常链接不报', findBadLinks('[x](' + goodTarget + ')').length === 0);
ok('normalizeLinks 只改目标', normalizeLinks(badText) === badText.replace(badTarget, goodTarget));
ok('lastAssistantText 取最后一条', lastAssistantText([
  { role: 'user', content: 'hi' },
  { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'b' }] },
]) === 'b');
ok('buildCorrection 含应为路径', buildCorrection(bad, badText).includes('应为：' + goodTarget));

// ---------- 假 ctx ----------
const captured = { contexts: [], handlers: {} };
const scope = {
  systemPrompt: { context: (o) => captured.contexts.push(o) },
  on: (ev, fn) => { captured.handlers[ev] = fn; },
};
const ctx = { inject: (deps, fn) => fn(scope) };
apply(ctx);

ok('注入 systemPrompt context', captured.contexts.length === 1 && typeof captured.contexts[0].text === 'function');
ok('注入文本含正斜杠规则', /正斜杠/.test(captured.contexts[0].text()));
ok('注册了 turn-stopping', typeof captured.handlers['agent/turn-stopping'] === 'function');

const steerCalls = [];
function makePayload(text, turn = 1, opts = {}) {
  const agent = {
    id: opts.id ?? 'agent-1',
    steer: (m) => steerCalls.push(m),
    session: opts.noSession ? undefined : {
      deriveMessages: () => [{ role: 'assistant', content: [{ type: 'text', text }] }],
    },
  };
  return { agent, turn };
}
async function fire(payload) {
  await captured.handlers['agent/turn-stopping'](payload, async () => {});
}

await fire(makePayload('[x](' + badTarget + ')'));
ok('坏链接触发纠错', steerCalls.length === 1);
ok('纠错消息是 plugin 来源', steerCalls[0]?.source?.kind === 'plugin');
ok('纠错消息含「正斜杠」', /正斜杠/.test(steerCalls[0]?.content?.[0]?.text ?? ''));

steerCalls.length = 0;
await fire(makePayload('[x](' + goodTarget + ')', 2));
ok('好链接不纠错', steerCalls.length === 0);

steerCalls.length = 0;
await fire(makePayload('```\n[x](docs' + B + 'a.md)\n```', 3));
ok('代码块里的不纠错', steerCalls.length === 0);

steerCalls.length = 0;
await fire(makePayload('[x](docs' + B + 'a.md)', 4, { noSession: true }));
ok('没有 session 不崩', steerCalls.length === 0);

steerCalls.length = 0;
for (let i = 0; i < 5; i++) await fire(makePayload('[x](docs' + B + 'a.md)', 5));
ok(`同一回合最多纠错 ${MAX_CORRECTIONS_PER_TURN} 次`, steerCalls.length === MAX_CORRECTIONS_PER_TURN);

steerCalls.length = 0;
await fire({ agent: null, turn: 6 });
ok('无 agent 不崩', steerCalls.length === 0);

// ---------- assistantTextOf ----------
const a = assistantTextOf({ agent: { session: { deriveMessages: () => [{ role: 'assistant', content: 'raw' }] } } });
ok('assistantTextOf 处理字符串 content', a.text === 'raw');

console.log(`\n合计 ${pass + fails.length}，失败 ${fails.length}${fails.length ? '：' + fails.join('; ') : ''}`);
process.exit(fails.length ? 1 : 0);
