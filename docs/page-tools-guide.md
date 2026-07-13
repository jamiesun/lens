# 页面工具开发指南

本章面向**维护业务前端**的开发者：你想让 Lens 在自己的系统里跑得更快、更准，而不是靠猜测 DOM 结构去点按钮、填表单。读完这一章，你可以在自己的页面里用几十行 JavaScript 声明一组结构化工具，Lens 运行时会自动发现、校验，并在 Agent 认为合适时直接调用它们。

## 1. 这是什么，为什么需要它

Lens 默认靠语义快照（`page.snapshot`）理解页面：提取标题、表单、按钮、表格等元素，让模型"看图猜测"该做什么。这种方式对任意第三方网站都能工作，但有代价：慢（每一步都要重新扫描 DOM）、脆弱（换个 class 名或者布局就可能失效）、粗粒度（模型只能通过填表单、点按钮这种"手动操作"路径间接达成目标）。

如果业务前端本来就有现成的查询函数、状态读取逻辑，让 Lens 直接调用它们比"模拟一次表单提交再解析结果 DOM"高效得多，也稳定得多。**Lens Page Tools v1** 就是为此设计的私有协议：

- 零依赖：不需要安装任何包，纯 JavaScript 全局对象契约。
- 页面主导声明，Lens 主导执行裁决：你声明"有什么工具、风险多高"，Lens 决定"要不要真的执行"。
- 只在你自己的页面里生效：这是 Lens 与"合作页面"之间的私有协议，不是浏览器标准，也不影响其他任何网站。

## 2. 五分钟接入

在你的页面加载早期（越早越好，见 [§6 生命周期](#6-生命周期与发现时机)）执行：

```js
window.__lensPageToolsV1 = {
  version: 1,
  sessionId: crypto.randomUUID(),
  tools: new Map(),
};

window.__lensPageToolsV1.tools.set('inventory_lookup', {
  name: 'inventory_lookup',
  description: '按关键字查询库存条目，返回匹配的 SKU、名称与数量。',
  risk: 'observe',
  inputSchema: {
    type: 'object',
    properties: { keyword: { type: 'string' } },
    required: ['keyword'],
    additionalProperties: false,
  },
  execute: async (input) => {
    const keyword = String(input?.keyword ?? '').toLowerCase();
    return {
      matches: currentStock
        .filter((item) => item.name.toLowerCase().includes(keyword))
        .slice(0, 20),
    };
  },
});
```

保存后打开 Lens Side Panel、扫描页面并给一个用得上这个工具的目标（例如"帮我查一下有没有编号含 abc 的库存"）。Lens 会在发现阶段读到 `inventory_lookup`，以 `site_inventory_lookup` 的名字提供给模型，模型调用它时会直接执行你写的 `execute`，而不会去猜测页面上有没有一个搜索框。

## 3. 协议契约详解

### 3.1 全局注册表

```ts
interface LensPageToolsRegistry {
  version: 1;
  sessionId: string; // 建议用 crypto.randomUUID() 自己生成
  tools: Map<string, LensPageTool> | Record<string, LensPageTool>;
}

window.__lensPageToolsV1: LensPageToolsRegistry
```

`tools` 既可以是 `Map`（推荐，示例都用这个）也可以是普通对象；Lens 的发现逻辑对两者都做了兼容。

### 3.2 单个工具字段

```ts
type LensToolRisk = 'observe' | 'local-write' | 'server-write' | 'destructive' | 'financial';

interface LensPageTool {
  name: string;                                  // 见命名规则
  description: string;                           // ≤ 500 字符
  risk: LensToolRisk;                            // 见 §4
  inputSchema?: Record<string, unknown>;         // 可选，JSON 可序列化，序列化后 ≤ 4096 字符
  execute: (input: unknown) => unknown | Promise<unknown>; // 返回值必须 JSON 可序列化
}
```

| 字段 | 规则 | 超出/违反后果 |
| --- | --- | --- |
| `name` | 正则 `^[a-z][a-z0-9_]{0,63}$`（小写 snake_case，最多 64 字符） | 整个注册表被拒绝 |
| `description` | 非空字符串，≤ 500 字符 | 整个注册表被拒绝 |
| `risk` | 必须是五个枚举值之一 | 非法值 → 整个注册表被拒绝；合法但高风险 → 该工具不会被执行（见 §4） |
| `inputSchema` | 可选；必须是能被 `JSON.stringify` 的普通对象，序列化后 ≤ 4096 字符 | 非对象或超限 → 整个注册表被拒绝 |
| `execute` | 必须是函数，可以是 `async` | 不是函数 → 调用时返回 `TOOL_NOT_FOUND` |
| 工具数量 | 单个注册表最多 16 个工具 | 超过 16 个 → 整个注册表被拒绝（不是"只丢弃多余的"） |
| 工具名重复 | 同一批工具里 `name` 不能重复 | 整个注册表被拒绝 |

**重要：校验策略是"全有或全无"。** 只要有一个工具声明非法（命名不合规、风险值拼错、Schema 不是对象、重名，或总数超过 16 个），Lens 会拒绝**整个注册表**，你所有的工具（包括本来合法的那些）当次都不会被模型看到。这是有意为之的设计：宁可让页面完全没有结构化工具可用（退回到 DOM 快照兜底），也不让模型看到一个不完整、不一致的工具集合而做出错误判断。调试时如果发现工具"整批消失"，先检查是不是某一个工具的声明出了问题，而不是怀疑框架坏了。

### 3.3 `inputSchema` 只是"给模型看的说明书"，不是校验规则

这是一个容易被误解的地方，必须讲清楚：**Lens 不会用你声明的 `inputSchema` 去校验模型传入的参数。** Lens 只保证转发给 `execute` 的 `input` 满足两个最基本条件：

1. 是一段合法 JSON，且解析后是一个非数组、非 `null` 的普通对象；
2. 原始 JSON 文本长度 ≤ 8192 字符。

除此之外，`input` 里具体有哪些字段、类型对不对、必填项在不在——**Lens 完全不管**，`inputSchema` 只是被原样转发给模型，当作"这个函数大概接受什么参数"的提示（类似 OpenAI function calling 的 `parameters`），模型可能会依据它生成参数，但不保证严格遵守。你的 `execute` 函数必须自己做防御性校验：

```js
execute: async (input) => {
  const keyword = typeof input?.keyword === 'string' ? input.keyword.trim() : '';
  if (!keyword) {
    return { matches: [], warning: 'keyword is required' };
  }
  // ...
},
```

不要假设 `input` 一定符合你写的 Schema——它是模型生成的、经过网络往返的数据，按"不可信输入"处理。

## 4. 风险等级与运行时策略

`risk` 字段决定这个工具**是否会被真正执行**，而不是你说了算。当前运行时策略：

| risk 值 | 含义 | 是否进入模型工具列表 | 是否会被执行 |
| --- | --- | --- | --- |
| `observe` | 只读查询，不改变任何状态 | ✅ | ✅ |
| `local-write` | 只修改页面本地/临时状态（例如草稿、UI 状态），不触达后端持久化 | ✅ | ✅ |
| `server-write` | 会调用后端接口持久化写入 | ❌（不展示给模型） | ❌（即使模型硬调用也会被拒绝） |
| `destructive` | 删除或不可逆操作 | ❌ | ❌ |
| `financial` | 涉及金额、支付、下单等 | ❌ | ❌ |

**两层阻断机制**：

1. **发现阶段过滤**：`server-write` / `destructive` / `financial` 的工具压根不会出现在模型能看到的工具列表里，模型不知道它们存在。
2. **派发阶段兜底拒绝**：即便模型因为幻觉（比如从工具描述文本里"猜"出了一个名字）硬调用了一个从未展示过的工具名，Lens 在真正执行前还会再查一次绑定表，命中高风险直接返回 `RISK_BLOCKED` 错误，绝不会触发你的 `execute`。

也就是说，**声明 `risk: 'observe'` 并不是你自己承诺"这个工具是安全的"就完了**——风险等级是 Lens 运行时据此做执行决策的依据，页面声明较低风险不能让 Lens 放宽本不该放宽的执行权；反过来，如果你的工具实际上会产生副作用却标成 `observe`，那是你自己的责任判断错误，Lens 无法从代码层面验证一个工具"是不是真的只读"。**诚实标注风险等级是协议生效的前提，不是可绕过的装饰。**

如果你的场景需要 `server-write`/`destructive`/`financial` 级别的自动化，当前版本的 Page Tools 协议不支持——这是有意的范围限制，不是遗漏（对应 `AGENTS.md` "模型只能提出结构化工具调用；权限、风险、确认、审计和执行结果必须由受控运行时裁决"这条工程约束，目前运行时还没有为高风险操作实现二次确认 UI）。

## 5. 限制一览

| 限制项 | 数值 | 超出后果 |
| --- | --- | --- |
| 工具数量 | ≤ 16 | 整个注册表被拒绝 |
| `description` 长度 | ≤ 500 字符 | 整个注册表被拒绝 |
| `inputSchema` 序列化长度 | ≤ 4096 字符 | 整个注册表被拒绝 |
| 模型传入的参数 JSON 长度 | ≤ 8192 字符 | 本次调用返回参数错误，不会调用 `execute` |
| `execute` 返回值序列化长度 | ≤ 32768 字符 | 本次调用返回 `RESULT_TOO_LARGE` |
| `execute` 执行超时 | 10 秒 | 本次调用返回 `TIMEOUT`（`execute` 内部逻辑不会被强行中断，但结果会被丢弃） |
| 返回值类型 | 必须能被 `JSON.stringify` | 返回 `RESULT_NOT_JSON` |

**实践建议**：即使还没到 32768 字符的硬上限，也应该让 `execute` 返回精简、聚合过的数据（分页、摘要、限制条数），而不是整表倾倒。原因有二：一是结果最终还会被塞进当次对话给模型看，塞得越多，留给其他上下文的预算越少；二是模型处理简洁结构化数据的准确率明显高于处理超长原始转储。

## 6. 生命周期与发现时机

### 6.1 何时发现，何时不发现

Lens 在**每次 Agent 运行开始时、拿到初始页面快照之后**发现一次页面工具，然后才进入执行步骤循环。这意味着：

- 只要你的工具在用户点击"运行"之前完成注册，就能被发现，不需要在页面刚加载的那一刻就注册完。
- 但**发现只在一次运行的开头做一次**，运行过程中途改变 `window.__lensPageToolsV1.tools`（比如异步加载了新的一批工具）不会被当次运行感知到，模型看到的工具集合在整个对话里保持不变，直到用户发起新一轮 Agent 运行。
- 结论：**尽量在用户可能触发 Agent 运行之前就完成工具注册**，不要放在"点击后才异步加载"的懒逻辑里；如果工具集合确实依赖异步数据（比如要等一个接口返回才知道有哪些操作可用），要确保这个异步过程通常能在用户实际点击 Lens 之前完成。

### 6.2 会话失效（`sessionId`）

`sessionId` 是这个注册表实例的身份标识。推荐自己在创建注册表时用 `crypto.randomUUID()` 生成一个：

```js
window.__lensPageToolsV1 = {
  version: 1,
  sessionId: crypto.randomUUID(),
  tools: new Map(),
};
```

如果你没设置（或设置了一个空字符串/超过 128 字符的值），Lens 会在第一次读取时**帮你懒生成一个并写回** `window.__lensPageToolsV1.sessionId`——这只是兜底，不建议依赖它。

会话失效的实际效果：页面刷新（或者 SPA 里整个 `window.__lensPageToolsV1` 被重新赋值成一个新对象）会自然产生一个新的 `sessionId`。如果某次工具调用携带的是发现阶段记下的旧 `sessionId`，而此时页面上的 `sessionId` 已经变了，调用会被直接拒绝，返回 `STALE_TOOLS`，不会执行任何 `execute`。你不需要手动处理这个失效逻辑——只要老老实实让页面刷新/重建时自然产生新的 `sessionId`（大多数情况下这是自动发生的），旧调用自己就会失效。

### 6.3 SPA 路由切换

如果你的应用是单页应用，路由切换时如果不刷新整个 `window`，`window.__lensPageToolsV1` 也不会自动重置。这通常是你想要的（工具在路由间保持可用），但如果某个工具只在特定路由下才有意义（比如"当前订单详情页"专属工具），要在路由切换时自己更新 `tools`（增删对应条目），并且记住：**这个更新只会在下一次 Agent 运行的发现阶段生效**，当次运行中途切换路由不会让模型立刻看到变化。

## 7. 错误码参考

调用一个 `site_*` 工具时，如果没有成功执行，Lens 会把错误码和消息一起回传给模型（模型看到的是 `{"error": {"code": ..., "message": ...}}`）。排查问题时对照下表：

| 错误码 | 触发时机 | 你能做什么 |
| --- | --- | --- |
| `RISK_BLOCKED` | 工具风险等级不在 `observe`/`local-write` 内（不区分是否被模型幻觉调用） | 确认这个操作是否真的应该由 Lens 自动化；当前协议不支持更高风险等级 |
| `NO_REGISTRY` | 调用时页面上已经没有 `window.__lensPageToolsV1` 了 | 检查是否在发现之后、调用之前页面发生了会清空全局对象的操作（例如整页替换） |
| `STALE_TOOLS` | 调用携带的 `sessionId` 和页面当前的不一致 | 通常是页面在发现之后又刷新/重建了注册表；属于正常保护机制，重新扫描页面即可 |
| `TOOL_NOT_FOUND` | 页面当前的 `tools` 里找不到这个名字，或者对应条目没有 `execute` 函数 | 检查工具名有没有被后续代码覆盖删除，或者 `execute` 是不是漏写了 |
| `INVALID_ARGUMENTS` | 模型传来的参数字符串不是合法 JSON | 通常是模型侧的问题；如果频繁出现，考虑把 `inputSchema` 写得更清楚以引导模型 |
| `EXECUTE_ERROR` | `execute` 函数自己抛出了异常 | 这是你自己代码里的 bug，检查 `execute` 的实现；错误消息会截断到 300 字符传回 |
| `TIMEOUT` | `execute` 在 10 秒内没有 resolve | 检查是否有未处理的挂起 Promise、卡住的网络请求；考虑给内部调用加更短的超时 |
| `RESULT_NOT_JSON` | 返回值不能被 `JSON.stringify`（例如包含 `BigInt`、循环引用、`Symbol`、`undefined` 字段的特殊语义等边界情况） | 在 `return` 之前手动转换成普通 JSON 值，比如 `BigInt` 转字符串 |
| `RESULT_TOO_LARGE` | 序列化后的返回值超过 32768 字符 | 精简返回内容：分页、只返回必要字段、限制条数 |
| `CALL_FAILED` | 调用 MAIN world 执行时整个过程失败（例如调用期间标签页被关闭或导航走了） | 通常是用户操作导致的环境变化，重试或提示用户 |
| `INVALID_RESULT` | 页面返回的结果不满足 Lens 期望的内部结构，或者规范化后发现不是合法 JSON | 极少见；如果稳定复现，检查是否有代码 monkey-patch 了 `JSON.stringify`/`JSON.parse` |

除了工具调用失败，**发现阶段**（对应 `page.tools.list` 事件）也有几种状态：

| 状态 | 触发条件 | 模型工具列表 |
| --- | --- | --- |
| 不存在（absent） | 页面根本没有设置 `window.__lensPageToolsV1` | 静默跳过，不产生事件，也不影响内置工具 |
| 不可用（unavailable） | 读取过程本身抛出异常（例如页面正在导航） | 产生一条 `failed` 事件，退回内置工具 |
| 版本不兼容（incompatible） | `version` 不等于 `1` | 产生一条 `failed` 事件，注明协议版本号 |
| 声明非法（invalid） | 命名/风险值/Schema/数量任一项不合规，或重名 | 产生一条 `failed` 事件，注明具体原因 |
| 正常（ok，但工具数为 0） | 注册表存在且合法，但 `tools` 为空 | 静默跳过，不产生事件 |
| 正常（ok，有工具） | 注册表存在且合法，至少一个工具通过风险过滤 | 产生一条 `completed` 事件，形如 `"3/5 page tools available"` |

## 8. 完整示例

仓库的端到端测试用了一个包含三个工具的演示页（`tests/fixtures/tools-console.html`，一个虚构的"库存控制台"），覆盖了"会执行"和"永远不会执行"两种情况，下面是它的工具声明部分（省略了外层 HTML 和一个几行的最小 SDK 引导代码，完整内容见仓库源文件）：

```js
const stock = [
  { sku: 'GZ-1', item: 'Gizmo classic', qty: 7 },
  { sku: 'GZ-2', item: 'Gizmo mk2', qty: 42 },
  { sku: 'WD-9', item: 'Widget nine', qty: 130 },
];

// 1) observe：只读查询，会被执行
window.registerLensTool({
  name: 'inventory_lookup',
  description: '按关键字查询库存条目，返回匹配的 SKU、名称与数量。',
  risk: 'observe',
  inputSchema: {
    type: 'object',
    properties: { keyword: { type: 'string' } },
    required: ['keyword'],
    additionalProperties: false,
  },
  execute: (input) => {
    const keyword = String(input.keyword ?? '').toLowerCase();
    return {
      matches: stock.filter((entry) => entry.item.toLowerCase().includes(keyword)),
    };
  },
});

// 2) local-write：只改页面本地 UI 状态，会被执行
window.registerLensTool({
  name: 'set_shelf_note',
  description: '在货架便签区写入一条备注（仅本地界面状态）。',
  risk: 'local-write',
  inputSchema: {
    type: 'object',
    properties: { note: { type: 'string' } },
    required: ['note'],
    additionalProperties: false,
  },
  execute: (input) => {
    const note = String(input.note ?? '').slice(0, 200);
    document.getElementById('note').textContent = note;
    return { written: true, note };
  },
});

// 3) destructive：即使声明了、即使模型尝试调用，也永远不会执行
window.registerLensTool({
  name: 'purge_inventory',
  description: '清空全部库存记录（不可恢复）。',
  risk: 'destructive',
  execute: () => {
    // 这个函数体永远不会被 Lens 调用到——risk 是 destructive，
    // 发现阶段就不会展示给模型，模型硬调用也会被 RISK_BLOCKED 拒绝。
    stock.length = 0;
    document.getElementById('purge-state').textContent = 'Inventory purged!';
    return { purged: true };
  },
});
```

（`registerLensTool` 是这个演示页自己定义的一个几行小函数，内部只是 `registry.tools.set(tool.name, tool)`——它不是 Lens 提供的 API，只是这个页面为了少写重复代码而自建的便捷封装，你完全可以直接用 `window.__lensPageToolsV1.tools.set(...)`，效果一样。）

在这个例子里：

- 模型能看到并可以调用 `site_inventory_lookup`、`site_set_shelf_note`；e2e 测试会验证调用后页面上的便签文本确实被更新。
- 模型即使"决定"要调用 `site_purge_inventory`，也会收到 `{"error":{"code":"RISK_BLOCKED", ...}}`，`purge_inventory` 的 `execute` 函数体永远不会运行，库存数据保持不变——把它声明出来只是为了让维护者显式记录"这个操作存在，但 Lens 不允许自动化它"，而不是悄悄不管它；e2e 测试专门验证了这条失败路径（调用被拒绝且页面状态不受影响）。

## 9. 调试建议

1. **先脱离 Lens 自测 `execute`**：在业务页面自己的 DevTools 控制台里手动跑：

   ```js
   await window.__lensPageToolsV1.tools.get('inventory_lookup').execute({ keyword: 'abc' });
   ```

   确认逻辑本身没问题，再交给 Lens 调用。

2. **检查注册表本身**：直接在控制台打印 `window.__lensPageToolsV1`，确认 `version`、`sessionId`、`tools` 的内容和你预期一致（尤其是用 `Map` 时容易忘记调用 `.set`，或者对象字面量误写成了普通对象却当 `Map` 用）。

3. **看 Lens 侧的工具事件**：打开 Side Panel 的"工具过程"（默认折叠），找 `page.tools.list`（每次运行一次，报告"发现了几个/共几个工具可用"或失败原因）和 `page.tools.call`（每次实际调用一次，报告成功字符数或 §7 里的错误码）。

4. **常见坑**：
   - `execute` 忘记处理 `async`：同步函数也可以，但如果内部确实是异步操作，记得 `return` 一个 Promise（或用 `async function`），不要提前 `return` 导致 Lens 拿到一个"半成品"。
   - 用了非 JSON 可序列化的返回值：`Date` 对象会被 `JSON.stringify` 隐式转成字符串（通常没问题），但 `BigInt`、`Map`、`Set`、循环引用会直接失败，触发 `RESULT_NOT_JSON`。
   - 工具数超过 16 个：整批工具消失，容易误以为是协议坏了，其实是数量超限。
   - 工具名不符合正则（比如用了大写字母、连字符 `-`、或者以数字开头）：同样是整批消失。
   - `inputSchema` 写得太随意导致模型传参混乱：`INVALID_ARGUMENTS` 频繁出现时，先检查 Schema 描述是否清晰、`required` 是否声明准确。

## 10. 安全须知

把这几条当作硬性前提，而不是建议：

- **页面数据一律不可信。** `window.__lensPageToolsV1` 运行在页面自己的 JavaScript 上下文里，任何能在这个页面执行代码的东西（包括潜在的 XSS、被篡改的第三方脚本）都能读写它。Lens 把所有从这个通道读到的数据当作不可信输入处理：结果会被强制 `JSON.parse` 再 `JSON.stringify` 规范化一遍，防止页面通过篡改 `JSON.stringify` 之类的手段夹带非法内容。
- **风险等级是运行时的执行依据，不是页面单方面的免责声明。** 不要指望"标成 `observe`"就能让某个实际有副作用的操作被执行——诚实标注是协议正确工作的前提；反过来，Lens 也不会因为你标了更高风险就自动获得任何"更强"的能力，`server-write`/`destructive`/`financial` 在当前版本下无论如何声明都不会被执行。
- **Page Tools 不是绕过后端权限校验的捷径。** `execute` 只是"页面前端到 Lens 之间的桥"，不是安全边界本身。任何真正影响业务数据的写入操作，仍然应该在你自己的后端接口上有完整的鉴权和校验；不要因为"反正 Lens 只会调用 observe/local-write"就放松后端校验的警惕——`execute` 内部如果调用了会产生持久化副作用的接口,这本身就违反了 `local-write` 的语义,应该诚实标成 `server-write`（然后当前版本会拒绝执行，这正是设计意图）。
- **不要把敏感数据塞进 `description` 或返回值。** `description` 会被原样发给模型 Provider（你自己配置的第三方 API）；`execute` 的返回值最终也会进入模型看到的对话上下文。任何你不希望离开浏览器、发到模型 Provider 的数据，都不应该出现在工具描述或返回值里。

## 11. FAQ

**Q：可以在一个页面里同时用 Page Tools 和让 Lens 用 DOM 快照兜底吗？**
可以，两者不互斥。没有被 Page Tools 覆盖的操作，模型仍然可以用内置的 `page.snapshot`/`page.form.fill`/`page.click` 兜底。

**Q：我需要发布一个 npm 包给 Lens 依赖吗？**
不需要，也不应该。协议就是一个纯 JavaScript 全局对象契约，你在自己的代码里实现它即可，Lens 不提供也不要求任何 SDK 依赖。本章里的 TypeScript 类型定义只是给你抄的参考，不是需要 `import` 的真实模块。

**Q：如果我想要更高风险等级（写库存、下单）的自动化，现在能做吗？**
现在不能。当前版本的 Page Tools 协议只放行 `observe` 和 `local-write`。更高风险等级需要运行时先实现二次确认机制，这超出了当前版本范围（见[架构与工程约束](./architecture.md)）。

**Q：`sessionId` 一定要自己生成吗？**
不是必须，但强烈建议。自己生成能保证"页面刷新 = 新会话 = 旧调用自动失效"这个语义在任何情况下都成立，而不依赖 Lens 的懒生成兜底逻辑。

**Q：工具可以互相调用，或者依赖之前某次工具调用的结果吗？**
`execute` 就是普通 JavaScript 函数，你可以在里面做任何事，包括调用页面里的其他函数或状态。但每次工具调用之间没有 Lens 维护的"跨调用上下文"——如果需要跨调用状态，自己在页面全局变量里维护。

**Q：协议以后会加版本 2 吗？**
`version` 字段就是为了这个预留的：Lens 目前只接受 `version === 1`，将来如果协议扩展，会用新的版本号区分，旧版本注册表会被明确标记为"不兼容"而不是被静默误解析。
