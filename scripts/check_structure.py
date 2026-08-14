import sys
from pathlib import Path

EXPECTED_PATHS = [
    "AGENTS.md",
    "GEMINI.md",
    "CLAUDE.md",
    "docs/EXECUTION_PLAN.md",
    "docs/SECURITY_RULES.md",
    "docs/API_CONTRACT.md",
    "docs/adr/001-shift-optimization-engine-selection.md",
    "docs/adr/002-infrastructure-selection.md",
    "docs/adr/003-frontend-ui-selection.md",
    "backend/requirements.txt",
    "backend/requirements-dev.txt",
    "backend/pyproject.toml",
    "backend/app/main.py",
    "backend/app/config.py",
    "backend/app/schemas/scheduler.py",
    "backend/app/middleware/security_headers.py",
    "backend/app/middleware/payload_limit.py",
    "backend/app/api/v1/health.py",
    "backend/app/api/v1/optimize.py",
    "backend/tests/test_health.py",
    "backend/tests/test_security.py",
    "backend/tests/test_schemas.py",
    "frontend/package.json",
    "frontend/tsconfig.json",
    "frontend/next.config.js",
    "frontend/src/lib/types.ts",
    "frontend/src/lib/mock-data.ts",
    "frontend/src/app/layout.tsx",
    "frontend/src/app/page.tsx",
    "frontend/src/styles/globals.css",
]

root = Path(__file__).resolve().parent.parent
missing = []

for rel_path in EXPECTED_PATHS:
    full_path = root / rel_path
    if not full_path.exists():
        missing.append(rel_path)
    elif full_path.is_file() and full_path.stat().st_size == 0:
        missing.append(f"{rel_path} (Empty file 0 bytes)")

if missing:
    print("[ERROR] Missing or invalid expected structure:")
    for m in missing:
        print(f"  - {m}")
    sys.exit(1)

print(f"[OK] All {len(EXPECTED_PATHS)} expected structure files exist and are non-empty.")
sys.exit(0)
