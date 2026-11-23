#!/usr/bin/env bash
# 05b A17 / M-17: one-time owner step. Creates the tablet RELEASE signing key on YOUR machine and stores it in
# GitHub Actions secrets. The key never goes into the repo. Losing it means every device-owner tablet must be
# factory-reset to take a new app, so keep the backup (step 3).
# Needs: keytool (sudo apt install openjdk-21-jdk-headless), gh logged in as the repo owner (gh auth login).
set -euo pipefail
REPO="${REPO:-arsiihere/pos}"
DIR="$HOME/pos-secrets/tablet-release"
KS="$DIR/pos-tablet-release.jks"
ALIAS="pos-tablet"
mkdir -p "$DIR"; chmod 700 "$DIR"
if [ -e "$KS" ]; then echo "Key already exists at $KS — not overwriting. Delete it yourself only if you are sure."; exit 1; fi
PASS="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-28)"   # PKCS12: store and key password are the same
keytool -genkeypair -v -storetype PKCS12 -keystore "$KS" -alias "$ALIAS" -keyalg RSA -keysize 4096 \
  -validity 10950 -storepass "$PASS" -keypass "$PASS" \
  -dname "CN=Arif Chatkhara POS, O=Arif Chatkhara, L=Lahore, C=PK"
umask 077
printf 'alias=%s\nstore_password=%s\nkey_password=%s\n' "$ALIAS" "$PASS" "$PASS" > "$DIR/passwords.txt"
keytool -list -v -keystore "$KS" -storepass "$PASS" | grep -E 'SHA256:' | head -1 | tee "$DIR/sha256.txt"
# 2. GitHub secrets (values go through stdin, never the command line)
base64 -w0 "$KS"  | gh secret set TABLET_RELEASE_KEYSTORE_B64     --repo "$REPO"
printf '%s' "$PASS"  | gh secret set TABLET_RELEASE_STORE_PASSWORD --repo "$REPO"
printf '%s' "$ALIAS" | gh secret set TABLET_RELEASE_KEY_ALIAS      --repo "$REPO"
printf '%s' "$PASS"  | gh secret set TABLET_RELEASE_KEY_PASSWORD   --repo "$REPO"
gh secret list --repo "$REPO" | grep TABLET_RELEASE
echo
echo "Done. 3. BACK UP NOW: copy the folder $DIR (the .jks + passwords.txt) to a USB stick AND your Google Drive."
echo "   Without it, no future app update installs on a device-owner tablet."
