#!/bin/bash

# GitHub Actions Runner Entrypoint
# This script configures and starts the runner

set -e

# Check required environment variables
if [ -z "$RUNNER_TOKEN" ]; then
    echo "Error: RUNNER_TOKEN environment variable is required"
    exit 1
fi

if [ -z "$RUNNER_NAME" ]; then
    RUNNER_NAME="docker-runner-$(hostname)"
fi

if [ -z "$RUNNER_WORKDIR" ]; then
    RUNNER_WORKDIR="_work"
fi

REPO_URL="${REPO_URL:-https://github.com/codercodingthecode/openzero}"
RUNNER_LABELS="${RUNNER_LABELS:-self-hosted,linux,x64,docker}"

# Ensure work directory exists with proper ownership
if [ ! -d "$RUNNER_WORKDIR" ]; then
    mkdir -p "$RUNNER_WORKDIR"
elif [ ! -w "$RUNNER_WORKDIR" ]; then
    # If directory exists but isn't writable, fix ownership via sudo
    sudo chown -R runner:runner "$RUNNER_WORKDIR"
fi

# Configure the runner if not already configured
if [ ! -f ".runner" ]; then
    echo "Configuring GitHub Actions Runner..."
    ./config.sh \
        --url "$REPO_URL" \
        --token "$RUNNER_TOKEN" \
        --name "$RUNNER_NAME" \
        --work "$RUNNER_WORKDIR" \
        --labels "$RUNNER_LABELS" \
        --unattended \
        --replace
fi

# Cleanup function
cleanup() {
    echo "Removing runner..."
    if [ -f ".runner" ]; then
        ./config.sh remove --token "$RUNNER_TOKEN"
    fi
}

trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

# Start the runner
echo "Starting GitHub Actions Runner..."
./run.sh & wait $!
