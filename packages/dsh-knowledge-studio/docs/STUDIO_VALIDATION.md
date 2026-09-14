# Studio output validation

Studio accepts useful results with missing optional information. It never adds factual content to satisfy a schema. Generation still uses the current workspace evidence; omitting provenance metadata does not authorize inventing facts.

| Input or result | Behavior |
| --- | --- |
| Missing, malformed or unknown optional reference IDs | Retain exact known IDs only. Do not guess a label; omit an empty reference section or spreadsheet source sheet. |
| Missing report section heading, slide title, column heading, metric label, time label or speaker notes | Omit the field. The shared slide renderer fits the visible content without manufacturing a title. |
| Missing trailing spreadsheet cells | Leave them empty. Surplus cells without matching columns remain an error because their meaning is ambiguous. |
| Fewer valid questions or flashcards than requested | Save usable items and report their actual count. Do not pad, invent answers or repeat generation to reach a count. |
| Missing/invalid answer index, blank quiz options, one-sided flashcards | Reject that unusable item without reindexing options. A result with no usable items fails. |
| Invalid JSON, empty visible content, unknown layout, cyclic/unknown mindmap parents | Fail with the original draft retained. |
| File permissions, denial, cancellation, corrupt OOXML, unsafe paths, unreadable output or resource limits | Remain enforced. Successful model text does not imply successful file generation. |
| Template title/marker conventions or narrative ratios | Optional editorial guidance; standard file validation does not require them. |
| Saved Office export recovery | Accept zero references. Revalidate saved content and any citation snapshots, check the saved content hash, and preserve provider/permission restrictions. |

Reports, tables and slides share the actual-file preview service. Opening an existing artifact never calls the model or recreates a missing Office file. Runtime checks cover stored artifacts without sidecars, changed source bytes, sandbox isolation, native Sidebar fullscreen, zoom and original-file downloads on DSH 0.1.5-rc.1.
