#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="wendy-curves"
PORT="8087"
SMOKE_TIMEOUT=30
KEEP_IMAGES=3

red()   { printf '\033[1;31m%s\033[0m\n' "$*"; }
green() { printf '\033[1;32m%s\033[0m\n' "$*"; }
info()  { printf '\033[1;34m→ %s\033[0m\n' "$*"; }

die() { red "ERROR: $*" >&2; exit 1; }

prune_all() {
  info "Pruning unused Docker resources"
  docker container prune -f >/dev/null 2>&1 || true
  docker image prune -a -f >/dev/null 2>&1 || true
  docker builder prune -f >/dev/null 2>&1 || true
}

REDEPLOY=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --redeploy) REDEPLOY=true; shift ;;
    --help|-h) echo "Usage: $0 [--redeploy]"; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

SHORT_SHA=$(git rev-parse --short HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
GIT_TAG="${BRANCH}-${SHORT_SHA}"
CONTAINER="${IMAGE}-${GIT_TAG}"

DEPLOY_START=$SECONDS

LOCK_FILE="/tmp/wendy-curves-deploy.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  die "Another deploy is already running (lock: $LOCK_FILE)"
fi

ENV_ARGS=()
if [[ -f .env ]]; then
  info "Loading env vars from .env"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "${line// /}" || "$line" == \#* ]] && continue
    [[ "$line" != *"="* ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    value="${value%\"}" ; value="${value#\"}"
    value="${value%\'}" ; value="${value#\'}"
    ENV_ARGS+=(-e "$key=$value")
  done < .env
fi

if [[ "$REDEPLOY" == "true" ]]; then
  if ! docker image inspect "$IMAGE:$GIT_TAG" >/dev/null 2>&1; then
    die "Image $IMAGE:$GIT_TAG not found. Cannot --redeploy without an existing image."
  fi
  info "Fast-track redeploy — skipping build and smoke test"
fi

info "Deploying $IMAGE:$GIT_TAG"

if [[ "$REDEPLOY" != "true" ]]; then
  info "Building Docker image"
  docker build --build-arg "GIT_HASH=$SHORT_SHA" -t "$IMAGE:$GIT_TAG" .
  green "Build succeeded"
fi

mkdir -p data

if [[ "$REDEPLOY" != "true" ]]; then
  info "Running smoke test"
  SMOKE_NAME="${IMAGE}-smoke-$$"
  SMOKE_PORT=8099

  docker run -d \
    --name "$SMOKE_NAME" \
    --network host \
    "${ENV_ARGS[@]+"${ENV_ARGS[@]}"}" \
    -e "WENDY_CURVES_PORT=${SMOKE_PORT}" \
    -e "WENDY_CURVES_DB_PATH=:memory:" \
    -e "WENDY_CURVES_WENDY_URL=http://127.0.0.1:1" \
    "$IMAGE:$GIT_TAG" >/dev/null

  smoke_cleanup() { docker rm -f "$SMOKE_NAME" >/dev/null 2>&1 || true; }
  trap smoke_cleanup EXIT

  passed=false
  for i in $(seq 1 "$SMOKE_TIMEOUT"); do
    http_code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$SMOKE_PORT/api/health" 2>/dev/null) || http_code="000"
    if [[ "$http_code" == "200" ]]; then
      passed=true
      break
    fi
    sleep 1
  done

  if [[ "$passed" != "true" ]]; then
    red "Smoke test failed — /api/health did not return 200 within ${SMOKE_TIMEOUT}s"
    docker logs "$SMOKE_NAME" --tail 50 2>&1 || true
    smoke_cleanup
    trap - EXIT
    exit 1
  fi

  green "Smoke test passed"
  smoke_cleanup
  trap - EXIT
fi

OLD_NAME=""
for cid in $(docker ps -q -f "name=${IMAGE}"); do
  name=$(docker inspect --format '{{.Name}}' "$cid" | sed 's|^/||')
  info "Stopping $name"
  OLD_NAME="$name"
  docker stop --time=10 "$cid" >/dev/null
done

if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  docker rm "$CONTAINER" >/dev/null
fi

info "Starting $CONTAINER"
docker run -d \
  --name "$CONTAINER" \
  --network host \
  -v "$(pwd)/data:/app/data" \
  "${ENV_ARGS[@]+"${ENV_ARGS[@]}"}" \
  --restart unless-stopped \
  --log-driver json-file \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  "$IMAGE:$GIT_TAG" >/dev/null

info "Waiting for health check"
passed=false
for i in $(seq 1 15); do
  if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    passed=true
    break
  fi
  sleep 1
done

if [[ "$passed" != "true" ]]; then
  red "Health check failed — automatic rollback"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  if [[ -n "$OLD_NAME" ]]; then
    docker start "$OLD_NAME" >/dev/null 2>&1 || true
    red "Rolled back to $OLD_NAME"
  fi
  exit 1
fi

green "Health check passed"

if [[ -n "$OLD_NAME" && "$OLD_NAME" != "$CONTAINER" ]]; then
  docker rm "$OLD_NAME" >/dev/null 2>&1 || true
fi

if [[ "$KEEP_IMAGES" -gt 0 ]]; then
  old_images=$(docker images "$IMAGE" --format '{{.Tag}}' \
    | grep -v '<none>' \
    | sort -V \
    | head -n -"$KEEP_IMAGES" || true)
  for old_tag in $old_images; do
    docker rmi "$IMAGE:$old_tag" >/dev/null 2>&1 || true
  done
fi

prune_all

ELAPSED=$(( SECONDS - DEPLOY_START ))
green "Deployment complete in ${ELAPSED}s"
echo "  Image:     $IMAGE:$GIT_TAG"
echo "  Container: $CONTAINER"
echo "  URL:       http://$(hostname -I | awk '{print $1}'):${PORT}"
