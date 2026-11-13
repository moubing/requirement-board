# 差异与文本历史

命令前缀为 `node <skill-dir>/scripts/rb.mjs`。当前草稿对应工作区，正式版本对应提交，changeNote 对应提交说明。查询不加锁，不保存版本。

## 状态、Diff 和版本

```sh
rb.mjs status REQ-8
rb.mjs diff REQ-8
rb.mjs diff REQ-8 --from v2 --to v5
rb.mjs diff REQ-8 --stat
rb.mjs diff REQ-8 --json --out diff.json
rb.mjs log REQ-8
rb.mjs show REQ-8 --version v3 --out revision.json
```

status 的 modified 只比较标题和实际正文；属性单独查 property-history。cache 为 current/stale/missing，仅说明本机正文缓存；latestRevision 始终返回最新版本摘要。要开始编辑直接用 snapshot，不必先调用 status。

Diff 默认 latest → draft，from/to 还支持明确的 rev_id。复用网页 Diff 引擎，按块输出增删、字符与格式变化、图片属性、表格单元格及章节上下文。默认可读文本，--json 和 --out 返回结构化结果；--out 不改变文件内容为纯文本。每页默认 30 个变化块，--limit 最大 100；total 是全部变化块数。存在 nextOffset 时继续：

```sh
rb.mjs diff REQ-8 --from v2 --to draft --offset <nextOffset> --comparison-token <原响应comparisonToken> --json
```

保持相同 from/to；内容变化返回 DIFF_CHANGED，从第一页重读，不能把两个时间点的页面拼在一起。--stat 只返回全局统计和标题变化，不需要翻页。格式变化即使文字相同也要说明；块 ID 只用于定位。

log 默认显示版本、保存人、保存时间和提交说明，--json 返回元数据。show 的 --version 支持 vN、rev_id、latest、draft；旧 revisions/revision 保持兼容。版本保存人不能当作每句话的作者。

## 给文字或截图查历史

先确定需求。截图由 AI 识别用户指明的文字及上下文，再使用准确文本查询；仅为查历史提供的截图不上传到正文。

```sh
rb.mjs history REQ-8 --text "图片大小不得超过 5 MB。"
rb.mjs history REQ-8 --text "图片大小不得超过 2 MB。" --at v2
rb.mjs history REQ-8 --block <块ID>
```

默认从当前草稿逐个相邻版本向前投影。若当前版本没有该文本，结合 log/show 确定截图所在版本，用 --at vN 重查，不把“当前未找到”解释为从未出现。

遇到 ambiguous 时会返回多个 matches（最多展示 50 个）及 matchCount。结合 context 选择，再加 `--block <blockId> --start <start>` 查询；start 按 Unicode 字符计数，直接使用返回值。不能任意选第一处。仍无法分辨才向用户确认。

结果区分：

- savedBy/savedAt：该版本的保存人和保存时间，当前草稿为空。
- participants：该版本区间内修改整个节点的人员；不代表每个人改了选中的哪几个字。
- participantsUnknown：修改人记录缺失或不完整，不能用保存人补齐。
- comparedTo：本条记录比较的更早版本；为 null 时没有可比较的前一版。explanation 解释该记录的证据边界。
- confidence exact/inferred/lost：与更早版本的块与文本定位确定程度；inferred 是推断。lost 仅表示不能可靠继续向前对应，当前版本仍已找到文本，不是查询失败。
- tracking_lost：在此版本已找到内容，但追溯到更早版本时中断。不能把这条记录当作首次出现，也不能据此指定原作者或创作时间。旧服务端的 introduced + lost 按同一含义解释。
- introduced + exact：最早可用版本中已有这段内容，默认显示“最早可查记录”；保存时间仍不是精确创作时间的证明。
- history_boundary/truncated：最多检查 200 个相邻正式版本；到达上限不能判断首次出现。可结合最旧版本中的投影文本用 --at 继续查询。

例如“v3 追溯到此中断”表示可以确认 v3 中的这段内容及节点参与者，但无法可靠对应 v2；回答应说明这个范围，不能说“这句话确定由 v3 保存人首次写于保存时间”。边界记录展示“此版本文本”，不把缺失的前文渲染成确定的新增差异。

回答时提供版本号、提交说明和可确认的人员范围，明确必要的记录边界。此接口没有逐字作者或每次输入时间，不能承诺完整 git blame。历史数据只读，不能为了“补记录”修改版本。
