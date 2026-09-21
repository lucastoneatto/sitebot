import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function isPrivateIp(ip: string): boolean {
  if (ip.startsWith('10.') || ip.startsWith('127.') || ip.startsWith('0.')) {
    return true;
  }
  if (ip.startsWith('192.168.') || ip.startsWith('169.254.')) {
    return true;
  }
  if (ip.startsWith('172.')) {
    const second = Number(ip.split('.')[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (
    ip === '::1' ||
    ip.startsWith('fe80:') ||
    ip.startsWith('fc') ||
    ip.startsWith('fd')
  ) {
    return true;
  }
  return false;
}

export async function isPublicHost(host: string): Promise<boolean> {
  if (isIP(host)) return !isPrivateIp(host);
  try {
    const addresses = await lookup(host, { all: true });
    if (addresses.length === 0) return false;
    return addresses.every((address) => !isPrivateIp(address.address));
  } catch {
    return false;
  }
}
