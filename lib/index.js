// @local/dsh-link-guard — 跨会话守护「Markdown 文件链接必须用正斜杠」
//
// 2026-11-05 事故：链接写成 `docs\_verify\x.md`，Markdown 把 `\_` 当转义，
// 反斜杠消失 → `.._verify/x.md`，用户点不开。规则已写进 AGENTS/skill/记忆，
// 但仍靠「记得」；这个插件把它变成宿主层的两条机制：
//   1) 每次请求注入一行规则（systemPrompt context）——所有会话都能看到；
//   2) 回合停止前检查最后一条 assistant 消息，发现坏链接就 steer 一条纠错指令，
//      让同一轮立刻重发（与 dsh-guard-hooks 的 Stop 语义一致）。
//
// 设计约束：任何钩子都 try/catch；认不出/取不到消息就静默放行，绝不因为护栏把回合搞坏。
import { randomUUID } from 'node:crypto';
import { buildCorrection, findBadLinks, lastAssistantText } from './scan.js';

export const name = 'link-guard';

/** 需要 systemPrompt 服务；缺失时插件不激活（不会拖垮别的东西）。 */
export const inject = ['systemPrompt'];

const RULE =
  '交付链接：Markdown 里的本地文件链接一律正斜杠（如 ../_verify/x.md）；' +
  '反斜杠会被 Markdown 当转义（`\\_` 消失）导致路径拼错。生成用 `_tools/mdlink.mjs`，自检用 `_tools/check-links.mjs`。';

/** 同一回合最多纠错多少次，防死循环。 */
export const MAX_CORRECTIONS_PER_TURN = 2;

function userMessage(text, summary) {
  return Object.freeze(
    structuredClone({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: String(text).slice(0, 8000) }],
      source: { kind: 'plugin', plugin: 'local.link-guard', form: 'notice', summary: String(summary ?? '').slice(0, 160) },
    }),
  );
}

/** 纯函数：从 turn-stopping payload 里取出「最后一条 assistant 文本」。 */
export function assistantTextOf(payload) {
  try {
    const agent = payload && payload.agent;
    const session = agent && agent.session;
    if (!session || typeof session.deriveMessages !== 'function') return { agent, text: '' };
    return { agent, text: lastAssistantText(session.deriveMessages()) };
  } catch {
    return { agent: payload && payload.agent, text: '' };
  }
}

export function apply(ctx, config = {}) {
  if (config && config.enabled === false) return;
  const max = Number.isFinite(config?.maxCorrections) ? Number(config.maxCorrections) : MAX_CORRECTIONS_PER_TURN;

  ctx.inject(['systemPrompt'], (scope) => {
    // 1) 每次请求注入规则（所有会话、所有 preset 都会看到）
    scope.systemPrompt.context({
      name: 'link-guard',
      order: 940,
      interpolate: false,
      text: () => RULE,
    });

    // 2) 回合停止前检查并纠错
    const budget = new Map();
    scope.on('agent/turn-stopping', async (payload, next) => {
      try {
        await next();
      } catch {
        /* 下游控制流异常不影响检查 */
      }
      try {
        const { agent, text } = assistantTextOf(payload);
        if (!agent || typeof agent.steer !== 'function' || !text) return;
        const bad = findBadLinks(text);
        if (bad.length === 0) return;
        const key = String(agent.id ?? '?') + ':' + String(payload?.turn ?? '?');
        const used = budget.get(key) ?? 0;
        if (used >= max) return;
        budget.set(key, used + 1);
        if (budget.size > 200) budget.clear();
        agent.steer(userMessage(buildCorrection(bad, text), 'link-guard: forward-slash links'));
      } catch {
        /* 护栏自身出错静默放行 */
      }
    });
  });
}
