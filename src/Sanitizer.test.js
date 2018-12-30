const test = require('tape');
const Sanitizer = require('./Sanitizer');

test('the Sanitizer library', (t) => {
    t.plan(1);
    t.ok(Sanitizer, 'should exist');
});
