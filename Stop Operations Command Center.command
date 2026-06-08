#!/bin/bash
cd "$(dirname "$0")"
./scripts/local_mac_stop.sh
read -p "Stopped. Press Enter to close..." _
