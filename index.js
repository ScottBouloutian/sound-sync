'use strict';

const request = require('request');
const fs = require('fs');
const SoundCloud = require('soundcloud-nodejs-api-wrapper');
const Q = require('q');
const nodeId3 = require('node-id3');
const s3 = require('s3');
const path = require('path');

const endpoint = 'https://api.soundcloud.com';

let config, s3Client;

function getAccessToken() {
    const soundCloud = new SoundCloud({
      client_id : config.clientID,
      client_secret : config.clientSecret,
      username : config.username,
      password: config.password
    });
    const client = soundCloud.client();
    return Q.Promise((resolve, reject) => {
        client.exchange_token((error, result, arg, body) => {
            if(error) {
                reject(error);
            } else {
                resolve(body.access_token);
            }
        });
    });
}

function getMe() {
    const options = {
        url: endpoint + '/me',
        qs: {
            oauth_token: config.accessToken
        }
    };
    return Q.Promise((resolve, reject) => {
        request.get(options, (error, response, body) => {
            if(error) {
                reject(error);
            } else {
                resolve(JSON.parse(body));
            }
        });
    });
}

function getFavorites(id) {
    const options = {
        url: endpoint + '/users/' + id + '/favorites',
        qs: {
            client_id: config.clientID
        }
    };
    return Q.Promise((resolve, reject) => {
        request.get(options, (error, response, body) => {
            if(error) {
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
        qs: {
            client_id: config.clientID
        }
    };
    return Q.Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(file);
        request.get(options).pipe(writeStream).on('close', () => {
            resolve(file);
        }).on('error', error => {
            reject(error);
        });
    });
}

function downloadArtwork(track, file) {
    const thumb = track.artwork_url;
    const options = {
        url: (thumb) ? thumb.replace('-large', '-t500x500') : null,
    };
    return Q.Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(file);
        request.get(options).pipe(writeStream).on('close', () => {
            resolve(file);
        }).on('error', error => {
            reject(error);
        });
    });
}

function writeMetadata(track, file, image) {
    const tags = {
        artist: track.user.username,
        title: track.title,
        genre: track.genre,
        year: String(track.release_year || new Date(track.created_at).getFullYear()),
        image: image
    };
    nodeId3.write(tags, file);
}

function saveTrack(track, file) {
    var params = {
        localFile: file,
        s3Params: {
            Bucket: config.aws.bucket,
            Key: 'soundcloud/' + track.title + '.mp3'
        }
    };
    var uploader = s3Client.uploadFile(params);
    return Q.Promise((resolve, reject) => {
        uploader.on('error', function(error) {
            reject(error);
        });
        uploader.on('end', function() {
            resolve();
        });
    });
}

function filterExistingTracks(tracks) {
    return Q.Promise((resolve, reject) => {
        const params = {
            s3Params: {
                Bucket: config.aws.bucket,
                Prefix: 'soundcloud/'
            }
        };
        const lister = s3Client.listObjects(params);
        let s3Data = [];
        lister.on('data', data => {
            s3Data = s3Data.concat(data.Contents);
        });
        lister.once('error', reject);
        lister.once('end', () => {
            resolve(tracks.filter(track => {
                return s3Data.every(data => {
                    return (data.Key.indexOf(track.title) === -1);
                });
            }));
        });
    });
}

function syncSounds(n) {
    // Create a tmp directory
    try {
      fs.mkdirSync(path.join(__dirname, 'tmp'));
    } catch(e) {
      if ( e.code !== 'EEXIST' ) {
          throw e;
      }
    }

    return getAccessToken(config).then(token => {
        config.accessToken = token;
        return getMe();
    }).then(me => {
        return getFavorites(me.id);
    }).then(favorites => {
        const tracks = favorites.filter(favorite => {
            return favorite.kind === 'track';
        }).slice(0, n || favorites.length);
        return filterExistingTracks(tracks);
    }).then(newTracks => {
        return Q.Promise((resolve, reject, notify) => {
            Q.all(newTracks.map(track => {
                const mediaFile = path.join(__dirname, 'tmp', track.id + '.mp3');
                const imageFile = path.join(__dirname, 'tmp', track.id + '.jpg');

                return Q.all([
                    downloadArtwork(track, imageFile),
                    downloadTrack(track, mediaFile)
                ]).then(() => {
                    return writeMetadata(track, mediaFile, imageFile);
                }).then(() => {
                    fs.unlinkSync(imageFile);
                    return saveTrack(track, mediaFile);
                }).then(() => {
                    fs.unlinkSync(mediaFile);
                    notify(track);
                });
            })).then(() => {
                fs.rmdirSync(path.join(__dirname, 'tmp'));
                resolve();
            }).catch(reject);
        });
    });
}

function getNumSounds() {
    return getAccessToken(config).then(token => {
        config.accessToken = token;
        return getMe();
    }).then(me => {
        return getFavorites(me.id);
    }).then(favorites => {
        const tracks = favorites.filter(favorite => {
            return favorite.kind === 'track';
        });
        return tracks.length;
    });
}

module.exports = cfg => {
    config = cfg;
    s3Client = s3.createClient({
        s3Options: {
            accessKeyId: config.aws.accessKeyId,
            secretAccessKey: config.aws.secretAccessKey
        }
    });
    return {
        sync: syncSounds,
        getNumSounds: getNumSounds
    };
};
