import { ServiceUnavailableException } from '@nestjs/common';
import { normalizeIp } from '@nestjs/throttler';
import type { Request } from 'express';
import { isIP } from 'node:net';
import { recordRequestCategory } from './request-audit';

// Railway's public HTTP edge supplies X-Real-IP. This mode must not be used
// behind a TCP proxy or for untrusted private-network callers (no HTTP edge).
export function validateClientIpConfiguration(): 'socket' | 'railway-edge' {
  // Platform metadata may forbid an unsafe default, but never grants trust.
  // Edge mode is an operator's explicit decision after ingress isolation review.
  const hasRailwayMetadata = [
    'RAILWAY_PROJECT_ID',
    'RAILWAY_ENVIRONMENT_ID',
    'RAILWAY_SERVICE_ID',
  ].some((key) => process.env[key] !== undefined);
  const source =
    process.env.CLIENT_IP_SOURCE ?? (hasRailwayMetadata ? undefined : 'socket');
  if (source !== 'socket' && source !== 'railway-edge') {
    recordRequestCategory('client_ip_unavailable');
    throw new ServiceUnavailableException(
      'La identificación del cliente no está disponible.',
    );
  }
  return source;
}

export function resolveClientIp(req: Request): string {
  const source = validateClientIpConfiguration();
  const value =
    source === 'railway-edge'
      ? req.headers['x-real-ip']
      : req.socket.remoteAddress;
  // A list/duplicate or missing/malformed address must never fall back to XFF,
  // CF-Connecting-IP or req.ip. Otherwise a caller could change tracker buckets.
  if (typeof value !== 'string' || !isIP(value.trim())) {
    recordRequestCategory('client_ip_unavailable');
    throw new ServiceUnavailableException(
      'La identificación del cliente no está disponible.',
    );
  }
  // Canonical address for sessions/provider remoteip (not an IPv6 subnet).
  return normalizeIp(value.trim(), 128).replace(/\/128$/, '');
}
