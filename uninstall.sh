#!/usr/bin/env bash
set -e

PLUGIN_NAME="mailspring-mcp"

for DIR in \
  "$HOME/.var/app/com.getmailspring.Mailspring/config/Mailspring/packages" \
  "$HOME/.config/Mailspring/packages" \
  "$HOME/Library/Application Support/Mailspring/packages"; do
  LINK="$DIR/$PLUGIN_NAME"
  if [[ -L "$LINK" ]]; then
    rm "$LINK"
    echo "Removed $LINK"
    echo "Restart Mailspring to complete uninstall."
    exit 0
  fi
done

echo "Symlink not found — plugin may not be installed."
