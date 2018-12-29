const request = require('request');
const fs = require('fs');
const Promise = require('bluebird');
const nodeId3 = require('node-id3');
const path = require('path');
const aws = require('aws-sdk');
const SoundCloud = require('./src/SoundCloud');

const s3 = new aws.S3({ region: 'us-east-1' });
const bucket = process.env.SOUND_SYNC_BUCKET;
const listObjects = Promise.promisify(s3.listObjectsV2, { context: s3 });
const upload = Promise.promisify(s3.upload, { context: s3 });

function downloadArtwork(track, file) {
    const thumb = track.artwork_url || track.user.avatar_url;
    const options = { url: thumb.replace('-large', '-t500x500') };
    return new Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(file);
        request.get(options).pipe(writeStream).on('close', () => {
            resolve(file);
        }).on('error', error => reject(error));
    });
}

function writeMetadata(track, file, image) {
    const tags = {
        artist: track.user.username,
        title: track.title,
        genre: track.genre,
        year: String(track.release_year || new Date(track.created_at).getFullYear()),
        image,
    };
    nodeId3.write(tags, file);
}

function saveTrack(track, file) {
    const name = track.title.replace(/\//g, '-');
    const stream = fs.createReadStream(file);
    return upload({
        Bucket: bucket,
        Key: `sound-sync/${name}.mp3`,
        Body: stream,
    });
}

// Lists all music files on s3
function s3ListObjects(token, collection = []) {
    return listObjects({
        Bucket: bucket,
        Prefix: 'sound-sync/',
        ContinuationToken: token,
    }).then(({ IsTruncated, Contents, NextContinuationToken }) => {
        const contents = collection.concat(Contents);
        return IsTruncated
            ? s3ListObjects(NextContinuationToken, contents)
            : contents;
    });
}

function filterExistingTracks(tracks) {
    return s3ListObjects().then(objects => (
        tracks.filter(track => (
            objects.every((data) => {
                const name = track.title.replace(/\//g, '-');
                return (data.Key.indexOf(name) === -1);
            })
        ))
    ));
}

function sync() {
    return SoundCloud.getAllTracks()
        .then((tracks) => {
            console.log(`There are ${tracks.length} tracks on SoundCloud`);
            return filterExistingTracks(tracks);
        })
        .then((newTracks) => {
            console.log(`Downloading ${newTracks.length} new tracks`);
            return new Promise((resolve, reject) => {
                Promise.map(newTracks, (track) => {
                    const mediaFile = path.join(`/tmp/${track.id}.mp3`);
                    const imageFile = path.join(`/tmp/${track.id}.jpg`);

                    return Promise
                        .all([
                            downloadArtwork(track, imageFile),
                            SoundCloud.downloadTrack(track, mediaFile),
                        ])
                        .then(() => writeMetadata(track, mediaFile, imageFile))
                        .then(() => {
                            fs.unlinkSync(imageFile);
                            return saveTrack(track, mediaFile);
                        })
                        .then(() => {
                            fs.unlinkSync(mediaFile);
                            console.log(`[FINISHED] ${track.title}`);
                        })
                        .catch(reject);
                }, { concurrency: 5 }).then(() => {
                    resolve();
                }).catch(reject);
            });
        })
        .then(() => console.log('All done'))
        .catch(error => console.error(error));
}

module.exports = { sync };
