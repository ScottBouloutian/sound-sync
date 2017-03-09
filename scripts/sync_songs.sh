#!/bin/sh
BASEDIR=$(dirname "$0")
( osascript $BASEDIR/sync_songs.scpt | cw-pipe stdout ) 3>&1 1>&2 2>&3 | cw-pipe stderr
