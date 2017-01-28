'use strict';

const request = require('request');
const fs = require('fs');
const SoundCloud = require('soundcloud-nodejs-api-wrapper');
const Promise = require('bluebird');
const nodeId3 = require('node-id3');
const s3 = require('s3');
const path = require('path');
const privateLib = require('private');

const endpoint = 'https://api.soundcloud.com';

class Private {
    getAccessToken() {
        const soundCloud = new SoundCloud({
          client_id : this.config.clientID,
          client_secret : this.config.clientSecret,
          username : this.config.username,
          password: this.config.password
        });
        const client = soundCloud.client();
        return new Promise((resolve, reject) => {
            client.exchange_token((error, result, arg, body) => {
                if(error) {
                    reject(error);
                } else {
                    resolve(body.access_token);
                }
            });
        });
    }

    getMe(token) {
        const options = {
            url: endpoint + '/me',
            qs: {
                oauth_token: token
            }
        };
        return new Promise((resolve, reject) => {
            request.get(options, (error, response, body) => {
                if(error) {
                    reject(error);
                } else {
                    resolve(JSON.parse(body));
                }
            });
        });
    }

    paginatedRequest(url, collection) {
        const options = {
            url: url,
            json: true
        };
        if (collection.length === 0) {
            options.qs = {
                client_id: this.config.clientID,
                linked_partitioning: true
            }
        }
        return new Promise((resolve, reject) => {
            request.get(options, (error, response, body) => {
                if(error) {
                    reject(error);
                } else {
                    const result = ('next_href' in body) ?
                        this.paginatedRequest(body.next_href, collection.concat(body.collection)) :
                        collection;
                    resolve(result);
                }
            });
        });
    }

    getFavorites(id) {
        return this.paginatedRequest(`${endpoint}/users/${id}/favorites`, []);
    }

    getPlaylists(id) {
        const options = {
            url: endpoint + `/users/${id}/playlists`,
            qs: {
                client_id: this.config.clientID
            }
        };
        return new Promise((resolve, reject) => {
            request.get(options, (error, response, body) => {
                if(error) {
                    reject(error);
                } else {
                    resolve(JSON.parse(body));
                }
            });
        });
    }

    downloadTrack(track, file) {
        const streamURL = track.stream_url;
        const options = {
            url: streamURL,
            qs: {
                client_id: this.config.clientID
            }
        };
        return new Promise((resolve, reject) => {
            const writeStream = fs.createWriteStream(file);
            request.get(options).pipe(writeStream).on('close', () => {
                resolve(file);
            }).on('error', error => {
                reject(error);
            });
        });
    }

    downloadArtwork(track, file) {
        const thumb = track.artwork_url || track.user.avatar_url;
        const options = {
            url: thumb.replace('-large', '-t500x500')
        };
        return new Promise((resolve, reject) => {
            const writeStream = fs.createWriteStream(file);
            request.get(options).pipe(writeStream).on('close', () => {
                resolve(file);
            }).on('error', error => {
                reject(error);
            });
        });
    }

    writeMetadata(track, file, image) {
        const tags = {
            artist: track.user.username,
            title: track.title,
            genre: track.genre,
            year: String(track.release_year || new Date(track.created_at).getFullYear()),
            image: image
        };
        nodeId3.write(tags, file);
    }

    saveTrack(track, file) {
        const name = track.title.replace(/\//g, '-');
        const params = {
            localFile: file,
            s3Params: {
                Bucket: this.config.aws.bucket,
                Key: `soundcloud/${name}.mp3`
            }
        };
        const uploader = this.s3Client.uploadFile(params);
        return new Promise((resolve, reject) => {
            uploader.on('error', function(error) {
                reject(error);
            });
            uploader.on('end', function() {
                resolve();
            });
        });
    }

    filterExistingTracks(tracks) {
        return new Promise((resolve, reject) => {
            const params = {
                s3Params: {
                    Bucket: this.config.aws.bucket,
                    Prefix: 'soundcloud/'
                }
            };
            const lister = this.s3Client.listObjects(params);
            let s3Data = [];
            lister.on('data', data => {
                s3Data = s3Data.concat(data.Contents);
            });
            lister.once('error', reject);
            lister.once('end', () => {
                resolve(tracks.filter(track => {
                    return s3Data.every(data => {
                        const name = track.title.replace(/\//g, '-');
                        return (data.Key.indexOf(name) === -1);
                    });
                }));
            });
        });
    }
}
const _ = privateLib.makeAccessor(() => new Private());

class SoundSync {
    constructor(config) {
        _(this).config = config;
        _(this).s3Client = s3.createClient({
            s3Options: {
                accessKeyId: config.aws.accessKeyId,
                secretAccessKey: config.aws.secretAccessKey
            }
        });
    }

    sync(n) {
        return _(this).getAccessToken().then(token => {
            return _(this).getMe(token);
        }).then(me => {
            return Promise.all([
                _(this).getFavorites(me.id),
                _(this).getPlaylists(me.id)
            ]).then(results => {
                const favorites = results[0];
                const playlists = results[1];

                return playlists.map(function(playlist) {
                    return playlist.tracks;
                }).reduce(function(array, next) {
                    return array.concat(next);
                }, favorites);
            });
        }).then(myTracks => {
            const tracks = myTracks.filter(myTrack => {
                return (myTrack.kind === 'track' && 'stream_url' in myTrack);
            }).slice(0, n || myTracks.length);
            return _(this).filterExistingTracks(tracks);
        }).then(newTracks => {
            return new Promise((resolve, reject) => {
                Promise.map(newTracks, track => {
                    const mediaFile = path.join(_(this).config.workingDir, track.id + '.mp3');
                    const imageFile = path.join(_(this).config.workingDir, track.id + '.jpg');

                    return Promise.all([
                        _(this).downloadArtwork(track, imageFile),
                        _(this).downloadTrack(track, mediaFile)
                    ]).then(() => {
                        return _(this).writeMetadata(track, mediaFile, imageFile);
                    }).then(() => {
                        fs.unlinkSync(imageFile);
                        return _(this).saveTrack(track, mediaFile);
                    }).then(() => {
                        fs.unlinkSync(mediaFile);
                        console.log(`[FINISHED] ${track.title}`);
                    }).catch(reject);
                }, { concurrency: 20 }).then(() => {
                    resolve();
                }).catch(reject);
            });
        });
    }
}
module.exports = SoundSync;
