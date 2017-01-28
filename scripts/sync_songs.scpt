-- Configuration
set syncPath to "/Users/scott/Music/SoundCloud"
set bucket to "scottbouloutian"
set prefix to "soundcloud"

-- Sync with iTunes
set syncDir to POSIX file syncPath
do shell script "aws s3 sync s3://" & bucket & "/" & prefix & " " & syncPath
tell application "iTunes"
	delete tracks of playlist "SoundCloud"
	add syncDir to playlist "SoundCloud"
end tell
