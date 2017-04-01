const request = require('request');
const fs = require('fs');
const SoundCloud = require('soundcloud-nodejs-api-wrapper');
const Promise = require('bluebird');
const nodeId3 = require('node-id3');
const s3 = require('s3');
const path = require('path');
const aws = require('aws-sdk');

const s3Client = s3.createClient({
    s3Client: new aws.S3({ region: 'us-east-1' }),
});
const endpoint = 'https://api.soundcloud.com';
const clientId = process.env.SOUNDCLOUD_CLIENT_ID;
const bucket = process.env.SOUND_SYNC_BUCKET;

function getAccessToken() {
    const soundCloud = new SoundCloud({
        client_id: clientId,
        client_secret: process.env.SOUNDCLOUD_CLIENT_SECRET,
        username: process.env.SOUNDCLOUD_USERNAME,
        password: process.env.SOUNDCLOUD_PASSWORD,
    });
    const client = soundCloud.client();
    return new Promise((resolve, reject) => {
        client.exchange_token((error, result, arg, body) => {
            if (error) {
                reject(error);
            } else {
                resolve(body.access_token);
            }
        });
    });
}

function getMe(token) {
    const options = {
        url: `${endpoint}/me`,
        qs: { oauth_token: token },
    };
    return new Promise((resolve, reject) => {
        request.get(options, (error, response, body) => {
            if (error) {
                reject(error);
            } else {
                resolve(JSON.parse(body));
            }
        });
    });
}

function paginatedRequest(url, collection) {
    const options = {
        url,
        json: true,
    };
    if (collection.length === 0) {
        options.qs = {
            client_id: clientId,
            linked_partitioning: true,
        };
    }
    return new Promise((resolve, reject) => {
        request.get(options, (error, response, body) => {
            if (error) {
                reject(error);
            } else {
                const result = ('next_href' in body) ?
                    paginatedRequest(body.next_href, collection.concat(body.collection)) :
                    collection;
                resolve(result);
            }
        });
    });
}

function getFavorites(id) {
    return paginatedRequest(`${endpoint}/users/${id}/favorites`, []);
}

function getPlaylists(id) {
    const options = {
        url: `${endpoint}/users/${id}/playlists`,
        qs: { client_id: clientId },
    };
    return new Promise((resolve, reject) => {
        request.get(options, (error, response, body) => {
            if (error) {
                reject(error);
            } else {
                resolve(JSON.parse(body));
            }
        });
    });
}

function downloadTrack(track, file) {
    const streamURL = track.stream_url;
    const options = {
        url: streamURL,
        qs: { client_id: clientId },
    };
    return new Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(file);
        request.get(options).pipe(writeStream).on('close', () => {
            resolve(file);
        }).on('error', error => reject(error));
    });
}

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
    const params = {
        localFile: file,
        s3Params: {
            Bucket: bucket,
            Key: `sound-sync/${name}.mp3`,
        },
    };
    const uploader = s3Client.uploadFile(params);
    return new Promise((resolve, reject) => {
        uploader.on('error', error => reject(error));
        uploader.on('end', () => resolve());
    });
}

function filterExistingTracks(tracks) {
    return new Promise((resolve, reject) => {
        const params = {
            s3Params: {
                Bucket: bucket,
                Prefix: 'sound-sync/',
            },
        };
        const lister = s3Client.listObjects(params);
        let s3Data = [];
        lister.on('data', (data) => {
            s3Data = s3Data.concat(data.Contents);
        });
        lister.once('error', reject);
        lister.once('end', () => (
            resolve(tracks.filter(track => (
                s3Data.every((data) => {
                    const name = track.title.replace(/\//g, '-');
                    return (data.Key.indexOf(name) === -1);
                })
            )))
        ));
    });
}

function sync(n) {
    return getAccessToken()
    .then(token => getMe(token))
    .then(me => (
        Promise.all([
            getFavorites(me.id),
            getPlaylists(me.id),
        ])
        .then((results) => {
            const favorites = results[0];
            const playlists = results[1];

            return playlists
            .map(playlist => playlist.tracks)
            .reduce((array, next) => array.concat(next), favorites);
        })
    ))
    .then((myTracks) => {
        const tracks = myTracks.filter(myTrack => (
            myTrack.kind === 'track' && ('stream_url' in myTrack)
        )).slice(0, n || myTracks.length);
        return filterExistingTracks(tracks);
    })
    .then(newTracks => (
        new Promise((resolve, reject) => {
            Promise.map(newTracks, (track) => {
                const mediaFile = path.join(`/tmp/${track.id}.mp3`);
                const imageFile = path.join(`/tmp/${track.id}.jpg`);

                return Promise.all([
                    downloadArtwork(track, imageFile),
                    downloadTrack(track, mediaFile),
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
            }, { concurrency: 20 }).then(() => {
                resolve();
            }).catch(reject);
        })
    ));
}

module.exports = { sync };
