#!/usr/bin/env bash
set -e

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_NAME="mailspring-mcp"

# Detect Mailspring packages directory
if [[ -d "$HOME/.var/app/com.getmailspring.Mailspring/config/Mailspring" ]]; then
  TARGET="$HOME/.var/app/com.getmailspring.Mailspring/config/Mailspring/packages"
  # Flatpak needs filesystem access to follow the symlink
  flatpak override --user --filesystem="$PLUGIN_DIR:ro" com.getmailspring.Mailspring
  echo "Granted Flatpak read-only access to $PLUGIN_DIR"
elif [[ -d "$HOME/.config/Mailspring" ]]; then
  TARGET="$HOME/.config/Mailspring/packages"
elif [[ -d "$HOME/Library/Application Support/Mailspring" ]]; then
  TARGET="$HOME/Library/Application Support/Mailspring/packages"
else
  echo "Could not find Mailspring config directory."
  exit 1
fi

mkdir -p "$TARGET"
ln -sfn "$PLUGIN_DIR" "$TARGET/$PLUGIN_NAME"
echo "Linked $PLUGIN_DIR -> $TARGET/$PLUGIN_NAME"
echo "Restart Mailspring to activate the plugin."
