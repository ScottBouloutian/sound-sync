# SoundSync

Sound Sync is a Node script which downloads your liked tracks on SoundCloud and uploads them to Amazon S3.

# Syncing with iTunes
This utility can be used to sync your SoundCloud tracks to Amazon S3. After wards, you can run the included AppleScript to sync the songs with iTunes.
```
osascript scripts/sync_songs.scpt
```
The included `sync_songs.sh` script is one that I use personally which will send `stdout` and `stderr` to CloudWatch. Note that you will need the `cw-pipe` global npm module.
