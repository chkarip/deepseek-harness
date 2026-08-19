#!/usr/bin/env python3
"""
Enterprise JSON Validator and Formatter Helper Script
"""
import sys
import json
from datetime import datetime, timezone

def format_envelope(data, status="success", error=None):
    return {
        "status": status,
        "code": 200 if status == "success" else 400,
        "data": data if status == "success" else None,
        "error": error,
        "meta": {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "version": "v1.0"
        }
    }

if __name__ == "__main__":
    sample = {"userId": 123, "userName": "chris"}
    print(json.dumps(format_envelope(sample), indent=2))
