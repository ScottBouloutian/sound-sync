const getFilename = track => track.title.replace(/[<>:"/\\|*?]/g, '-');

module.exports = { getFilename };
