# OpenZero Self-Hosted GitHub Actions Runner (Docker)

This setup runs a GitHub Actions self-hosted runner inside a Docker container on your lab VPS.

## Prerequisites

- Docker and Docker Compose installed on lab VPS
- GitHub repository admin access to generate runner tokens

## Setup Instructions

### 1. Generate Runner Token

Go to your repository settings:

```
https://github.com/codercodingthecode/openzero/settings/actions/runners/new
```

Copy the registration token shown (it looks like `A...` and expires in 1 hour).

### 2. Deploy to Lab VPS

Transfer these files to your lab box:

```bash
scp -r docker-runner/ lab:~/openzero-runner/
```

SSH into lab:

```bash
ssh lab
cd ~/openzero-runner
```

### 3. Configure Environment

Create `.env` file:

```bash
cat > .env << 'EOF'
RUNNER_TOKEN=YOUR_REGISTRATION_TOKEN_HERE
RUNNER_NAME=openzero-lab-runner
REPO_URL=https://github.com/codercodingthecode/openzero
RUNNER_LABELS=self-hosted,linux,x64,docker,lab
EOF
```

Replace `YOUR_REGISTRATION_TOKEN_HERE` with the token from step 1.

### 4. Build and Start

```bash
sudo docker-compose up -d --build
```

### 5. Verify

Check logs:

```bash
sudo docker-compose logs -f
```

Check runner status in GitHub:

```
https://github.com/codercodingthecode/openzero/settings/actions/runners
```

## Management Commands

### View logs

```bash
sudo docker-compose logs -f runner
```

### Restart runner

```bash
sudo docker-compose restart runner
```

### Stop runner

```bash
sudo docker-compose down
```

### Rebuild after changes

```bash
sudo docker-compose up -d --build
```

### Remove completely

```bash
sudo docker-compose down -v
```

## Updating Workflows

To use this runner, add the label to your workflow:

```yaml
jobs:
  build:
    runs-on: [self-hosted, linux, x64, docker, lab]
```

## Notes

- Runner has Docker-in-Docker support via socket mount
- Privileged mode enabled for full Docker functionality
- Bun and Node.js LTS pre-installed
- Runner auto-restarts unless stopped manually
- Registration token expires after 1 hour (generate new if needed)
