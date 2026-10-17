'use strict';

// PikaStudio administrator-managed offline registry. Add approved mappings here
// before publishing a client package update. Keep domain keys lowercase.
// Example records (documentation-only):
//   'zeke.waddle': { ip: '192.168.1.50', port: 8765 },
//   'ian.waddle': { ip: '203.0.113.42', port: 8765 }
const registry = Object.freeze({
    'local.waddle': { ip: '127.0.0.1', port: 8765 }
});

module.exports = registry;
