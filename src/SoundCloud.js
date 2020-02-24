const fs = require('fs');
const SoundCloud = require('soundcloud-nodejs-api-wrapper');
const request = require('request');

const endpoint = 'https://api.soundcloud.com';
const clientId = process.env.SOUNDCLOUD_CLIENT_ID;

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
      const { statusCode } = response;
      if (error || statusCode !== 200) {
        reject(error || `code ${statusCode}`);
      } else {
        const objects = collection.concat(body.collection);
        const result = ('next_href' in body)
          ? paginatedRequest(body.next_href, objects)
          : objects;
        resolve(result);
      }
    });
  });
}

function getFavorites(id) {
  return paginatedRequest(`${endpoint}/users/${id}/favorites`, []);
}

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
    }).on('error', (error) => reject(error));
  });
}

function getAllTracks() {
  return getAccessToken()
    .then((token) => getMe(token))
    .then((me) => (
      Promise
        .all([
          getFavorites(me.id),
          getPlaylists(me.id),
        ])
        .then((results) => {
          const favorites = results[0];
          const playlists = results[1];
          return playlists
            .map((playlist) => playlist.tracks)
            .reduce((array, next) => array.concat(next), favorites);
        })
    ))
    .then((myTracks) => (
      myTracks.filter((myTrack) => (
        myTrack.kind === 'track' && ('stream_url' in myTrack)
      ))
    ));
}

module.exports = {
  getAllTracks,
  downloadTrack,
};
