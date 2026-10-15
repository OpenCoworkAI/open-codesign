---
"@open-codesign/desktop": patch
---

Read DOCX, PPTX and XLSX attachments as text. Until now the model got only a note that the file was a binary format. It now gets the text of the document, slide by slide or sheet by sheet, up to the same 6,000 characters as a text attachment, and anything a limit cuts is marked in the text so the model can tell it is partial. A file that cannot be read as the format it claims, or that unpacks to more than 32 MB of text, fails the attachment with a message that names the file. PDF and the older `.doc`, `.ppt` and `.xls` keep the filename note. The Files tab preview shares the parsers and keeps its own limits; they now read XML in a single pass, so a malformed file can no longer stall the app, decode text once, so `&lt;div&gt;` is no longer lost, and read the cell after an empty styled cell correctly.
