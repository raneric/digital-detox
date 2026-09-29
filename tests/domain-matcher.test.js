import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DomainMatcher } from '../src/background/domain-matcher.js';

// Expected values follow the Public Suffix List algorithm
// (cf. the official test suite: https://github.com/publicsuffix/list).

test('simple domains strip subdomains', () => {
  assert.equal(DomainMatcher.extractBaseDomain('https://www.instagram.com/p/123'), 'instagram.com');
  assert.equal(DomainMatcher.extractBaseDomain('https://instagram.com'), 'instagram.com');
  assert.equal(DomainMatcher.extractBaseDomain('https://m.facebook.com/feed'), 'facebook.com');
});

test('multi-label public suffixes keep the real registrable domain', () => {
  // The old 2-label heuristic returned "co.uk" here.
  assert.equal(DomainMatcher.extractBaseDomain('https://www.bbc.co.uk/news'), 'bbc.co.uk');
  assert.equal(DomainMatcher.extractBaseDomain('https://example.com.au'), 'example.com.au');
});

test('wildcard and exception rules per the official PSL test suite', () => {
  // `*.ck` with `!www.ck` — official expectations (tests.txt):
  // test.ck -> null (entirely a suffix); b.test.ck -> b.test.ck;
  // www.ck -> www.ck; www.www.ck -> www.ck.
  // For hosts that are entirely a public suffix we return the host itself.
  assert.equal(DomainMatcher.toBaseDomain('www.ck'), 'www.ck'); // exception: registrable
  assert.equal(DomainMatcher.toBaseDomain('www.www.ck'), 'www.ck');
  assert.equal(DomainMatcher.toBaseDomain('b.test.ck'), 'b.test.ck');
  assert.equal(DomainMatcher.toBaseDomain('a.b.test.ck'), 'b.test.ck');
});

test('exception rules: !city.kawasaki.jp per the PSL test suite', () => {
  assert.equal(DomainMatcher.toBaseDomain('city.kawasaki.jp'), 'city.kawasaki.jp');
  assert.equal(DomainMatcher.toBaseDomain('www.city.kawasaki.jp'), 'city.kawasaki.jp');
  assert.equal(DomainMatcher.toBaseDomain('foo.city.kawasaki.jp'), 'city.kawasaki.jp');
});

test('hosts that are entirely a public suffix stay stable', () => {
  assert.equal(DomainMatcher.toBaseDomain('co.uk'), 'co.uk');
  assert.equal(DomainMatcher.toBaseDomain('com'), 'com');
});

test('non-http or invalid URLs return null', () => {
  assert.equal(DomainMatcher.extractBaseDomain('chrome://extensions'), null);
  assert.equal(DomainMatcher.extractBaseDomain('about:blank'), null);
  assert.equal(DomainMatcher.extractBaseDomain('not a url'), null);
  assert.equal(DomainMatcher.extractBaseDomain('http://192.168.1.5/'), null);
  assert.equal(DomainMatcher.extractBaseDomain('http://localhost:3000/'), null);
});

test('matching folds subdomains onto the base domain', () => {
  assert.equal(DomainMatcher.matches('m.twitter.com', 'twitter.com'), true);
  assert.equal(DomainMatcher.matches('twitter.com', 'twitter.com'), true);
  assert.equal(DomainMatcher.matches('not-twitter.com', 'twitter.com'), false);
  assert.equal(DomainMatcher.matches('news.bbc.co.uk', 'bbc.co.uk'), true);
});