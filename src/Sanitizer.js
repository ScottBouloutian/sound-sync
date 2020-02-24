const emojiRegex = require('emoji-regex');

const regex = emojiRegex();
const getFilename = (track) => (
  track.title
    .replace(/[<>:"/\\|*?]/g, '-')
    .replace(regex, '')
);

module.exports = { getFilename };
