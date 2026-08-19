---
name: json-envelope
description: Format JSON outputs following strict enterprise envelope standards (status, data, error, metadata, timestamp). Use whenever the user asks to format JSON, generate structured API responses, or output data in JSON format.
---

# Enterprise JSON Formatting Skill

This workflow guides you through generating consistent, production-grade JSON responses adhering to enterprise API standards.

## Instructions

When formatting JSON or generating structured data responses:

1. **Envelope Structure**: Always wrap the payload in the standard enterprise envelope:
   ```json
   {
     "status": "success" | "error",
     "code": 200,
     "data": { ... },
     "error": null | { "code": "ERR_CODE", "message": "..." },
     "meta": {
       "timestamp": "ISO-8601 UTC string",
       "version": "v1.0"
     }
   }
   ```

2. **Casing Rules**:
   - Use `camelCase` for all property keys.
   - Use `UPPER_SNAKE_CASE` for error codes and enum values.

3. **Validation**:
   - Never output trailing commas.
   - Ensure all strings are properly escaped.
   - Include the current UTC ISO-8601 timestamp in `meta.timestamp`.

See [references/schema-spec.md](references/schema-spec.md) for detailed schema specifications and edge cases.
