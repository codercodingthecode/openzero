# OpenZero Installer Testing Guide

## Quick Test with Docker

```bash
# Build test image
docker build -f Dockerfile.test -t openzero-test .

# Run interactive shell
docker run -it openzero-test bash

# Inside container, verify:
ls -la ~/.openzero/bin/openzero
ls -la ~/.local/share/openzero/bin/qdrant
ls -la ~/.config/openzero
ls -la ~/.local/share/openzero/memory
```

## Manual Test (curl | bash)

```bash
# From repo root
./install

# Verify installation
which openzero
openzero --version
ls -la ~/.local/share/openzero/bin/qdrant
```

## npm/bun Test

```bash
cd packages/openzero
npm install

# Verify Qdrant downloaded
ls -la ~/.local/share/openzero/bin/qdrant
```

## Verification Checklist

- [ ] OpenZero binary installed to `~/.openzero/bin/openzero`
- [ ] Qdrant binary installed to `~/.local/share/openzero/bin/qdrant`
- [ ] Config directory created at `~/.config/openzero`
- [ ] Memory directory created at `~/.local/share/openzero/memory`
- [ ] OpenZero added to PATH
- [ ] `openzero --version` works
- [ ] First launch is instant (no downloads)
- [ ] Memory system can be configured via TUI

## Platform Coverage

- [x] Linux (ubuntu:22.04)
- [ ] Linux (debian)
- [ ] Linux (alpine)
- [ ] macOS (darwin-arm64)
- [ ] macOS (darwin-x64)
- [ ] Windows

## Notes

- Memory system configuration is **optional** and done via TUI
- No starter config file is created
- All binaries downloaded during installation
- Zero first-run setup delays
