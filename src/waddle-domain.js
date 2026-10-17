'use strict';
const net = require('node:net');
const registry = require('./waddle-registry');

const DEFAULT_PORT = 8765;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function validateDomain(domain) {
  if (typeof domain !== 'string' || domain.length > 253 || !domain.toLowerCase().endsWith('.waddle')) return false;
  const labels = domain.slice(0, -'.waddle'.length).split('.');
  return labels.length > 0 && labels.every(label => LABEL.test(label));
}

function validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  if (typeof record.ip !== 'string' || net.isIP(record.ip) === 0) return false;
  if (record.port !== undefined && (!Number.isInteger(record.port) || record.port < 1 || record.port > 65535)) return false;
  return true;
}

function resolveWaddleDomain(domain, portOverride, source = registry) {
  if (!validateDomain(domain)) throw new Error('Invalid .waddle domain');
  const normalized = domain.toLowerCase();
  if (!source || typeof source !== 'object' || !Object.hasOwn(source, normalized)) return null;
  const record = source[normalized];
  if (!validateRecord(record)) throw new Error(`Invalid registry entry for ${normalized}`);
  if (portOverride !== undefined && (!Number.isInteger(portOverride) || portOverride < 1 || portOverride > 65535)) throw new Error('Port must be from 1 to 65535');
  return { domain: normalized, ip: record.ip, port: portOverride ?? record.port ?? DEFAULT_PORT };
}

module.exports = { DEFAULT_PORT, validateDomain, validateRecord, resolveWaddleDomain };
