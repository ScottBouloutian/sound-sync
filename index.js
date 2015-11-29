'use strict';

const request = require('request');
const fs = require('fs');
const Datastore = require('nedb')
const SoundCloud = require('soundcloud-nodejs-api-wrapper');
const Q = require('q');

const endpoint = 'https://api.soundcloud.com';

let config, db;

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

function downloadTrack(track) {
    const streamURL = track.stream_url;
    const options = {
        url: streamURL,
        qs: {
            client_id: config.clientID
        }
    };
    const path = config.soundsFolder + '/' + track.id + '.mp3';
    return Q.Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(path);
        const trackRequest = request.get(options).pipe(writeStream).on('close', () => {
            resolve();
        }).on('error', error => {
            reject(error);
        });
    });
}

function checkForExisting(track) {
    return Q.Promise((resolve, reject) => {
        db.find({ id: track.id }, (error, docs) => {
            if(error) {
                reject(error);
            } else {
                resolve((docs.length !==0));
            }
        });
    });
}

function addToDatabase(track) {
    return Q.Promise((resolve, reject) => {
        db.insert(track, (error, docs) => {
            if(error) {
                reject(error);
            } else {
                resolve(docs);
            }
        });
    });
}

function promiseFilter(array, fn) {
    return Q.all(array.map(entry => {
        return Q(fn(entry));
    })).then(results => {
        return array.filter((entry, index) => {
            return results[index];
        });
    });
}

function syncSounds() {
    return getAccessToken(config).then(token => {
        config.accessToken = token;
        return getMe();
    }).then(me => {
        return getFavorites(me.id);
    }).then(favorites => {
        const tracks = favorites.filter(favorite => {
            return favorite.kind === 'track';
        });
        return promiseFilter(tracks, track => {
            return checkForExisting(track).then(exists => {
                return !exists;
            });
        });
    }).then(newTracks => {
        return Q.Promise((resolve, reject, notify) => {
            Q.all(newTracks.map(track => {
                return downloadTrack(track).then(() => {
                    return addToDatabase(track);
                }).then(() => {
                    notify(track);
                });
            })).then(resolve).catch(reject);
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
    db = new Datastore({ filename: config.datastorePath, autoload: true });
    return {
        sync: syncSounds,
        getNumSounds: getNumSounds
    };
};
