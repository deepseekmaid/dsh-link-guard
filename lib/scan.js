// 纯函数：找出 Markdown 链接里的反斜杠路径，并给出正斜杠修正
// 事由：2026-11-05 `[报告](docs\_verify\x.md)` 的 `\_` 被 Markdown 当转义，
// 反斜杠消失 → `docs_verify/x.md`，链接打不开。

const LINK = /!?\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

/** 逐行扫描（跳过代码围栏），返回 [{line, target, fixed}]。 */
export function findBadLinks(text) {
  const out = [];
  if (typeof text !== 'string' || text.length === 0) return out;
  const lines = text.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    LINK.lastIndex = 0;
    let m;
    while ((m = LINK.exec(line)) !== null) {
      const raw = m[1].replace(/^<|>$/g, '');
      if (raw.includes('\\')) out.push({ line: i + 1, target: raw, fixed: raw.replace(/\\/g, '/') });
    }
  }
  return out;
}

/** 取最后一条 assistant 消息的文本（content 可能是字符串或 block 数组）。 */
export function lastAssistantText(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'assistant') continue;
    const content = m.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n');
    }
    return '';
  }
  return '';
}

/** 把一段文本里的链接目标全部改成正斜杠（用于生成纠错示例）。 */
export function normalizeLinks(text) {
  if (typeof text !== 'string') return '';
  return text.replace(LINK, (whole, target) => {
    const raw = target.replace(/^<|>$/g, '');
    if (!raw.includes('\\')) return whole;
    return whole.replace(target, target.replace(/\\/g, '/'));
  });
}

/** 生成给模型的纠错说明（纯函数，便于单测）。 */
export function buildCorrection(bad, text) {
  const sample = bad.slice(0, 3).map((b) => `- 现在：${b.target}\n  应为：${b.fixed}`).join('\n');
  const whole = normalizeLinks(text);
  return [
    '[link-guard] 上一条回复里有 Markdown 链接用了反斜杠路径。',
    '原因：Markdown 把 `\\_` 当转义，反斜杠会消失，路径变成 `AI编程_verify` 之类，用户点不开。',
    sample,
    '请把这条消息里的链接全部改成正斜杠后重新发一次（只改链接目标，正文不用重写）。',
    '参考：' + (whole.slice(0, 400) || '（无法提取原文）'),
  ].join('\n');
}
