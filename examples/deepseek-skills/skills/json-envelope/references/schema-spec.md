# Enterprise JSON Schema Specification

## Error Envelope Details
When an error occurs, the `data` field should be `null` and the `error` field must follow:

```json
{
  "code": "VALIDATION_FAILED",
  "message": "Human readable explanation",
  "details": [
    {
      "field": "user.email",
      "issue": "Invalid email address format"
    }
  ]
}
```

## Pagination Envelope
For list payloads, include pagination inside `meta`:

```json
{
  "meta": {
    "page": 1,
    "limit": 50,
    "totalCount": 142,
    "totalPages": 3,
    "timestamp": "2026-08-19T18:00:00Z"
  }
}
```
