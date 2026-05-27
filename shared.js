'use strict';

export const KNOWN_NAMES = {
  'github.com': 'GitHub',
  'stackoverflow.com': 'Stack Overflow',
  'google.com': 'Google',
  'youtube.com': 'YouTube',
  'twitter.com': 'Twitter',
  'x.com': 'X',
  'reddit.com': 'Reddit',
  'linkedin.com': 'LinkedIn',
  'notion.so': 'Notion',
  'figma.com': 'Figma',
  'slack.com': 'Slack',
  'discord.com': 'Discord',
  'medium.com': 'Medium',
  'npmjs.com': 'npm',
  'vercel.com': 'Vercel',
  'aws.amazon.com': 'AWS',
  'mail.google.com': 'Gmail',
  'docs.google.com': 'Google Docs',
  'drive.google.com': 'Google Drive',
  'calendar.google.com': 'Google Calendar',
};

export function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'other';
  }
}

export function getDisplayName(domain) {
  if (KNOWN_NAMES[domain]) return KNOWN_NAMES[domain];
  const parts = domain.split('.');
  if (parts.length >= 1) {
    const name = parts[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return domain;
}

export function isInternalUrl(url) {
  return url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:');
}

export function domainHash(domain) {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = ((hash << 5) - hash + domain.charCodeAt(i)) | 0;
  }
  return hash;
}
