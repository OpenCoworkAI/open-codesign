---
"@open-codesign/core": patch
"@open-codesign/desktop": patch
---

Keep generation ownership until cancellation and cleanup settle. Bind clarification,
preview, verification, and workspace publication to cancellation; prevent cancelled
prompt/recovery admissions and preserve queued messages for explicit recovery.

Use pi's sequential ask barrier and reject remaining tools when the third failed
done check exhausts repair attempts. Report incomplete verification without another
provider turn or misclassifying the repair limit as a user cancellation.
