"""
DeepChart Security & Secret Scanner
Scans codebase for accidentally committed secrets, API keys, or private tokens.
"""

import os
import re
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent

EXCLUDE_DIRS = {
    ".git",
    "target",
    "node_modules",
    "dist",
    ".pytest_cache",
    ".gemini",
    "graphify-out",
}

SECRET_PATTERNS = [
    re.compile(r"""(?i)(?:api_key|secret_key|private_key|auth_token)\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}['"]"""),
    re.compile(r"""(?i)-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----"""),
    re.compile(r"""(?i)ghp_[a-zA-Z0-9]{36}"""), # GitHub token
    re.compile(r"""(?i)xox[baprs]-[a-zA-Z0-9]{10,48}"""), # Slack token
]

def scan_files():
    violations = []
    for root, dirs, files in os.walk(BASE_DIR):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in files:
            path = Path(root) / f
            if path.suffix in {".exe", ".ico", ".png", ".jpg", ".bin", ".dat", ".crc"}:
                continue
            try:
                content = path.read_text(encoding="utf-8", errors="ignore")
                for pattern in SECRET_PATTERNS:
                    match = pattern.search(content)
                    if match:
                        violations.append((str(path.relative_to(BASE_DIR)), match.group(0)[:30]))
            except Exception as e:
                pass
    return violations

if __name__ == "__main__":
    found = scan_files()
    if found:
        print(f"FAILED: Found {len(found)} potential hardcoded secrets:")
        for file, sample in found:
            print(f"  {file}: {sample}")
        sys.exit(1)
    else:
        print("PASS: Zero hardcoded secrets found in codebase.")
        sys.exit(0)
