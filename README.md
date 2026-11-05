# dsh-link-guard

跨会话守护 Markdown 文件链接格式的 DeepSeek Harness（DSH）宿主插件。

## 它解决什么问题

Markdown 里写 Windows 反斜杠路径放进链接时：

```markdown
[报告](docs\_verify\report.md)
```

`\_` 会被 Markdown 当作转义序列，反斜杠消失，渲染成：

```
.._verify/report.md     ← 目录名粘连，文件明明存在却点不开
```

正确写法是正斜杠：

```markdown
[报告](../_verify/report.md)
```

规则容易忘，所以这个插件把它做成宿主层的两条机制，**所有会话自动生效**，不依赖模型记性。

## 两个机制

1. **每轮注入规则**：通过 `systemPrompt.context` 在每次请求里加一行「链接一律正斜杠」。
2. **回合停止前纠错**：监听 `agent/turn-stopping`，用 `agent.session.deriveMessages()` 取最后一条
   assistant 消息文本，扫描 `](...)` 里是否含反斜杠（自动跳过代码围栏）；命中就
   `agent.steer()` 一条纠错消息，让同一轮立刻重发修正版。同一 `agent:turn` 最多纠错 2 次。

所有钩子都 `try/catch`：取不到消息或内部异常时静默放行，绝不因为护栏把回合搞坏。

## 安装

```bash
# 放进 DSH profile 的 node_modules
mkdir -p ~/.dsh/profiles/desktop/node_modules/@local
cp -r dsh-link-guard ~/.dsh/profiles/desktop/node_modules/@local/
```

在 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: link-guard
      name: '@local/dsh-link-guard'
```

保存后约 2 秒生效（日志出现 `plugin.state ... state:2`）。修改插件代码后需要重启 DSH。

## 配置

```yaml
- insert:
    - id: link-guard
      name: '@local/dsh-link-guard'
      config:
        enabled: true          # false = 关闭
        maxCorrections: 2      # 同一回合最多纠错次数
```

## 测试

```bash
node test/link-guard-test.mjs
```

18 项断言：坏链检出、代码围栏跳过、好链接不纠错、无 session 不崩、同回合上限、
消息来源标记、字符串 content 兼容等。

## 适用范围与限制

- 宿主层插件，profile 级：同一 DSH 安装下的所有会话都生效。
- 纠错发生在回合停止阶段，坏链接可能已经流式显示过；纠正方式是让模型同轮补发修正版。
- 想在渲染层直接改写显示内容，需要另写 client slot 插件（例如替换 `conversation.chat.node`
  渲染器），不在本插件范围内。
- 只拦截 Markdown 链接目标里的反斜杠，不检查链接是否指向存在的文件。

## 许可

MIT
