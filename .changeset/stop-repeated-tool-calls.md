---
"@open-codesign/core": patch
---

Stop a run that keeps repeating the same tool call. When the model makes the same call with identical arguments three times in a row, or repeats the same short sequence of calls three times, the call is blocked and the model reads a reason telling it to change approach. At five repeats the run ends with the incomplete-generation error, no further tool or model request runs, and the workspace files are kept. A call with different arguments starts the count again, `done` keeps its own repair limit, and there is no cap on how many times a tool is called in total.
