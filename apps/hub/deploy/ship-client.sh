#!/usr/bin/env bash
# Ship the built /admin/stock and /staff pages to a stopped hub (01a S39 d, e; §7.8 hub release step 5;
# 01d task 41 adds the staff entry).
# Run on the developer machine, on the restaurant LAN, after `pnpm test` built apps/client/dist/ at the
# release commit and the hub was stopped and checked out at the same commit. Refuses while
# `systemctl is-active hub` reports anything but inactive or failed on the target (D6). Uses only bash, git, tar, ssh.
set -euo pipefail

REMOTE_DIST=/opt/pos-hub/apps/client/dist
REMOTE_CHECKOUT=/opt/pos-hub
# Each build is checked, copied and swapped on its own; a refused check ships nothing.
BUILDS=(admin-stock staff)

fail() {
  echo "ship-client: $1" >&2
  exit 1
}

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "usage: apps/hub/deploy/ship-client.sh <ssh-target>" >&2
  exit 2
fi
target="$1"

cd "$(git rev-parse --show-toplevel)"

# (a) a clean tree and a build to ship.
if [ -n "$(git status --porcelain)" ]; then
  fail "tree is dirty; commit or stash, then rebuild with pnpm test"
fi
for build in "${BUILDS[@]}"; do
  if [ ! -f "apps/client/dist/$build/index.html" ]; then
    fail "build output missing: apps/client/dist/$build/index.html (run pnpm test first)"
  fi
done

# (b) the hub service must be stopped, so no restart can pair new code with an old page.
state=""
rc=0
state="$(ssh "$target" systemctl is-active hub)" || rc=$?
if [ "$rc" -eq 255 ]; then
  fail "cannot reach $target over ssh"
fi
# D6: only a stopped service ships; activating, deactivating, reloading and active all refuse.
if [ "$state" != "inactive" ] && [ "$state" != "failed" ]; then
  fail "hub service is ${state:-in an unknown state} on $target; stop it first (ssh $target sudo systemctl stop hub)"
fi

# (c) the hub checkout must be at the commit the page was built from.
local_head="$(git rev-parse HEAD)"
remote_head="$(ssh "$target" git -C "$REMOTE_CHECKOUT" rev-parse HEAD)" || fail "cannot read the hub checkout's HEAD on $target"
if [ "$remote_head" != "$local_head" ]; then
  fail "hub checkout is at $remote_head, local HEAD is $local_head; check out the same tag on the hub"
fi

for build in "${BUILDS[@]}"; do
  # (d) stream the build into a staging folder on the hub.
  tar -C apps/client/dist -cf - "$build" |
    ssh "$target" "rm -rf '$REMOTE_DIST/$build.new' && mkdir -p '$REMOTE_DIST/$build.new' && tar -C '$REMOTE_DIST/$build.new' --strip-components=1 -xf -" ||
    fail "copy of $build to $target failed; the hub's current $build page is unchanged"

  # (e) swap it in with mv, so a broken copy never replaces a good one.
  ssh "$target" "cd '$REMOTE_DIST' && if [ -e '$build' ]; then rm -rf '$build.old' && mv '$build' '$build.old'; fi && mv '$build.new' '$build' && rm -rf '$build.old'" ||
    fail "swap of $build on $target failed; check $REMOTE_DIST by hand"
done

echo "ship-client: ${BUILDS[*]} shipped to $target at $local_head"
