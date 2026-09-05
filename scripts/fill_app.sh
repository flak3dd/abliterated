#!/bin/bash
set -e
APP=/Users/adminuser/abliterated/docs/APP.md
P=/Users/adminuser/abliterated/scripts/push_md.py
py(){ python3 "$P" "$APP" "$1"; }
py ""
py "---"
py ""
py "## Requirements"
