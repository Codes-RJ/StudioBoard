"""Read-only, redacted pattern scan. Never print values or rewrite Git history."""
import argparse
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = {
    "private-key": re.compile(rb"-----BEGIN (?:(?:RSA|EC|OPENSSH|DSA|ENCRYPTED) )?PRIVATE KEY(?: BLOCK)?-----"),
    "pgp-private-key": re.compile(rb"-----BEGIN PGP " + rb"PRIVATE KEY BLOCK-----"),
    "github-token": re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b"),
    "aws-access-id": re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "provider-api-key": re.compile(rb"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}\b"),
    "google-api-key": re.compile(rb"\bAIza[0-9A-Za-z_-]{35}\b"),
    "stripe-live-key": re.compile(rb"\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b"),
    "slack-token": re.compile(rb"\bxox[baprs]-[0-9A-Za-z-]{20,}\b"),
    "gitlab-token": re.compile(rb"\bglpat-[0-9A-Za-z_-]{20,}\b"),
    "pypi-token": re.compile(rb"\bpypi-[0-9A-Za-z_-]{30,}\b"),
    "sendgrid-key": re.compile(rb"\bSG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}\b"),
    "npm-token": re.compile(rb"\bnpm_[0-9A-Za-z]{30,}\b"),
}
MAX_BYTES = 32 * 1024 * 1024


def inspect_bytes(data, label, findings):
    binary = b"\x00" in data[:8192]
    for rule, pattern in PATTERNS.items():
        for match in pattern.finditer(data):
            findings.append({"location": label, "line": data.count(b"\n", 0, match.start()) + 1, "rule": rule})
    return "binary" if binary else "text"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--history", action="store_true")
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--output", default="test-results/secret-scan.json")
    args = parser.parse_args()
    findings, skipped = [], []
    paths = git("ls-files", "-z", "--cached", "--others", "--exclude-standard").decode().split("\0")
    if args.build:
        paths += [str(path.relative_to(ROOT)) for path in (ROOT / "frontend/dist").rglob("*") if path.is_file()]
    source_count = 0
    for name in sorted(set(filter(None, paths))):
        path = ROOT / name
        if not path.is_file():
            continue
        if path.stat().st_size > MAX_BYTES:
            skipped.append({"location": name, "reason": "oversize"})
            continue
        source_count += 1
        if inspect_bytes(path.read_bytes(), name, findings) == "binary":
            skipped.append({"location": name, "reason": "binary"})
    history_count = 0
    if args.history:
        objects = [line.split(b" ", 1)[0] for line in git("rev-list", "--objects", "--all").splitlines()]
        process = subprocess.Popen(["git", "cat-file", "--batch"], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        try:
            for object_id in objects:
                process.stdin.write(object_id + b"\n")
                process.stdin.flush()
                header = process.stdout.readline().split()
                if len(header) != 3:
                    raise RuntimeError("Invalid Git object response")
                size = int(header[2])
                if header[1] == b"blob" and size <= MAX_BYTES:
                    data = process.stdout.read(size)
                    history_count += 1
                    inspect_bytes(data, "git-blob:" + object_id.decode(), findings)
                else:
                    remaining = size
                    while remaining:
                        chunk = process.stdout.read(min(remaining, 1024 * 1024))
                        if not chunk:
                            raise RuntimeError("Truncated Git object")
                        remaining -= len(chunk)
                    if header[1] == b"blob":
                        skipped.append({"location": "git-blob:" + object_id.decode(), "reason": "oversize"})
                process.stdout.read(1)
        finally:
            process.stdin.close()
            process.wait()
    report = {"sourceFiles": source_count, "historyBlobs": history_count, "findings": findings, "skipped": skipped,
              "boundary": "High-confidence patterns only; binary files are byte-scanned but not semantically inspected, oversize files and ignored operator env/data remain outside evidence. Values redacted."}
    output = ROOT / args.output
    if not output.resolve().is_relative_to(ROOT):
        raise ValueError("Report must remain in the workspace")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"sourceFiles": source_count, "historyBlobs": history_count, "findings": len(findings), "skipped": len(skipped)}))
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
