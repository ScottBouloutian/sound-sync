const request = require('request');
const fs = require('fs');
const Promise = require('bluebird');
const nodeId3 = require('node-id3');
const path = require('path');
const aws = require('aws-sdk');
const _ = require('lodash/fp');
const winston = require('winston');
const SoundCloud = require('./src/SoundCloud');
const Sanitizer = require('./src/Sanitizer');

const s3 = new aws.S3({ region: 'us-east-1' });
const bucket = process.env.SOUND_SYNC_BUCKET;
const maxSyncedTracks = process.env.MAX_SYNCED_TRACKS;
const listObjects = Promise.promisify(s3.listObjectsV2, { context: s3 });
const upload = Promise.promisify(s3.upload, { context: s3 });
const logger = winston.createLogger({
  transports: [
    new winston.transports.Console(),
  ],
});

function downloadArtwork(track, file) {
  const thumb = track.artwork_url || track.user.avatar_url;
  const url = thumb.replace('-large', '-t500x500');
  const options = { url };
  logger.info(`Downloading artwork from ${url}`);
  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(file);
    request.get(options).pipe(writeStream).on('close', () => {
      resolve(file);
    }).on('error', (error) => reject(error));
  });
}

function writeMetadata(track, file, image) {
  const tags = {
    album: track.user.username,
    artist: track.user.full_name,
    title: track.title,
    genre: track.genre,
    year: String(track.release_year || new Date(track.created_at).getFullYear()),
    image,
  };
  nodeId3.write(tags, file);
}

function saveTrack(track, file) {
  const name = Sanitizer.getFilename(track);
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
  return s3ListObjects().then((objects) => (
    _.flow(
      _.filter((track) => (
        _.every((data) => {
          const name = Sanitizer.getFilename(track);
          return (data.Key.indexOf(name) === -1);
        })(objects)
      )),
      _.take(maxSyncedTracks),
    )(tracks)
  ));
}

function sync() {
  return SoundCloud.getAllTracks()
    .then((tracks) => {
      logger.info(`There are ${tracks.length} tracks on SoundCloud`);
      return filterExistingTracks(tracks);
    })
    .then((newTracks) => {
      logger.info(`Downloading ${newTracks.length} new tracks`);
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
              logger.info(`[FINISHED] ${track.title}`);
            })
            .catch(reject);
        }, { concurrency: 5 }).then(() => {
          resolve();
        }).catch(reject);
      });
    })
    .then(() => {
      logger.info('All done');
    })
    .catch((error) => {
      logger.error(error);
    });
}

module.exports = { sync };
