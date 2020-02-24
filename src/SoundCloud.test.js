const test = require('tape');
const SoundCloud = require('./SoundCloud');

test('the SoundCloud library', (t) => {
  t.plan(1);
  t.ok(SoundCloud, 'should exist');
});
