#!/usr/bin/env bash
# ============================================================
# TrackLiv — deploy from your terminal to trackliv.dd-gruppe.de
#
#   ./deploy.sh             upload + build on the server + start
#   ./deploy.sh --dry-run   only show what would be uploaded
#   ./deploy.sh --no-build  upload + restart with the image already on the server
#   ./deploy.sh --status    container status, health and the last log lines
#   ./deploy.sh --logs      follow the server log (Ctrl+C to stop)
#   ./deploy.sh --fleetgo-check   sign in to FleetGO once and show what TrackLiv sees (no secrets shown)
#   ./deploy.sh --reset-data      deploy and start over with the starting data (old data kept as a backup)
#
# Runs next to Registra Atlas on the same server: TrackLiv is one container
# (trackliv-app) in the docker network "atlas-edge"; the Caddy that already
# serves atlas.dd-gruppe.de also serves trackliv.dd-gruppe.de (TLS automatic).
# People sign in with their Registra Atlas account: every deploy copies the
# Atlas sign-in settings (Konto-Dienst, Supabase fallback) from Atlas' .env.
#
# Prerequisites (once):
#   * DNS A record  trackliv.dd-gruppe.de → the server   (dig +short trackliv.dd-gruppe.de)
#   * Registra Atlas' Caddy loads extra sites from deploy/sites/
#     (deploy/registra-atlas-edge.patch — the script tells you if it is missing)
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

VERSION="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json | head -1)"

STEP="start"
trap 'rc=$?; echo ""; echo "✗ Deploy aborted during: ${STEP} (exit ${rc}) — the running version was not replaced."; exit $rc' ERR

if [[ ! -f package.json || ! -f deploy/docker-compose.yml ]]; then
  echo "✗ Please start this from the TrackLiv project folder (the one with package.json and deploy/)."
  exit 1
fi

# --- server settings ------------------------------------------------------------------------
# Kept in deploy/server.env (git-ignored – the repository is public). Asked for once.
CONF="deploy/server.env"
if [[ ! -f "$CONF" ]]; then
  echo "── First run: where should TrackLiv be deployed? (saved in ${CONF}, not committed)"
  read -r -p "   SSH login (user@host): " IN_SERVER
  read -r -p "   SSH port [22]: " IN_PORT
  read -r -p "   Require a login with the Registra Atlas accounts? (Y/n): " IN_LOGIN
  [[ "$IN_LOGIN" =~ ^[nN] ]] && IN_LOGIN="off" || IN_LOGIN="on"
  cat > "$CONF" <<EOF
# TrackLiv deploy target – not committed (see .gitignore)
SERVER="${IN_SERVER}"
SSH_PORT="${IN_PORT:-22}"
# on = sign-in with the Registra Atlas accounts, off = anyone with the link can use TrackLiv (demo).
LOGIN="${IN_LOGIN}"
# Who may sign in: admins (Atlas administrators), all (every active Atlas account),
# or admins plus e-mails, e.g. "admins,dispo@dd-gruppe.de,lager@dd-gruppe.de". Applied on every deploy.
ACCESS="admins"
DOMAIN="trackliv.dd-gruppe.de"
DEST="/opt/trackliv"
# Caddy of Registra Atlas loads every *.caddy file in this folder
SITES_DIR="/opt/registra-atlas/deploy/sites"
EDGE_NETWORK="atlas-edge"
EOF
  echo "   saved."
fi
# shellcheck disable=SC1090
source "$CONF"
: "${SERVER:?SERVER missing in ${CONF}}"
SSH_PORT="${SSH_PORT:-22}"
DOMAIN="${DOMAIN:-trackliv.dd-gruppe.de}"
DEST="${DEST:-/opt/trackliv}"
SITES_DIR="${SITES_DIR:-/opt/registra-atlas/deploy/sites}"
EDGE_NETWORK="${EDGE_NETWORK:-atlas-edge}"
LOGIN="${LOGIN:-on}"
if [[ "$LOGIN" != "on" && "$LOGIN" != "off" ]]; then echo "✗ LOGIN in ${CONF} must be \"on\" or \"off\""; exit 1; fi
ACCESS="${ACCESS:-admins}"
if [[ ! "$ACCESS" =~ ^[A-Za-z0-9@._+,\ -]+$ ]]; then echo "✗ ACCESS in ${CONF}: admins, all, or e-mail addresses separated by commas"; exit 1; fi
# Registra Atlas on the server (its .env holds the sign-in settings) and, on this computer, its project
# folder (only for Atlas' public Supabase key, used as the fallback sign-in).
ATLAS_HOME="${ATLAS_HOME:-/opt/registra-atlas}"
ATLAS_DIR="${ATLAS_DIR:-$HOME/Documents/GitHub/registra-atlas}"
KONTO_NETWORK="${KONTO_NETWORK:-atlas-konto}"
SSH=(ssh -p "${SSH_PORT}" -o ServerAliveInterval=30)
MODE="${1:-}"

RSYNC_EXCLUDES=(
  --exclude node_modules --exclude 'apps/web/dist' --exclude .git --exclude screenshots
  --exclude docs --exclude test-results --exclude 'apps/server/var' --exclude 'scripts/geo/.cache'
  --exclude __pycache__ --exclude .env --exclude deploy/server.env --exclude .build-ca.crt
)
COMPOSE="cd ${DEST}/app && TRACKLIV_HOME=${DEST} TRACKLIV_UID=\$(id -u) TRACKLIV_GID=\$(id -g) TRACKLIV_EDGE_NETWORK=${EDGE_NETWORK} TRACKLIV_KONTO_NETWORK=${KONTO_NETWORK} docker compose --env-file ${DEST}/.env -f deploy/docker-compose.yml"

case "$MODE" in
  --dry-run)
    echo "── DRY RUN — nothing will be changed"
    rsync -az --delete --dry-run -v -e "ssh -p ${SSH_PORT}" "${RSYNC_EXCLUDES[@]}" ./ "${SERVER}:${DEST}/app/" | sed -n '1,60p'
    echo "── DRY RUN done."
    exit 0 ;;
  --status)
    "${SSH[@]}" "${SERVER}" "${COMPOSE} ps; echo; docker inspect -f 'health: {{.State.Health.Status}}' trackliv-app 2>/dev/null || true; echo; docker logs --tail 40 trackliv-app 2>&1"
    exit 0 ;;
  --logs)
    "${SSH[@]}" -t "${SERVER}" "docker logs -f --tail 100 trackliv-app"
    exit 0 ;;
  --fleetgo-check)
    "${SSH[@]}" "${SERVER}" "docker exec trackliv-app node --import tsx apps/server/src/fleetgo-check.ts" || true
    exit 0 ;;
  --reset-data)
    echo "This replaces ALL TrackLiv data on the server (people, vehicles, projects, plans, log) with the"
    echo "starting data. The current data is kept in ${DEST}/data/backups/."
    read -r -p "Type 'reset' to continue: " CONFIRM
    [[ "$CONFIRM" == "reset" ]] || { echo "Cancelled – nothing changed."; exit 1; } ;;
  ""|--no-build) ;;
  *) echo "Unknown option ${MODE} (use --dry-run, --no-build, --status, --logs, --fleetgo-check or --reset-data)"; exit 1 ;;
esac
echo "▶ Deploying TrackLiv ${VERSION:-dev} to ${SERVER} → https://${DOMAIN}"

STEP="1/6 connection"
echo "── 1/6 Checking the connection and creating ${DEST}"
if ! "${SSH[@]}" "${SERVER}" "mkdir -p ${DEST}/app ${DEST}/data/backups"; then
  echo "✗ Connection or write permission failed."
  echo "  If it is a permission problem, run this once on the server:"
  echo "    sudo mkdir -p ${DEST} && sudo chown -R \$(whoami):\$(whoami) ${DEST}"
  exit 1
fi

STEP="2/6 upload of the source"
echo "── 2/6 Source → ${SERVER}:${DEST}/app/"
rsync -az --delete -e "ssh -p ${SSH_PORT}" "${RSYNC_EXCLUDES[@]}" ./ "${SERVER}:${DEST}/app/"

STEP="3/6 server .env"
echo "── 3/6 Server settings (${DEST}/.env)"
# The server .env holds FleetGO credentials and the sign-in settings – it never leaves the server.
# First deploy: create it from .env.example and generate the session secret. LOGIN (deploy/server.env)
# decides whether TRACKLIV_AUTH=off is set. With the login on, the Registra Atlas sign-in settings are
# copied from Atlas' .env on every deploy (so they stay current); without an Atlas on the server an
# Admin login of TrackLiv's own is created instead.
SB_ANON_LOCAL=""
if [[ -r "${ATLAS_DIR}/.env" ]]; then
  SB_ANON_LOCAL="$(sed -n 's/^VITE_SUPABASE_ANON_KEY=//p' "${ATLAS_DIR}/.env" | tail -1 | tr -d "\"' \r")"
  [[ "$SB_ANON_LOCAL" =~ ^[A-Za-z0-9._-]+$ ]] || SB_ANON_LOCAL=""
fi
"${SSH[@]}" "${SERVER}" "bash -s" <<REMOTE
set -e
cd ${DEST}
setenv() { sed -i "/^\$1=/d" .env; if [ -n "\$2" ]; then printf '%s=%s\n' "\$1" "\$2" >> .env; fi; }
ATLAS_ENV='${ATLAS_HOME}/.env'
aget() { if [ -r "\$ATLAS_ENV" ]; then sed -n "s/^\$1=//p" "\$ATLAS_ENV" | tail -1 | tr -d "\"' \r"; fi; }
if [ ! -f .env ]; then cp app/.env.example .env; chmod 600 .env; echo '   created .env from .env.example'; fi
if ! grep -Eq '^TRACKLIV_SESSION_SECRET=[0-9a-fA-F]{64}\$' .env; then
  echo "TRACKLIV_SESSION_SECRET=\$(openssl rand -hex 32)" >> .env; echo '   session secret: generated'; fi
if [ ${LOGIN} = off ]; then
  grep -q '^TRACKLIV_AUTH=off\$' .env || echo 'TRACKLIV_AUTH=off' >> .env
  echo '   Login: OFF – anyone with the link can use TrackLiv (LOGIN="on" in deploy/server.env switches it on)'
else
  sed -i '/^TRACKLIV_AUTH=off\$/d' .env
  KONTO_KEY=\$(aget KONTO_ANON_KEY); PRIM=\$(aget KONTO_PRIMAER); SB_URL=\$(aget SUPABASE_URL)
  SB_ANON=\$(aget VITE_SUPABASE_ANON_KEY); [ -n "\$SB_ANON" ] || SB_ANON=\$(aget SUPABASE_ANON_KEY); [ -n "\$SB_ANON" ] || SB_ANON='${SB_ANON_LOCAL}'
  [ -n "\$SB_URL" ] || SB_ANON=''
  if [ -n "\$KONTO_KEY" ] || [ -n "\$SB_ANON" ]; then
    if [ -n "\$KONTO_KEY" ]; then setenv ATLAS_AUTH_URL http://registra-konto-dienst:8100; else setenv ATLAS_AUTH_URL ''; fi
    setenv ATLAS_ANON_KEY "\$KONTO_KEY"
    setenv ATLAS_PRIMARY "\${PRIM:-aus}"
    setenv ATLAS_SUPABASE_URL "\$SB_URL"
    setenv ATLAS_SUPABASE_ANON_KEY "\$SB_ANON"
    setenv ATLAS_ACCESS '${ACCESS}'
    if [ "\${PRIM:-aus}" = an ] && [ -n "\$KONTO_KEY" ]; then VIA="Konto-Dienst\${SB_ANON:+, Supabase as fallback}"
    elif [ -n "\$SB_ANON" ]; then VIA='Supabase (Atlas KONTO_PRIMAER is off)'
    else VIA='Konto-Dienst – note: KONTO_PRIMAER is off in Atlas and no Supabase key was found'; fi
    echo "   Login: Registra Atlas accounts via \$VIA · access: ${ACCESS}"
    if [ -n "\$KONTO_KEY" ] && ! docker ps --format '{{.Names}}' | grep -qx registra-konto-dienst; then
      echo '   ! registra-konto-dienst is not running – sign-in works only through the Supabase fallback'; fi
  else
    for k in ATLAS_AUTH_URL ATLAS_ANON_KEY ATLAS_PRIMARY ATLAS_SUPABASE_URL ATLAS_SUPABASE_ANON_KEY ATLAS_ACCESS; do setenv \$k ''; done
    echo "   ! No Registra Atlas sign-in found in ${ATLAS_HOME}/.env – using TrackLiv logins (TRACKLIV_USERS)"
    if ! grep -Eq '^TRACKLIV_USERS=.+' .env; then
      PW=\$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-16)
      echo "TRACKLIV_USERS=Admin:\$PW" >> .env
      echo ''
      echo '   ┌──────────────────────────────────────────────────────────────'
      echo "   │ First login:  Admin  /  \$PW"
      echo "   │ More people:  TRACKLIV_USERS=Admin:…,Name:password  in ${DEST}/.env"
      echo '   └──────────────────────────────────────────────────────────────'
      echo ''
    fi
  fi
fi
if grep -Eq '^FLEETGO_CLIENT_ID=.+' .env; then echo '   FleetGO: API keys present – live vehicle data via the FleetGO API'
elif grep -Eq '^FLEETGO_USERNAME=.+' .env && grep -Eq '^FLEETGO_PASSWORD=.+' .env; then echo '   FleetGO: login present – live vehicle data via the FleetGO dashboard (./deploy.sh --fleetgo-check to test)'
else echo '   FleetGO: no login yet – demo simulator (add FLEETGO_USERNAME/FLEETGO_PASSWORD to .env, then ./deploy.sh --no-build)'; fi
REMOTE

STEP="4/6 backup"
echo "── 4/6 Backup of the current data"
"${SSH[@]}" "${SERVER}" "cd ${DEST}/data && if [ -f db.json ]; then cp db.json backups/predeploy-\$(date +%Y%m%d-%H%M%S).json && ls -1t backups/predeploy-*.json | tail -n +21 | xargs -r rm -f && echo '   saved data/backups/predeploy-…json'; else echo '   nothing yet (first deploy)'; fi"

if [[ "$MODE" == "--reset-data" ]]; then
  STEP="4/6 reset of the data"
  "${SSH[@]}" "${SERVER}" "docker stop trackliv-app >/dev/null 2>&1 || true; cd ${DEST}/data && if [ -f db.json ]; then mv db.json backups/reset-\$(date +%Y%m%d-%H%M%S).json && echo '   old data moved to data/backups/reset-…json – starting fresh'; fi"
fi

STEP="5/6 docker compose build + start"
if [[ "$MODE" == "--no-build" ]]; then
  echo "── 5/6 Restarting with the existing image"
  BUILD="--no-build"
else
  echo "── 5/6 Building and starting on the server (tests + type check run inside the build)"
  BUILD="--build"
fi
"${SSH[@]}" "${SERVER}" "for n in ${EDGE_NETWORK} ${KONTO_NETWORK}; do docker network inspect \$n >/dev/null 2>&1 || docker network create \$n >/dev/null; done; ${COMPOSE} up -d ${BUILD} --remove-orphans"
echo "   waiting for the health check …"
"${SSH[@]}" "${SERVER}" "for i in \$(seq 1 40); do s=\$(docker inspect -f '{{.State.Health.Status}}' trackliv-app 2>/dev/null || echo missing); [ \"\$s\" = healthy ] && echo '   trackliv-app: healthy' && exit 0; sleep 3; done; echo '   ✗ not healthy after 2 min – last log lines:'; docker logs --tail 60 trackliv-app; exit 1"
if [[ "$LOGIN" == "on" ]]; then
  # the server logs whether Atlas' sign-in answers (Konto-Dienst / Supabase)
  "${SSH[@]}" "${SERVER}" "for i in \$(seq 1 12); do L=\$(docker logs --since 5m trackliv-app 2>&1 | grep -F '[auth] sign-in' | tail -1); [ -n \"\$L\" ] && echo \"   \$L\" && exit 0; sleep 1; done; true"
fi

STEP="6/6 Caddy (edge proxy)"
echo "── 6/6 Caddy site for ${DOMAIN}"
"${SSH[@]}" "${SERVER}" "set -e
  C=\$(docker ps --format '{{.Names}}' | grep -E '^(registra-edge-caddy|registra-caddy)\$' | head -1 || true)
  if [ -z \"\$C\" ]; then echo '   ✗ No Registra Atlas Caddy container is running on this server.'; exit 3; fi
  if ! mkdir -p ${SITES_DIR} 2>/dev/null || ! sed 's/^trackliv.dd-gruppe.de {/${DOMAIN} {/' ${DEST}/app/deploy/trackliv.caddy > ${SITES_DIR}/trackliv.caddy 2>/dev/null; then
    echo '   ✗ Cannot write ${SITES_DIR} – run once on the server:  sudo mkdir -p ${SITES_DIR} && sudo chown \$(whoami) ${SITES_DIR}'; exit 3; fi
  if ! docker exec \"\$C\" grep -q 'import /etc/caddy/sites/' /etc/caddy/Caddyfile || ! docker exec \"\$C\" test -f /etc/caddy/sites/trackliv.caddy; then
    echo \"   ! \$C does not load ${SITES_DIR} yet – TrackLiv runs, but is not reachable from outside.\"
    echo '     Apply deploy/registra-atlas-edge.patch to Registra Atlas and run its ./deploy.sh once,'
    echo '     then run ./deploy.sh --no-build here again.'
    exit 4
  fi
  if ! OUT=\$(docker exec \"\$C\" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1); then
    echo \"\$OUT\" | tail -n 15
    echo \"   ✗ \$C rejected the new config – it keeps serving the previous one (Atlas is not affected).\"; exit 1; fi
  echo \"   \$C reloaded (zero downtime)\"" || {
  rc=$?
  if [[ $rc -eq 4 || $rc -eq 3 ]]; then
    echo ""
    echo "⚠ Deployed, but ${DOMAIN} is not routed yet (see above)."
    exit 0
  fi
  exit $rc
}

echo ""
echo "✔ Done: https://${DOMAIN}"
echo "  The first call can take ~30 s (Caddy fetches the TLS certificate)."
echo "  Prerequisite: DNS A record ${DOMAIN} → this server   (dig +short ${DOMAIN})"
