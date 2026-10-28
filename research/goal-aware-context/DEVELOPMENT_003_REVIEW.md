# 待人工复核：保持原分数

以下是看过本轮输出后的AI建议，不自动增加官方分数。14项同义/翻译建议接受；范围争议需单独判断；3项格式异常建议只确认内容正确，格式和综合仍失败。

| 编号 | 案例/方法/题目 | 实际答案 | 参考答案 | 建议 |
|---|---|---|---|---|
| 1 | s01-c45 / full-history / scope | {"scope":"调整统计卡片里的数字，不修改导航"} | 统计数字；统计卡片数字；统计卡片里的数字 | 同义/翻译，建议接受 |
| 2 | s03-c49 / full-history / scope | {"scope":"onboarding 第一步的说明文案"} | 第一步说明文案；onboarding第一步说明文案；onboarding 第一步说明文案；第一步的说明文案 | 同义/翻译，建议接受 |
| 3 | s01-c45 / production-matched / scope | {"scope":"调整统计数字"} | 统计数字；统计卡片数字；统计卡片里的数字 | 同义/翻译，建议接受 |
| 4 | s04-c49 / production-matched / nextAction | {"nextAction":"先重读App.jsx"} | 重读App.jsx；重读 App.jsx；重新读取App.jsx；重新读取 App.jsx | 同义/翻译，建议接受 |
| 5 | s01-c49 / ordinary-summary / scope | {"scope":"调整统计卡片的数字"} | 统计数字；统计卡片数字；统计卡片中的数字 | 同义/翻译，建议接受 |
| 6 | s02-c49 / ordinary-summary / goal | {"goal":"generating a weekly expense report"} | 每周费用报告；生成每周费用报告 | 同义/翻译，建议接受 |
| 7 | s03-c49 / ordinary-summary / scope | {"scope":"onboarding第一步的说明文案"} | 第一步说明文案；onboarding第一步说明文案；onboarding 第一步说明文案；第一步的说明文案 | 同义/翻译，建议接受 |
| 8 | s06-c49 / ordinary-summary / scope | {"scope":"footer description"} | 页脚说明；页脚说明文案 | 同义/翻译，建议接受 |
| 9 | s01-c45 / goal-record / scope | {"scope":"调整统计卡片的数字"} | 统计数字；统计卡片数字；统计卡片里的数字 | 同义/翻译，建议接受 |
| 10 | s01-c49 / goal-record / scope | {"scope":"statistics card numbers"} | 统计数字；统计卡片数字；统计卡片中的数字 | 同义/翻译，建议接受 |
| 11 | s02-c49 / goal-record / goal | {"goal":"weekly expense report"} | 每周费用报告；生成每周费用报告 | 同义/翻译，建议接受 |
| 12 | s03-c49 / goal-record / activeDesign | {"activeDesign":"Onboarding design"} | onboarding | 同义/翻译，建议接受 |
| 13 | s03-c49 / goal-record / palette | {"palette":"white background and black text"} | 白底黑字；白底和黑字；白色背景和黑色文字 | 同义/翻译，建议接受 |
| 14 | s06-c49 / goal-record / scope | {"scope":"footer description"} | 页脚说明；页脚说明文案 | 同义/翻译，建议接受 |
| 15 | s03-c49 / goal-record / scope | {"scope":"onboarding第一步的文案"} | 第一步说明文案；onboarding第一步说明文案；onboarding 第一步说明文案；第一步的说明文案 | “第一步的文案”是否足够限定到说明文案？需判断 |
| 16 | s01-c3 / production-matched / font | {"key":"font","text":"system-ui"} | system-ui | 内容看似正确；格式及综合仍失败 |
| 17 | s03-c49 / production-raw / scope | {"key":"scope","text":"onboarding第一步说明文案"} | 第一步说明文案；onboarding第一步说明文案；onboarding 第一步说明文案；第一步的说明文案 | 内容看似正确；格式及综合仍失败 |
| 18 | s06-c49 / production-raw / fileAuthority | {"key":"fileAuthority","text":"no"} | no | 内容看似正确；格式及综合仍失败 |

范围争议原文：“只改 onboarding 第一步的说明文案，后两步保留。”实际回答“onboarding第一步的文案”，省略了“说明”，可能包含标题等其他文案。

来源以冻结 corpus-evaluation.json 的 caseId/key/evidenceSeqs 对应 corpus-inputs.json：s01-c3/font 为 seq 2；s01-c45/scope 为 seq 4；s01-c49/scope 为 seq 48；s02-c49/goal 为 seq 2；s03-c49 的 activeDesign 为 seq 0、2，palette 为 seq 2，scope 为 seq 46；s04-c49/nextAction 为 seq 46；s06-c49/scope 为 seq 48，fileAuthority 为 seq 4、46。原始日志指纹见 DEVELOPMENT_003_RESULTS.md。
