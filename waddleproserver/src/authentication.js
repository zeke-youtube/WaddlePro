'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
function makeVerifier(password, salt = crypto.randomBytes(16)) {
  if (typeof password !== 'string' || password.length < 1) throw new Error('Waddle ID must not be empty');
  return { salt: salt.toString('hex'), verifier: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function verifyPassword(password, record) {
  try { const salt = Buffer.from(record.salt, 'hex'), expected = Buffer.from(record.verifier, 'hex'); const actual = crypto.scryptSync(password, salt, expected.length); return expected.length === 64 && crypto.timingSafeEqual(expected, actual); } catch { return false; }
}
function writeVerifierFile(filename, password) { const record = makeVerifier(password); fs.writeFileSync(filename, JSON.stringify(record, null, 2), { mode: 0o600 }); return record; }
module.exports = { makeVerifier, verifyPassword, writeVerifierFile };
